/**
 * SAML 2.0 provider — wraps @node-saml/node-saml with hardened defaults.
 *
 * AIG-646.
 *
 * Security guarantees enforced here:
 *   - `validateInResponseTo: 'always'` (replay protection on request ids)
 *   - `wantAssertionsSigned: true` (reject unsigned assertions)
 *   - `signatureAlgorithm` defaulted to 'sha256'; SHA1/MD5 refused at preflight
 *   - `acceptedClockSkewMs` defaulted to 30s
 *   - Pre-flight on raw XML before parser sees it (XXE, weak alg, unsigned)
 *   - Assertion ID + InResponseTo replay cache (5min TTL)
 *
 * NB: We import @node-saml/node-saml lazily so the package is only required
 * when SAML is actually configured, keeping the dev-install footprint small
 * for users who don't need SSO.
 */

import { logger } from '../../utils/logger.js';
import {
  preflightSamlResponse,
  validateAssertionWindow,
  checkSamlReplay,
  SamlSecurityError,
} from './saml-validator.js';
import type { ReplayCache } from './replay-cache.js';
import type { SamlConfig, SsoProfile } from './types.js';

const log = logger.child('sso:saml');

/**
 * Minimal interface for the @node-saml/node-saml SAML class we depend on.
 * Declared structurally so we can stub it in tests without importing the
 * real package.
 */
export interface SamlLike {
  getAuthorizeUrlAsync(
    RelayState: string,
    host: string | undefined,
    options: Record<string, unknown>
  ): Promise<string>;
  validatePostResponseAsync(
    body: { SAMLResponse: string; RelayState?: string }
  ): Promise<{ profile: SamlProfileRaw | null; loggedOut: boolean }>;
  getLogoutUrlAsync(
    user: SamlProfileRaw,
    RelayState: string,
    options: Record<string, unknown>
  ): Promise<string>;
}

export interface SamlProfileRaw {
  nameID?: string;
  nameIDFormat?: string;
  sessionIndex?: string;
  attributes?: Record<string, unknown>;
  // Assertion ID surfaced by node-saml for replay checks.
  ID?: string;
  inResponseTo?: string;
  notBefore?: string;
  notOnOrAfter?: string;
}

export type SamlFactory = (config: Record<string, unknown>) => SamlLike;

/**
 * Default factory: loads @node-saml/node-saml dynamically.
 * Tests can pass their own factory to SamlProvider for isolation.
 */
export const defaultSamlFactory: SamlFactory = (config) => {
  // Dynamic require so missing optional dep is only a problem at runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const mod = require('@node-saml/node-saml');
  const SAML = mod.SAML ?? mod.default?.SAML ?? mod.default;
  return new SAML(config);
};

export class SamlProvider {
  readonly providerName: string;
  private readonly cfg: SamlConfig;
  private readonly saml: SamlLike;
  private readonly replayCache: ReplayCache;

  constructor(
    cfg: SamlConfig,
    replayCache: ReplayCache,
    factory: SamlFactory = defaultSamlFactory
  ) {
    this.cfg = cfg;
    this.providerName = cfg.providerName;
    this.replayCache = replayCache;

    if (!cfg.idpCert) {
      throw new Error('SAML config requires idpCert (IdP signing certificate)');
    }
    if (!cfg.idpSsoUrl) {
      throw new Error('SAML config requires idpSsoUrl');
    }
    if (!cfg.entityId) {
      throw new Error('SAML config requires entityId');
    }

    const sigAlg = cfg.signatureAlgorithm ?? 'sha256';
    if (sigAlg !== 'sha256' && sigAlg !== 'sha512') {
      throw new Error(`Unsupported SAML signatureAlgorithm: ${sigAlg}`);
    }

    this.saml = factory({
      issuer: cfg.entityId,
      callbackUrl: cfg.callbackUrl,
      entryPoint: cfg.idpSsoUrl,
      logoutUrl: cfg.idpSloUrl,
      idpCert: cfg.idpCert,
      privateKey: cfg.spPrivateKey,
      publicCert: cfg.spCert,
      signatureAlgorithm: sigAlg,
      digestAlgorithm: cfg.digestAlgorithm ?? 'sha256',
      wantAssertionsSigned: true, // SEC #1
      validateInResponseTo: 'always', // SEC #3
      acceptedClockSkewMs: (cfg.acceptedClockSkewSec ?? 30) * 1000,
      requestIdExpirationPeriodMs: cfg.requestIdExpirationMs ?? 5 * 60 * 1000,
      disableRequestedAuthnContext: false,
      identifierFormat:
        'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    });
  }

  /** Generate IdP SSO URL for a login flow. */
  async getAuthURL(relayState: string = ''): Promise<string> {
    return this.saml.getAuthorizeUrlAsync(relayState, undefined, {});
  }

  /**
   * Handle the ACS POST. Returns a normalized SsoProfile.
   * Throws SamlSecurityError on any security failure.
   */
  async handleACS(samlResponseB64: string, relayState?: string): Promise<SsoProfile> {
    if (!samlResponseB64) throw new SamlSecurityError('Missing SAMLResponse');

    // Decode for preflight; node-saml itself will re-decode internally.
    let xml: string;
    try {
      xml = Buffer.from(samlResponseB64, 'base64').toString('utf-8');
    } catch {
      throw new SamlSecurityError('SAMLResponse is not valid base64');
    }

    preflightSamlResponse(xml);

    const { profile, loggedOut } = await this.saml.validatePostResponseAsync({
      SAMLResponse: samlResponseB64,
      RelayState: relayState,
    });

    if (loggedOut) {
      throw new SamlSecurityError('Received SAML logout response, not a login');
    }
    if (!profile) {
      throw new SamlSecurityError('SAML profile missing after validation');
    }

    // Defense-in-depth window check.
    validateAssertionWindow({
      notBefore: profile.notBefore ?? null,
      notOnOrAfter: profile.notOnOrAfter ?? null,
      acceptedClockSkewSec: this.cfg.acceptedClockSkewSec ?? 30,
    });

    // Replay protection — fail closed if Assertion has no ID.
    if (!profile.ID) {
      throw new SamlSecurityError('SAML assertion missing required ID for replay protection');
    }
    checkSamlReplay({
      replayCache: this.replayCache,
      assertionId: profile.ID,
      inResponseTo: profile.inResponseTo,
      providerName: this.providerName,
      ttlMs: 5 * 60 * 1000,
    });

    const attrs = profile.attributes ?? {};
    const email = this.extractEmail(profile, attrs);
    if (!email) {
      throw new SamlSecurityError('SAML profile missing email/NameID');
    }

    const groups = this.extractGroups(attrs);
    const username = this.extractAttr(attrs, this.cfg.usernameAttributeName) ?? email;

    log.info('SAML assertion validated', {
      provider: this.providerName,
      email,
      groupCount: groups.length,
    });

    return {
      externalId: profile.nameID ?? email,
      email,
      username,
      displayName: this.extractAttr(attrs, 'displayName') ?? undefined,
      groups,
      rawAttributes: attrs,
    };
  }

  /** Generate IdP SLO URL. */
  async getLogoutURL(nameID: string, sessionIndex?: string): Promise<string | null> {
    if (!this.cfg.idpSloUrl) return null;
    return this.saml.getLogoutUrlAsync(
      { nameID, sessionIndex } as SamlProfileRaw,
      '',
      {}
    );
  }

  private extractEmail(
    profile: SamlProfileRaw,
    attrs: Record<string, unknown>
  ): string | undefined {
    const fromAttr = this.extractAttr(attrs, this.cfg.emailAttributeName ?? 'email');
    if (fromAttr) return fromAttr;
    if (profile.nameIDFormat?.includes('emailAddress')) return profile.nameID;
    return undefined;
  }

  private extractAttr(
    attrs: Record<string, unknown>,
    name?: string
  ): string | undefined {
    if (!name) return undefined;
    const v = attrs[name];
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
    return undefined;
  }

  private extractGroups(attrs: Record<string, unknown>): string[] {
    const attrName = this.cfg.groupAttributeName ?? 'groups';
    const raw = attrs[attrName];
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter((g): g is string => typeof g === 'string');
    if (typeof raw === 'string') return [raw];
    return [];
  }
}
