/**
 * Webhook transport - HTTP POST /v1/tasks endpoint with optional HMAC verification.
 *
 * Uses Node's built-in `http` module (zero new deps). Body parsing is intentionally
 * minimal (JSON only, 1 MiB cap) to stay focused; production users can put this
 * behind a reverse proxy or swap for Express/Fastify by reusing DaemonRuntime.
 */

import * as http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '../utils/logger.js';
import type { DaemonRuntime, QueueTask } from '../daemon/index.js';

const log = logger.child('transport:webhook');

const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

export interface WebhookServerConfig {
  port: number;
  host?: string;
  /** Optional HMAC-SHA256 shared secret. When set, requests must include X-Aistack-Signature: sha256=<hex>. */
  hmacSecret?: string;
  /** Header name carrying the HMAC signature. Defaults to 'x-aistack-signature'. */
  signatureHeader?: string;
}

export interface WebhookTaskRequest {
  agentType: string;
  input: string;
  metadata?: Record<string, unknown>;
  id?: string;
}

/**
 * Verify an HMAC-SHA256 signature using constant-time comparison.
 * Accepted formats: 'sha256=<hex>' (GitHub-style) or raw '<hex>'.
 */
export function verifyHmacSignature(
  body: Buffer | string,
  secret: string,
  providedSignature: string | undefined,
): boolean {
  if (!providedSignature) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const provided = providedSignature.startsWith('sha256=')
    ? providedSignature.slice(7)
    : providedSignature;
  // Length check before timingSafeEqual (which throws on mismatched lengths)
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}

export class WebhookServer {
  private server: http.Server | null = null;
  private readonly signatureHeader: string;

  constructor(
    private readonly runtime: DaemonRuntime,
    private readonly config: WebhookServerConfig,
  ) {
    this.signatureHeader = (config.signatureHeader ?? 'x-aistack-signature').toLowerCase();
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handle(req, res).catch(err => {
          log.error('Unhandled webhook error', { error: (err as Error).message });
          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'internal' }));
          }
        });
      });
      this.server.on('error', reject);
      this.server.listen(this.config.port, this.config.host ?? '127.0.0.1', () => {
        const addr = this.server!.address();
        const port = typeof addr === 'object' && addr ? addr.port : this.config.port;
        log.info('Webhook server listening', { host: this.config.host ?? '127.0.0.1', port });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>(resolve => this.server!.close(() => resolve()));
    this.server = null;
  }

  /** Get the actual bound port (useful when port=0 for tests). */
  getPort(): number | null {
    if (!this.server) return null;
    const addr = this.server.address();
    return typeof addr === 'object' && addr ? addr.port : null;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Routing
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/tasks') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    const body = await readBody(req);
    if (body === null) {
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'payload_too_large' }));
      return;
    }

    // HMAC verification (if configured)
    if (this.config.hmacSecret) {
      const sig = req.headers[this.signatureHeader];
      const sigStr = Array.isArray(sig) ? sig[0] : sig;
      if (!verifyHmacSignature(body, this.config.hmacSecret, sigStr)) {
        log.warn('Webhook signature verification failed', { url: req.url });
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_signature' }));
        return;
      }
    }

    let payload: WebhookTaskRequest;
    try {
      payload = JSON.parse(body.toString('utf-8')) as WebhookTaskRequest;
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_json' }));
      return;
    }
    if (typeof payload.agentType !== 'string' || typeof payload.input !== 'string') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing_fields', required: ['agentType', 'input'] }));
      return;
    }

    const task: QueueTask = await this.runtime.enqueue({
      agentType: payload.agentType,
      input: payload.input,
      source: 'webhook',
      metadata: payload.metadata,
      id: payload.id,
    });

    res.writeHead(202, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ taskId: task.id, status: task.status }));
  }
}

function readBody(req: http.IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
