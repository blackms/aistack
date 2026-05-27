/**
 * Webhook transport - HTTP webhook server with HMAC signature verification.
 *
 * NOTE: This file is a minimal STUB intended to be superseded by the full
 * implementation delivered in AIG-636. The interface defined here is
 * deliberately compatible with the AIG-636 contract so that AIG-637 can
 * import and extend it without further changes once AIG-636 lands on main.
 *
 * Merge sequence assumed: AIG-636 → main, then AIG-637 → main. When AIG-636
 * merges first, this stub should be REPLACED (not deleted) by the richer
 * implementation; the public exports (`WebhookServer`, `verifyHmacSignature`,
 * `WebhookHandler`) must remain backward-compatible.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '../utils/logger.js';

const log = logger.child('webhook');

export type SignatureFormat = 'github' | 'gitlab' | 'raw';

export interface WebhookHandlerContext {
  readonly headers: IncomingMessage['headers'];
  readonly rawBody: Buffer;
  readonly path: string;
  readonly method: string;
}

export type WebhookHandler = (
  ctx: WebhookHandlerContext,
  res: ServerResponse
) => Promise<void> | void;

export interface WebhookRoute {
  method?: string; // defaults to 'POST'
  path: string;
  handler: WebhookHandler;
  /** Optional shared secret; when set, the route enforces signature verification */
  secret?: string;
  /** Signature format expected on the incoming request */
  signatureFormat?: SignatureFormat;
  /** Header that carries the signature for this route */
  signatureHeader?: string;
}

export interface WebhookServerOptions {
  host?: string;
  port?: number;
  maxBodyBytes?: number;
}

/**
 * Verify an HMAC signature on a payload.
 *
 * - `github` format expects the signature to be prefixed with `sha256=` and
 *   delivered via the `X-Hub-Signature-256` header.
 * - `gitlab` and `raw` formats expect the bare hex digest (GitLab forwards a
 *   plain shared-secret token in `X-Gitlab-Token`; treat that as `raw`).
 *
 * Returns `true` when the digest matches in constant time.
 */
export function verifyHmacSignature(
  payload: Buffer | string,
  signature: string | undefined,
  secret: string,
  format: SignatureFormat = 'github'
): boolean {
  if (!signature || !secret) return false;

  const data = typeof payload === 'string' ? Buffer.from(payload, 'utf-8') : payload;

  if (format === 'gitlab' || format === 'raw') {
    // GitLab simply echoes the configured secret token; constant-time compare.
    const a = Buffer.from(signature);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // GitHub-style: header is `sha256=<hex>`
  const expected = `sha256=${createHmac('sha256', secret).update(data).digest('hex')}`;
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  try {
    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

/**
 * Minimal webhook server. Routes are registered via `addRoute()` and dispatched
 * on incoming requests. Signature verification (when a secret is configured on
 * the route) happens before the handler is invoked.
 */
export class WebhookServer {
  private readonly host: string;
  private readonly port: number;
  private readonly maxBodyBytes: number;
  private readonly routes: WebhookRoute[] = [];
  private server: Server | null = null;

  constructor(options: WebhookServerOptions = {}) {
    this.host = options.host ?? '0.0.0.0';
    this.port = options.port ?? 9091;
    this.maxBodyBytes = options.maxBodyBytes ?? 1_048_576; // 1 MiB
  }

  addRoute(route: WebhookRoute): void {
    this.routes.push({ method: 'POST', ...route });
  }

  async start(): Promise<void> {
    if (this.server) return;
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        void this.handleRequest(req, res);
      });
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        log.info('Webhook server listening', { host: this.host, port: this.port });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const srv = this.server;
    if (!srv) return;
    this.server = null;
    return new Promise((resolve) => {
      srv.close(() => resolve());
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const url = req.url ?? '/';
    const path = url.split('?')[0] ?? '/';

    const route = this.routes.find(
      (r) => (r.method ?? 'POST').toUpperCase() === method && r.path === path
    );

    if (!route) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    let body: Buffer;
    try {
      body = await this.readBody(req);
    } catch (err) {
      res.statusCode = 413;
      res.end((err as Error).message);
      return;
    }

    if (route.secret) {
      const headerName = (route.signatureHeader ?? 'x-hub-signature-256').toLowerCase();
      const sig = req.headers[headerName];
      const sigValue = Array.isArray(sig) ? sig[0] : sig;
      const ok = verifyHmacSignature(body, sigValue, route.secret, route.signatureFormat ?? 'github');
      if (!ok) {
        log.warn('Webhook signature verification failed', { path, headerName });
        res.statusCode = 401;
        res.end('invalid signature');
        return;
      }
    }

    try {
      await route.handler(
        { headers: req.headers, rawBody: body, path, method },
        res
      );
      if (!res.writableEnded) {
        res.statusCode = 200;
        res.end();
      }
    } catch (err) {
      log.error('Webhook handler threw', { path, err: (err as Error).message });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('internal error');
      }
    }
  }

  private readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      req.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > this.maxBodyBytes) {
          reject(new Error('payload too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
}
