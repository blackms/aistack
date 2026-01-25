/**
 * CORS middleware
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WebConfig } from '../types.js';

export function createCorsMiddleware(config: WebConfig) {
  const allowedOrigins = config.cors.origins;

  return function corsMiddleware(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = req.headers.origin;

    // Check if origin is allowed
    if (origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (allowedOrigins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return true; // Request handled
    }

    return false; // Continue to next handler
  };
}
