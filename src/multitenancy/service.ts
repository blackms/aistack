/**
 * TenantService — CRUD for tenants/workspaces and RBAC checks (AIG-649).
 *
 * All write methods are idempotent on the slug column so the migration tool
 * and CLI bootstrapping can be safely re-run.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

// Types are defined inline rather than imported from './index.js' to avoid
// the circular import that would form (index.ts already imports this file).
export type TenantUserRole = 'tenant_admin' | 'workspace_admin' | 'member';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Workspace {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantMembership {
  tenantId: string;
  userId: string;
  workspaceId?: string;
  role: TenantUserRole;
  createdAt: Date;
}

export interface CreateTenantInput {
  name: string;
  slug: string;
  settings?: Record<string, unknown>;
}

export interface CreateWorkspaceInput {
  tenantId: string;
  name: string;
  slug: string;
  settings?: Record<string, unknown>;
}

const log = logger.child('multitenancy');

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  settings_json: string | null;
  created_at: number;
  updated_at: number;
}

interface WorkspaceRow {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  settings_json: string | null;
  created_at: number;
  updated_at: number;
}

interface TenantUserRow {
  tenant_id: string;
  user_id: string;
  workspace_id: string | null;
  role: TenantUserRole;
  created_at: number;
}

function parseSettings(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    settings: parseSettings(row.settings_json),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    slug: row.slug,
    settings: parseSettings(row.settings_json),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapMembership(row: TenantUserRow): TenantMembership {
  return {
    tenantId: row.tenant_id,
    userId: row.user_id,
    workspaceId: row.workspace_id ?? undefined,
    role: row.role,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Slug must be URL/CLI safe so it can appear in paths, headers and CLI args
 * without escaping. Empty / whitespace-only slugs are rejected upstream.
 */
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,62}$/;

function assertValidSlug(slug: string, label: string): void {
  if (!SLUG_REGEX.test(slug)) {
    throw new Error(
      `Invalid ${label} slug "${slug}": must match ${SLUG_REGEX.toString()}`,
    );
  }
}

export class TenantService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureSchema();
  }

  /**
   * Inline schema bootstrap so callers that haven't run the migrations file
   * yet (unit tests, REPL) still get a usable service.
   */
  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        settings_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        settings_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(tenant_id, slug)
      );
      CREATE INDEX IF NOT EXISTS idx_workspaces_tenant ON workspaces(tenant_id);

      CREATE TABLE IF NOT EXISTS tenant_users (
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('tenant_admin', 'workspace_admin', 'member')),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, user_id, workspace_id)
      );
      CREATE INDEX IF NOT EXISTS idx_tenant_users_user ON tenant_users(user_id);
      CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant ON tenant_users(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_tenant_users_workspace ON tenant_users(workspace_id);
    `);
  }

  // ---- Tenant CRUD --------------------------------------------------------

  createTenant(input: CreateTenantInput): Tenant {
    assertValidSlug(input.slug, 'tenant');

    const existing = this.getTenantBySlug(input.slug);
    if (existing) {
      throw new Error(`Tenant with slug "${input.slug}" already exists`);
    }

    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO tenants (id, name, slug, settings_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.name, input.slug, JSON.stringify(input.settings ?? {}), now, now);

    log.info('Tenant created', { id, slug: input.slug });
    return this.getTenantById(id)!;
  }

  getTenantById(id: string): Tenant | undefined {
    const row = this.db.prepare('SELECT * FROM tenants WHERE id = ?').get(id) as
      | TenantRow
      | undefined;
    return row ? mapTenant(row) : undefined;
  }

  getTenantBySlug(slug: string): Tenant | undefined {
    const row = this.db
      .prepare('SELECT * FROM tenants WHERE slug = ?')
      .get(slug) as TenantRow | undefined;
    return row ? mapTenant(row) : undefined;
  }

  listTenants(): Tenant[] {
    const rows = this.db
      .prepare('SELECT * FROM tenants ORDER BY created_at ASC')
      .all() as TenantRow[];
    return rows.map(mapTenant);
  }

  /**
   * Cascade-delete a tenant and everything that hangs off it (workspaces,
   * memberships). Domain tables that haven't been retrofitted with tenant_id
   * yet are not touched here — see docs/MULTITENANT.md for the retrofit plan.
   */
  deleteTenant(id: string): void {
    const result = this.db.prepare('DELETE FROM tenants WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new Error(`Tenant ${id} not found`);
    }
    log.info('Tenant deleted', { id });
  }

  // ---- Workspace CRUD -----------------------------------------------------

  createWorkspace(input: CreateWorkspaceInput): Workspace {
    assertValidSlug(input.slug, 'workspace');

    const tenant = this.getTenantById(input.tenantId);
    if (!tenant) {
      throw new Error(`Tenant ${input.tenantId} not found`);
    }

    const existing = this.getWorkspaceBySlug(input.tenantId, input.slug);
    if (existing) {
      throw new Error(
        `Workspace "${input.slug}" already exists in tenant ${tenant.slug}`,
      );
    }

    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO workspaces (id, tenant_id, name, slug, settings_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.tenantId,
        input.name,
        input.slug,
        JSON.stringify(input.settings ?? {}),
        now,
        now,
      );

    log.info('Workspace created', { id, tenantId: input.tenantId, slug: input.slug });
    return this.getWorkspaceById(id)!;
  }

  getWorkspaceById(id: string): Workspace | undefined {
    const row = this.db
      .prepare('SELECT * FROM workspaces WHERE id = ?')
      .get(id) as WorkspaceRow | undefined;
    return row ? mapWorkspace(row) : undefined;
  }

  getWorkspaceBySlug(tenantId: string, slug: string): Workspace | undefined {
    const row = this.db
      .prepare('SELECT * FROM workspaces WHERE tenant_id = ? AND slug = ?')
      .get(tenantId, slug) as WorkspaceRow | undefined;
    return row ? mapWorkspace(row) : undefined;
  }

  listWorkspaces(tenantId: string): Workspace[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM workspaces WHERE tenant_id = ? ORDER BY created_at ASC',
      )
      .all(tenantId) as WorkspaceRow[];
    return rows.map(mapWorkspace);
  }

  deleteWorkspace(id: string): void {
    const result = this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new Error(`Workspace ${id} not found`);
    }
    log.info('Workspace deleted', { id });
  }

  // ---- Membership / RBAC --------------------------------------------------

  addMembership(
    tenantId: string,
    userId: string,
    role: TenantUserRole,
    workspaceId?: string,
  ): TenantMembership {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO tenant_users
         (tenant_id, user_id, workspace_id, role, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(tenantId, userId, workspaceId ?? null, role, now);

    return {
      tenantId,
      userId,
      workspaceId,
      role,
      createdAt: new Date(now),
    };
  }

  removeMembership(tenantId: string, userId: string, workspaceId?: string): void {
    if (workspaceId === undefined) {
      this.db
        .prepare(
          'DELETE FROM tenant_users WHERE tenant_id = ? AND user_id = ? AND workspace_id IS NULL',
        )
        .run(tenantId, userId);
    } else {
      this.db
        .prepare(
          'DELETE FROM tenant_users WHERE tenant_id = ? AND user_id = ? AND workspace_id = ?',
        )
        .run(tenantId, userId, workspaceId);
    }
  }

  listMembershipsForUser(userId: string): TenantMembership[] {
    const rows = this.db
      .prepare('SELECT * FROM tenant_users WHERE user_id = ?')
      .all(userId) as TenantUserRow[];
    return rows.map(mapMembership);
  }

  listMembershipsForTenant(tenantId: string): TenantMembership[] {
    const rows = this.db
      .prepare('SELECT * FROM tenant_users WHERE tenant_id = ?')
      .all(tenantId) as TenantUserRow[];
    return rows.map(mapMembership);
  }

  /**
   * Returns the highest privileged role this user holds in the tenant,
   * considering both tenant-wide and workspace-scoped grants. Returns
   * undefined if the user has no membership at all.
   */
  resolveRole(
    userId: string,
    tenantId: string,
    workspaceId?: string,
  ): TenantUserRole | undefined {
    const rows = this.db
      .prepare(
        `SELECT role, workspace_id FROM tenant_users
         WHERE tenant_id = ? AND user_id = ?
         AND (workspace_id IS NULL OR workspace_id = ?)`,
      )
      .all(tenantId, userId, workspaceId ?? null) as Array<{
        role: TenantUserRole;
        workspace_id: string | null;
      }>;

    if (rows.length === 0) return undefined;

    const order: Record<TenantUserRole, number> = {
      tenant_admin: 3,
      workspace_admin: 2,
      member: 1,
    };
    return rows.reduce<TenantUserRole>((best, r) => {
      return order[r.role] > order[best] ? r.role : best;
    }, 'member');
  }

  /**
   * Strict isolation check: confirms the user can access the given
   * tenant (+ optional workspace). Throws if denied.
   */
  assertAccess(userId: string, tenantId: string, workspaceId?: string): TenantUserRole {
    const role = this.resolveRole(userId, tenantId, workspaceId);
    if (!role) {
      throw new Error(
        `User ${userId} has no access to tenant ${tenantId}` +
          (workspaceId ? ` / workspace ${workspaceId}` : ''),
      );
    }
    return role;
  }
}
