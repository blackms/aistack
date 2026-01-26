/**
 * Authentication Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestEnv, cleanupTestEnv, createTestConfig } from './setup.js';
import { getMemoryManager, resetMemoryManager } from '../../src/memory/index.js';
import { AuthService } from '../../src/auth/service.js';
import { UserRole } from '../../src/auth/types.js';
import type { AgentStackConfig } from '../../src/types.js';

describe('Authentication Integration', () => {
  let config: AgentStackConfig;
  let authService: AuthService;

  beforeEach(() => {
    setupTestEnv();
    config = createTestConfig();
    const memory = getMemoryManager(config);
    authService = new AuthService(memory.getStore().getDatabase());
  });

  afterEach(() => {
    resetMemoryManager();
    cleanupTestEnv();
  });

  it('should create default admin user', () => {
    const users = authService.listUsers();
    expect(users.length).toBeGreaterThanOrEqual(1);

    const admin = users.find(u => u.role === UserRole.ADMIN);
    expect(admin).toBeDefined();
    expect(admin?.email).toBe('admin@aistack.local');
  });

  it('should register new user', async () => {
    const user = await authService.register({
      email: 'test@example.com',
      username: 'testuser',
      password: 'password123',
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe('test@example.com');
    expect(user.username).toBe('testuser');
    expect(user.role).toBe(UserRole.DEVELOPER);
  });

  it('should prevent duplicate email', async () => {
    await authService.register({
      email: 'duplicate@example.com',
      username: 'user1',
      password: 'password123',
    });

    await expect(
      authService.register({
        email: 'duplicate@example.com',
        username: 'user2',
        password: 'password123',
      })
    ).rejects.toThrow('already exists');
  });

  it('should login with valid credentials', async () => {
    // Register user
    await authService.register({
      email: 'login@example.com',
      username: 'loginuser',
      password: 'password123',
    });

    // Login
    const result = await authService.login({
      email: 'login@example.com',
      password: 'password123',
    });

    expect(result.user.email).toBe('login@example.com');
    expect(result.tokens.accessToken).toBeDefined();
    expect(result.tokens.refreshToken).toBeDefined();
    expect(result.tokens.expiresIn).toBe(900); // 15 minutes
  });

  it('should reject invalid credentials', async () => {
    await authService.register({
      email: 'test@example.com',
      username: 'testuser',
      password: 'correctpassword',
    });

    await expect(
      authService.login({
        email: 'test@example.com',
        password: 'wrongpassword',
      })
    ).rejects.toThrow('Invalid email or password');
  });

  it('should verify valid access token', async () => {
    const { user, tokens } = await authService.login({
      email: 'admin@aistack.local',
      password: process.env.ADMIN_PASSWORD || 'admin123',
    });

    const payload = authService.verifyAccessToken(tokens.accessToken);

    expect(payload.userId).toBe(user.id);
    expect(payload.email).toBe(user.email);
    expect(payload.role).toBe(user.role);
  });

  it('should reject invalid token', () => {
    expect(() => {
      authService.verifyAccessToken('invalid-token');
    }).toThrow('Invalid token');
  });

  it('should refresh access token', async () => {
    const { tokens } = await authService.login({
      email: 'admin@aistack.local',
      password: process.env.ADMIN_PASSWORD || 'admin123',
    });

    const newTokens = await authService.refreshAccessToken(tokens.refreshToken);

    expect(newTokens.accessToken).toBeDefined();
    expect(newTokens.accessToken).not.toBe(tokens.accessToken);
    expect(newTokens.refreshToken).toBeDefined();
  });

  it('should logout and revoke tokens', async () => {
    const { tokens } = await authService.login({
      email: 'admin@aistack.local',
      password: process.env.ADMIN_PASSWORD || 'admin123',
    });

    // Logout
    await authService.logout(tokens.refreshToken);

    // Try to refresh - should fail
    await expect(
      authService.refreshAccessToken(tokens.refreshToken)
    ).rejects.toThrow();
  });

  it('should change password', async () => {
    const user = await authService.register({
      email: 'password@example.com',
      username: 'passworduser',
      password: 'oldpassword',
    });

    // Change password
    await authService.changePassword(user.id, 'oldpassword', 'newpassword');

    // Login with new password should work
    const result = await authService.login({
      email: 'password@example.com',
      password: 'newpassword',
    });

    expect(result.user.email).toBe('password@example.com');

    // Old password should not work
    await expect(
      authService.login({
        email: 'password@example.com',
        password: 'oldpassword',
      })
    ).rejects.toThrow('Invalid email or password');
  });

  it('should update user role', async () => {
    const user = await authService.register({
      email: 'role@example.com',
      username: 'roleuser',
      password: 'password123',
    });

    expect(user.role).toBe(UserRole.DEVELOPER);

    // Update to admin
    authService.updateUserRole(user.id, UserRole.ADMIN);

    // Verify role changed
    const updated = authService.getUserById(user.id);
    expect(updated?.role).toBe(UserRole.ADMIN);
  });

  it('should delete user', async () => {
    const user = await authService.register({
      email: 'delete@example.com',
      username: 'deleteuser',
      password: 'password123',
    });

    // Delete user
    authService.deleteUser(user.id);

    // Verify user deleted
    const deleted = authService.getUserById(user.id);
    expect(deleted).toBeUndefined();
  });

  it('should enforce minimum password length', async () => {
    await expect(
      authService.register({
        email: 'short@example.com',
        username: 'shortpass',
        password: 'short',
      })
    ).rejects.toThrow('at least 8 characters');
  });
});
