/**
 * TenantService unit tests (AIG-649).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { TenantService } from '../../../src/multitenancy/service.js';
import {
  getActiveTenantContext,
  runWithTenantContext,
  workspaceNamespace,
  _resetActiveTenantContext,
} from '../../../src/multitenancy/index.js';

describe('TenantService', () => {
  let db: Database.Database;
  let service: TenantService;

  beforeEach(() => {
    db = new Database(':memory:');
    service = new TenantService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('createTenant', () => {
    it('creates a tenant with a unique slug', () => {
      const tenant = service.createTenant({ name: 'Acme', slug: 'acme' });
      expect(tenant.id).toBeDefined();
      expect(tenant.slug).toBe('acme');
      expect(tenant.name).toBe('Acme');
      expect(tenant.settings).toEqual({});
      expect(tenant.createdAt).toBeInstanceOf(Date);
    });

    it('rejects duplicate slugs', () => {
      service.createTenant({ name: 'Acme', slug: 'acme' });
      expect(() => service.createTenant({ name: 'Other', slug: 'acme' })).toThrow(
        /already exists/,
      );
    });

    it('rejects invalid slugs', () => {
      expect(() => service.createTenant({ name: 'X', slug: 'BadSlug!' })).toThrow(
        /Invalid tenant slug/,
      );
      expect(() => service.createTenant({ name: 'X', slug: '' })).toThrow(/Invalid/);
      expect(() => service.createTenant({ name: 'X', slug: '-leading' })).toThrow(/Invalid/);
    });
  });

  describe('listTenants / getTenantBySlug', () => {
    it('returns tenants in creation order', () => {
      service.createTenant({ name: 'A', slug: 'a' });
      service.createTenant({ name: 'B', slug: 'b' });
      const list = service.listTenants();
      expect(list).toHaveLength(2);
      expect(list[0].slug).toBe('a');
      expect(list[1].slug).toBe('b');
    });

    it('looks up by slug', () => {
      const created = service.createTenant({ name: 'A', slug: 'a' });
      const found = service.getTenantBySlug('a');
      expect(found?.id).toBe(created.id);
    });
  });

  describe('deleteTenant', () => {
    it('cascades to workspaces and memberships', () => {
      const t = service.createTenant({ name: 'A', slug: 'a' });
      service.createWorkspace({ tenantId: t.id, name: 'W', slug: 'w' });
      service.addMembership(t.id, 'user-1', 'tenant_admin');

      service.deleteTenant(t.id);

      expect(service.getTenantById(t.id)).toBeUndefined();
      expect(service.listWorkspaces(t.id)).toEqual([]);
      expect(service.listMembershipsForTenant(t.id)).toEqual([]);
    });

    it('throws when tenant does not exist', () => {
      expect(() => service.deleteTenant('nope')).toThrow(/not found/);
    });
  });

  describe('createWorkspace', () => {
    it('enforces tenant existence', () => {
      expect(() =>
        service.createWorkspace({ tenantId: 'nope', name: 'W', slug: 'w' }),
      ).toThrow(/not found/);
    });

    it('rejects duplicate workspace slugs within a tenant', () => {
      const t = service.createTenant({ name: 'A', slug: 'a' });
      service.createWorkspace({ tenantId: t.id, name: 'W', slug: 'w' });
      expect(() =>
        service.createWorkspace({ tenantId: t.id, name: 'W2', slug: 'w' }),
      ).toThrow(/already exists/);
    });

    it('allows same slug across different tenants', () => {
      const t1 = service.createTenant({ name: 'A', slug: 'a' });
      const t2 = service.createTenant({ name: 'B', slug: 'b' });
      service.createWorkspace({ tenantId: t1.id, name: 'W', slug: 'w' });
      const w2 = service.createWorkspace({ tenantId: t2.id, name: 'W', slug: 'w' });
      expect(w2.id).toBeDefined();
    });
  });

  describe('tenant isolation invariant', () => {
    it('returns only workspaces belonging to the requested tenant', () => {
      const t1 = service.createTenant({ name: 'A', slug: 'a' });
      const t2 = service.createTenant({ name: 'B', slug: 'b' });
      service.createWorkspace({ tenantId: t1.id, name: 'W1a', slug: 'w1' });
      service.createWorkspace({ tenantId: t1.id, name: 'W1b', slug: 'w2' });
      service.createWorkspace({ tenantId: t2.id, name: 'W2a', slug: 'w1' });

      const t1Workspaces = service.listWorkspaces(t1.id);
      const t2Workspaces = service.listWorkspaces(t2.id);

      expect(t1Workspaces).toHaveLength(2);
      expect(t1Workspaces.every((w) => w.tenantId === t1.id)).toBe(true);
      expect(t2Workspaces).toHaveLength(1);
      expect(t2Workspaces[0].tenantId).toBe(t2.id);
    });

    it('returns only memberships scoped to the requested tenant', () => {
      const t1 = service.createTenant({ name: 'A', slug: 'a' });
      const t2 = service.createTenant({ name: 'B', slug: 'b' });
      service.addMembership(t1.id, 'user-shared', 'tenant_admin');
      service.addMembership(t2.id, 'user-shared', 'member');
      service.addMembership(t2.id, 'user-other', 'member');

      const t1Members = service.listMembershipsForTenant(t1.id);
      const t2Members = service.listMembershipsForTenant(t2.id);

      expect(t1Members).toHaveLength(1);
      expect(t1Members[0].userId).toBe('user-shared');
      expect(t1Members[0].role).toBe('tenant_admin');
      expect(t2Members).toHaveLength(2);
    });
  });

  describe('tenant_users PK / uniqueness (AIG-649 review fix)', () => {
    it('does not allow duplicate tenant-wide memberships for the same user', () => {
      const t = service.createTenant({ name: 'A', slug: 'a' });

      // First addMembership inserts. Second one with the same (tenant, user,
      // NULL workspace) must REPLACE — not create a duplicate row. Previously
      // SQLite's PK treats NULLs as distinct, so without the COALESCE'd
      // UNIQUE INDEX a second insert would have left two rows behind and
      // resolveRole would have returned an arbitrary one.
      service.addMembership(t.id, 'u1', 'member');
      service.addMembership(t.id, 'u1', 'tenant_admin');

      const rows = db
        .prepare(
          'SELECT role, workspace_id FROM tenant_users WHERE tenant_id = ? AND user_id = ?',
        )
        .all(t.id, 'u1') as Array<{ role: string; workspace_id: string | null }>;

      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBe('tenant_admin');
      expect(rows[0].workspace_id).toBeNull();

      // resolveRole stays deterministic with the dedup in place.
      expect(service.resolveRole('u1', t.id)).toBe('tenant_admin');
    });

    it('still allows the same user to hold both a tenant-wide and a workspace-scoped grant', () => {
      const t = service.createTenant({ name: 'A', slug: 'a' });
      const w = service.createWorkspace({ tenantId: t.id, name: 'W', slug: 'w' });
      service.addMembership(t.id, 'u1', 'member');
      service.addMembership(t.id, 'u1', 'workspace_admin', w.id);

      const rows = db
        .prepare('SELECT role, workspace_id FROM tenant_users WHERE tenant_id = ? AND user_id = ?')
        .all(t.id, 'u1') as Array<{ role: string; workspace_id: string | null }>;

      expect(rows).toHaveLength(2);
      // resolveRole for the workspace must pick the highest of the two.
      expect(service.resolveRole('u1', t.id, w.id)).toBe('workspace_admin');
    });
  });

  describe('resolveRole', () => {
    it('picks the highest-privileged role for a user', () => {
      const t = service.createTenant({ name: 'A', slug: 'a' });
      const w = service.createWorkspace({ tenantId: t.id, name: 'W', slug: 'w' });
      service.addMembership(t.id, 'u1', 'member');
      service.addMembership(t.id, 'u1', 'workspace_admin', w.id);
      service.addMembership(t.id, 'u1', 'tenant_admin');

      expect(service.resolveRole('u1', t.id, w.id)).toBe('tenant_admin');
    });

    it('returns undefined when the user has no membership', () => {
      const t = service.createTenant({ name: 'A', slug: 'a' });
      expect(service.resolveRole('nobody', t.id)).toBeUndefined();
    });

    it('assertAccess throws for unknown users', () => {
      const t = service.createTenant({ name: 'A', slug: 'a' });
      expect(() => service.assertAccess('nobody', t.id)).toThrow(/no access/);
    });
  });

  describe('runWithTenantContext / getActiveTenantContext (AIG-649 wire-up)', () => {
    beforeEach(() => {
      _resetActiveTenantContext();
    });

    afterEach(() => {
      _resetActiveTenantContext();
    });

    it('exposes the active context to consumers and restores on exit', () => {
      const t = service.createTenant({ name: 'Acme', slug: 'acme' });
      const w = service.createWorkspace({ tenantId: t.id, name: 'W', slug: 'w' });

      expect(getActiveTenantContext()).toBeUndefined();

      let observed: string | undefined;
      runWithTenantContext(
        {
          tenantId: t.id,
          tenantSlug: t.slug,
          workspaceId: w.id,
          workspaceSlug: w.slug,
          role: 'tenant_admin',
        },
        () => {
          const active = getActiveTenantContext();
          expect(active?.tenantId).toBe(t.id);
          // workspaceNamespace() is what the spawner / memory manager use
          // to scope namespaces — this is the wire-up consumer surface.
          observed = workspaceNamespace(active!);
        },
      );

      expect(observed).toBe(`tenant:${t.id}:workspace:${w.id}`);
      expect(getActiveTenantContext()).toBeUndefined();
    });

    it('restores the previous context even if the callback throws', () => {
      const t = service.createTenant({ name: 'A', slug: 'a' });
      expect(() =>
        runWithTenantContext(
          {
            tenantId: t.id,
            tenantSlug: t.slug,
            role: 'member',
          },
          () => {
            expect(getActiveTenantContext()?.tenantId).toBe(t.id);
            throw new Error('boom');
          },
        ),
      ).toThrow(/boom/);
      expect(getActiveTenantContext()).toBeUndefined();
    });
  });
});
