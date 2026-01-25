/**
 * HTTP Router for the web server
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Route, RouteHandler, RouteParams } from './types.js';

export class Router {
  private routes: Route[] = [];

  /**
   * Register a route
   */
  private addRoute(method: string, path: string, handler: RouteHandler): void {
    // Convert path to regex pattern
    // e.g., '/api/v1/agents/:id' -> /^\/api\/v1\/agents\/([^\/]+)$/
    const paramNames: string[] = [];
    const pattern = path
      .replace(/\//g, '\\/')
      .replace(/:([^/]+)/g, (_, paramName) => {
        paramNames.push(paramName);
        return '([^\\/]+)';
      });

    this.routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${pattern}$`),
      handler,
      paramNames,
    });
  }

  // HTTP method shortcuts
  get(path: string, handler: RouteHandler): void {
    this.addRoute('GET', path, handler);
  }

  post(path: string, handler: RouteHandler): void {
    this.addRoute('POST', path, handler);
  }

  put(path: string, handler: RouteHandler): void {
    this.addRoute('PUT', path, handler);
  }

  delete(path: string, handler: RouteHandler): void {
    this.addRoute('DELETE', path, handler);
  }

  patch(path: string, handler: RouteHandler): void {
    this.addRoute('PATCH', path, handler);
  }

  /**
   * Match a request to a route
   */
  match(method: string, url: string): { handler: RouteHandler; params: RouteParams } | null {
    const [pathname, queryString] = url.split('?');

    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;

      const match = pathname?.match(route.pattern);
      if (!match) continue;

      // Extract path parameters
      const path: string[] = [];
      route.paramNames.forEach((name, index) => {
        path.push(match[index + 1] || '');
      });

      // Parse query parameters
      const query: Record<string, string> = {};
      if (queryString) {
        const searchParams = new URLSearchParams(queryString);
        for (const [key, value] of searchParams) {
          query[key] = value;
        }
      }

      return {
        handler: route.handler,
        params: { path, query },
      };
    }

    return null;
  }

  /**
   * Handle an incoming request
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const method = req.method || 'GET';
    const url = req.url || '/';

    const matched = this.match(method, url);
    if (!matched) return false;

    // Parse body for POST/PUT/PATCH
    let body: unknown = undefined;
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      body = await this.parseBody(req);
    }

    matched.params.body = body;

    try {
      await matched.handler(req, res, matched.params);
    } catch (error) {
      if (!res.headersSent) {
        // Check for ApiError with statusCode
        const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
        const message = error instanceof Error ? error.message : 'Internal server error';
        sendError(res, statusCode, message);
      }
    }

    return true;
  }

  /**
   * Parse request body as JSON
   */
  private parseBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      req.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf-8');
        if (!data) {
          resolve(undefined);
          return;
        }

        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Invalid JSON body'));
        }
      });

      req.on('error', reject);
    });
  }
}

// Response helpers
export function sendJson<T>(res: ServerResponse, data: T, statusCode: number = 200): void {
  const response = {
    success: statusCode >= 200 && statusCode < 300,
    data,
    timestamp: new Date().toISOString(),
  };

  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(response));
}

export function sendError(res: ServerResponse, statusCode: number, message: string): void {
  const response = {
    success: false,
    error: message,
    timestamp: new Date().toISOString(),
  };

  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(response));
}

export function sendPaginated<T>(
  res: ServerResponse,
  data: T[],
  pagination: { limit: number; offset: number; total: number },
  statusCode: number = 200
): void {
  const response = {
    success: true,
    data,
    pagination,
    timestamp: new Date().toISOString(),
  };

  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(response));
}
