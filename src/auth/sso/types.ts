/**
 * SSO (SAML 2.0 + OIDC) and SCIM v2 types.
 *
 * AIG-646: Enterprise SSO.
 *
 * Defined in a new module so existing `src/auth/types.ts` is not modified.
 */

import type { UserRole } from '../types.js';

/**
 * SAML 2.0 provider configuration. Maps onto @node-saml/node-saml SamlConfig
 * but keeps only the security-critical fields we expose to operators.
 */
export interface SamlConfig {
  /** Friendly name used as `provider_name` in sso_identities (e.g. 'okta'). */
  providerName: string;
  /** SP entity ID (issuer in our SAML requests). */
  entityId: string;
  /** IdP SSO URL (where AuthnRequests are POSTed). */
  idpSsoUrl: string;
  /** IdP SLO URL (optional). */
  idpSloUrl?: string;
  /** IdP X.509 signing certificate (PEM, public). Required for signature validation. */
  idpCert: string;
  /** ACS (assertion consumer service) callback URL. */
  callbackUrl: string;
  /** Optional SP private key for signed AuthnRequests (PEM). */
  spPrivateKey?: string;
  /** Optional SP cert for AuthnRequest signing (PEM). */
  spCert?: string;
  /** Signature algorithm (default RSA-SHA256, never SHA1). */
  signatureAlgorithm?: 'sha256' | 'sha512';
  /** Digest algorithm (default SHA256). */
  digestAlgorithm?: 'sha256' | 'sha512';
  /** Clock skew tolerance for NotBefore/NotOnOrAfter (seconds). Default 30s. */
  acceptedClockSkewSec?: number;
  /** Replay-protection request ID expiration (ms). Default 5min. */
  requestIdExpirationMs?: number;
  /** Allowed group→role mappings for this SAML IdP. */
  groupRoleMap?: GroupRoleMap;
  /** Attribute name in the assertion that contains group claims. */
  groupAttributeName?: string;
  /** Attribute name for email. Default 'email' or NameID if missing. */
  emailAttributeName?: string;
  /** Attribute name for username. */
  usernameAttributeName?: string;
}

/**
 * OIDC provider configuration. Maps onto openid-client.
 */
export interface OidcConfig {
  providerName: string;
  /** Issuer URL (used for discovery). */
  issuerUrl: string;
  clientId: string;
  clientSecret?: string;
  /** Public client → PKCE required. Default true. */
  pkceRequired?: boolean;
  redirectUri: string;
  scopes?: string[];
  /** Optional JWKS URI override (otherwise discovered). */
  jwksUri?: string;
  /** Claim name containing groups (default 'groups'). */
  groupsClaim?: string;
  groupRoleMap?: GroupRoleMap;
}

/**
 * SCIM v2 endpoint configuration.
 */
export interface ScimConfig {
  /** Whether SCIM endpoints are enabled. */
  enabled: boolean;
  /** Bearer token presented by the IdP for SCIM auth. NEVER hardcode — load from env. */
  bearerToken: string;
  /** Rate limit: max POST/PATCH/PUT mutations per minute per token. Default 60. */
  mutationsPerMinute?: number;
  /** Group → role mapping applied during SCIM group provisioning. */
  groupRoleMap?: GroupRoleMap;
}

/**
 * Group → RBAC role mapping. Whitelist-only: any group not in the map is dropped.
 * Roles MUST be valid `UserRole` enum values; the mapper rejects unknowns.
 */
export interface GroupRoleMap {
  /** Map of IdP group name (exact match) → aistack UserRole. */
  [groupName: string]: UserRole;
}

/**
 * Aggregated SSO config sub-field of AgentStackConfig.
 */
export interface SsoConfig {
  saml?: SamlConfig;
  oidc?: OidcConfig;
  scim?: ScimConfig;
  /** Default role assigned to new SSO users when no group mapping matches. */
  defaultRole?: UserRole;
  /** When true, refuse SSO logins for users whose email already exists with a different provider. */
  strictIdentityBinding?: boolean;
}

/**
 * Persisted SSO identity row.
 */
export interface SsoIdentity {
  id: string;
  userId: string;
  provider: 'saml' | 'oidc';
  providerName: string;
  externalId: string;
  attributes: Record<string, unknown>;
  groups: string[];
  lastSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Normalized profile extracted from a SAML assertion or OIDC id_token.
 */
export interface SsoProfile {
  externalId: string;
  email: string;
  username?: string;
  displayName?: string;
  groups: string[];
  rawAttributes: Record<string, unknown>;
}

/**
 * Result of a successful SSO authentication.
 */
export interface SsoAuthResult {
  user: {
    id: string;
    email: string;
    username: string;
    role: UserRole;
  };
  identity: SsoIdentity;
  /** Newly issued aistack access/refresh tokens. */
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
}

/**
 * Replay cache scope. Keys are stored as `${provider}:${scope}:${id}`.
 */
export type ReplayScope = 'assertion' | 'nonce' | 'inresponseto';
