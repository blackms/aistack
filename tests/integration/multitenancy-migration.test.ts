/**
 * Integration test: single-tenant -> multi-tenant migration (AIG-649).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrateSingleToMulti, TenantService } from '../../src/multitenancy/index.js';

function seedUsers(db: Database.Database, ids: string[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const insert = db.prepare(
    `INSERT INTO users (id, email, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  for (const id of ids) {
    insert.run(id, `${id}@local`, id, 'hash', 'developer', now, now);
  }
}

describe('migrateSingleToMulti', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates a default tenant + workspace and backfills user memberships', () => {
    seedUsers(db, ['user-a', 'user-b', 'user-c']);

    const result = migrateSingleToMulti(db);

    expect(result.tenant.slug).toBe('default');
    expect(result.workspace.slug).toBe('default');
    expect(result.workspace.tenantId).toBe(result.tenant.id);
    expect(result.reusedTenant).toBe(false);
    expect(result.reusedWorkspace).toBe(false);
    expect(result.usersGrantedMembership).toBe(3);

    const service = new TenantService(db);
    const members = service.listMembershipsForTenant(result.tenant.id);
    expect(members).toHaveLength(3);
    expect(members.every((m) => m.role === 'tenant_admin')).toBe(true);
  });

  it('is idempotent — re-running reuses existing tenant/workspace', () => {
    seedUsers(db, ['user-a']);

    const first = migrateSingleToMulti(db);
    const second = migrateSingleToMulti(db);

    expect(second.tenant.id).toBe(first.tenant.id);
    expect(second.workspace.id).toBe(first.workspace.id);
    expect(second.reusedTenant).toBe(true);
    expect(second.reusedWorkspace).toBe(true);
  });

  it('works with no users table (fresh install)', () => {
    const result = migrateSingleToMulti(db);
    expect(result.tenant.slug).toBe('default');
    expect(result.usersGrantedMembership).toBe(0);
  });

  it('honors custom slug overrides', () => {
    const result = migrateSingleToMulti(db, {
      tenantSlug: 'acme',
      tenantName: 'Acme Corp',
      workspaceSlug: 'main',
    });
    expect(result.tenant.slug).toBe('acme');
    expect(result.tenant.name).toBe('Acme Corp');
    expect(result.workspace.slug).toBe('main');
  });

  it('isolates data across separate migrations on different databases', () => {
    const db2 = new Database(':memory:');
    try {
      seedUsers(db, ['user-a']);
      seedUsers(db2, ['user-z']);

      const r1 = migrateSingleToMulti(db, { tenantSlug: 'tenant-a' });
      const r2 = migrateSingleToMulti(db2, { tenantSlug: 'tenant-z' });

      const s1 = new TenantService(db);
      const s2 = new TenantService(db2);

      // Each database sees only its own tenant
      expect(s1.listTenants().map((t) => t.slug)).toEqual(['tenant-a']);
      expect(s2.listTenants().map((t) => t.slug)).toEqual(['tenant-z']);

      // Memberships are scoped to their own database
      expect(s1.listMembershipsForTenant(r1.tenant.id).map((m) => m.userId)).toEqual([
        'user-a',
      ]);
      expect(s2.listMembershipsForTenant(r2.tenant.id).map((m) => m.userId)).toEqual([
        'user-z',
      ]);
    } finally {
      db2.close();
    }
  });
});
