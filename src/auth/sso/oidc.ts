/**
 * OIDC provider — wraps openid-client v5/v6 with PKCE + state + nonce.
 *
 * AIG-646 security focus #4, #5, #9.
 *
 * Enforced:
 *   - PKCE (S256) for all public clients.
 *   - `state` parameter is mandatory and verified on callback (CSRF).
 *   - `nonce` is mandatory and verified inside the id_token.
 *   - JWKS-based JWT signature verification with `iss`, `aud`, `exp`, `nbf`,
 *     `iat` checks delegated to openid-client.
 *   - `nonce` replay protection via ReplayCache (defence in depth on top of
 *     openid-client's internal nonce binding).
 */

import { randomBytes, createHash } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import type { ReplayCache } from './replay-cache.js';
import type { OidcConfig, SsoProfile } from './types.js';

const log = logger.child('sso:oidc');

/** State stored between /login and /callback. Must be persisted by the caller (cookie/session). */
export interface OidcAuthState {
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
}

/**
 * Subset of openid-client we depend on, declared structurally so tests can
 * substitute a stub. Compatible with both v5 (`Issuer`/`Client`) and the newer
 * v6 functional API.
 */
export interface OidcClientLike {
  authorizationUrl(params: Record<string, unknown>): string;
  callbackParams(input: unknown): Record<string, string>;
  callback(
    redirectUri: string,
    params: Record<string, string>,
    checks: { state: string; nonce: string; code_verifier: string }
  ): Promise<OidcTokenSet>;
}

export interface OidcTokenSet {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_at?: number;
  claims(): Record<string, unknown>;
}

export type OidcClientFactory = (cfg: OidcConfig) => Promise<OidcClientLike>;

/**
 * Default factory: discovers issuer + builds a Client using openid-client.
 * Loaded lazily so the dep is optional until OIDC is configured.
 */
export const defaultOidcFactory: OidcClientFactory = async (cfg) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { Issuer } = require('openid-client');
  const issuer = await Issuer.discover(cfg.issuerUrl);
  return new issuer.Client({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uris: [cfg.redirectUri],
    response_types: ['code'],
    token_endpoint_auth_method: cfg.clientSecret
      ? 'client_secret_post'
      : 'none',
  }) as OidcClientLike;
};

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function generatePkceVerifier(): string {
  return b64url(randomBytes(32));
}

export function pkceChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

export class OidcProvider {
  readonly providerName: string;
  private readonly cfg: OidcConfig;
  private readonly replayCache: ReplayCache;
  private clientPromise: Promise<OidcClientLike> | null = null;
  private readonly factory: OidcClientFactory;

  constructor(
    cfg: OidcConfig,
    replayCache: ReplayCache,
    factory: OidcClientFactory = defaultOidcFactory
  ) {
    this.cfg = cfg;
    this.providerName = cfg.providerName;
    this.replayCache = replayCache;
    this.factory = factory;

    if (!cfg.issuerUrl) throw new Error('OIDC config requires issuerUrl');
    if (!cfg.clientId) throw new Error('OIDC config requires clientId');
    if (!cfg.redirectUri) throw new Error('OIDC config requires redirectUri');
    if (cfg.pkceRequired === false && !cfg.clientSecret) {
      throw new Error('OIDC public client (no clientSecret) requires PKCE');
    }
  }

  private getClient(): Promise<OidcClientLike> {
    if (!this.clientPromise) this.clientPromise = this.factory(this.cfg);
    return this.clientPromise;
  }

  /**
   * Begin an OIDC auth flow. Returns the URL to redirect the user to AND
   * the auth state the caller MUST persist for the callback.
   */
  async getAuthURL(): Promise<{ url: string; state: OidcAuthState }> {
    const client = await this.getClient();
    const state = b64url(randomBytes(16));
    const nonce = b64url(randomBytes(16));
    const codeVerifier = generatePkceVerifier();
    const codeChallenge = pkceChallenge(codeVerifier);

    const url = client.authorizationUrl({
      scope: (this.cfg.scopes ?? ['openid', 'profile', 'email', 'groups']).join(' '),
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return {
      url,
      state: { state, nonce, codeVerifier, createdAt: Date.now() },
    };
  }

  /**
   * Handle the OIDC callback. The caller MUST provide the stored auth state
   * (cookie/session) so we can verify state + nonce + code_verifier.
   */
  async handleCallback(
    callbackInput: { url: string } | { query: Record<string, string> },
    storedState: OidcAuthState
  ): Promise<SsoProfile> {
    const client = await this.getClient();

    // Reject stale state (> 10 min).
    if (Date.now() - storedState.createdAt > 10 * 60 * 1000) {
      throw new OidcSecurityError('OIDC auth state expired');
    }

    const params = client.callbackParams(
      'url' in callbackInput ? callbackInput.url : callbackInput.query
    );

    if (!params.state || params.state !== storedState.state) {
      throw new OidcSecurityError('OIDC state mismatch (possible CSRF)');
    }

    // Replay-protect nonce (defence in depth — openid-client also binds nonce → id_token).
    if (
      this.replayCache.checkAndRecord(
        'oidc',
        'nonce',
        `${this.providerName}:${storedState.nonce}`,
        10 * 60 * 1000
      )
    ) {
      throw new OidcSecurityError('OIDC nonce replay detected');
    }

    const tokenSet = await client.callback(this.cfg.redirectUri, params, {
      state: storedState.state,
      nonce: storedState.nonce,
      code_verifier: storedState.codeVerifier,
    });

    if (!tokenSet.id_token) {
      throw new OidcSecurityError('OIDC response missing id_token');
    }

    const claims = tokenSet.claims();
    const sub = String(claims.sub ?? '');
    if (!sub) throw new OidcSecurityError('id_token missing sub claim');
    const email = String(claims.email ?? '');
    if (!email) throw new OidcSecurityError('id_token missing email claim');

    const groups = this.extractGroups(claims);

    log.info('OIDC token validated', {
      provider: this.providerName,
      sub,
      groupCount: groups.length,
    });

    return {
      externalId: sub,
      email,
      username:
        typeof claims.preferred_username === 'string'
          ? claims.preferred_username
          : email,
      displayName: typeof claims.name === 'string' ? claims.name : undefined,
      groups,
      rawAttributes: claims,
    };
  }

  private extractGroups(claims: Record<string, unknown>): string[] {
    const claimName = this.cfg.groupsClaim ?? 'groups';
    const raw = claims[claimName];
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.filter((g): g is string => typeof g === 'string');
    }
    if (typeof raw === 'string') return raw.split(/[\s,]+/).filter(Boolean);
    return [];
  }
}

export class OidcSecurityError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'OidcSecurityError';
  }
}
