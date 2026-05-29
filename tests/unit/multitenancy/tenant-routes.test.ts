/**
 * Tenant REST route auth + RBAC tests (AIG-649 review fix).
 *
 * Verifies the four critical access-control invariants the reviewer flagged:
 *   1. Anonymous calls are rejected with 401.
 *   2. A member of tenant A cannot read/delete tenant B (cross-tenant).
 *   3. A `member` cannot DELETE a tenant; only `tenant_admin` can.
 *   4. A `member` CAN read tenant detail / list workspaces.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Router } from '../../../src/web/router.js';
import {
  registerTenantRoutes,
  _resetTenantRoutesDb,
} from '../../../src/web/routes/tenants.js';
import { TenantService } from '../../../src/multitenancy/service.js';
import { AuthService } from '../../../src/auth/service.js';
import { initAuth } from '../../../src/web/middleware/auth.js';
import { UserRole } from '../../../src/auth/types.js';
import type { AgentStackConfig } from '../../../src/types.js';

// ---- Test fixtures ------------------------------------------------------

interface MockRes extends ServerResponse {
  statusCode: number;
  getBody: () => unknown;
}

function createMockResponse(): MockRes {
  let body = '';
  let statusCode = 200;
  const res = {
    writeHead: vi.fn((code: number) => { statusCode = code; }),
    end: vi.fn((data: string) => { body = data; }),
    headersSent: false,
    get statusCode() { return statusCode; },
    getBody: () => (body ? JSON.parse(body) : null),
  } as unknown as MockRes;
  return res;
}

function createMockRequest(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): IncomingMessage {
  const req = {
    method,
    url,
    headers,
    on: vi.fn((event: string, callback: (data?: Buffer) => void) => {
      if (event === 'data' && body) {
        callback(Buffer.from(JSON.stringify(body)));
      }
      if (event === 'end') {
        callback();
      }
      return req;
    }),
  } as unknown as IncomingMessage;
  return req;
}

// Use a single test DB shared between the routes' lazy handle and our setup.
// The routes call `new Database(config.memory.path)` lazily, so we point
// at the same path and pre-create tenants/users via that path.
function makeConfig(dbPath: string): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: { path: dbPath, defaultNamespace: 'default', vectorSearch: { enabled: false } },
    providers: { default: 'anthropic' },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: false },
    plugins: { enabled: false, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: false, sessionEnd: false, preTask: false, postTask: false },
  };
}

describe('Tenant routes — auth + RBAC (AIG-649 review fix)', () => {
  // The routes module opens its own DB handle lazily via `new Database(path)`.
  // Use a fresh file path per test so the setup-side handle and the routes'
  // lazy handle see the same data.
  let dbPath: string;

  let router: Router;
  let setupDb: Database.Database;
  let tenantService: TenantService;
  let authService: AuthService;

  let tenantA: { id: string };
  let tenantB: { id: string };

  let anonReq: () => IncomingMessage;
  let memberAId: string;
  let adminToken: string;
  let memberAToken: string;
  let memberBToken: string;

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-secret-aig-649';

    dbPath = join(tmpdir(), `aistack-tenant-routes-${randomUUID()}.db`);

    // The lazy DB handle inside tenants.ts opens the same file path.
    setupDb = new Database(dbPath);
    setupDb.pragma('journal_mode = WAL');

    // Reset cached DB handle so the routes pick up the fresh test path.
    _resetTenantRoutesDb();

    authService = new AuthService(setupDb);
    initAuth(authService);

    tenantService = new TenantService(setupDb);
    tenantA = tenantService.createTenant({ name: 'Tenant A', slug: 'tenant-a' });
    tenantB = tenantService.createTenant({ name: 'Tenant B', slug: 'tenant-b' });

    // Register users + grant memberships.
    const platformAdmin = await authService.register(
      { email: 'platform-admin@x', username: 'platform-admin', password: 'pw-admin-123' },
      UserRole.ADMIN,
    );
    const memberA = await authService.register(
      { email: 'a@x', username: 'a', password: 'pw-member-a' },
      UserRole.DEVELOPER,
    );
    memberAId = memberA.id;
    const memberB = await authService.register(
      { email: 'b@x', username: 'b', password: 'pw-member-b' },
      UserRole.DEVELOPER,
    );

    // memberA is `member` in tenantA, has NO membership in tenantB.
    tenantService.addMembership(tenantA.id, memberA.id, 'member');
    // memberB is `tenant_admin` of tenantB.
    tenantService.addMembership(tenantB.id, memberB.id, 'tenant_admin');

    adminToken = (await authService.login({ email: 'platform-admin@x', password: 'pw-admin-123' })).tokens.accessToken;
    memberAToken = (await authService.login({ email: 'a@x', password: 'pw-member-a' })).tokens.accessToken;
    memberBToken = (await authService.login({ email: 'b@x', password: 'pw-member-b' })).tokens.accessToken;

    anonReq = () => createMockRequest('GET', '/api/v1/tenants');

    router = new Router();
    registerTenantRoutes(router, makeConfig(dbPath));
  });

  afterEach(() => {
    _resetTenantRoutesDb();
    try { setupDb.close(); } catch { /* ignore */ }
    for (const suffix of ['', '-wal', '-shm']) {
      const f = `${dbPath}${suffix}`;
      if (existsSync(f)) {
        try { unlinkSync(f); } catch { /* ignore */ }
      }
    }
  });

  it('rejects anonymous requests with 401 on every tenant route', async () => {
    const res = createMockResponse();
    await router.handle(anonReq(), res);
    expect(res.statusCode).toBe(401);

    const delRes = createMockResponse();
    await router.handle(
      createMockRequest('DELETE', `/api/v1/tenants/${tenantA.id}`),
      delRes,
    );
    expect(delRes.statusCode).toBe(401);

    const wsRes = createMockResponse();
    await router.handle(
      createMockRequest('GET', `/api/v1/tenants/${tenantA.id}/workspaces`),
      wsRes,
    );
    expect(wsRes.statusCode).toBe(401);
  });

  it('lets a tenant `member` read their tenant', async () => {
    const res = createMockResponse();
    await router.handle(
      createMockRequest(
        'GET',
        `/api/v1/tenants/${tenantA.id}`,
        undefined,
        { authorization: `Bearer ${memberAToken}` },
      ),
      res,
    );
    expect(res.statusCode).toBe(200);
    const body = res.getBody() as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(tenantA.id);
  });

  it('forbids a `member` from DELETE-ing their tenant (403)', async () => {
    const res = createMockResponse();
    await router.handle(
      createMockRequest(
        'DELETE',
        `/api/v1/tenants/${tenantA.id}`,
        undefined,
        { authorization: `Bearer ${memberAToken}` },
      ),
      res,
    );
    expect(res.statusCode).toBe(403);

    // The tenant must NOT have been deleted.
    expect(tenantService.getTenantById(tenantA.id)).toBeDefined();
  });

  it('forbids a `tenant_admin` of tenant B from touching tenant A (cross-tenant 403)', async () => {
    // GET tenant A as memberB (tenant_admin of B, no membership in A)
    const getRes = createMockResponse();
    await router.handle(
      createMockRequest(
        'GET',
        `/api/v1/tenants/${tenantA.id}`,
        undefined,
        { authorization: `Bearer ${memberBToken}` },
      ),
      getRes,
    );
    expect(getRes.statusCode).toBe(403);

    // DELETE tenant A as memberB (admin of B). MUST be denied — even though
    // memberB is tenant_admin somewhere, RBAC is per-tenant.
    const delRes = createMockResponse();
    await router.handle(
      createMockRequest(
        'DELETE',
        `/api/v1/tenants/${tenantA.id}`,
        undefined,
        { authorization: `Bearer ${memberBToken}` },
      ),
      delRes,
    );
    expect(delRes.statusCode).toBe(403);
    expect(tenantService.getTenantById(tenantA.id)).toBeDefined();
  });

  it('lets a platform `admin` delete any tenant (bypass tenancy RBAC)', async () => {
    const res = createMockResponse();
    await router.handle(
      createMockRequest(
        'DELETE',
        `/api/v1/tenants/${tenantB.id}`,
        undefined,
        { authorization: `Bearer ${adminToken}` },
      ),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(tenantService.getTenantById(tenantB.id)).toBeUndefined();
  });

  it('rejects workspace reads when header tenant context differs from the path tenant', async () => {
    tenantService.addMembership(tenantB.id, memberAId, 'member');
    tenantService.createWorkspace({
      tenantId: tenantB.id,
      name: 'Default',
      slug: 'default',
    });

    const tenantAwareRouter = new Router();
    registerTenantRoutes(tenantAwareRouter, {
      ...makeConfig(dbPath),
      multitenancy: {
        enabled: true,
        defaultTenantSlug: 'tenant-a',
        defaultWorkspaceSlug: 'default',
      },
    });

    const res = createMockResponse();
    await tenantAwareRouter.handle(
      createMockRequest(
        'GET',
        `/api/v1/tenants/${tenantA.id}/workspaces`,
        undefined,
        {
          authorization: `Bearer ${memberAToken}`,
          'x-tenant-slug': 'tenant-b',
        },
      ),
      res,
    );

    expect(res.statusCode).toBe(403);
    expect((res.getBody() as { error: string }).error).toMatch(
      /Tenant context mismatch/,
    );
  });
});
