# Enterprise SSO (SAML 2.0 + OIDC) and SCIM v2 Provisioning

> AIG-646. This document describes how to configure aistack for enterprise
> Single Sign-On and automated user/group provisioning, and the threat model
> the implementation defends against.

## Table of Contents

1. [Overview](#overview)
2. [Configuration](#configuration)
3. [Setup: Okta SAML](#setup-okta-saml)
4. [Setup: Azure AD SAML](#setup-azure-ad-saml)
5. [Setup: Google Workspace SAML](#setup-google-workspace-saml)
6. [Setup: Auth0 OIDC](#setup-auth0-oidc)
7. [SCIM v2 Provisioning (Okta)](#scim-v2-provisioning-okta)
8. [Group to Role Mapping](#group-to-role-mapping)
9. [Threat Model](#threat-model)
10. [Operational Notes](#operational-notes)

---

## Overview

The SSO module (`src/auth/sso/`) is additive. It does not modify the existing
JWT + bcrypt + RBAC `AuthService`; instead it sits alongside it and:

- accepts authenticated subjects from an external IdP (SAML 2.0 or OIDC),
- creates or links a local `users` row,
- maps IdP groups to one of the aistack `UserRole` values via a strict
  whitelist (`groupRoleMap`),
- issues the same access + refresh JWTs the password login flow produces, and
- (optionally) exposes a SCIM v2 endpoint so the IdP can provision and
  deprovision users without manual intervention.

Endpoints (mounted under the web server's `/api` prefix):

| Method | Path                                | Purpose                       |
| ------ | ----------------------------------- | ----------------------------- |
| GET    | `/api/auth/sso/saml/login`          | Redirect to IdP SSO           |
| POST   | `/api/auth/sso/saml/acs`            | Assertion Consumer Service    |
| GET    | `/api/auth/sso/saml/logout`         | Redirect to IdP SLO (if any)  |
| GET    | `/api/auth/sso/oidc/login`          | Redirect to IdP authorize URL |
| GET    | `/api/auth/sso/oidc/callback`       | OIDC code exchange            |
| ANY    | `/api/scim/v2/{Users,Groups,...}`   | SCIM v2 server                |

## Configuration

SSO is configured under `auth.sso` in `aistack.config.json`. All three
sub-sections (`saml`, `oidc`, `scim`) are independent — enable only what you
need.

```jsonc
{
  "auth": {
    "sso": {
      "defaultRole": "viewer",
      "strictIdentityBinding": true,
      "saml": {
        "providerName": "okta",
        "entityId": "urn:aistack:sp",
        "idpSsoUrl": "https://${OKTA_DOMAIN}/app/aistack/sso/saml",
        "idpSloUrl": "https://${OKTA_DOMAIN}/app/aistack/slo/saml",
        "idpCert": "${OKTA_SAML_CERT_PEM}",
        "callbackUrl": "https://aistack.example.com/api/auth/sso/saml/acs",
        "signatureAlgorithm": "sha256",
        "acceptedClockSkewSec": 30,
        "groupAttributeName": "groups",
        "emailAttributeName": "email",
        "groupRoleMap": {
          "aistack-admins": "admin",
          "aistack-developers": "developer",
          "aistack-viewers": "viewer"
        }
      },
      "oidc": {
        "providerName": "auth0",
        "issuerUrl": "https://${AUTH0_DOMAIN}/",
        "clientId": "${AUTH0_CLIENT_ID}",
        "clientSecret": "${AUTH0_CLIENT_SECRET}",
        "redirectUri": "https://aistack.example.com/api/auth/sso/oidc/callback",
        "scopes": ["openid", "profile", "email", "groups"],
        "groupsClaim": "https://aistack.example.com/groups",
        "groupRoleMap": {
          "aistack-admins": "admin"
        }
      },
      "scim": {
        "enabled": true,
        "bearerToken": "${SCIM_BEARER_TOKEN}",
        "mutationsPerMinute": 60,
        "groupRoleMap": {
          "aistack-admins": "admin",
          "aistack-developers": "developer"
        }
      }
    }
  }
}
```

Values such as `${OKTA_SAML_CERT_PEM}` are resolved from environment variables
at startup. **Never** hardcode certificates, client secrets, or bearer tokens
in the config file checked into source control.

The following env vars are required when SSO is enabled:

- `JWT_SECRET` and `REFRESH_SECRET` — same as the existing password login
  flow; SSO reuses them so token verification is consistent.
- `SCIM_BEARER_TOKEN` — at least 32 random bytes (base64 or hex); generated
  per IdP integration and rotated annually.
- IdP-specific secrets (e.g. `AUTH0_CLIENT_SECRET`, `OKTA_SAML_CERT_PEM`).

## Setup: Okta SAML

1. In Okta admin, **Applications → Create App Integration → SAML 2.0**.
2. Set **Single sign-on URL** = `https://aistack.example.com/api/auth/sso/saml/acs`.
3. Set **Audience URI (SP Entity ID)** = `urn:aistack:sp` (match `entityId`).
4. **Attribute Statements**:
   - `email` → `user.email`
   - `displayName` → `user.displayName`
5. **Group Attribute Statements**:
   - Name: `groups`
   - Filter: `Matches regex` → `aistack-.*`
6. Save and assign Okta users/groups to the app.
7. **View SAML Setup Instructions** → copy the X.509 certificate (PEM) and
   the SSO URL into `OKTA_SAML_CERT_PEM` / `OKTA_DOMAIN`.

## Setup: Azure AD SAML

1. In Azure AD, **Enterprise applications → New application → Non-gallery**.
2. **Single sign-on → SAML**.
3. **Basic SAML Configuration**:
   - Identifier (Entity ID): `urn:aistack:sp`
   - Reply URL: `https://aistack.example.com/api/auth/sso/saml/acs`
4. **User Attributes & Claims**:
   - Add a group claim with **Source attribute** = `cloudOnly`, **Name** =
     `groups`.
5. **SAML Signing Certificate** → download `Certificate (Base64)` and set
   `OKTA_SAML_CERT_PEM` (variable name kept generic; rename to suit).
6. Copy the **Login URL** into `idpSsoUrl`.

## Setup: Google Workspace SAML

1. **Admin Console → Apps → Web and mobile apps → Add custom SAML app**.
2. Note the SSO URL, Entity ID, and download the certificate.
3. **Service Provider Details**:
   - ACS URL: `https://aistack.example.com/api/auth/sso/saml/acs`
   - Entity ID: `urn:aistack:sp`
   - Name ID format: `EMAIL`
4. **Attribute mapping**: `Primary email` → `email`, custom group attribute
   if you operate one.
5. Assign to OUs as needed.

## Setup: Auth0 OIDC

1. **Applications → Create Application → Regular Web Application**.
2. **Allowed Callback URLs**:
   `https://aistack.example.com/api/auth/sso/oidc/callback`
3. **Allowed Logout URLs**: `https://aistack.example.com/`
4. **Advanced Settings → Grant Types**: enable `Authorization Code`.
5. Add a **Rule** or **Action** that injects a groups claim into the id_token:

   ```js
   exports.onExecutePostLogin = async (event, api) => {
     const groups = event.authorization?.roles ?? [];
     api.idToken.setCustomClaim(
       'https://aistack.example.com/groups',
       groups
     );
   };
   ```

6. Populate `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_DOMAIN`.

## SCIM v2 Provisioning (Okta)

1. In your Okta SAML app, **Provisioning → Configure API Integration**.
2. **Base URL**: `https://aistack.example.com/api/scim/v2`.
3. **API Token**: paste the `SCIM_BEARER_TOKEN` value.
4. **Test API Credentials**. Okta will probe `/ServiceProviderConfig`.
5. Enable **Create Users**, **Update User Attributes**, **Deactivate Users**.
6. Map Okta groups to SCIM groups; aistack stores them in `scim_groups` and
   applies the `groupRoleMap` whitelist.

The supported subset of RFC 7644 covers:

- `Users` GET/POST/GET/PUT/PATCH/DELETE (filter by `userName eq` /
  `email eq`).
- `Groups` GET/POST/GET/PUT/PATCH/DELETE (members add/remove via PATCH).
- `ServiceProviderConfig`, `Schemas`, `ResourceTypes` discovery endpoints.

## Group to Role Mapping

`groupRoleMap` is a strict whitelist:

- Keys are the exact IdP group names (case-sensitive).
- Values must be one of `admin`, `developer`, `viewer` (the
  `UserRole` enum). Unknown values are rejected at config load.
- When a user has **multiple** mapped groups, the **highest privilege wins**
  (`admin` > `developer` > `viewer`). This is intentional and audited.
- When a user has **no** mapped groups, `defaultRole` (or `viewer` if
  omitted) is assigned.

There is no facility to inject arbitrary roles, evaluate expressions, or use
group names as SQL/path fragments. The mapping is a pure data lookup.

## Threat Model

Identity is the most critical security surface in the system; the following
threat classes are explicitly addressed.

### 1. Forged or unsigned SAML assertions (SEC #1)

- `wantAssertionsSigned: true` is hard-coded; the parser refuses any
  assertion without a verified signature over the canonicalised XML.
- `signatureAlgorithm` is restricted to `sha256` or `sha512` at the
  constructor; SHA1 / MD5 are rejected.
- The XML preflight (`preflightSamlResponse`) refuses any SAMLResponse whose
  `<ds:SignatureMethod>` or `<ds:DigestMethod>` references SHA1 or MD5
  before the parser is even invoked.
- `NotBefore` and `NotOnOrAfter` are enforced with a configurable clock
  skew (default 30s, max 5 min).

### 2. XML External Entity / XXE injection (SEC #2)

- `preflightSamlResponse` rejects any SAMLResponse containing `<!DOCTYPE`,
  `<!ENTITY`, `SYSTEM` or `PUBLIC` external references prior to parsing.
- The underlying `@node-saml/node-saml` library uses `xpath` + `xml-crypto`
  which do not resolve external entities by default; the preflight is
  defence in depth.

### 3. SAML replay attacks (SEC #3)

- Two-layer replay protection via `ReplayCache` (SQLite + in-memory):
  - the SAML `AssertionID` is recorded with a 5-minute TTL; second use →
    rejected.
  - the SAML `InResponseTo` (if present) is recorded identically, so a
    captured response cannot be replayed against a fresh AuthnRequest.
- `validateInResponseTo: 'always'` is enabled in the underlying parser.
- Missing `AssertionID` → request is refused (fail closed).

### 4. OIDC CSRF, code interception, replay (SEC #4)

- `state` is a 16-byte random value, persisted in an `HttpOnly; Secure;
  SameSite=Lax` cookie and checked on callback. Mismatch → request rejected.
- `nonce` is a separate 16-byte random value bound into the id_token by the
  IdP. The `ReplayCache` also records the nonce with a 10-minute TTL so a
  reused nonce is rejected even if the IdP issues a duplicate id_token.
- PKCE is mandatory: a 32-byte random verifier and SHA-256 challenge are
  always sent. Constructing an OIDC provider with `pkceRequired: false` and
  no `clientSecret` is refused.
- The stored auth state expires after 10 minutes.

### 5. OIDC id_token / JWKS validation (SEC #5)

- Signature, `iss`, `aud`, `exp`, `nbf`, `iat` and `nonce` checks are
  delegated to `openid-client` (panva), which uses the issuer-published
  JWKS with automatic key rotation.
- Missing `sub` or `email` claims → request rejected.

### 6. SCIM authorization and DoS (SEC #6)

- All SCIM requests require a bearer token of at least 16 characters;
  comparison uses `crypto.timingSafeEqual` to prevent timing leaks.
- Cross-tenant operations are not possible: aistack has a single tenant per
  deployment, and the SCIM server only operates on its own SQLite store.
- Mutation rate limit (default 60/minute per token) protects against POST
  flood DoS; further limiting can be applied at the reverse proxy layer.

### 7. SCIM account takeover via silent merge (SEC #7)

- On `POST /Users`, a duplicate `email` or `userName` returns **409
  Conflict**. There is no silent merge.
- During SSO login, if `strictIdentityBinding` is `true`, an SSO-asserted
  email that already exists locally without a matching `sso_identity` row
  is refused. With `strictIdentityBinding: false` (default) the existing
  user is linked, the action is logged at WARN level, but their role is
  **not** silently elevated — the previous role is preserved until the next
  SSO login completes group resolution.
- All SCIM mutations are logged at INFO level with user IDs for audit.

### 8. Group to Role mapping injection (SEC #8)

- Role mapping is a pure dictionary lookup. There is no `eval`, no SQL
  templating, no string interpolation into queries.
- The set of valid roles is hard-coded to the `UserRole` enum; any other
  value in the config is dropped at startup with a clear log message.
- SCIM `PATCH /Users/:id` intentionally ignores raw `role` mutations:
  privilege changes can only come through group membership, which is
  audited and rate-limited.

### 9. Session fixation after SSO login (SEC #9)

- Every successful SSO login mints a brand new access + refresh token pair
  via the existing `AuthService` semantics. The new refresh token is stored
  in `refresh_tokens`; previous refresh tokens for the user are **not**
  silently revoked, but the legacy `logout` endpoint can be used by the
  client to revoke them.
- SSO requests run on the standard web Router which sets no server-side
  HTTP session; there is no session id to fix.

## Operational Notes

- **Rotation**: rotate `SCIM_BEARER_TOKEN`, OIDC `client_secret`, and SAML
  certificate before they expire. The replay cache is keyed by provider
  name so multiple SAML IdPs can coexist without collision.
- **Logging**: every SSO/SCIM mutation logs at INFO level via the standard
  logger. Pipe to your SIEM for retention and alerting.
- **Local dev**: SSO is disabled when `auth.sso` is absent. Tests do not
  require `@node-saml/node-saml` or `openid-client` to be installed because
  both libraries are loaded via `require` only when a provider is wired up;
  unit tests use stub factories.
- **Migrations**: the new tables (`sso_identities`, `sso_sessions`,
  `sso_replay_cache`, `scim_groups`, `scim_group_members`) live in
  `migrations/004_sso_provisioning.sql`. They are additive and do not
  modify existing tables.
