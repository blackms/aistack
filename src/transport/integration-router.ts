/**
 * Integration router - lightweight multi-route HTTP server for SCM webhooks.
 *
 * Sits alongside the AIG-636 `WebhookServer` (which is fixed to POST /v1/tasks
 * and feeds the daemon queue). This router lets integration adapters (GitHub,
 * GitLab, future Bitbucket/Gitea) register their own routes on a dedicated
 * HTTP listener with multi-format HMAC verification — features that the
 * task-ingestion `WebhookServer` deliberately does not expose.
 *
 * Keeping the two surfaces separate avoids forcing the daemon webhook to grow
 * a plugin/route table, while integration handlers retain a single import
 * point for path registration and signature checks.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '../utils/logger.js';

const log = logger.child('integration-router');

export type SignatureFormat = 'github' | 'gitlab' | 'raw';

export interface IntegrationHandlerContext {
  readonly headers: IncomingMessage['headers'];
  readonly rawBody: Buffer;
  readonly path: string;
  readonly method: string;
}

export type IntegrationHandler = (
  ctx: IntegrationHandlerContext,
  res: ServerResponse
) => Promise<void> | void;

export interface IntegrationRoute {
  method?: string; // defaults to 'POST'
  path: string;
  handler: IntegrationHandler;
  /** Optional shared secret; when set, the route enforces signature verification */
  secret?: string;
  /** Signature format expected on the incoming request */
  signatureFormat?: SignatureFormat;
  /** Header that carries the signature for this route */
  signatureHeader?: string;
}

export interface IntegrationRouterOptions {
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
 *
 * NOTE: This complements `verifyHmacSignature` in src/transport/webhook.ts,
 * which only handles the GitHub-style format used by the daemon ingestion
 * endpoint. The integration router needs the broader multi-format surface.
 */
export function verifyIntegrationSignature(
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
 * Minimal multi-route HTTP server. Routes are registered via `addRoute()` and
 * dispatched on incoming requests. Signature verification (when a secret is
 * configured on the route) happens before the handler is invoked.
 */
export class IntegrationRouter {
  private readonly host: string;
  private readonly port: number;
  private readonly maxBodyBytes: number;
  private readonly routes: IntegrationRoute[] = [];
  private server: Server | null = null;

  constructor(options: IntegrationRouterOptions = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 9091;
    this.maxBodyBytes = options.maxBodyBytes ?? 1_048_576; // 1 MiB
  }

  addRoute(route: IntegrationRoute): void {
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
        log.info('Integration router listening', { host: this.host, port: this.port });
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
      const ok = verifyIntegrationSignature(body, sigValue, route.secret, route.signatureFormat ?? 'github');
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
