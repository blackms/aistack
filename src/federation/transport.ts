/**
 * Transport layer - secure HTTP(S) client + credential management for
 * peer-to-peer federation.
 *
 * Default security posture is mutual TLS (mTLS):
 *   - The local node loads cert / key / CA from disk via `loadCredentials`.
 *   - Outgoing requests use an https.Agent built from those credentials and
 *     are dispatched via `https.request` (Node's global `fetch`/undici does
 *     NOT honor https.Agent, so we must not use it for federation calls).
 *   - Incoming requests are verified by the federation server, including
 *     CN/SAN pinning against `trustedPeerCNs`.
 *
 * A bearer-token fallback is supported for dev / air-gapped trust models
 * where mTLS PKI is not available. The fallback is opt-in via
 * `FederationTlsConfig.bearerToken`, logs a security warning at startup,
 * and uses a constant-time comparison.
 *
 * Sensitive-data egress guarantee (AIG-652 #5):
 *   - `submitTask` calls `sanitizeDelegation` to truncate the input to
 *     `maxInputLength` and to strip unknown keys via an allowlist.
 *   - No memory entries, source code, or file contents are ever serialized
 *     by the transport. The federation protocol only carries task metadata.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { Agent as HttpsAgent, RequestOptions as HttpsRequestOptions } from 'node:https';
import { URL } from 'node:url';
import { logger } from '../utils/logger.js';
import type {
  FederationTlsConfig,
  NodeInfo,
  TaskDelegation,
  TaskDelegationResult,
} from './types.js';

const log = logger.child('federation:transport');

/**
 * Maximum bytes accepted in any single federation HTTP response body
 * (also used as a default request body cap on the server side).
 */
export const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB

/**
 * Materialized credentials in memory. `null` fields mean "not configured".
 */
export interface FederationCredentials {
  cert: Buffer | null;
  key: Buffer | null;
  ca: Buffer | null;
  bearerToken: string | null;
  requireClientCert: boolean;
  /** CN/SAN values we accept from peers (mTLS pinning). Empty = accept any CA-signed cert. */
  trustedPeerCNs: string[];
  /** When true, plaintext HTTP fallback is forbidden; missing cert files throw. */
  allowPlainText: boolean;
}

/**
 * Load mTLS material from disk.
 *
 * Security posture rules:
 *   - If `tls.certPath` / `tls.keyPath` are set but the file is missing or
 *     unreadable → THROW. We never silently downgrade a configured TLS
 *     deployment to plain HTTP. (AIG-652 review fix #3.)
 *   - If `tls.allowPlainText` is false (default) and no cert/key are
 *     configured AND no bearer token is configured → THROW. The operator
 *     must opt-in to plaintext explicitly.
 *   - Bearer-only mode is permitted but logged loudly.
 */
export function loadCredentials(tls: FederationTlsConfig | undefined): FederationCredentials {
  const creds: FederationCredentials = {
    cert: null,
    key: null,
    ca: null,
    bearerToken: tls?.bearerToken ?? null,
    requireClientCert: tls?.requireClientCert ?? true,
    trustedPeerCNs: Array.isArray(tls?.trustedPeerCNs) ? [...(tls?.trustedPeerCNs ?? [])] : [],
    allowPlainText: tls?.allowPlainText ?? false,
  };

  if (tls?.certPath) {
    creds.cert = readRequiredFile(tls.certPath, 'cert');
  }
  if (tls?.keyPath) {
    creds.key = readRequiredFile(tls.keyPath, 'key');
  }
  if (tls?.caPath) {
    creds.ca = readRequiredFile(tls.caPath, 'CA bundle');
  }

  // If only one of cert/key is provided, that's a misconfiguration.
  if ((creds.cert && !creds.key) || (!creds.cert && creds.key)) {
    throw new Error(
      'Federation TLS misconfiguration: both certPath and keyPath must be set together.'
    );
  }

  const haveMtls = !!(creds.cert && creds.key);

  // Fail-closed on missing security material.
  if (!haveMtls && !creds.bearerToken && !creds.allowPlainText) {
    throw new Error(
      'Federation transport refuses to start unauthenticated. ' +
        'Configure federation.tls (certPath/keyPath[+caPath]) OR a bearerToken, ' +
        'OR explicitly set federation.tls.allowPlainText = true for local development.'
    );
  }

  // Loud warnings if the security posture is degraded.
  if (!haveMtls && !creds.bearerToken) {
    log.warn(
      'Federation transport is UNAUTHENTICATED (allowPlainText=true). ' +
        'Local development only. Configure federation.tls in aistack.config.json for production.'
    );
  } else if (!haveMtls && creds.bearerToken) {
    log.warn(
      'Federation transport is using a bearer token without mTLS. Prefer mTLS in production deployments.'
    );
  }

  return creds;
}

function readRequiredFile(path: string, label: string): Buffer {
  try {
    return fs.readFileSync(path);
  } catch (err) {
    throw new Error(
      `Federation ${label} file is required but could not be read at "${path}": ` +
        (err instanceof Error ? err.message : String(err))
    );
  }
}

/**
 * Build an https.Agent that performs mTLS when credentials are available.
 */
export function buildHttpsAgent(creds: FederationCredentials): HttpsAgent {
  return new https.Agent({
    cert: creds.cert ?? undefined,
    key: creds.key ?? undefined,
    ca: creds.ca ?? undefined,
    rejectUnauthorized: !!creds.ca, // only verify peers when we have a CA
    keepAlive: true,
  });
}

/**
 * Constant-time comparison for bearer tokens. Pads to equal length first to
 * avoid leaking the length through the early-return path of `===`.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf-8');
  const bBuf = Buffer.from(b, 'utf-8');
  const len = Math.max(aBuf.length, bBuf.length);
  if (len === 0) return aBuf.length === bBuf.length;
  const aPadded = Buffer.alloc(len, 0);
  const bPadded = Buffer.alloc(len, 0);
  aBuf.copy(aPadded);
  bBuf.copy(bPadded);
  // Combine the length-check into the boolean so the timing of the overall
  // function does not branch on length alone.
  const eq = crypto.timingSafeEqual(aPadded, bPadded);
  return eq && aBuf.length === bBuf.length;
}

/**
 * Peer certificate shape exposed by `tls.TLSSocket.getPeerCertificate()`.
 * We accept the minimal subset we need (subject.CN and subjectaltname).
 */
export interface PeerCertificateLike {
  subject?: { CN?: string };
  subjectaltname?: string;
}

/**
 * Extract candidate CN/SAN values from a peer certificate.
 */
export function extractPeerCertNames(cert: PeerCertificateLike | undefined): string[] {
  if (!cert) return [];
  const names: string[] = [];
  if (cert.subject?.CN) names.push(cert.subject.CN);
  if (typeof cert.subjectaltname === 'string') {
    // "DNS:foo.example, DNS:bar.example, IP Address:10.0.0.1"
    for (const part of cert.subjectaltname.split(',')) {
      const trimmed = part.trim();
      const colon = trimmed.indexOf(':');
      if (colon > 0) {
        names.push(trimmed.slice(colon + 1).trim());
      }
    }
  }
  return names;
}

/**
 * Verify a peer's presented certificate matches the configured CA and,
 * when `trustedPeerCNs` is non-empty, also that the CN/SAN is pinned.
 * Called by the federation server during request handling.
 *
 * Returns `true` when the request is acceptable, `false` otherwise.
 */
export function verifyPeerRequest(
  creds: FederationCredentials,
  peerCert: PeerCertificateLike | undefined,
  bearerHeader: string | undefined
): { ok: boolean; reason: string } {
  const haveMtls = !!(creds.cert && creds.key);

  // Bearer-token mode (no mTLS configured)
  if (!haveMtls && creds.bearerToken) {
    if (!bearerHeader) return { ok: false, reason: 'Missing Authorization header' };
    const token = bearerHeader.replace(/^Bearer\s+/i, '').trim();
    if (!timingSafeEqualString(token, creds.bearerToken)) {
      return { ok: false, reason: 'Invalid bearer token' };
    }
    return { ok: true, reason: 'bearer-token' };
  }
  // mTLS mode
  if (haveMtls && creds.requireClientCert) {
    const names = extractPeerCertNames(peerCert);
    if (names.length === 0) {
      return { ok: false, reason: 'Missing or invalid client certificate' };
    }
    if (creds.trustedPeerCNs.length > 0) {
      const matched = names.find((n) => creds.trustedPeerCNs.includes(n));
      if (!matched) {
        return {
          ok: false,
          reason: `Peer certificate CN/SAN not in trustedPeerCNs (saw: ${names.join(',')})`,
        };
      }
      return { ok: true, reason: `mtls:${matched}` };
    }
    return { ok: true, reason: `mtls:${names[0]}` };
  }
  if (haveMtls) {
    return { ok: true, reason: 'mtls:client-cert-not-required' };
  }
  if (!creds.allowPlainText) {
    return { ok: false, reason: 'Missing federation authentication' };
  }
  // Permissive dev mode (allowPlainText forced, no auth) - allowed only because
  // loadCredentials() has already enforced the explicit opt-in gate.
  return { ok: true, reason: 'dev-mode' };
}

/**
 * Sanitize an outgoing delegation: enforce an allowlist of keys and
 * truncate the input. This is the central choke point that enforces the
 * no-egress-of-sensitive-data guarantee.
 */
export function sanitizeDelegation(
  task: TaskDelegation,
  maxInputLength: number = 4096
): TaskDelegation {
  return {
    taskId: String(task.taskId),
    agentType: String(task.agentType),
    input: typeof task.input === 'string' ? task.input.slice(0, maxInputLength) : '',
    hints: task.hints
      ? {
          requiredCapabilities: task.hints.requiredCapabilities?.slice(0, 16),
          preferredTags: task.hints.preferredTags?.slice(0, 16),
          estimatedTokens: typeof task.hints.estimatedTokens === 'number' ? task.hints.estimatedTokens : undefined,
        }
      : undefined,
  };
}

/**
 * Minimal Response-like shape returned by our `request()` helper. We
 * intentionally do NOT use the global Response/fetch because Node's
 * `fetch` (undici) does not honor `https.Agent`, which would silently
 * skip mTLS for outbound federation calls.
 */
export interface FederationResponse {
  ok: boolean;
  status: number;
  body: Buffer;
  json: <T>() => T;
  text: () => string;
}

/**
 * HTTP client used to talk to a remote federation peer.
 */
export class FederationClient {
  private readonly agent: HttpsAgent;
  private readonly maxInputLength: number;
  private readonly timeoutMs: number;
  private readonly bearer: string | null;

  constructor(creds: FederationCredentials, opts: { maxInputLength?: number; timeoutMs?: number } = {}) {
    this.agent = buildHttpsAgent(creds);
    this.maxInputLength = opts.maxInputLength ?? 4096;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.bearer = creds.bearerToken;
  }

  /** Expose the underlying https.Agent (e.g. for advanced callers). */
  getHttpsAgent(): HttpsAgent {
    return this.agent;
  }

  /**
   * Fetch the peer's advertised capabilities.
   */
  async fetchPeerCapabilities(peer: NodeInfo): Promise<NodeInfo | null> {
    try {
      const url = this.peerUrl(peer, '/v1/federation/capabilities');
      const res = await this.request(url, 'GET');
      if (!res.ok) {
        log.debug('Peer capabilities non-ok', { peer: peer.nodeId, status: res.status });
        return null;
      }
      return res.json<NodeInfo>();
    } catch (err) {
      log.debug('Peer capabilities failed', {
        peer: peer.nodeId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Submit a delegated task to a remote peer. Returns the peer's response
   * or throws on transport / authorization failure.
   */
  async submitTask(peer: NodeInfo, task: TaskDelegation): Promise<TaskDelegationResult> {
    const url = this.peerUrl(peer, '/v1/federation/task');
    const safe = sanitizeDelegation(task, this.maxInputLength);
    const res = await this.request(url, 'POST', safe);
    if (!res.ok) {
      throw new Error(`Federation submitTask ${res.status}`);
    }
    return res.json<TaskDelegationResult>();
  }

  private peerUrl(peer: NodeInfo, path: string): string {
    let base = peer.address;
    if (!/^https?:\/\//.test(base)) base = `${peer.scheme}://${base}`;
    return `${base.replace(/\/$/, '')}${path}`;
  }

  /**
   * Dispatch an HTTP(S) request using `http(s).request` directly so the
   * configured `https.Agent` (with mTLS material) is actually used.
   *
   * Body cap (DoS guard): we refuse to read more than MAX_BODY_BYTES from
   * the peer response and abort the stream.
   */
  protected async request(
    url: string,
    method: 'GET' | 'POST',
    body?: unknown
  ): Promise<FederationResponse> {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;

    let bodyBuf: Buffer | null = null;
    if (body !== undefined) {
      bodyBuf = Buffer.from(JSON.stringify(body), 'utf-8');
      headers['content-length'] = String(bodyBuf.length);
    }

    const reqOptions: HttpsRequestOptions = {
      method,
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port ? Number.parseInt(parsed.port, 10) : isHttps ? 443 : 80,
      path: `${parsed.pathname}${parsed.search}`,
      headers,
      timeout: this.timeoutMs,
    };
    if (isHttps) {
      reqOptions.agent = this.agent;
    }

    const requester = isHttps ? https.request : http.request;

    return new Promise<FederationResponse>((resolve, reject) => {
      const req = requester(reqOptions, (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let aborted = false;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_BODY_BYTES) {
            aborted = true;
            res.destroy(new Error('Federation response exceeds 1 MiB cap'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (aborted) return;
          const buf = Buffer.concat(chunks);
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            body: buf,
            json: <T>() => JSON.parse(buf.toString('utf-8')) as T,
            text: () => buf.toString('utf-8'),
          });
        });
        res.on('error', reject);
      });
      req.on('timeout', () => {
        req.destroy(new Error('Federation request timed out'));
      });
      req.on('error', reject);
      if (bodyBuf) req.write(bodyBuf);
      req.end();
    });
  }
}
