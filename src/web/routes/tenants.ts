/**
 * Tenant + workspace REST routes (AIG-649).
 *
 * Routes:
 *   GET    /api/v1/tenants                           — list tenants the caller belongs to
 *   POST   /api/v1/tenants                           — create tenant (platform admin only)
 *   GET    /api/v1/tenants/:id                       — tenant detail (tenant member+)
 *   DELETE /api/v1/tenants/:id                       — delete tenant (tenant_admin only)
 *   GET    /api/v1/tenants/:id/workspaces            — list workspaces (tenant member+)
 *   POST   /api/v1/tenants/:id/workspaces            — create workspace (tenant_admin/workspace_admin)
 *
 * Security model (post-AIG-649 review fix):
 *   1. Every request requires a valid Bearer token / API key — `createAuthMiddleware`
 *      will 401 otherwise.
 *   2. Tenant-scoped routes additionally require a membership in the target
 *      tenant. The required tenancy role is resolved with `assertTenantRole()`.
 *   3. Cross-tenant requests (member of tenant A asking for tenant B) are
 *      rejected with 403 by `assertTenantRole()`.
 */

import Database from 'better-sqlite3';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import type { AgentStackConfig } from '../../types.js';
import type { Router } from '../router.js';
import { sendJson, sendError } from '../router.js';
import { badRequest, notFound } from '../middleware/error.js';
import { createAuthMiddleware, type AuthContext } from '../middleware/auth.js';
import {
  TenantService,
  withTenantContext,
  runWithTenantContext,
} from '../../multitenancy/index.js';
import type {
  Tenant,
  TenantUserRole,
  Workspace,
  MultitenancyContext,
} from '../../multitenancy/index.js';

interface CreateTenantBody {
  name?: string;
  slug?: string;
  settings?: Record<string, unknown>;
}

interface CreateWorkspaceBody {
  name?: string;
  slug?: string;
  settings?: Record<string, unknown>;
}

function serializeTenant(t: Tenant) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    settings: t.settings,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function serializeWorkspace(w: Workspace) {
  return {
    id: w.id,
    tenantId: w.tenantId,
    name: w.name,
    slug: w.slug,
    settings: w.settings,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

// Singleton DB handle for the routes — opened lazily so unit tests that
// stub a router don't trigger filesystem access.
let cachedDb: Database.Database | undefined;
function getDb(config: AgentStackConfig): Database.Database {
  if (cachedDb) return cachedDb;
  const path = config.memory.path;
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  cachedDb = new Database(path);
  return cachedDb;
}

/**
 * Test-only reset hook so unit tests can swap config / dispose handles.
 */
export function _resetTenantRoutesDb(): void {
  if (cachedDb) {
    try { cachedDb.close(); } catch { /* ignore */ }
  }
  cachedDb = undefined;
}

const TENANT_ROLE_RANK: Record<TenantUserRole, number> = {
  tenant_admin: 3,
  workspace_admin: 2,
  member: 1,
};

/**
 * Resolve the caller's tenant role and enforce that they have at least
 * `minRole` in the requested tenant. Throws an Error tagged with statusCode
 * (403/404) that the router will translate into a proper HTTP response.
 *
 * NOTE: Platform admins (auth role === 'admin') bypass tenancy checks. This
 * mirrors how the rest of the API treats the `admin` auth role.
 */
function assertTenantRole(
  service: TenantService,
  auth: AuthContext,
  tenantId: string,
  minRole: TenantUserRole,
): TenantUserRole {
  if (auth.role === 'admin') return 'tenant_admin';

  if (!auth.userId) {
    const err = new Error('Authentication required') as Error & { statusCode: number };
    err.statusCode = 401;
    throw err;
  }

  const role = service.resolveRole(auth.userId, tenantId);
  if (!role) {
    // Do NOT leak existence of the tenant to non-members — 403 vs 404 would
    // be an enumeration oracle. 403 with generic message.
    const err = new Error('Forbidden') as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }

  if (TENANT_ROLE_RANK[role] < TENANT_ROLE_RANK[minRole]) {
    const err = new Error(
      `Insufficient tenant role: requires ${minRole}, have ${role}`,
    ) as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }

  return role;
}

/**
 * Authenticate the request. Returns the AuthContext or throws after writing
 * a 401 to `res` — the caller should catch and exit.
 */
function authenticate(req: IncomingMessage, res: ServerResponse): AuthContext {
  return createAuthMiddleware({ required: true })(req, res);
}

export function registerTenantRoutes(router: Router, config: AgentStackConfig): void {
  router.get('/api/v1/tenants', (req, res, _params) => {
    let auth: AuthContext;
    try {
      auth = authenticate(req, res);
    } catch {
      return; // middleware already wrote 401
    }
    const service = new TenantService(getDb(config));

    // Non-admin users only see tenants they belong to. Platform admins see all.
    let tenants: Tenant[];
    if (auth.role === 'admin') {
      tenants = service.listTenants();
    } else if (auth.userId) {
      const memberships = service.listMembershipsForUser(auth.userId);
      const tenantIds = new Set(memberships.map((m) => m.tenantId));
      tenants = service
        .listTenants()
        .filter((t) => tenantIds.has(t.id));
    } else {
      tenants = [];
    }

    sendJson(res, {
      count: tenants.length,
      tenants: tenants.map(serializeTenant),
    });
  });

  router.post('/api/v1/tenants', (req, res, params) => {
    let auth: AuthContext;
    try {
      auth = authenticate(req, res);
    } catch {
      return;
    }
    // Creating a brand-new tenant is a platform-level operation. Only the
    // global `admin` role can do it — there is no tenancy to belong to yet.
    if (auth.role !== 'admin') {
      sendError(res, 403, 'Only platform admins can create tenants');
      return;
    }

    const body = params.body as CreateTenantBody | undefined;
    if (!body?.name || !body?.slug) {
      throw badRequest('name and slug are required');
    }
    const service = new TenantService(getDb(config));
    try {
      const tenant = service.createTenant({
        name: body.name,
        slug: body.slug,
        settings: body.settings,
      });
      // Auto-grant the creator tenant_admin so they don't lock themselves out.
      if (auth.userId) {
        service.addMembership(tenant.id, auth.userId, 'tenant_admin');
      }
      sendJson(res, serializeTenant(tenant), 201);
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : 'Create failed');
    }
  });

  router.get('/api/v1/tenants/:id', (req, res, params) => {
    let auth: AuthContext;
    try {
      auth = authenticate(req, res);
    } catch {
      return;
    }
    const id = params.path[0];
    if (!id) throw badRequest('tenant id required');
    const service = new TenantService(getDb(config));

    // 1. Membership check first — this returns 403 for unknown tenants too,
    //    to avoid acting as an enumeration oracle.
    assertTenantRole(service, auth, id, 'member');

    const tenant = service.getTenantById(id);
    if (!tenant) throw notFound('Tenant');
    sendJson(res, serializeTenant(tenant));
  });

  router.delete('/api/v1/tenants/:id', (req, res, params) => {
    let auth: AuthContext;
    try {
      auth = authenticate(req, res);
    } catch {
      return;
    }
    const id = params.path[0];
    if (!id) throw badRequest('tenant id required');
    const service = new TenantService(getDb(config));

    // Hard requirement: only tenant_admin (or platform admin) can delete.
    assertTenantRole(service, auth, id, 'tenant_admin');

    try {
      service.deleteTenant(id);
      sendJson(res, { success: true });
    } catch (error) {
      sendError(res, 404, error instanceof Error ? error.message : 'Not found');
    }
  });

  router.get('/api/v1/tenants/:id/workspaces', (req, res, params) => {
    let auth: AuthContext;
    try {
      auth = authenticate(req, res);
    } catch {
      return;
    }
    const id = params.path[0];
    if (!id) throw badRequest('tenant id required');
    const service = new TenantService(getDb(config));

    assertTenantRole(service, auth, id, 'member');

    // AIG-649: when multitenancy is enabled, resolve a MultitenancyContext
    // for this request and propagate it via runWithTenantContext so any
    // downstream consumer (memory/spawner/audit/dispatcher) automatically
    // scopes to the correct tenant. We resolve from the slug header / JWT
    // claims so callers don't have to repeat the wiring per route.
    let resolved: MultitenancyContext | undefined;
    if (config.multitenancy?.enabled) {
      try {
        resolved = withTenantContext(
          { headers: req.headers, userId: auth.userId },
          service,
          config.multitenancy,
        );
      } catch {
        // Bad slug or no membership in the slug-resolved tenant — fall
        // through; tenant-id-from-path is the source of truth here and we
        // already passed assertTenantRole above.
        resolved = undefined;
      }
    }

    runWithTenantContext(resolved, () => {
      const workspaces = service.listWorkspaces(id);
      sendJson(res, {
        count: workspaces.length,
        workspaces: workspaces.map(serializeWorkspace),
      });
    });
  });

  router.post('/api/v1/tenants/:id/workspaces', (req, res, params) => {
    let auth: AuthContext;
    try {
      auth = authenticate(req, res);
    } catch {
      return;
    }
    const id = params.path[0];
    if (!id) throw badRequest('tenant id required');
    const body = params.body as CreateWorkspaceBody | undefined;
    if (!body?.name || !body?.slug) {
      throw badRequest('name and slug are required');
    }
    const service = new TenantService(getDb(config));

    // workspace_admin is enough to create new workspaces in the tenant.
    assertTenantRole(service, auth, id, 'workspace_admin');

    try {
      const ws = service.createWorkspace({
        tenantId: id,
        name: body.name,
        slug: body.slug,
        settings: body.settings,
      });
      sendJson(res, serializeWorkspace(ws), 201);
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : 'Create failed');
    }
  });
}
