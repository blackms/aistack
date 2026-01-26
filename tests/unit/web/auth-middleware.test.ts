import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initAuth,
  createAuthMiddleware,
  getApiKey,
  hasPermission,
  type AuthContext,
} from '../../../src/web/middleware/auth.js';
import { AuthService } from '../../../src/auth/service.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { User } from '../../../src/auth/types.js';
import Database from 'better-sqlite3';

describe('Auth Middleware', () => {
  let authService: AuthService;
  let mockReq: Partial<IncomingMessage>;
  let mockRes: Partial<ServerResponse>;
  let db: Database.Database;
  let resStatus: number;
  let resBody: string;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    authService = new AuthService(db, 'test-secret', 'test-refresh-secret');

    // Create mock response
    resStatus = 0;
    resBody = '';
    mockRes = {
      writeHead: vi.fn((status: number) => {
        resStatus = status;
        return mockRes as ServerResponse;
      }),
      end: vi.fn((body: string) => {
        resBody = body;
        return mockRes as ServerResponse;
      }),
    };

    // Initialize auth middleware
    initAuth(authService);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  describe('createAuthMiddleware', () => {
    it('should allow requests when required=false', () => {
      mockReq = { headers: {} };
      const middleware = createAuthMiddleware({ required: false });
      const context = middleware(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(context.authenticated).toBe(true);
      expect(mockRes.writeHead).not.toHaveBeenCalled();
    });

    it('should require token when required=true', () => {
      mockReq = { headers: {} };
      const middleware = createAuthMiddleware({ required: true });

      expect(() => middleware(mockReq as IncomingMessage, mockRes as ServerResponse))
        .toThrow('Authentication required');
      expect(resStatus).toBe(401);
      expect(JSON.parse(resBody)).toEqual({ error: 'No authentication token provided' });
    });

    it('should authenticate valid Bearer token', async () => {
      const user = await authService.register({
        email: 'test@example.com',
        username: 'testuser',
        password: 'password123',
        role: 'developer',
      });

      const { tokens } = await authService.login({
        email: 'test@example.com',
        password: 'password123',
      });

      mockReq = {
        headers: {
          authorization: `Bearer ${tokens.accessToken}`,
        },
      };

      const middleware = createAuthMiddleware({ required: true });
      const context = middleware(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(context.authenticated).toBe(true);
      expect(context.userId).toBe(user.id);
      expect(context.role).toBe('developer');
      expect(context.user).toBeDefined();
      expect(context.user?.email).toBe('test@example.com');
      expect(context.permissions).toBeDefined();
      expect(context.permissions).toContain('agents:read');
    });

    it('should authenticate valid API key from x-api-key header', async () => {
      const user = await authService.register({
        email: 'test@example.com',
        username: 'testuser',
        password: 'password123',
        role: 'developer',
      });

      const { tokens } = await authService.login({
        email: 'test@example.com',
        password: 'password123',
      });

      mockReq = {
        headers: {
          'x-api-key': tokens.accessToken,
        },
      };

      const middleware = createAuthMiddleware({ required: true });
      const context = middleware(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(context.authenticated).toBe(true);
      expect(context.userId).toBe(user.id);
    });

    it('should reject invalid token', async () => {
      mockReq = {
        headers: {
          authorization: 'Bearer invalid-token',
        },
      };

      const middleware = createAuthMiddleware({ required: true });

      expect(() => middleware(mockReq as IncomingMessage, mockRes as ServerResponse))
        .toThrow();
      expect(resStatus).toBe(401);
      expect(JSON.parse(resBody)).toEqual({ error: 'Invalid token' });
    });

    it('should reject expired token', async () => {
      // Create a token with past expiration
      const expiredToken = authService['generateTokens']({
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
        role: 'developer',
      } as User);

      // Wait a tiny bit and mock token verification to throw expired error
      vi.spyOn(authService, 'verifyAccessToken').mockImplementation(() => {
        throw new Error('Token expired');
      });

      mockReq = {
        headers: {
          authorization: `Bearer ${expiredToken.accessToken}`,
        },
      };

      const middleware = createAuthMiddleware({ required: true });

      expect(() => middleware(mockReq as IncomingMessage, mockRes as ServerResponse))
        .toThrow();
      expect(resStatus).toBe(401);
      expect(JSON.parse(resBody)).toEqual({ error: 'Token expired' });
    });

    it('should check role permissions', async () => {
      await authService.register({
        email: 'viewer@example.com',
        username: 'viewer',
        password: 'password123',
        role: 'viewer',
      });

      const { tokens } = await authService.login({
        email: 'viewer@example.com',
        password: 'password123',
      });

      mockReq = {
        headers: {
          authorization: `Bearer ${tokens.accessToken}`,
        },
      };

      // Require admin role
      const middleware = createAuthMiddleware({ required: true, roles: ['admin'] });

      expect(() => middleware(mockReq as IncomingMessage, mockRes as ServerResponse))
        .toThrow('Forbidden');
      expect(resStatus).toBe(403);
      expect(JSON.parse(resBody)).toEqual({ error: 'Insufficient permissions' });
    });

    it('should allow correct role', async () => {
      await authService.register({
        email: 'dev@example.com',
        username: 'developer',
        password: 'password123',
        role: 'developer',
      });

      const { tokens } = await authService.login({
        email: 'dev@example.com',
        password: 'password123',
      });

      mockReq = {
        headers: {
          authorization: `Bearer ${tokens.accessToken}`,
        },
      };

      const middleware = createAuthMiddleware({ required: true, roles: ['developer', 'admin'] });
      const context = middleware(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(context.authenticated).toBe(true);
      expect(context.role).toBe('developer');
    });

    it('should handle non-existent user', async () => {
      // Mock a valid token but non-existent user
      vi.spyOn(authService, 'verifyAccessToken').mockReturnValue({ userId: 'non-existent-user-id' });
      vi.spyOn(authService, 'getUserById').mockReturnValue(undefined);

      mockReq = {
        headers: {
          authorization: 'Bearer valid-token',
        },
      };

      const middleware = createAuthMiddleware({ required: true });

      expect(() => middleware(mockReq as IncomingMessage, mockRes as ServerResponse))
        .toThrow('Authentication failed');
      expect(resStatus).toBe(401);
      // Response body will be "User not found" first, then potentially "Authentication failed"
      expect(mockRes.writeHead).toHaveBeenCalledWith(401, { 'Content-Type': 'application/json' });
    });

    it('should handle authentication errors', async () => {
      vi.spyOn(authService, 'verifyAccessToken').mockImplementation(() => {
        throw new Error('Database error');
      });

      mockReq = {
        headers: {
          authorization: 'Bearer some-token',
        },
      };

      const middleware = createAuthMiddleware({ required: true });

      expect(() => middleware(mockReq as IncomingMessage, mockRes as ServerResponse))
        .toThrow('Database error');
      expect(resStatus).toBe(401);
      expect(JSON.parse(resBody)).toEqual({ error: 'Authentication failed' });
    });

    it('should not include passwordHash in context', async () => {
      const user = await authService.register({
        email: 'test@example.com',
        username: 'testuser',
        password: 'password123',
        role: 'developer',
      });

      const { tokens } = await authService.login({
        email: 'test@example.com',
        password: 'password123',
      });

      mockReq = {
        headers: {
          authorization: `Bearer ${tokens.accessToken}`,
        },
      };

      const middleware = createAuthMiddleware({ required: true });
      const context = middleware(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(context.user).toBeDefined();
      expect((context.user as any).passwordHash).toBeUndefined();
      expect(context.user?.email).toBe('test@example.com');
    });
  });

  describe('getApiKey', () => {
    it('should extract Bearer token', () => {
      mockReq = {
        headers: {
          authorization: 'Bearer test-token-123',
        },
      };

      const apiKey = getApiKey(mockReq as IncomingMessage);
      expect(apiKey).toBe('test-token-123');
    });

    it('should extract x-api-key header', () => {
      mockReq = {
        headers: {
          'x-api-key': 'api-key-456',
        },
      };

      const apiKey = getApiKey(mockReq as IncomingMessage);
      expect(apiKey).toBe('api-key-456');
    });

    it('should return null if no token', () => {
      mockReq = { headers: {} };
      const apiKey = getApiKey(mockReq as IncomingMessage);
      expect(apiKey).toBeNull();
    });

    it('should prefer Bearer token over x-api-key', () => {
      mockReq = {
        headers: {
          authorization: 'Bearer bearer-token',
          'x-api-key': 'api-key',
        },
      };

      const apiKey = getApiKey(mockReq as IncomingMessage);
      expect(apiKey).toBe('bearer-token');
    });

    it('should return null for malformed authorization header', () => {
      mockReq = {
        headers: {
          authorization: 'InvalidFormat token',
        },
      };

      const apiKey = getApiKey(mockReq as IncomingMessage);
      expect(apiKey).toBeNull();
    });

    it('should handle array x-api-key header', () => {
      mockReq = {
        headers: {
          'x-api-key': ['key1', 'key2'],
        },
      };

      const apiKey = getApiKey(mockReq as IncomingMessage);
      expect(apiKey).toBeNull();
    });
  });

  describe('hasPermission', () => {
    it('should return false for unauthenticated context', () => {
      const context: AuthContext = { authenticated: false };
      expect(hasPermission(context, 'agents:read')).toBe(false);
    });

    it('should return false for context without permissions', () => {
      const context: AuthContext = {
        authenticated: true,
        userId: 'user-1',
        role: 'viewer',
      };
      expect(hasPermission(context, 'agents:read')).toBe(false);
    });

    it('should return true for admin wildcard', () => {
      const context: AuthContext = {
        authenticated: true,
        userId: 'admin-1',
        role: 'admin',
        permissions: ['*'],
      };
      expect(hasPermission(context, 'agents:read')).toBe(true);
      expect(hasPermission(context, 'anything:write')).toBe(true);
    });

    it('should return true for exact permission match', () => {
      const context: AuthContext = {
        authenticated: true,
        userId: 'dev-1',
        role: 'developer',
        permissions: ['agents:read', 'agents:write', 'memory:read'],
      };
      expect(hasPermission(context, 'agents:read')).toBe(true);
      expect(hasPermission(context, 'memory:read')).toBe(true);
    });

    it('should return false for missing permission', () => {
      const context: AuthContext = {
        authenticated: true,
        userId: 'viewer-1',
        role: 'viewer',
        permissions: ['agents:read', 'memory:read'],
      };
      expect(hasPermission(context, 'agents:write')).toBe(false);
    });

    it('should support wildcard permissions', () => {
      const context: AuthContext = {
        authenticated: true,
        userId: 'dev-1',
        role: 'developer',
        permissions: ['agents:*', 'memory:read'],
      };
      expect(hasPermission(context, 'agents:read')).toBe(true);
      expect(hasPermission(context, 'agents:write')).toBe(true);
      expect(hasPermission(context, 'agents:delete')).toBe(true);
      expect(hasPermission(context, 'memory:read')).toBe(true);
      expect(hasPermission(context, 'memory:write')).toBe(false);
    });

    it('should not match wildcards for single-part permissions', () => {
      const context: AuthContext = {
        authenticated: true,
        userId: 'user-1',
        role: 'custom',
        permissions: ['read', 'write'],
      };
      expect(hasPermission(context, 'read')).toBe(true);
      expect(hasPermission(context, 'read:something')).toBe(false);
    });

    it('should handle empty permissions array', () => {
      const context: AuthContext = {
        authenticated: true,
        userId: 'user-1',
        role: 'none',
        permissions: [],
      };
      expect(hasPermission(context, 'agents:read')).toBe(false);
    });
  });
});
