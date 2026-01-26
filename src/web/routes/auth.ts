/**
 * Authentication routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthService } from '../../auth/service.js';
import { logger } from '../../utils/logger.js';
import { parseRequestBody } from '../utils/request.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { UserRole } from '../../auth/types.js';

const log = logger.child('web:auth');

export interface AuthRoutes {
  authService: AuthService;
}

/**
 * Create authentication routes
 */
export function createAuthRoutes(deps: AuthRoutes) {
  const { authService } = deps;

  return {
    /**
     * POST /api/auth/register - Register new user
     */
    async register(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        const body = await parseRequestBody(req);

        const user = await authService.register(
          {
            email: body.email,
            username: body.username,
            password: body.password,
          },
          body.role || UserRole.DEVELOPER
        );

        const { passwordHash, ...userWithoutPassword } = user;

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            user: userWithoutPassword,
          })
        );
      } catch (error) {
        log.error('Registration failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Registration failed',
          })
        );
      }
    },

    /**
     * POST /api/auth/login - Login user
     */
    async login(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        const body = await parseRequestBody(req);

        const result = await authService.login({
          email: body.email,
          password: body.password,
        });

        const { passwordHash, ...userWithoutPassword } = result.user;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            user: userWithoutPassword,
            tokens: result.tokens,
          })
        );
      } catch (error) {
        log.error('Login failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Login failed',
          })
        );
      }
    },

    /**
     * POST /api/auth/refresh - Refresh access token
     */
    async refresh(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        const body = await parseRequestBody(req);

        if (!body.refreshToken) {
          throw new Error('Refresh token is required');
        }

        const tokens = await authService.refreshAccessToken(body.refreshToken);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tokens }));
      } catch (error) {
        log.error('Token refresh failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Token refresh failed',
          })
        );
      }
    },

    /**
     * POST /api/auth/logout - Logout user
     */
    async logout(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        const body = await parseRequestBody(req);

        if (body.refreshToken) {
          await authService.logout(body.refreshToken);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        log.error('Logout failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Logout failed',
          })
        );
      }
    },

    /**
     * GET /api/auth/me - Get current user
     */
    async me(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        const auth = createAuthMiddleware({ required: true })(req, res);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            user: auth.user,
            permissions: auth.permissions,
          })
        );
      } catch (error) {
        // Error already handled by middleware
      }
    },

    /**
     * POST /api/auth/change-password - Change password
     */
    async changePassword(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        const auth = createAuthMiddleware({ required: true })(req, res);
        const body = await parseRequestBody(req);

        if (!auth.userId) {
          throw new Error('Authentication required');
        }

        await authService.changePassword(
          auth.userId,
          body.oldPassword,
          body.newPassword
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        log.error('Password change failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Password change failed',
          })
        );
      }
    },

    /**
     * GET /api/auth/users - List all users (admin only)
     */
    async listUsers(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        const auth = createAuthMiddleware({ required: true, roles: ['admin'] })(req, res);

        const users = authService.listUsers();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ users }));
      } catch (error) {
        // Error already handled by middleware
      }
    },

    /**
     * PUT /api/auth/users/:userId/role - Update user role (admin only)
     */
    async updateUserRole(
      req: IncomingMessage,
      res: ServerResponse,
      userId: string
    ): Promise<void> {
      try {
        const auth = createAuthMiddleware({ required: true, roles: ['admin'] })(req, res);
        const body = await parseRequestBody(req);

        if (!body.role) {
          throw new Error('Role is required');
        }

        authService.updateUserRole(userId, body.role);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        log.error('Role update failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Role update failed',
          })
        );
      }
    },

    /**
     * DELETE /api/auth/users/:userId - Delete user (admin only)
     */
    async deleteUser(
      req: IncomingMessage,
      res: ServerResponse,
      userId: string
    ): Promise<void> {
      try {
        const auth = createAuthMiddleware({ required: true, roles: ['admin'] })(req, res);

        authService.deleteUser(userId);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        log.error('User deletion failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'User deletion failed',
          })
        );
      }
    },
  };
}
