/**
 * Authentication service
 */

import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';
import type {
  User,
  AuthTokens,
  JWTPayload,
  LoginCredentials,
  RegisterData,
  UserRole,
} from './types.js';

const log = logger.child('auth');

const SALT_ROUNDS = 10;
const ACCESS_TOKEN_EXPIRY = '15m'; // 15 minutes
const REFRESH_TOKEN_EXPIRY = '7d'; // 7 days

export class AuthService {
  private db: Database.Database;
  private jwtSecret: string;
  private refreshSecret: string;

  constructor(
    db: Database.Database,
    jwtSecret?: string,
    refreshSecret?: string
  ) {
    this.db = db;
    this.jwtSecret = jwtSecret || process.env.JWT_SECRET || this.generateSecret();
    this.refreshSecret = refreshSecret || process.env.REFRESH_SECRET || this.generateSecret();

    if (!process.env.JWT_SECRET) {
      log.warn('No JWT_SECRET set, using generated secret (not suitable for production)');
    }

    this.initDatabase();
  }

  /**
   * Initialize database schema for authentication
   */
  private initDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'developer',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);
    `);

    // Create default admin user if no users exist
    const userCount = this.db
      .prepare('SELECT COUNT(*) as count FROM users')
      .get() as { count: number };

    if (userCount.count === 0) {
      log.info('Creating default admin user');
      try {
        this.createDefaultAdmin();
      } catch (error) {
        log.error('Failed to create default admin user', error);
      }
    }
  }

  /**
   * Create default admin user
   */
  private createDefaultAdmin(): void {
    const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const passwordHash = bcrypt.hashSync(defaultPassword, SALT_ROUNDS);

    this.db
      .prepare(
        `INSERT INTO users (id, email, username, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        'admin@aistack.local',
        'admin',
        passwordHash,
        'admin',
        new Date().toISOString(),
        new Date().toISOString()
      );

    log.info('Default admin user created', {
      email: 'admin@aistack.local',
      password: defaultPassword,
    });
  }

  /**
   * Generate a secure random secret
   */
  private generateSecret(): string {
    return randomUUID() + randomUUID();
  }

  /**
   * Register a new user
   */
  async register(data: RegisterData, role: UserRole = 'developer' as UserRole): Promise<User> {
    // Validate input
    if (!data.email || !data.username || !data.password) {
      throw new Error('Email, username, and password are required');
    }

    if (data.password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }

    // Check if user already exists
    const existing = this.db
      .prepare('SELECT id FROM users WHERE email = ? OR username = ?')
      .get(data.email, data.username);

    if (existing) {
      throw new Error('User with this email or username already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    // Create user
    const userId = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO users (id, email, username, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(userId, data.email, data.username, passwordHash, role, now, now);

    log.info('User registered', { userId, email: data.email, username: data.username });

    return this.getUserById(userId)!;
  }

  /**
   * Authenticate user and generate tokens
   */
  async login(credentials: LoginCredentials): Promise<{ user: User; tokens: AuthTokens }> {
    // Find user
    const user = this.getUserByEmail(credentials.email);

    if (!user) {
      throw new Error('Invalid email or password');
    }

    // Verify password
    const valid = await bcrypt.compare(credentials.password, user.passwordHash);
    if (!valid) {
      throw new Error('Invalid email or password');
    }

    // Generate tokens
    const tokens = this.generateTokens(user);

    // Use transaction to ensure atomic update of last login and token storage
    const now = new Date().toISOString();
    const tokenHash = await bcrypt.hash(tokens.refreshToken, SALT_ROUNDS);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const transaction = this.db.transaction(() => {
      // Update last login
      this.db
        .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
        .run(now, user.id);

      // Store refresh token
      this.db
        .prepare(
          `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(randomUUID(), user.id, tokenHash, expiresAt, now);

      // Clean up expired tokens
      this.db
        .prepare('DELETE FROM refresh_tokens WHERE expires_at < ? OR revoked = 1')
        .run(now);
    });

    transaction();

    log.info('User logged in', { userId: user.id, email: user.email });

    return { user, tokens };
  }

  /**
   * Generate access and refresh tokens
   */
  private generateTokens(user: User): AuthTokens {
    const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
      userId: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    };

    const accessToken = jwt.sign(payload, this.jwtSecret, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
    });

    const refreshToken = jwt.sign({ userId: user.id }, this.refreshSecret, {
      expiresIn: REFRESH_TOKEN_EXPIRY,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60, // 15 minutes in seconds
    };
  }

  /**
   * Store refresh token in database
   */
  private async storeRefreshToken(userId: string, token: string): Promise<void> {
    const tokenHash = await bcrypt.hash(token, SALT_ROUNDS);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
    const now = new Date().toISOString();

    // Use transaction to ensure atomic insert and cleanup
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(randomUUID(), userId, tokenHash, expiresAt, now);

      // Clean up expired tokens
      this.db
        .prepare('DELETE FROM refresh_tokens WHERE expires_at < ? OR revoked = 1')
        .run(now);
    });

    transaction();
  }

  /**
   * Verify access token
   */
  verifyAccessToken(token: string): JWTPayload {
    try {
      const payload = jwt.verify(token, this.jwtSecret) as JWTPayload;
      return payload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Token expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid token');
      }
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
    try {
      // Verify refresh token
      const payload = jwt.verify(refreshToken, this.refreshSecret) as { userId: string };

      // Check if token exists and is not revoked
      const storedTokens = this.db
        .prepare(
          `SELECT * FROM refresh_tokens
           WHERE user_id = ? AND revoked = 0 AND expires_at > ?`
        )
        .all(payload.userId, new Date().toISOString()) as Array<{
        token_hash: string;
      }>;

      // Verify at least one stored token matches
      let tokenValid = false;
      for (const stored of storedTokens) {
        if (await bcrypt.compare(refreshToken, stored.token_hash)) {
          tokenValid = true;
          break;
        }
      }

      if (!tokenValid) {
        throw new Error('Invalid or revoked refresh token');
      }

      // Get user
      const user = this.getUserById(payload.userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Generate new tokens
      const tokens = this.generateTokens(user);

      // Store new refresh token
      await this.storeRefreshToken(user.id, tokens.refreshToken);

      return tokens;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Refresh token expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid refresh token');
      }
      throw error;
    }
  }

  /**
   * Revoke refresh token (logout)
   */
  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = jwt.verify(refreshToken, this.refreshSecret) as { userId: string };

      // Mark all tokens for this user as revoked
      this.db
        .prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?')
        .run(payload.userId);

      log.info('User logged out', { userId: payload.userId });
    } catch {
      // Ignore errors - token might be invalid but that's okay for logout
    }
  }

  /**
   * Get user by ID
   */
  getUserById(userId: string): User | undefined {
    const row = this.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(userId) as any;

    if (!row) return undefined;

    return {
      id: row.id,
      email: row.email,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : undefined,
    };
  }

  /**
   * Get user by email
   */
  getUserByEmail(email: string): User | undefined {
    const row = this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email) as any;

    if (!row) return undefined;

    return {
      id: row.id,
      email: row.email,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : undefined,
    };
  }

  /**
   * List all users (admin only)
   */
  listUsers(): Array<Omit<User, 'passwordHash'>> {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as any[];

    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      username: row.username,
      role: row.role,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : undefined,
    }));
  }

  /**
   * Update user role (admin only)
   */
  updateUserRole(userId: string, role: UserRole): void {
    this.db
      .prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?')
      .run(role, new Date().toISOString(), userId);

    log.info('User role updated', { userId, role });
  }

  /**
   * Delete user (admin only)
   */
  deleteUser(userId: string): void {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    log.info('User deleted', { userId });
  }

  /**
   * Change user password
   */
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const user = this.getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Verify old password
    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) {
      throw new Error('Invalid old password');
    }

    if (newPassword.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Use transaction to ensure password update and token revocation are atomic
    const transaction = this.db.transaction(() => {
      // Update password
      this.db
        .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
        .run(passwordHash, new Date().toISOString(), userId);

      // Revoke all refresh tokens
      this.db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
    });

    transaction();

    log.info('Password changed', { userId });
  }
}
