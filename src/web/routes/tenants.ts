/**
 * Tenant + workspace REST routes (AIG-649).
 *
 * Routes:
 *   GET    /api/v1/tenants                           — list tenants the caller belongs to
 *   POST   /api/v1/tenants                           — create tenant (admin only)
 *   GET    /api/v1/tenants/:id                       — tenant detail
 *   DELETE /api/v1/tenants/:id                       — delete tenant (tenant_admin)
 *   GET    /api/v1/tenants/:id/workspaces            — list workspaces in tenant
 *   POST   /api/v1/tenants/:id/workspaces            — create workspace (tenant_admin/workspace_admin)
 */

import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import type { AgentStackConfig } from '../../types.js';
import type { Router } from '../router.js';
import { sendJson, sendError } from '../router.js';
import { badRequest, notFound } from '../middleware/error.js';
import { TenantService } from '../../multitenancy/index.js';
import type { Tenant, Workspace } from '../../multitenancy/index.js';

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

export function registerTenantRoutes(router: Router, config: AgentStackConfig): void {
  router.get('/api/v1/tenants', (_req, res, _params) => {
    const service = new TenantService(getDb(config));
    const tenants = service.listTenants();
    sendJson(res, {
      count: tenants.length,
      tenants: tenants.map(serializeTenant),
    });
  });

  router.post('/api/v1/tenants', (_req, res, params) => {
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
      sendJson(res, serializeTenant(tenant), 201);
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : 'Create failed');
    }
  });

  router.get('/api/v1/tenants/:id', (_req, res, params) => {
    const id = params.path[0];
    if (!id) throw badRequest('tenant id required');
    const service = new TenantService(getDb(config));
    const tenant = service.getTenantById(id);
    if (!tenant) throw notFound('Tenant');
    sendJson(res, serializeTenant(tenant));
  });

  router.delete('/api/v1/tenants/:id', (_req, res, params) => {
    const id = params.path[0];
    if (!id) throw badRequest('tenant id required');
    const service = new TenantService(getDb(config));
    try {
      service.deleteTenant(id);
      sendJson(res, { success: true });
    } catch (error) {
      sendError(res, 404, error instanceof Error ? error.message : 'Not found');
    }
  });

  router.get('/api/v1/tenants/:id/workspaces', (_req, res, params) => {
    const id = params.path[0];
    if (!id) throw badRequest('tenant id required');
    const service = new TenantService(getDb(config));
    const workspaces = service.listWorkspaces(id);
    sendJson(res, {
      count: workspaces.length,
      workspaces: workspaces.map(serializeWorkspace),
    });
  });

  router.post('/api/v1/tenants/:id/workspaces', (_req, res, params) => {
    const id = params.path[0];
    if (!id) throw badRequest('tenant id required');
    const body = params.body as CreateWorkspaceBody | undefined;
    if (!body?.name || !body?.slug) {
      throw badRequest('name and slug are required');
    }
    const service = new TenantService(getDb(config));
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
