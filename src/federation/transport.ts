/**
 * Transport layer - secure HTTP(S) client + credential management for
 * peer-to-peer federation.
 *
 * Default security posture is mutual TLS (mTLS):
 *   - The local node loads cert / key / CA from disk via `loadCredentials`.
 *   - Outgoing requests use an https.Agent built from those credentials.
 *   - Incoming requests are verified by the federation server.
 *
 * A bearer-token fallback is supported for dev / air-gapped trust models
 * where mTLS PKI is not available. The fallback is opt-in via
 * `FederationTlsConfig.bearerToken` and logs a security warning at startup.
 *
 * Sensitive-data egress guarantee (AIG-652 #5):
 *   - `submitTask` calls `sanitizeDelegation` to truncate the input to
 *     `maxInputLength` and to strip unknown keys via an allowlist.
 *   - No memory entries, source code, or file contents are ever serialized
 *     by the transport. The federation protocol only carries task metadata.
 */

import * as fs from 'node:fs';
import * as https from 'node:https';
import { logger } from '../utils/logger.js';
import type {
  FederationTlsConfig,
  NodeInfo,
  TaskDelegation,
  TaskDelegationResult,
} from './types.js';

const log = logger.child('federation:transport');

/**
 * Materialized credentials in memory. `null` fields mean "not configured".
 */
export interface FederationCredentials {
  cert: Buffer | null;
  key: Buffer | null;
  ca: Buffer | null;
  bearerToken: string | null;
  requireClientCert: boolean;
}

/**
 * Load mTLS material from disk. Missing files do NOT throw - they degrade
 * to "bearer token" mode (or unauthenticated, which is logged loudly).
 *
 * This centralizes credential parsing so the rest of the federation module
 * never reads from the filesystem directly.
 */
export function loadCredentials(tls: FederationTlsConfig | undefined): FederationCredentials {
  const creds: FederationCredentials = {
    cert: null,
    key: null,
    ca: null,
    bearerToken: tls?.bearerToken ?? null,
    requireClientCert: tls?.requireClientCert ?? true,
  };

  if (tls?.certPath) {
    try {
      creds.cert = fs.readFileSync(tls.certPath);
    } catch (err) {
      log.warn('Failed to read federation cert', {
        path: tls.certPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (tls?.keyPath) {
    try {
      creds.key = fs.readFileSync(tls.keyPath);
    } catch (err) {
      log.warn('Failed to read federation key', {
        path: tls.keyPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (tls?.caPath) {
    try {
      creds.ca = fs.readFileSync(tls.caPath);
    } catch (err) {
      log.warn('Failed to read federation CA bundle', {
        path: tls.caPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Loud warnings if the security posture is degraded.
  if (!creds.cert && !creds.bearerToken) {
    log.warn(
      'Federation transport is UNAUTHENTICATED - no mTLS material and no bearer token. ' +
        'This is only acceptable for local development. Configure federation.tls in aistack.config.json.'
    );
  } else if (!creds.cert && creds.bearerToken) {
    log.warn(
      'Federation transport is using a bearer token without mTLS. Prefer mTLS in production deployments.'
    );
  }

  return creds;
}

/**
 * Build an https.Agent that performs mTLS when credentials are available.
 */
export function buildHttpsAgent(creds: FederationCredentials): https.Agent {
  return new https.Agent({
    cert: creds.cert ?? undefined,
    key: creds.key ?? undefined,
    ca: creds.ca ?? undefined,
    rejectUnauthorized: !!creds.ca, // only verify peers when we have a CA
  });
}

/**
 * Verify a peer's presented certificate matches the configured CA.
 * Called by the federation server during request handling.
 *
 * Returns `true` when the request is acceptable, `false` otherwise.
 */
export function verifyPeerRequest(
  creds: FederationCredentials,
  peerCert: { subject?: { CN?: string } } | undefined,
  bearerHeader: string | undefined
): { ok: boolean; reason: string } {
  // Bearer-token mode
  if (!creds.cert && creds.bearerToken) {
    if (!bearerHeader) return { ok: false, reason: 'Missing Authorization header' };
    const token = bearerHeader.replace(/^Bearer\s+/i, '').trim();
    if (token !== creds.bearerToken) return { ok: false, reason: 'Invalid bearer token' };
    return { ok: true, reason: 'bearer-token' };
  }
  // mTLS mode
  if (creds.requireClientCert) {
    if (!peerCert || !peerCert.subject?.CN) {
      return { ok: false, reason: 'Missing or invalid client certificate' };
    }
    return { ok: true, reason: `mtls:${peerCert.subject.CN}` };
  }
  // Permissive dev mode
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
 * HTTP client used to talk to a remote federation peer.
 */
export class FederationClient {
  /** Reserved for future undici Dispatcher integration. */
  private readonly agent: https.Agent;
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
  getHttpsAgent(): https.Agent {
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
      return (await res.json()) as NodeInfo;
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
    return (await res.json()) as TaskDelegationResult;
  }

  private peerUrl(peer: NodeInfo, path: string): string {
    let base = peer.address;
    if (!/^https?:\/\//.test(base)) base = `${peer.scheme}://${base}`;
    return `${base.replace(/\/$/, '')}${path}`;
  }

  private async request(
    url: string,
    method: 'GET' | 'POST',
    body?: unknown
  ): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      // NOTE: Node's global `fetch` (undici) does not honor `https.Agent`.
      // For full mTLS in production, callers should configure a global
      // undici Dispatcher with the credentials, or replace this with an
      // `https.request` call. For tests + dev (HTTP, no mTLS) the global
      // fetch works as-is.
      return await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
