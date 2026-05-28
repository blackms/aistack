/**
 * TenantService unit tests (AIG-649).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { TenantService } from '../../../src/multitenancy/service.js';

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
});
