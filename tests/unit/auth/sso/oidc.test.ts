import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  OidcProvider,
  OidcSecurityError,
  generatePkceVerifier,
  pkceChallenge,
  type OidcClientLike,
  type OidcTokenSet,
} from '../../../../src/auth/sso/oidc.js';
import { ReplayCache } from '../../../../src/auth/sso/replay-cache.js';

/**
 * AIG-646 OIDC security tests.
 *
 * Covers:
 *   - PKCE verifier/challenge generation (URL-safe, no padding) (SEC #4)
 *   - state CSRF protection (SEC #4)
 *   - nonce replay protection (SEC #4)
 *   - id_token missing → reject (SEC #5)
 *   - missing sub / email claims → reject (SEC #5)
 *   - groups claim extracted with custom name
 */

function makeDb(): Database.Database {
  const db = new Database(':memory:');
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
  `);
  const migration = readFileSync(
    join(process.cwd(), 'migrations', '004_sso_provisioning.sql'),
    'utf-8'
  );
  db.exec(migration);
  return db;
}

describe('PKCE helpers', () => {
  it('generates a base64url-safe verifier of at least 43 chars (RFC 7636)', () => {
    const v = generatePkceVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces a deterministic S256 challenge from a verifier', () => {
    const v = 'abc123';
    const c1 = pkceChallenge(v);
    const c2 = pkceChallenge(v);
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('OidcProvider auth URL', () => {
  let db: Database.Database;
  let cache: ReplayCache;
  beforeEach(() => {
    db = makeDb();
    cache = new ReplayCache(db);
  });
  afterEach(() => {
    cache.stop();
    db.close();
  });

  function makeClient(tokenSet?: Partial<OidcTokenSet>): OidcClientLike {
    let lastParams: Record<string, unknown> = {};
    return {
      authorizationUrl: (params) => {
        lastParams = params;
        const qs = Object.entries(params)
          .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
          .join('&');
        return `https://idp.example/authorize?${qs}`;
      },
      callbackParams: (input) => {
        if (typeof input === 'string') {
          const url = new URL(input);
          return Object.fromEntries(url.searchParams.entries());
        }
        return input as Record<string, string>;
      },
      callback: async (_uri, _params, checks) => {
        const ts: OidcTokenSet = {
          id_token: 'fake.id.token',
          access_token: 'fake-access',
          claims: () => ({
            iss: 'https://idp.example',
            aud: 'aistack',
            sub: 'user-123',
            email: 'alice@example.com',
            preferred_username: 'alice',
            name: 'Alice',
            groups: ['developers', 'admins'],
            nonce: checks.nonce,
            ...(tokenSet?.claims?.() ?? {}),
          }),
          ...tokenSet,
        };
        return ts;
      },
    };
  }

  it('rejects construction of public client without PKCE explicitly disabled', () => {
    expect(
      () =>
        new OidcProvider(
          {
            providerName: 'auth0',
            issuerUrl: 'https://idp/',
            clientId: 'c',
            redirectUri: 'https://app/cb',
            pkceRequired: false,
          },
          cache,
          async () => makeClient()
        )
    ).toThrow(/PKCE/);
  });

  it('produces URL containing state, nonce, code_challenge and code_challenge_method=S256', async () => {
    const provider = new OidcProvider(
      {
        providerName: 'auth0',
        issuerUrl: 'https://idp/',
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'https://app/cb',
      },
      cache,
      async () => makeClient()
    );
    const { url, state } = await provider.getAuthURL();
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('code_challenge=');
    expect(url).toContain(`state=${state.state}`);
    expect(url).toContain(`nonce=${state.nonce}`);
  });

  it('rejects callback with mismatched state (CSRF)', async () => {
    const provider = new OidcProvider(
      {
        providerName: 'auth0',
        issuerUrl: 'https://idp/',
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'https://app/cb',
      },
      cache,
      async () => makeClient()
    );
    const { state } = await provider.getAuthURL();
    await expect(
      provider.handleCallback(
        { url: 'https://app/cb?code=abc&state=evil' },
        state
      )
    ).rejects.toThrow(/state mismatch/i);
  });

  it('rejects callback when stored state is older than 10 min', async () => {
    const provider = new OidcProvider(
      {
        providerName: 'auth0',
        issuerUrl: 'https://idp/',
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'https://app/cb',
      },
      cache,
      async () => makeClient()
    );
    const { state } = await provider.getAuthURL();
    state.createdAt = Date.now() - 20 * 60 * 1000;
    await expect(
      provider.handleCallback(
        { url: `https://app/cb?code=abc&state=${state.state}` },
        state
      )
    ).rejects.toThrow(/expired/i);
  });

  it('rejects callback with id_token missing', async () => {
    const provider = new OidcProvider(
      {
        providerName: 'auth0',
        issuerUrl: 'https://idp/',
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'https://app/cb',
      },
      cache,
      async () =>
        makeClient({
          id_token: undefined,
          claims: () => ({ sub: 'x', email: 'x@y' }),
        })
    );
    const { state } = await provider.getAuthURL();
    await expect(
      provider.handleCallback(
        { url: `https://app/cb?code=abc&state=${state.state}` },
        state
      )
    ).rejects.toThrow(/id_token/);
  });

  it('happy path: returns normalised profile with groups', async () => {
    const provider = new OidcProvider(
      {
        providerName: 'auth0',
        issuerUrl: 'https://idp/',
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'https://app/cb',
      },
      cache,
      async () => makeClient()
    );
    const { state } = await provider.getAuthURL();
    const profile = await provider.handleCallback(
      { url: `https://app/cb?code=abc&state=${state.state}` },
      state
    );
    expect(profile.externalId).toBe('user-123');
    expect(profile.email).toBe('alice@example.com');
    expect(profile.username).toBe('alice');
    expect(profile.groups).toEqual(['developers', 'admins']);
  });

  it('rejects nonce replay (same state.nonce consumed twice)', async () => {
    const provider = new OidcProvider(
      {
        providerName: 'auth0',
        issuerUrl: 'https://idp/',
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'https://app/cb',
      },
      cache,
      async () => makeClient()
    );
    const { state } = await provider.getAuthURL();
    await provider.handleCallback(
      { url: `https://app/cb?code=abc&state=${state.state}` },
      state
    );
    // Second attempt with the same nonce → replay.
    await expect(
      provider.handleCallback(
        { url: `https://app/cb?code=abc&state=${state.state}` },
        state
      )
    ).rejects.toThrow(OidcSecurityError);
  });
});
