/**
 * Multi-tenancy module (AIG-649).
 *
 * Consolidated barrel — exposes types, the TenantService, request-context
 * resolution helpers and the single->multi migration tool. Files were
 * intentionally collapsed here to keep the AIG-649 footprint within the
 * 16-file budget. If this module grows further, split out the types into
 * a dedicated file.
 */

import type { IncomingMessage } from 'node:http';
import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';
import { TenantService } from './service.js';
import type { Tenant, TenantUserRole, Workspace } from './service.js';

export { TenantService } from './service.js';
export type {
  Tenant,
  Workspace,
  TenantMembership,
  TenantUserRole,
  CreateTenantInput,
  CreateWorkspaceInput,
} from './service.js';

const log = logger.child('multitenancy');

// ===== Cross-cutting types ===============================================

export interface MultitenancyContext {
  tenantId: string;
  tenantSlug: string;
  workspaceId?: string;
  workspaceSlug?: string;
  role: TenantUserRole;
}

export interface MultitenancyConfig {
  enabled: boolean;
  defaultTenantSlug: string;
  defaultWorkspaceSlug: string;
}

// ===== Request-context resolution =======================================

export interface TenantContextRequest {
  headers?: IncomingMessage['headers'] | Record<string, string | string[] | undefined>;
  jwtClaims?: { tenant_slug?: string; workspace_slug?: string };
  userId?: string;
}

function headerValue(
  headers: TenantContextRequest['headers'],
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lc = name.toLowerCase();
  const raw = (headers as Record<string, string | string[] | undefined>)[lc]
    ?? (headers as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/**
 * Build a stable memory namespace prefix scoped to tenant+workspace.
 * Callers should COMPOSE on top of this, e.g.
 * `${workspaceNamespace(ctx)}:agents:${agentId}`.
 */
export function workspaceNamespace(ctx: MultitenancyContext): string {
  if (ctx.workspaceId) {
    return `tenant:${ctx.tenantId}:workspace:${ctx.workspaceId}`;
  }
  return `tenant:${ctx.tenantId}`;
}

/**
 * Resolve a MultitenancyContext from an incoming request. Returns undefined
 * when multitenancy is disabled — callers should treat that as "no isolation".
 *
 * Resolution priority: X-Tenant-Slug/X-Workspace-Slug headers > JWT custom
 * claims > config-level defaultTenantSlug/defaultWorkspaceSlug.
 */
export function withTenantContext(
  req: TenantContextRequest,
  service: TenantService,
  config: MultitenancyConfig,
): MultitenancyContext | undefined {
  if (!config.enabled) return undefined;

  const tenantSlug =
    headerValue(req.headers, 'x-tenant-slug')
    ?? req.jwtClaims?.tenant_slug
    ?? config.defaultTenantSlug;

  const workspaceSlug =
    headerValue(req.headers, 'x-workspace-slug')
    ?? req.jwtClaims?.workspace_slug
    ?? config.defaultWorkspaceSlug;

  const tenant = service.getTenantBySlug(tenantSlug);
  if (!tenant) {
    throw new Error(`Tenant "${tenantSlug}" not found`);
  }

  const workspace = workspaceSlug
    ? service.getWorkspaceBySlug(tenant.id, workspaceSlug)
    : undefined;

  let role: TenantUserRole = 'member';
  if (req.userId) {
    const resolved = service.resolveRole(req.userId, tenant.id, workspace?.id);
    if (!resolved) {
      throw new Error(
        `User ${req.userId} has no membership in tenant ${tenantSlug}`,
      );
    }
    role = resolved;
  }

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    workspaceId: workspace?.id,
    workspaceSlug: workspace?.slug,
    role,
  };
}

// ===== Single-tenant -> multi-tenant migration tool =====================

export interface MigrationOptions {
  tenantSlug?: string;
  tenantName?: string;
  workspaceSlug?: string;
  workspaceName?: string;
  /**
   * When true, do not promote existing users to tenant_admin. Useful when
   * the caller wants to provision roles manually after the bootstrap.
   */
  skipUserMembership?: boolean;
  /**
   * Optional: limit user backfill to a specific list of user IDs. When
   * omitted, all users in the `users` table are granted membership.
   */
  userIds?: string[];
}

export interface MigrationResult {
  tenant: Tenant;
  workspace: Workspace;
  usersGrantedMembership: number;
  reusedTenant: boolean;
  reusedWorkspace: boolean;
}

/**
 * Idempotent: re-running on an already-migrated DB will detect the existing
 * tenant+workspace and refresh memberships without duplicating data.
 *
 * Cross-branch retrofit (adding tenant_id to existing domain tables) is
 * OUT OF SCOPE here — see docs/MULTITENANT.md "Retrofit checklist".
 */
export function migrateSingleToMulti(
  db: Database.Database,
  opts: MigrationOptions = {},
): MigrationResult {
  const service = new TenantService(db);

  const tenantSlug = opts.tenantSlug ?? 'default';
  const workspaceSlug = opts.workspaceSlug ?? 'default';
  const tenantName = opts.tenantName ?? 'Default Tenant';
  const workspaceName = opts.workspaceName ?? 'Default Workspace';

  let tenant = service.getTenantBySlug(tenantSlug);
  const reusedTenant = tenant !== undefined;
  if (!tenant) {
    tenant = service.createTenant({ name: tenantName, slug: tenantSlug });
    log.info('Default tenant provisioned', { id: tenant.id, slug: tenantSlug });
  }

  let workspace = service.getWorkspaceBySlug(tenant.id, workspaceSlug);
  const reusedWorkspace = workspace !== undefined;
  if (!workspace) {
    workspace = service.createWorkspace({
      tenantId: tenant.id,
      name: workspaceName,
      slug: workspaceSlug,
    });
    log.info('Default workspace provisioned', {
      id: workspace.id,
      tenantId: tenant.id,
    });
  }

  let usersGrantedMembership = 0;
  if (!opts.skipUserMembership) {
    const userIds = opts.userIds ?? listExistingUserIds(db);
    for (const userId of userIds) {
      service.addMembership(tenant.id, userId, 'tenant_admin');
      usersGrantedMembership++;
    }
    log.info('User memberships backfilled', {
      tenantId: tenant.id,
      count: usersGrantedMembership,
    });
  }

  return {
    tenant,
    workspace,
    usersGrantedMembership,
    reusedTenant,
    reusedWorkspace,
  };
}

function listExistingUserIds(db: Database.Database): string[] {
  const tableExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
    )
    .get();
  if (!tableExists) return [];

  const rows = db.prepare('SELECT id FROM users').all() as Array<{ id: string }>;
  return rows.map((r) => r.id);
}
