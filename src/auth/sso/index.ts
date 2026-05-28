/**
 * SSO module — barrel + factory.
 *
 * AIG-646.
 *
 * Public API:
 *   - createSsoModule(deps, cfg): wires up replay cache + providers + SCIM,
 *     returns handles + a SsoService that binds IdP profiles to local users
 *     and issues aistack tokens.
 *   - SsoService.upsertFromProfile(profile, provider, providerName) →
 *     creates or links a local user, applies group→role mapping, persists
 *     the sso_identity row, and returns issued tokens.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';
import { AuthService } from '../service.js';
import { UserRole } from '../types.js';
import type { AuthTokens, User } from '../types.js';
import { ReplayCache } from './replay-cache.js';
import { SamlProvider, type SamlFactory, defaultSamlFactory } from './saml.js';
import { OidcProvider, type OidcClientFactory, defaultOidcFactory } from './oidc.js';
import { ScimServer } from './scim.js';
import { mapGroupsToRoles, validateGroupRoleMap } from './role-mapper.js';
import {
  SqliteOidcPendingStateStore,
  type OidcPendingStateStore,
} from './oidc-state-store.js';
import type {
  SsoConfig,
  SsoIdentity,
  SsoProfile,
  SsoAuthResult,
} from './types.js';

export * from './types.js';
export { ReplayCache } from './replay-cache.js';
export { SamlProvider, SamlSecurityError } from './saml.js';
export { OidcProvider, OidcSecurityError } from './oidc.js';
export { ScimServer } from './scim.js';
export { mapGroupsToRoles, validateGroupRoleMap } from './role-mapper.js';
export {
  SqliteOidcPendingStateStore,
  type OidcPendingStateStore,
} from './oidc-state-store.js';

const log = logger.child('sso');

export interface SsoModuleDeps {
  db: Database.Database;
  authService: AuthService;
  /** Optional factories for test injection. */
  samlFactory?: SamlFactory;
  oidcFactory?: OidcClientFactory;
}

export interface SsoModule {
  service: SsoService;
  saml?: SamlProvider;
  oidc?: OidcProvider;
  scim?: ScimServer;
  replayCache: ReplayCache;
  /** Persistent pending-state store for OIDC /login → /callback. */
  oidcPendingStore: OidcPendingStateStore;
  /** Stop background timers (sweep). */
  stop(): void;
}

/**
 * Build the SSO module from config. Returns `undefined` for any provider not
 * configured. Validates role maps and bearer token strength up-front.
 */
export function createSsoModule(deps: SsoModuleDeps, cfg: SsoConfig): SsoModule {
  const { db, authService } = deps;

  // Validate all role maps before instantiating anything (fail fast).
  for (const [name, map] of [
    ['saml', cfg.saml?.groupRoleMap],
    ['oidc', cfg.oidc?.groupRoleMap],
    ['scim', cfg.scim?.groupRoleMap],
  ] as const) {
    const v = validateGroupRoleMap(map ?? undefined);
    if (!v.ok) {
      throw new Error(`Invalid ${name} groupRoleMap: ${v.errors.join('; ')}`);
    }
  }

  const replayCache = new ReplayCache(db);
  const oidcPendingStore = new SqliteOidcPendingStateStore(db);
  const service = new SsoService(db, authService, cfg);

  const saml = cfg.saml
    ? new SamlProvider(cfg.saml, replayCache, deps.samlFactory ?? defaultSamlFactory)
    : undefined;
  const oidc = cfg.oidc
    ? new OidcProvider(cfg.oidc, replayCache, deps.oidcFactory ?? defaultOidcFactory)
    : undefined;
  const scim =
    cfg.scim?.enabled === true
      ? new ScimServer(db, authService, cfg.scim)
      : undefined;

  log.info('SSO module initialised', {
    saml: !!saml,
    oidc: !!oidc,
    scim: !!scim,
  });

  return {
    service,
    saml,
    oidc,
    scim,
    replayCache,
    oidcPendingStore,
    stop: () => replayCache.stop(),
  };
}

/**
 * SsoService — translates an IdP profile into a local user + tokens.
 *
 * SEC #7: never silently merge accounts. If `strictIdentityBinding` is set
 * and the email belongs to another provider, we throw.
 *
 * SEC #9: session fixation — we always issue NEW tokens via AuthService.login()
 * semantics (no token reuse from previous sessions). We do not touch the
 * legacy refresh_tokens of prior browser sessions, but a fresh login_at is
 * recorded so audit consumers see the new event.
 */
export class SsoService {
  private readonly db: Database.Database;
  private readonly authService: AuthService;
  private readonly cfg: SsoConfig;

  constructor(db: Database.Database, authService: AuthService, cfg: SsoConfig) {
    this.db = db;
    this.authService = authService;
    this.cfg = cfg;
  }

  /**
   * Bind an IdP profile to a local user, creating one if needed, then issue
   * new tokens. Idempotent on the (provider, providerName, externalId) tuple.
   */
  async upsertFromProfile(
    profile: SsoProfile,
    provider: 'saml' | 'oidc',
    providerName: string
  ): Promise<SsoAuthResult> {
    const map =
      provider === 'saml'
        ? this.cfg.saml?.groupRoleMap
        : this.cfg.oidc?.groupRoleMap;
    const role = mapGroupsToRoles(
      profile.groups,
      map,
      this.cfg.defaultRole ?? UserRole.VIEWER
    );

    // Look up existing identity.
    const existingIdentity = this.db
      .prepare(
        `SELECT * FROM sso_identities
         WHERE provider = ? AND provider_name = ? AND external_id = ?`
      )
      .get(provider, providerName, profile.externalId) as
      | {
          id: string;
          user_id: string;
        }
      | undefined;

    let user: User | undefined;

    if (existingIdentity) {
      user = this.authService.getUserById(existingIdentity.user_id);
      if (!user) {
        throw new Error('SSO identity references missing user');
      }
      // Keep role in sync with IdP groups on every login.
      if (user.role !== role) {
        this.authService.updateUserRole(user.id, role);
        user = this.authService.getUserById(user.id)!;
      }
    } else {
      // No identity for this external_id. Check email collision.
      const byEmail = this.authService.getUserByEmail(profile.email);
      if (byEmail) {
        // SEC #7: strict mode → refuse.
        if (this.cfg.strictIdentityBinding) {
          throw new Error(
            `Email ${profile.email} already exists; strictIdentityBinding refuses silent merge`
          );
        }
        // Audit log the link.
        log.warn('Linking SSO identity to existing local user (no silent role change)', {
          userId: byEmail.id,
          provider,
          providerName,
        });
        user = byEmail;
      } else {
        // Provision a new user with an unusable random password (SSO-only).
        const password = randomUUID() + randomUUID();
        user = await this.authService.register(
          {
            email: profile.email,
            username: profile.username ?? profile.email,
            password,
          },
          role
        );
      }
    }

    const identity = this.persistIdentity(
      existingIdentity?.id,
      user.id,
      provider,
      providerName,
      profile
    );

    // Issue new tokens. AuthService.login() requires a password; for SSO we
    // mint tokens inline using the same JWT secrets and refresh-token table,
    // so the standard `/auth/refresh` and `/auth/logout` endpoints work for
    // SSO sessions without changes.
    const tokens = await this.issueTokensForUser(user);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
      identity,
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      },
    };
  }

  private persistIdentity(
    existingId: string | undefined,
    userId: string,
    provider: 'saml' | 'oidc',
    providerName: string,
    profile: SsoProfile
  ): SsoIdentity {
    const now = new Date();
    const nowIso = now.toISOString();

    if (existingId) {
      this.db
        .prepare(
          `UPDATE sso_identities
           SET attributes_json = ?, groups_json = ?, last_synced_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          JSON.stringify(profile.rawAttributes),
          JSON.stringify(profile.groups),
          nowIso,
          nowIso,
          existingId
        );
      return this.loadIdentity(existingId);
    }

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO sso_identities
         (id, user_id, provider, provider_name, external_id, attributes_json, groups_json,
          last_synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        userId,
        provider,
        providerName,
        profile.externalId,
        JSON.stringify(profile.rawAttributes),
        JSON.stringify(profile.groups),
        nowIso,
        nowIso,
        nowIso
      );
    return this.loadIdentity(id);
  }

  private loadIdentity(id: string): SsoIdentity {
    const row = this.db
      .prepare('SELECT * FROM sso_identities WHERE id = ?')
      .get(id) as {
      id: string;
      user_id: string;
      provider: 'saml' | 'oidc';
      provider_name: string;
      external_id: string;
      attributes_json: string;
      groups_json: string;
      last_synced_at: string;
      created_at: string;
      updated_at: string;
    };

    return {
      id: row.id,
      userId: row.user_id,
      provider: row.provider,
      providerName: row.provider_name,
      externalId: row.external_id,
      attributes: JSON.parse(row.attributes_json ?? '{}') as Record<string, unknown>,
      groups: JSON.parse(row.groups_json ?? '[]') as string[],
      lastSyncedAt: new Date(row.last_synced_at),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Issue access + refresh tokens for an SSO-authenticated user.
   * Uses the same JWT secrets as AuthService (env: JWT_SECRET, REFRESH_SECRET).
   * Persists the refresh token hash in refresh_tokens so it can be revoked
   * via the standard logout endpoint.
   */
  private async issueTokensForUser(user: User): Promise<AuthTokens> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const jwt = require('jsonwebtoken');
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const bcrypt = require('bcrypt');

    const jwtSecret = process.env.JWT_SECRET;
    const refreshSecret = process.env.REFRESH_SECRET;
    if (!jwtSecret || !refreshSecret) {
      throw new Error(
        'JWT_SECRET and REFRESH_SECRET env vars are required for SSO token issuance'
      );
    }

    const accessToken: string = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
      jwtSecret,
      { expiresIn: '15m' }
    );
    const refreshToken: string = jwt.sign({ userId: user.id }, refreshSecret, {
      expiresIn: '7d',
    });

    const tokenHash: string = await bcrypt.hash(refreshToken, 10);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    this.db.transaction(() => {
      this.db
        .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
        .run(now, user.id);
      this.db
        .prepare(
          `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(randomUUID(), user.id, tokenHash, expiresAt, now);
      this.db
        .prepare('DELETE FROM refresh_tokens WHERE expires_at < ? OR revoked = 1')
        .run(now);
    })();

    return { accessToken, refreshToken, expiresIn: 15 * 60 };
  }
}
