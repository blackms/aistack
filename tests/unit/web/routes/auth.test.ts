import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuthRoutes } from '../../../../src/web/routes/auth.js';
import { AuthService } from '../../../../src/auth/service.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { User } from '../../../../src/auth/types.js';

// Mock dependencies
vi.mock('../../../../src/web/middleware/auth.js', () => ({
  createAuthMiddleware: vi.fn((options) => {
    return (req: IncomingMessage, res: ServerResponse) => {
      if (options.required) {
        const authHeader = (req.headers as any).authorization;

        // Check roles if specified
        if (options.roles && options.roles.length > 0) {
          const isAdmin = authHeader === 'Bearer admin-token';
          if (!isAdmin) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Insufficient permissions' }));
            throw new Error('Forbidden');
          }

          return {
            authenticated: true,
            userId: 'admin-123',
            role: 'admin',
            user: {
              id: 'admin-123',
              email: 'admin@example.com',
              username: 'admin',
              role: 'admin',
            },
            permissions: ['*'],
          };
        }

        if (!authHeader || authHeader !== 'Bearer valid-token') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Authentication required' }));
          throw new Error('Authentication required');
        }
      }

      return {
        authenticated: true,
        userId: 'user-123',
        role: 'developer',
        user: {
          id: 'user-123',
          email: 'test@example.com',
          username: 'testuser',
          role: 'developer',
        },
        permissions: ['agents:read', 'agents:write'],
      };
    };
  }),
}));

describe('Auth Routes', () => {
  let authService: AuthService;
  let routes: ReturnType<typeof createAuthRoutes>;
  let mockReq: Partial<IncomingMessage>;
  let mockRes: Partial<ServerResponse>;
  let resStatus: number;
  let resHeaders: Record<string, string>;
  let resBody: string;

  beforeEach(() => {
    authService = {
      register: vi.fn(),
      login: vi.fn(),
      refreshAccessToken: vi.fn(),
      logout: vi.fn(),
      changePassword: vi.fn(),
      listUsers: vi.fn(),
      updateUserRole: vi.fn(),
      deleteUser: vi.fn(),
    } as any;

    routes = createAuthRoutes({ authService });

    resStatus = 0;
    resHeaders = {};
    resBody = '';

    mockRes = {
      writeHead: vi.fn((status: number, headers?: Record<string, string>) => {
        resStatus = status;
        if (headers) {
          resHeaders = { ...resHeaders, ...headers };
        }
        return mockRes as ServerResponse;
      }),
      end: vi.fn((body?: string) => {
        if (body) resBody = body;
        return mockRes as ServerResponse;
      }),
    };

    mockReq = {
      headers: {},
      method: 'POST',
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createMockRequest(data: any): IncomingMessage {
    const stream = new Readable({
      read() {
        this.push(JSON.stringify(data));
        this.push(null);
      },
    });
    return stream as unknown as IncomingMessage;
  }

  describe('register', () => {
    it('should register a new user successfully', async () => {
      const mockUser: User = {
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
        passwordHash: 'hashed',
        role: 'developer',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(authService.register).mockResolvedValue(mockUser);

      mockReq = createMockRequest({
        email: 'test@example.com',
        username: 'testuser',
        password: 'password123',
      });

      await routes.register(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(authService.register).toHaveBeenCalledWith(
        {
          email: 'test@example.com',
          username: 'testuser',
          password: 'password123',
        },
        'developer'
      );
      expect(resStatus).toBe(201);
      expect(resHeaders['Content-Type']).toBe('application/json');

      const response = JSON.parse(resBody);
      expect(response.user).toBeDefined();
      expect(response.user.passwordHash).toBeUndefined();
      expect(response.user.email).toBe('test@example.com');
    });

    it('should register user with specified role', async () => {
      const mockUser: User = {
        id: 'user-123',
        email: 'admin@example.com',
        username: 'adminuser',
        passwordHash: 'hashed',
        role: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(authService.register).mockResolvedValue(mockUser);

      mockReq = createMockRequest({
        email: 'admin@example.com',
        username: 'adminuser',
        password: 'password123',
        role: 'admin',
      });

      await routes.register(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(authService.register).toHaveBeenCalledWith(
        {
          email: 'admin@example.com',
          username: 'adminuser',
          password: 'password123',
        },
        'admin'
      );
    });

    it('should handle registration errors', async () => {
      vi.mocked(authService.register).mockRejectedValue(new Error('Email already exists'));

      mockReq = createMockRequest({
        email: 'test@example.com',
        username: 'testuser',
        password: 'password123',
      });

      await routes.register(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(resStatus).toBe(400);
      const response = JSON.parse(resBody);
      expect(response.error).toBe('Email already exists');
    });

    it('should handle unknown registration errors', async () => {
      vi.mocked(authService.register).mockRejectedValue('Unknown error');

      mockReq = createMockRequest({
        email: 'test@example.com',
        username: 'testuser',
        password: 'password123',
      });

      await routes.register(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(resStatus).toBe(400);
      const response = JSON.parse(resBody);
      expect(response.error).toBe('Registration failed');
    });
  });

  describe('login', () => {
    it('should login user successfully', async () => {
      const mockUser: User = {
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
        passwordHash: 'hashed',
        role: 'developer',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(authService.login).mockResolvedValue({
        user: mockUser,
        tokens: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresIn: 900,
        },
      });

      mockReq = createMockRequest({
        email: 'test@example.com',
        password: 'password123',
      });

      await routes.login(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(authService.login).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
      expect(resStatus).toBe(200);

      const response = JSON.parse(resBody);
      expect(response.user).toBeDefined();
      expect(response.user.passwordHash).toBeUndefined();
      expect(response.tokens).toBeDefined();
      expect(response.tokens.accessToken).toBe('access-token');
    });

    it('should handle login errors', async () => {
      vi.mocked(authService.login).mockRejectedValue(new Error('Invalid credentials'));

      mockReq = createMockRequest({
        email: 'test@example.com',
        password: 'wrongpassword',
      });

      await routes.login(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(resStatus).toBe(401);
      const response = JSON.parse(resBody);
      expect(response.error).toBe('Invalid credentials');
    });

    it('should handle unknown login errors', async () => {
      vi.mocked(authService.login).mockRejectedValue('Unknown error');

      mockReq = createMockRequest({
        email: 'test@example.com',
        password: 'password123',
      });

      await routes.login(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(resStatus).toBe(401);
      const response = JSON.parse(resBody);
      expect(response.error).toBe('Login failed');
    });
  });

  describe('refresh', () => {
    it('should refresh access token successfully', async () => {
      vi.mocked(authService.refreshAccessToken).mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 900,
      });

      mockReq = createMockRequest({
        refreshToken: 'refresh-token',
      });

      await routes.refresh(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(authService.refreshAccessToken).toHaveBeenCalledWith('refresh-token');
      expect(resStatus).toBe(200);

      const response = JSON.parse(resBody);
      expect(response.tokens).toBeDefined();
      expect(response.tokens.accessToken).toBe('new-access-token');
    });

    it('should reject refresh without token', async () => {
      mockReq = createMockRequest({});

      await routes.refresh(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(resStatus).toBe(401);
      const response = JSON.parse(resBody);
      expect(response.error).toBe('Refresh token is required');
    });

    it('should handle refresh errors', async () => {
      vi.mocked(authService.refreshAccessToken).mockRejectedValue(
        new Error('Invalid refresh token')
      );

      mockReq = createMockRequest({
        refreshToken: 'invalid-token',
      });

      await routes.refresh(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(resStatus).toBe(401);
      const response = JSON.parse(resBody);
      expect(response.error).toBe('Invalid refresh token');
    });
  });

  describe('logout', () => {
    it('should logout user successfully', async () => {
      vi.mocked(authService.logout).mockResolvedValue();

      mockReq = createMockRequest({
        refreshToken: 'refresh-token',
      });

      await routes.logout(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(authService.logout).toHaveBeenCalledWith('refresh-token');
      expect(resStatus).toBe(200);

      const response = JSON.parse(resBody);
      expect(response.success).toBe(true);
    });

    it('should logout without refresh token', async () => {
      mockReq = createMockRequest({});

      await routes.logout(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(authService.logout).not.toHaveBeenCalled();
      expect(resStatus).toBe(200);

      const response = JSON.parse(resBody);
      expect(response.success).toBe(true);
    });

    it('should handle logout errors', async () => {
      vi.mocked(authService.logout).mockRejectedValue(new Error('Logout failed'));

      mockReq = createMockRequest({
        refreshToken: 'refresh-token',
      });

      await routes.logout(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(resStatus).toBe(500);
      const response = JSON.parse(resBody);
      expect(response.error).toBe('Logout failed');
    });
  });

  describe('me', () => {
    it('should return current user info', async () => {
      mockReq.headers = { authorization: 'Bearer valid-token' };

      await routes.me(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(resStatus).toBe(200);
      const response = JSON.parse(resBody);
      expect(response.user).toBeDefined();
      expect(response.user.email).toBe('test@example.com');
      expect(response.permissions).toBeDefined();
    });

    it('should reject unauthenticated requests', async () => {
      mockReq.headers = {};

      await routes.me(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(resStatus).toBe(401);
    });
  });

  describe('changePassword', () => {
    it('should change password successfully', async () => {
      vi.mocked(authService.changePassword).mockResolvedValue();

      mockReq = createMockRequest({
        oldPassword: 'old123',
        newPassword: 'new123',
      });
      mockReq.headers = { authorization: 'Bearer valid-token' };

      await routes.changePassword(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(authService.changePassword).toHaveBeenCalledWith('user-123', 'old123', 'new123');
      expect(resStatus).toBe(200);

      const response = JSON.parse(resBody);
      expect(response.success).toBe(true);
    });

    it('should reject unauthenticated password change', async () => {
      mockReq = createMockRequest({
        oldPassword: 'old123',
        newPassword: 'new123',
      });
      mockReq.headers = {};

      await routes.changePassword(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(resStatus).toBe(400);
      const response = JSON.parse(resBody);
      expect(response.error).toContain('Authentication required');
    });

    it('should handle password change errors', async () => {
      vi.mocked(authService.changePassword).mockRejectedValue(
        new Error('Invalid old password')
      );

      mockReq = createMockRequest({
        oldPassword: 'wrong',
        newPassword: 'new123',
      });
      mockReq.headers = { authorization: 'Bearer valid-token' };

      await routes.changePassword(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(resStatus).toBe(400);
      const response = JSON.parse(resBody);
      expect(response.error).toBe('Invalid old password');
    });
  });

  describe('listUsers', () => {
    it('should list all users as admin', async () => {
      const mockUsers = [
        {
          id: 'user-1',
          email: 'user1@example.com',
          username: 'user1',
          role: 'developer',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'user-2',
          email: 'user2@example.com',
          username: 'user2',
          role: 'viewer',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(authService.listUsers).mockReturnValue(mockUsers);

      mockReq = {} as any;
      mockReq.headers = { authorization: 'Bearer admin-token' };

      await routes.listUsers(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(authService.listUsers).toHaveBeenCalled();
      expect(resStatus).toBe(200);

      const response = JSON.parse(resBody);
      expect(response.users).toBeDefined();
      expect(response.users).toHaveLength(2);
    });

    it('should reject non-admin users', async () => {
      mockReq = {} as any;
      mockReq.headers = { authorization: 'Bearer valid-token' };

      await routes.listUsers(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(resStatus).toBe(403);
    });
  });

  describe('updateUserRole', () => {
    it('should update user role as admin', async () => {
      vi.mocked(authService.updateUserRole).mockImplementation(() => {});

      mockReq = createMockRequest({
        role: 'admin',
      });
      mockReq.headers = { authorization: 'Bearer admin-token' };

      await routes.updateUserRole(
        mockReq as IncomingMessage,
        mockRes as ServerResponse,
        'user-456'
      );

      expect(authService.updateUserRole).toHaveBeenCalledWith('user-456', 'admin');
      expect(resStatus).toBe(200);

      const response = JSON.parse(resBody);
      expect(response.success).toBe(true);
    });

    it('should reject role update without role', async () => {
      mockReq = createMockRequest({});
      mockReq.headers = { authorization: 'Bearer admin-token' };

      await routes.updateUserRole(
        mockReq as IncomingMessage,
        mockRes as ServerResponse,
        'user-456'
      );

      expect(resStatus).toBe(400);
      const response = JSON.parse(resBody);
      expect(response.error).toBe('Role is required');
    });

    it('should reject non-admin role updates', async () => {
      mockReq = createMockRequest({
        role: 'admin',
      });
      mockReq.headers = { authorization: 'Bearer valid-token' };

      await routes.updateUserRole(
        mockReq as IncomingMessage,
        mockRes as ServerResponse,
        'user-456'
      );

      expect(resStatus).toBe(400);
      const response = JSON.parse(resBody);
      expect(response.error).toContain('Forbidden');
    });

    it('should handle role update errors', async () => {
      vi.mocked(authService.updateUserRole).mockImplementation(() => {
        throw new Error('User not found');
      });

      mockReq = createMockRequest({
        role: 'admin',
      });
      mockReq.headers = { authorization: 'Bearer admin-token' };

      await routes.updateUserRole(
        mockReq as IncomingMessage,
        mockRes as ServerResponse,
        'user-456'
      );

      expect(resStatus).toBe(400);
      const response = JSON.parse(resBody);
      expect(response.error).toBe('User not found');
    });
  });

  describe('deleteUser', () => {
    it('should delete user as admin', async () => {
      vi.mocked(authService.deleteUser).mockImplementation(() => {});

      mockReq = {} as any;
      mockReq.headers = { authorization: 'Bearer admin-token' };

      await routes.deleteUser(
        mockReq as IncomingMessage,
        mockRes as ServerResponse,
        'user-456'
      );

      expect(authService.deleteUser).toHaveBeenCalledWith('user-456');
      expect(resStatus).toBe(200);

      const response = JSON.parse(resBody);
      expect(response.success).toBe(true);
    });

    it('should reject non-admin user deletion', async () => {
      mockReq = {} as any;
      mockReq.headers = { authorization: 'Bearer valid-token' };

      await routes.deleteUser(
        mockReq as IncomingMessage,
        mockRes as ServerResponse,
        'user-456'
      );

      expect(resStatus).toBe(400);
      const response = JSON.parse(resBody);
      expect(response.error).toContain('Forbidden');
    });

    it('should handle user deletion errors', async () => {
      vi.mocked(authService.deleteUser).mockImplementation(() => {
        throw new Error('User not found');
      });

      mockReq = {} as any;
      mockReq.headers = { authorization: 'Bearer admin-token' };

      await routes.deleteUser(
        mockReq as IncomingMessage,
        mockRes as ServerResponse,
        'user-456'
      );

      expect(resStatus).toBe(400);
      const response = JSON.parse(resBody);
      expect(response.error).toBe('User not found');
    });
  });
});
