/**
 * Authentication types
 */

export interface User {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
}

export enum UserRole {
  ADMIN = 'admin',
  DEVELOPER = 'developer',
  VIEWER = 'viewer',
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface JWTPayload {
  userId: string;
  email: string;
  username: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  username: string;
  password: string;
}

export interface AuthContext {
  authenticated: boolean;
  user?: Omit<User, 'passwordHash'>;
  userId?: string;
  role?: UserRole;
  permissions?: string[];
  /**
   * Multi-tenancy scoping (AIG-649). Populated by the tenant middleware when
   * the `multitenancy.enabled` config flag is on; left undefined otherwise.
   * Downstream services should treat undefined as "single-tenant mode".
   */
  tenantId?: string;
  workspaceId?: string;
  tenantRole?: 'tenant_admin' | 'workspace_admin' | 'member';
}
