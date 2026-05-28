import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuthService } from '../../../../src/auth/service.js';
import { ScimServer } from '../../../../src/auth/sso/scim.js';
import { UserRole } from '../../../../src/auth/types.js';

/**
 * AIG-646 SCIM security tests.
 *
 * Covers:
 *   - Bearer auth required (SEC #6)
 *   - 401 on missing/wrong token
 *   - 409 on email/userName collision (no silent merge, SEC #7)
 *   - Group→role mapping respects whitelist (SEC #8)
 *   - PATCH active=false deprovisions (deletes) user
 *   - Rate limit on mutations
 */

const TOKEN = 'a'.repeat(32); // 32-char bearer token

function makeServer(): {
  db: Database.Database;
  auth: AuthService;
  scim: ScimServer;
} {
  const db = new Database(':memory:');
  const migration = readFileSync(
    join(process.cwd(), 'migrations', '004_sso_provisioning.sql'),
    'utf-8'
  );
  // AuthService initialises users + refresh_tokens tables.
  const auth = new AuthService(db, 'test-jwt-secret', 'test-refresh-secret');
  db.exec(migration);
  const scim = new ScimServer(db, auth, {
    enabled: true,
    bearerToken: TOKEN,
    mutationsPerMinute: 5,
    groupRoleMap: {
      'aistack-admins': UserRole.ADMIN,
      'aistack-devs': UserRole.DEVELOPER,
    },
  });
  return { db, auth, scim };
}

describe('ScimServer bearer auth', () => {
  let env: ReturnType<typeof makeServer>;
  beforeEach(() => {
    env = makeServer();
  });
  afterEach(() => env.db.close());

  it('rejects requests without Authorization header', async () => {
    const r = await env.scim.handle({ method: 'GET', path: 'Users' });
    expect(r.status).toBe(401);
  });

  it('rejects requests with wrong token', async () => {
    const r = await env.scim.handle({
      method: 'GET',
      path: 'Users',
      authHeader: 'Bearer wrong',
    });
    expect(r.status).toBe(401);
  });

  it('accepts valid bearer token', async () => {
    const r = await env.scim.handle({
      method: 'GET',
      path: 'ServiceProviderConfig',
      authHeader: `Bearer ${TOKEN}`,
    });
    expect(r.status).toBe(200);
  });

  it('rejects construction with short bearer token', () => {
    expect(
      () =>
        new ScimServer(env.db, env.auth, {
          enabled: true,
          bearerToken: 'short',
        })
    ).toThrow(/at least 16/);
  });
});

describe('ScimServer Users CRUD', () => {
  let env: ReturnType<typeof makeServer>;
  beforeEach(() => {
    env = makeServer();
  });
  afterEach(() => env.db.close());

  it('creates a user (role from group whitelist)', async () => {
    const r = await env.scim.handle({
      method: 'POST',
      path: 'Users',
      authHeader: `Bearer ${TOKEN}`,
      body: {
        userName: 'alice',
        emails: [{ value: 'alice@example.com', primary: true }],
        groups: [{ display: 'aistack-admins' }],
      },
    });
    expect(r.status).toBe(201);
    const body = r.body as { id: string; userName: string };
    expect(body.userName).toBe('alice');

    const dbUser = env.auth.getUserByEmail('alice@example.com')!;
    expect(dbUser.role).toBe(UserRole.ADMIN);
  });

  it('returns 409 on duplicate email (no silent merge)', async () => {
    await env.scim.handle({
      method: 'POST',
      path: 'Users',
      authHeader: `Bearer ${TOKEN}`,
      body: {
        userName: 'bob',
        emails: [{ value: 'bob@example.com', primary: true }],
      },
    });
    const r = await env.scim.handle({
      method: 'POST',
      path: 'Users',
      authHeader: `Bearer ${TOKEN}`,
      body: {
        userName: 'bob2',
        emails: [{ value: 'bob@example.com', primary: true }],
      },
    });
    expect(r.status).toBe(409);
  });

  it('returns 400 when userName missing', async () => {
    const r = await env.scim.handle({
      method: 'POST',
      path: 'Users',
      authHeader: `Bearer ${TOKEN}`,
      body: { emails: [{ value: 'a@b.com', primary: true }] },
    });
    expect(r.status).toBe(400);
  });

  it('falls back to default role VIEWER when no group matches whitelist', async () => {
    await env.scim.handle({
      method: 'POST',
      path: 'Users',
      authHeader: `Bearer ${TOKEN}`,
      body: {
        userName: 'carol',
        emails: [{ value: 'carol@example.com', primary: true }],
        groups: [{ display: 'random-group-not-whitelisted' }],
      },
    });
    expect(env.auth.getUserByEmail('carol@example.com')!.role).toBe(
      UserRole.VIEWER
    );
  });

  it('PATCH active=false deprovisions the user', async () => {
    const created = await env.scim.handle({
      method: 'POST',
      path: 'Users',
      authHeader: `Bearer ${TOKEN}`,
      body: {
        userName: 'dan',
        emails: [{ value: 'dan@example.com', primary: true }],
      },
    });
    const id = (created.body as { id: string }).id;

    const r = await env.scim.handle({
      method: 'PATCH',
      path: `Users/${id}`,
      authHeader: `Bearer ${TOKEN}`,
      body: {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      },
    });
    expect(r.status).toBe(204);
    expect(env.auth.getUserById(id)).toBeUndefined();
  });

  it('lists users filtered by userName eq', async () => {
    await env.scim.handle({
      method: 'POST',
      path: 'Users',
      authHeader: `Bearer ${TOKEN}`,
      body: {
        userName: 'eve',
        emails: [{ value: 'eve@example.com', primary: true }],
      },
    });
    const r = await env.scim.handle({
      method: 'GET',
      path: 'Users',
      authHeader: `Bearer ${TOKEN}`,
      query: { filter: 'userName eq "eve"' },
    });
    expect(r.status).toBe(200);
    const body = r.body as { totalResults: number; Resources: unknown[] };
    expect(body.totalResults).toBeGreaterThanOrEqual(1);
  });

  it('enforces mutation rate limit', async () => {
    // limit is 5/min; do 5 creates then expect 429.
    for (let i = 0; i < 5; i++) {
      await env.scim.handle({
        method: 'POST',
        path: 'Users',
        authHeader: `Bearer ${TOKEN}`,
        body: {
          userName: `u${i}`,
          emails: [{ value: `u${i}@x.com`, primary: true }],
        },
      });
    }
    const r = await env.scim.handle({
      method: 'POST',
      path: 'Users',
      authHeader: `Bearer ${TOKEN}`,
      body: {
        userName: 'u-extra',
        emails: [{ value: 'extra@x.com', primary: true }],
      },
    });
    expect(r.status).toBe(429);
  });
});

describe('ScimServer Groups', () => {
  let env: ReturnType<typeof makeServer>;
  beforeEach(() => {
    env = makeServer();
  });
  afterEach(() => env.db.close());

  it('creates and lists a group', async () => {
    const c = await env.scim.handle({
      method: 'POST',
      path: 'Groups',
      authHeader: `Bearer ${TOKEN}`,
      body: { displayName: 'engineering' },
    });
    expect(c.status).toBe(201);

    const l = await env.scim.handle({
      method: 'GET',
      path: 'Groups',
      authHeader: `Bearer ${TOKEN}`,
    });
    const body = l.body as { totalResults: number };
    expect(body.totalResults).toBe(1);
  });

  it('returns 409 on duplicate group displayName', async () => {
    await env.scim.handle({
      method: 'POST',
      path: 'Groups',
      authHeader: `Bearer ${TOKEN}`,
      body: { displayName: 'dup' },
    });
    const r = await env.scim.handle({
      method: 'POST',
      path: 'Groups',
      authHeader: `Bearer ${TOKEN}`,
      body: { displayName: 'dup' },
    });
    expect(r.status).toBe(409);
  });
});
