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
 */

import * as http from 'node:http';
import * as https from 'node:https';
import type { AddressInfo } from 'node:net';
import { logger } from '../utils/logger.js';
import type {
  NodeInfo,
  TaskDelegation,
  TaskDelegationResult,
} from './types.js';
import {
  FederationCredentials,
  verifyPeerRequest,
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
   * Start the server. Uses HTTPS when a server cert+key are configured,
   * otherwise falls back to HTTP (development only — a warning is logged).
   */
  async start(): Promise<void> {
    const { credentials } = this.opts;
    const useHttps = !!(credentials.cert && credentials.key);

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
      log.warn('Federation server starting in HTTP mode (no TLS material). Use only for dev/test.');
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
    // Authn / Authz
    const tlsReq = req as http.IncomingMessage & {
      socket: { getPeerCertificate?: () => { subject?: { CN?: string } } };
    };
    const peerCert = tlsReq.socket.getPeerCertificate ? tlsReq.socket.getPeerCertificate() : undefined;
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
      const body = await readJson<TaskDelegation>(req);
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

async function readJson<T>(req: http.IncomingMessage): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(JSON.parse(raw) as T);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}
