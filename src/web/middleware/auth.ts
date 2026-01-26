/**
 * Authentication middleware
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthService } from '../../auth/service.js';
import { logger } from '../../utils/logger.js';
import type { AuthContext } from '../../auth/types.js';

const log = logger.child('auth:middleware');

export type { AuthContext };

let authService: AuthService | null = null;

/**
 * Initialize authentication with service
 */
export function initAuth(service: AuthService): void {
  authService = service;
}

/**
 * Create authentication middleware
 */
export function createAuthMiddleware(options: { required?: boolean; roles?: string[] } = {}) {
  const { required = true, roles = [] } = options;

  return function authMiddleware(
    req: IncomingMessage,
    res: ServerResponse
  ): AuthContext {
    // If auth is not required, return authenticated context
    if (!required) {
      return {
        authenticated: true,
      };
    }

    // If auth service is not initialized, fail closed in production
    if (!authService) {
      if (process.env.NODE_ENV === 'production') {
        sendUnauthorized(res, 'Authentication service not initialized');
        throw new Error('Authentication required');
      }
      // In development, allow requests if auth is not set up
      log.warn('Auth service not initialized, allowing request in development mode');
      return {
        authenticated: true,
      };
    }

    // Extract token
    const token = getToken(req);
    if (!token) {
      sendUnauthorized(res, 'No authentication token provided');
      throw new Error('Authentication required');
    }

    try {
      // Verify token
      const payload = authService.verifyAccessToken(token);

      // Get user
      const user = authService.getUserById(payload.userId);
      if (!user) {
        sendUnauthorized(res, 'User not found');
        throw new Error('Authentication failed');
      }

      // Check role if specified
      if (roles.length > 0 && !roles.includes(user.role)) {
        sendForbidden(res, 'Insufficient permissions');
        throw new Error('Forbidden');
      }

      // Return auth context (excluding sensitive fields)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { passwordHash, ...userWithoutPassword } = user;
      return {
        authenticated: true,
        user: userWithoutPassword,
        userId: user.id,
        role: user.role,
        permissions: getRolePermissions(user.role),
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Token expired') {
          sendUnauthorized(res, 'Token expired');
        } else if (error.message === 'Invalid token') {
          sendUnauthorized(res, 'Invalid token');
        } else if (error.message !== 'Authentication required' && error.message !== 'Forbidden') {
          log.error('Authentication error', { error: error.message });
          sendUnauthorized(res, 'Authentication failed');
        }
      }
      throw error;
    }
  };
}

/**
 * Extract token from request headers
 */
function getToken(req: IncomingMessage): string | null {
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

/**
 * Get API key from request (legacy support)
 */
export function getApiKey(req: IncomingMessage): string | null {
  return getToken(req);
}

/**
 * Get role permissions
 */
function getRolePermissions(role: string): string[] {
  const permissions: Record<string, string[]> = {
    admin: ['*'], // Admin has all permissions
    developer: [
      'agents:read',
      'agents:write',
      'agents:spawn',
      'memory:read',
      'memory:write',
      'workflows:read',
      'workflows:write',
      'projects:read',
      'projects:write',
      'sessions:read',
      'sessions:write',
    ],
    viewer: [
      'agents:read',
      'memory:read',
      'workflows:read',
      'projects:read',
      'sessions:read',
    ],
  };

  return permissions[role] || [];
}

/**
 * Send 401 Unauthorized response
 */
function sendUnauthorized(res: ServerResponse, message: string): void {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

/**
 * Send 403 Forbidden response
 */
function sendForbidden(res: ServerResponse, message: string): void {
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

/**
 * Verify user has permission
 */
export function hasPermission(context: AuthContext, permission: string): boolean {
  if (!context.authenticated) return false;
  if (!context.permissions) return false;

  // Admin wildcard
  if (context.permissions.includes('*')) return true;

  // Exact match
  if (context.permissions.includes(permission)) return true;

  // Wildcard match (e.g., "agents:*" matches "agents:read")
  const parts = permission.split(':');
  if (parts.length === 2) {
    const wildcardPerm = `${parts[0]}:*`;
    if (context.permissions.includes(wildcardPerm)) return true;
  }

  return false;
}
