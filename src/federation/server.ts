/**
 * Federation HTTP(S) server.
 *
 * Exposes two endpoints over an isolated port (separate from the WebServer
 * of AIG-636 so that public web traffic and peer-to-peer traffic can be
 * firewalled independently):
 *
 *   GET  /v1/federation/capabilities  -> returns this node's NodeInfo
 *   POST /v1/federation/task          -> accepts a TaskDelegation, executes
 *                                        locally, returns TaskDelegationResult
 *
 * The server is intentionally minimal: no router framework, no JSON-Schema,
 * no middleware chain. Federation is a low-volume control-plane interface,
 * not a user-facing API. Lower complexity = smaller attack surface.
 *
 * Security posture:
 *   - HTTPS w/ mTLS is the default. If cert/key are configured but missing
 *     on disk, `loadCredentials` throws on startup (no silent downgrade).
 *   - Plaintext HTTP is allowed ONLY when `tls.allowPlainText === true`.
 *     That gate is also enforced here so the server cannot bind plain HTTP
 *     by accident.
 *   - Incoming bodies are capped at 1 MiB to bound denial-of-service.
 *   - Peer cert CN/SAN pinning is enforced by `verifyPeerRequest`.
 */

import * as http from 'node:http';
import * as https from 'node:https';
import type { AddressInfo } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { logger } from '../utils/logger.js';
import type {
  NodeInfo,
  TaskDelegation,
  TaskDelegationResult,
} from './types.js';
import {
  FederationCredentials,
  MAX_BODY_BYTES,
  verifyPeerRequest,
  type PeerCertificateLike,
} from './transport.js';

const log = logger.child('federation:server');

/**
 * Handler invoked when a peer submits a task. Implementations should
 * delegate to the local coordinator. The handler is provided by the caller
 * (FederationManager) to avoid coupling this module to the coordination
 * package.
 */
export type TaskHandler = (task: TaskDelegation) => Promise<TaskDelegationResult>;

export interface FederationServerOptions {
  credentials: FederationCredentials;
  selfInfo: () => NodeInfo;
  onTask: TaskHandler;
  bindAddress?: string;
  bindPort?: number;
}

/**
 * Lightweight federation HTTP(S) server.
 */
export class FederationServer {
  private server: http.Server | https.Server | null = null;
  private opts: FederationServerOptions;
  private boundAddress: { host: string; port: number } | null = null;

  constructor(opts: FederationServerOptions) {
    this.opts = opts;
  }

  /**
   * Start the server. Uses HTTPS when a server cert+key are configured.
   *
   * If TLS material is NOT configured AND `credentials.allowPlainText` is
   * false, this method throws — we never silently bind a plain HTTP socket
   * for federation traffic.
   */
  async start(): Promise<void> {
    const { credentials } = this.opts;
    const useHttps = !!(credentials.cert && credentials.key);

    if (!useHttps && !credentials.allowPlainText) {
      throw new Error(
        'FederationServer refuses to start in plaintext HTTP mode. ' +
          'Configure federation.tls.certPath + tls.keyPath, or explicitly set ' +
          'federation.tls.allowPlainText = true for local development.'
      );
    }

    const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => {
      this.handleRequest(req, res).catch((err) => {
        log.warn('Federation request handler crashed', {
          error: err instanceof Error ? err.message : String(err),
        });
        try {
          res.statusCode = 500;
          res.end();
        } catch {
          /* ignore */
        }
      });
    };

    if (useHttps) {
      this.server = https.createServer(
        {
          cert: credentials.cert ?? undefined,
          key: credentials.key ?? undefined,
          ca: credentials.ca ?? undefined,
          requestCert: credentials.requireClientCert,
          rejectUnauthorized: credentials.requireClientCert && !!credentials.ca,
        },
        handler
      );
    } else {
      log.warn('Federation server starting in HTTP mode (allowPlainText=true). Use only for dev/test.');
      this.server = http.createServer(handler);
    }

    await new Promise<void>((resolve) => {
      this.server!.listen(
        this.opts.bindPort ?? 0,
        this.opts.bindAddress ?? '0.0.0.0',
        () => resolve()
      );
    });

    const addr = this.server.address() as AddressInfo | null;
    this.boundAddress = addr
      ? { host: addr.address, port: addr.port }
      : { host: this.opts.bindAddress ?? '0.0.0.0', port: this.opts.bindPort ?? 0 };

    log.info('Federation server listening', {
      address: this.boundAddress,
      scheme: useHttps ? 'https' : 'http',
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve());
    });
    this.server = null;
    this.boundAddress = null;
  }

  /** Returns the bound `{host, port}` (after `start`). */
  getBoundAddress(): { host: string; port: number } | null {
    return this.boundAddress;
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Extract peer certificate when this is a TLS connection. We probe the
    // socket via `instanceof`-equivalent shape detection so the server still
    // works in plain-HTTP dev mode (where there is no peer cert at all).
    const sock = req.socket as Partial<TLSSocket>;
    let peerCert: PeerCertificateLike | undefined;
    if (typeof sock.getPeerCertificate === 'function') {
      try {
        const raw = sock.getPeerCertificate(true);
        // getPeerCertificate returns {} when no cert is presented.
        if (raw && (raw.subject || (raw as { subjectaltname?: string }).subjectaltname)) {
          peerCert = raw as unknown as PeerCertificateLike;
        }
      } catch (err) {
        log.debug('getPeerCertificate failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const auth = verifyPeerRequest(this.opts.credentials, peerCert, req.headers.authorization);
    if (!auth.ok) {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'unauthorized', reason: auth.reason }));
      return;
    }

    const url = req.url ?? '';
    const method = req.method ?? 'GET';

    if (method === 'GET' && url.startsWith('/v1/federation/capabilities')) {
      const self = this.opts.selfInfo();
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(self));
      return;
    }

    if (method === 'POST' && url.startsWith('/v1/federation/task')) {
      const parsed = await readJson<TaskDelegation>(req);
      if (parsed.tooLarge) {
        res.statusCode = 413;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'payload_too_large', limitBytes: MAX_BODY_BYTES }));
        return;
      }
      const body = parsed.value;
      if (!body || typeof body.taskId !== 'string' || typeof body.agentType !== 'string') {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'invalid_payload' }));
        return;
      }
      try {
        const result = await this.opts.onTask(body);
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(result));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'task_failed',
            message: err instanceof Error ? err.message : String(err),
          })
        );
      }
      return;
    }

    res.statusCode = 404;
    res.end();
  }
}

/* ---------- helpers ---------- */

interface ReadJsonResult<T> {
  value: T | null;
  tooLarge: boolean;
}

/**
 * Read and parse a JSON body with a hard size cap.
 *
 * The cap bounds simple denial-of-service from peers (or attackers who
 * compromise the perimeter and probe the federation port).
 */
export async function readJson<T>(
  req: http.IncomingMessage,
  maxBytes: number = MAX_BODY_BYTES
): Promise<ReadJsonResult<T>> {
  return new Promise<ReadJsonResult<T>>((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    let settled = false;

    const finish = (result: ReadJsonResult<T>): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on('data', (c: Buffer) => {
      if (tooLarge) return;
      total += c.length;
      if (total > maxBytes) {
        tooLarge = true;
        // Stop draining; destroy with an error so upstream knows.
        req.destroy(new Error('Federation request body exceeds cap'));
        finish({ value: null, tooLarge: true });
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) {
        finish({ value: null, tooLarge: true });
        return;
      }
      if (chunks.length === 0) {
        finish({ value: null, tooLarge: false });
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        finish({ value: JSON.parse(raw) as T, tooLarge: false });
      } catch {
        finish({ value: null, tooLarge: false });
      }
    });
    req.on('error', () => finish({ value: null, tooLarge }));
  });
}
