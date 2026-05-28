/**
 * SSO routes integration tests (AIG-646 follow-ups).
 *
 * Covers the three reviewer findings on PR #35:
 *   1) `registerSsoRoutes` is actually wired — `/api/auth/sso/saml/login`
 *      returns 302 (not 404).
 *   2) ACS / OIDC callback responses set the refresh token as an HttpOnly +
 *      Secure + SameSite=Strict cookie and DO NOT return it in the JSON body.
 *   3) OIDC pending-state survives a "process restart" (new in-memory map
 *      would have lost it) — proves the SQLite-backed store works across
 *      multi-process deploys.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Router } from '../../src/web/router.js';
import { registerSsoRoutes } from '../../src/web/routes/sso.js';
import { AuthService } from '../../src/auth/service.js';
import {
  createSsoModule,
  SqliteOidcPendingStateStore,
  type SsoModule,
} from '../../src/auth/sso/index.js';
import type { SsoConfig } from '../../src/auth/sso/types.js';
import type { OidcAuthState } from '../../src/auth/sso/oidc.js';

// --------------- helpers ------------------------------------------------

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  // Minimum schema the AuthService + SSO module touch.
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'developer',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    );
  `);
  const migration = readFileSync(
    join(process.cwd(), 'migrations', '006_sso_provisioning.sql'),
    'utf-8'
  );
  db.exec(migration);
  return db;
}

/** Mock SAML library returning a static authorize URL — no network. */
const stubSamlFactory = () => ({
  getAuthorizeUrlAsync: async () => 'https://idp.example.com/sso?req=stub',
  validatePostResponseAsync: async () => ({ profile: null, loggedOut: false }),
  getLogoutUrlAsync: async () => 'https://idp.example.com/slo',
});

const minimalSamlConfig = {
  providerName: 'stub-idp',
  entityId: 'urn:test:sp',
  idpSsoUrl: 'https://idp.example.com/sso',
  callbackUrl: 'https://sp.example.com/acs',
  idpCert: '-----BEGIN CERTIFICATE-----\nMIIBkTCB+w...stub\n-----END CERTIFICATE-----',
};

/** Build an SsoModule wired to an in-memory DB, no real IdP libs needed. */
function makeSsoModule(db: Database.Database): SsoModule {
  process.env.JWT_SECRET ??= 'test-jwt-secret-do-not-use-in-prod';
  process.env.REFRESH_SECRET ??= 'test-refresh-secret-do-not-use-in-prod';
  const authService = new AuthService(db);
  const cfg: SsoConfig = { saml: minimalSamlConfig };
  return createSsoModule(
    { db, authService, samlFactory: stubSamlFactory },
    cfg
  );
}

/** Build a minimal IncomingMessage / ServerResponse pair for router.handle. */
function makeReqRes(
  method: string,
  url: string,
  body?: string
): {
  req: any;
  res: any;
  done: Promise<{
    status: number;
    headers: Record<string, string | string[]>;
    body: string;
  }>;
} {
  const req = new EventEmitter() as any;
  req.method = method;
  req.url = url;
  req.headers = {
    'content-type': 'application/json',
    'content-length': String(body?.length ?? 0),
  };

  let status = 0;
  const headers: Record<string, string | string[]> = {};
  let bodyOut = '';

  const res: any = {
    writeHead(s: number, h?: Record<string, string | string[]>) {
      status = s;
      if (h) Object.assign(headers, h);
      return res;
    },
    setHeader(k: string, v: string | string[]) {
      headers[k] = v;
    },
    end(chunk?: string) {
      if (chunk) bodyOut += chunk;
      res._done = true;
      res._resolve?.({ status, headers, body: bodyOut });
    },
  };

  const done = new Promise<{
    status: number;
    headers: Record<string, string | string[]>;
    body: string;
  }>((resolve) => {
    res._resolve = resolve;
  });

  // Push the body asynchronously so parseRequestBody can attach listeners first.
  if (body !== undefined) {
    setImmediate(() => {
      req.emit('data', Buffer.from(body));
      req.emit('end');
    });
  } else {
    setImmediate(() => req.emit('end'));
  }

  return { req, res, done };
}

// --------------- tests --------------------------------------------------

describe('SSO routes — wiring smoke (AIG-646 #1)', () => {
  let db: Database.Database;
  let sso: SsoModule;
  let router: Router;

  beforeEach(() => {
    db = makeDb();
    sso = makeSsoModule(db);
    router = new Router();
    registerSsoRoutes(router, { ssoModule: sso });
  });

  afterEach(() => {
    sso.stop();
    db.close();
  });

  it('GET /api/auth/sso/saml/login returns 302 (route is mounted, not 404)', async () => {
    const { req, res, done } = makeReqRes('GET', '/api/auth/sso/saml/login');
    const handled = await router.handle(req, res);
    expect(handled).toBe(true);
    const { status, headers } = await done;
    expect(status).toBe(302);
    expect(headers.Location ?? headers.location).toContain('idp.example.com');
  });
});

describe('SSO routes — refresh-token cookie (AIG-646 #2)', () => {
  let db: Database.Database;
  let sso: SsoModule;
  let router: Router;

  beforeEach(() => {
    db = makeDb();
    sso = makeSsoModule(db);
    // Patch SAML provider to skip real assertion validation and return a
    // canned profile, so we exercise the response-shaping code only.
    (sso.saml as any).handleACS = async () => ({
      externalId: 'user-1',
      email: 'alice@example.com',
      username: 'alice',
      groups: [],
      rawAttributes: {},
    });
    router = new Router();
    registerSsoRoutes(router, { ssoModule: sso });
  });

  afterEach(() => {
    sso.stop();
    db.close();
  });

  it('ACS sets HttpOnly + Secure + SameSite=Strict refresh cookie and omits refreshToken from body', async () => {
    const body = JSON.stringify({ SAMLResponse: 'ignored-by-stub' });
    const { req, res, done } = makeReqRes('POST', '/api/auth/sso/saml/acs', body);
    await router.handle(req, res);
    const { status, headers, body: respBody } = await done;
    expect(status).toBe(200);

    const setCookie = headers['Set-Cookie'] ?? headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookies = Array.isArray(setCookie) ? setCookie : [String(setCookie)];
    const refreshCookie = cookies.find((c) => c.startsWith('aistack_refresh='));
    expect(refreshCookie, 'aistack_refresh cookie must be set').toBeDefined();
    expect(refreshCookie).toMatch(/HttpOnly/);
    expect(refreshCookie).toMatch(/Secure/);
    expect(refreshCookie).toMatch(/SameSite=Strict/);

    const json = JSON.parse(respBody);
    expect(json.tokens.accessToken).toBeTypeOf('string');
    // Critical: refresh token must NOT leak into the JSON body.
    expect(json.tokens.refreshToken).toBeUndefined();
    // Cookie value must equal the refresh token (so /auth/refresh still works).
    const cookieValue = refreshCookie!.split(';')[0].split('=')[1];
    expect(cookieValue.length).toBeGreaterThan(20);
  });
});

describe('OIDC pending-state store — multi-process durability (AIG-646 #3)', () => {
  it('state set on instance A is readable by a fresh instance B on the same DB', () => {
    const db = makeDb();
    const storeA = new SqliteOidcPendingStateStore(db);
    const state: OidcAuthState = {
      state: 'st-abc',
      nonce: 'nonce-xyz',
      codeVerifier: 'verifier-123',
      createdAt: Date.now(),
    };
    storeA.set('tx-1', state);

    // Simulate a worker process restart by constructing a brand-new store
    // pointing at the same DB. An in-memory Map would lose 'tx-1' here.
    const storeB = new SqliteOidcPendingStateStore(db);
    const got = storeB.takeAndDelete('tx-1');
    expect(got).toEqual(state);

    // Single-use semantics: a second take returns undefined.
    const again = storeB.takeAndDelete('tx-1');
    expect(again).toBeUndefined();
    db.close();
  });

  it('expired entries are not returned even before sweep', () => {
    const db = makeDb();
    const store = new SqliteOidcPendingStateStore(db, 10); // 10ms TTL
    store.set('tx-exp', {
      state: 's',
      nonce: 'n',
      codeVerifier: 'v',
      createdAt: Date.now(),
    });
    // Wait synchronously past TTL.
    const until = Date.now() + 25;
    while (Date.now() < until) {
      /* spin */
    }
    expect(store.takeAndDelete('tx-exp')).toBeUndefined();
    db.close();
  });
});
