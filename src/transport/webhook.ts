/**
 * Local stub of WebhookServer (originally introduced by AIG-636 background-runner branch).
 *
 * This stub provides a minimal HTTP server with route registration so that
 * sibling modules (A2A server in AIG-639, github-webhook in AIG-637) can compile
 * and run before the AIG-636 branch is merged to main.
 *
 * Once AIG-636 lands in main, this file should be deleted and replaced by the
 * canonical implementation from that PR. The public API (registerRoute,
 * start, stop) MUST remain identical so dependent modules keep working.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { logger } from '../utils/logger.js';

const log = logger.child('webhook-server');

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface WebhookRequest {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  query: Record<string, string>;
}

export interface WebhookResponse {
  status: number;
  headers?: Record<string, string>;
  body: string | object;
}

export type RouteHandler = (req: WebhookRequest) => Promise<WebhookResponse> | WebhookResponse;

interface RegisteredRoute {
  method: HttpMethod;
  path: string;
  handler: RouteHandler;
}

export interface WebhookServerOptions {
  port?: number;
  host?: string;
}

/**
 * Minimal HTTP server with method/path routing.
 * Mirrors the shape introduced by AIG-636 so A2A and github-webhook can share it.
 */
export class WebhookServer {
  private server: Server | null = null;
  private routes: RegisteredRoute[] = [];
  private readonly port: number;
  private readonly host: string;

  constructor(options: WebhookServerOptions = {}) {
    this.port = options.port ?? 8787;
    this.host = options.host ?? '127.0.0.1';
  }

  /**
   * Register a route. Last registration wins for identical method+path.
   */
  registerRoute(method: HttpMethod, path: string, handler: RouteHandler): void {
    // Dedupe identical registrations
    this.routes = this.routes.filter((r) => !(r.method === method && r.path === path));
    this.routes.push({ method, path, handler });
    log.debug('Registered route', { method, path });
  }

  getRoutes(): ReadonlyArray<{ method: HttpMethod; path: string }> {
    return this.routes.map((r) => ({ method: r.method, path: r.path }));
  }

  async start(): Promise<{ port: number; host: string }> {
    if (this.server) {
      throw new Error('WebhookServer already started');
    }

    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, this.host, () => {
        this.server!.removeListener('error', reject);
        resolve();
      });
    });

    log.info('WebhookServer listening', { host: this.host, port: this.port });
    return { port: this.port, host: this.host };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    log.info('WebhookServer stopped');
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = req.url ?? '/';
      const [rawPath, rawQuery = ''] = url.split('?');
      const query: Record<string, string> = {};
      if (rawQuery) {
        for (const pair of rawQuery.split('&')) {
          const [k, v = ''] = pair.split('=');
          if (k) query[decodeURIComponent(k)] = decodeURIComponent(v);
        }
      }

      const body = await readBody(req);
      const method = (req.method ?? 'GET').toUpperCase();

      const route = this.routes.find((r) => r.method === method && r.path === rawPath);

      if (!route) {
        sendJson(res, 404, { error: 'not_found', path: rawPath });
        return;
      }

      const webhookReq: WebhookRequest = {
        method,
        url,
        path: rawPath,
        headers: req.headers,
        body,
        query,
      };

      const result = await route.handler(webhookReq);
      const headers = result.headers ?? {};
      if (typeof result.body === 'string') {
        res.writeHead(result.status, headers);
        res.end(result.body);
      } else {
        sendJson(res, result.status, result.body, headers);
      }
    } catch (error) {
      log.error('Route handler failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      sendJson(res, 500, {
        error: 'internal_error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: object,
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(body));
}
