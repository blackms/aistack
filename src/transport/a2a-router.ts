/**
 * A2A HTTP router — minimal multi-route HTTP server used to expose the
 * A2A agent-card and message endpoints.
 *
 * Sits alongside the AIG-636 `WebhookServer` (which is pinned to
 * POST /v1/tasks and feeds the daemon queue). Splitting the surface keeps
 * the daemon webhook free of any plugin/route registration table.
 *
 * Request/response shape is value-based (handlers return WebhookResponse
 * objects) so handlers stay easy to unit-test without HTTP plumbing.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { logger } from '../utils/logger.js';

const log = logger.child('a2a-router');

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

export interface A2ARouterOptions {
  port?: number;
  host?: string;
  /**
   * Max accepted request-body size in bytes. Requests exceeding this are
   * aborted with HTTP 413. Defaults to 1 MiB to mirror the AIG-636
   * WebhookServer cap.
   */
  maxBytes?: number;
}

/** Default request-body size cap (1 MiB). */
export const DEFAULT_A2A_MAX_BYTES = 1024 * 1024;

/** Sentinel thrown by `readBody` when the body exceeds the configured cap. */
export class PayloadTooLargeError extends Error {
  readonly code = 'payload_too_large';
  constructor(public readonly limit: number) {
    super(`Request body exceeded ${limit} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

class MalformedQueryError extends Error {
  constructor() {
    super('Malformed query encoding');
    this.name = 'MalformedQueryError';
  }
}

/**
 * Minimal HTTP server with method/path routing for A2A endpoints.
 * Renamed from the original WebhookServer stub to avoid colliding with the
 * AIG-636 `WebhookServer` (which is fixed to POST /v1/tasks and owned by the
 * daemon).
 */
export class A2ARouter {
  private server: Server | null = null;
  private routes: RegisteredRoute[] = [];
  private readonly port: number;
  private readonly host: string;
  private readonly maxBytes: number;

  constructor(options: A2ARouterOptions = {}) {
    this.port = options.port ?? 8787;
    this.host = options.host ?? '127.0.0.1';
    this.maxBytes = options.maxBytes ?? DEFAULT_A2A_MAX_BYTES;
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
      throw new Error('A2ARouter already started');
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

    const address = this.server.address();
    const boundPort = typeof address === 'object' && address ? address.port : this.port;
    const boundHost = typeof address === 'object' && address ? address.address : this.host;

    log.info('A2ARouter listening', { host: boundHost, port: boundPort });
    return { port: boundPort, host: boundHost };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    log.info('A2ARouter stopped');
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = req.url ?? '/';
      const [rawPath, rawQuery = ''] = url.split('?');
      let query: Record<string, string>;
      try {
        query = parseQuery(rawQuery);
      } catch (err) {
        if (err instanceof MalformedQueryError) {
          sendJson(res, 400, {
            error: 'bad_request',
            message: 'Malformed query encoding',
          });
          return;
        }
        throw err;
      }

      let body: string;
      try {
        body = await readBody(req, this.maxBytes);
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          log.warn('Rejected oversized A2A request body', { limit: err.limit, url });
          sendJson(res, 413, { error: 'payload_too_large', limit: err.limit });
          return;
        }
        throw err;
      }
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
        stack: error instanceof Error ? error.stack : undefined,
      });
      sendJson(res, 500, {
        error: 'internal_error',
        message: 'internal server error',
      });
    }
  }
}

function parseQuery(rawQuery: string): Record<string, string> {
  const query: Record<string, string> = {};
  if (!rawQuery) return query;
  for (const pair of rawQuery.split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    const rawKey = idx === -1 ? pair : pair.slice(0, idx);
    const rawValue = idx === -1 ? '' : pair.slice(idx + 1);
    if (!rawKey) continue;
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      const value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
      query[key] = value;
    } catch {
      throw new MalformedQueryError();
    }
  }
  return query;
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > maxBytes) {
        aborted = true;
        // Destroy the socket so the client stops uploading and we don't
        // buffer more bytes in memory.
        req.destroy();
        reject(new PayloadTooLargeError(maxBytes));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    req.on('error', (err) => {
      if (aborted) return;
      reject(err);
    });
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
