/**
 * Authentication middleware (placeholder for future implementation)
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export interface AuthContext {
  authenticated: boolean;
  userId?: string;
  permissions?: string[];
}

/**
 * Create authentication middleware
 * Currently a no-op that allows all requests
 */
export function createAuthMiddleware(_options: { required?: boolean } = {}) {
  return function authMiddleware(
    _req: IncomingMessage,
    _res: ServerResponse
  ): AuthContext {
    // For now, all requests are authenticated
    // In the future, this could check API keys, JWT tokens, etc.
    return {
      authenticated: true,
    };
  };
}

/**
 * Extract API key from request headers
 */
export function getApiKey(req: IncomingMessage): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string') {
    return apiKeyHeader;
  }

  return null;
}
