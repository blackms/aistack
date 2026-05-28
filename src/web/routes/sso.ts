/**
 * SSO HTTP routes — registers SAML / OIDC / SCIM endpoints on the Router.
 *
 * AIG-646. Co-located with the existing web routes (no new WebhookServer
 * needed) so SSO inherits CORS, logging, and the request body parser.
 *
 * State storage for OIDC: SQLite-backed `OidcPendingStateStore` keyed by an
 * opaque transaction id sent to the user via the `aistack_oidc_state` cookie.
 * Short-lived (10min). Persisting state in SQLite (instead of an in-process
 * Map) makes the `/login` → `/callback` flow tolerant of multi-process
 * deploys where the two requests may hit different workers.
 *
 * Refresh tokens for browser flows are returned as an HttpOnly + Secure +
 * SameSite=Strict cookie (`aistack_refresh`) and stripped from the JSON body,
 * so a malicious script that successfully exfiltrates the JSON response cannot
 * steal the long-lived refresh token. The short-lived access token remains in
 * the body for the SPA to consume.
 *
 * Mounted prefix is determined by the caller (typically `/api`). Routes:
 *   GET  /api/auth/sso/saml/login                 → 302 to IdP
 *   POST /api/auth/sso/saml/acs                   → consume SAMLResponse
 *   GET  /api/auth/sso/saml/logout                → 302 to IdP SLO (if any)
 *   GET  /api/auth/sso/oidc/login                 → 302 to IdP + Set-Cookie
 *   GET  /api/auth/sso/oidc/callback              → consume code+state
 *   ANY  /api/scim/v2/...                         → SCIM router
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import type { Router } from '../router.js';
import { sendError } from '../router.js';
import type { SsoModule } from '../../auth/sso/index.js';
import type { SsoAuthResult } from '../../auth/sso/types.js';

const log = logger.child('web:sso');

const OIDC_COOKIE = 'aistack_oidc_state';
const REFRESH_COOKIE = 'aistack_refresh';
/** 7d, matches refresh-token JWT lifetime in SsoService.issueTokensForUser. */
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

interface SsoRouteDeps {
  ssoModule: SsoModule;
  /** Base URL of the aistack web server, used to build absolute redirects. */
  publicBaseUrl?: string;
}

/**
 * Register all SSO routes on the given router. Endpoints are no-ops if the
 * relevant provider is not configured.
 */
export function registerSsoRoutes(router: Router, deps: SsoRouteDeps): void {
  const { ssoModule } = deps;

  // Persistent OIDC pending-state store (multi-process safe). Keyed by a
  // random transaction id sent as a cookie to the user agent.
  const oidcPending = ssoModule.oidcPendingStore;

  // ---- SAML ---------------------------------------------------------------
  if (ssoModule.saml) {
    router.get('/api/auth/sso/saml/login', async (_req, res) => {
      try {
        const url = await ssoModule.saml!.getAuthURL();
        res.writeHead(302, { Location: url });
        res.end();
      } catch (err) {
        log.error('SAML login redirect failed', errMeta(err));
        sendError(res, 500, 'SAML login failed');
      }
    });

    router.post('/api/auth/sso/saml/acs', async (req, res, params) => {
      try {
        // The Router has already consumed and JSON-parsed the request body.
        // Reading it a second time would hang (data + end already fired).
        const body = (params.body ?? {}) as { SAMLResponse?: unknown; RelayState?: unknown };
        const samlResponse = String(body.SAMLResponse ?? '');
        const relayState = body.RelayState ? String(body.RelayState) : undefined;
        const profile = await ssoModule.saml!.handleACS(samlResponse, relayState);
        const result = await ssoModule.service.upsertFromProfile(
          profile,
          'saml',
          ssoModule.saml!.providerName
        );
        sendSsoAuthResult(res, result);
      } catch (err) {
        log.warn('SAML ACS rejected', errMeta(err));
        const status = (err as { statusCode?: number }).statusCode ?? 401;
        sendError(res, status, errMessage(err));
      }
    });

    router.get('/api/auth/sso/saml/logout', async (req, res) => {
      try {
        const url = req.url ?? '';
        const nameID = new URL(url, 'http://x').searchParams.get('nameID') ?? '';
        const sessionIndex =
          new URL(url, 'http://x').searchParams.get('sessionIndex') ?? undefined;
        const logoutUrl = await ssoModule.saml!.getLogoutURL(nameID, sessionIndex);
        if (!logoutUrl) {
          res.writeHead(204);
          res.end();
          return;
        }
        res.writeHead(302, { Location: logoutUrl });
        res.end();
      } catch (err) {
        log.error('SAML logout failed', errMeta(err));
        sendError(res, 500, 'SAML logout failed');
      }
    });
  }

  // ---- OIDC ---------------------------------------------------------------
  if (ssoModule.oidc) {
    router.get('/api/auth/sso/oidc/login', async (_req, res) => {
      try {
        const { url, state } = await ssoModule.oidc!.getAuthURL();
        const txId = randomUUID();
        oidcPending.set(txId, state);
        res.writeHead(302, {
          Location: url,
          'Set-Cookie': `${OIDC_COOKIE}=${txId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
        });
        res.end();
      } catch (err) {
        log.error('OIDC login redirect failed', errMeta(err));
        sendError(res, 500, 'OIDC login failed');
      }
    });

    router.get('/api/auth/sso/oidc/callback', async (req, res) => {
      try {
        const cookieHeader = req.headers.cookie ?? '';
        const txId = readCookie(cookieHeader, OIDC_COOKIE);
        if (!txId) {
          sendError(res, 400, 'Missing OIDC state cookie');
          return;
        }
        // Single-use, multi-process-safe (atomic read+delete in SQLite).
        const state = oidcPending.takeAndDelete(txId);
        if (!state) {
          sendError(res, 400, 'Unknown or expired OIDC state');
          return;
        }
        const fullUrl = `http://x${req.url ?? ''}`;
        const profile = await ssoModule.oidc!.handleCallback(
          { url: fullUrl },
          state
        );
        const result = await ssoModule.service.upsertFromProfile(
          profile,
          'oidc',
          ssoModule.oidc!.providerName
        );
        sendSsoAuthResult(res, result, [
          // Clear the OIDC transaction cookie now that the flow is complete.
          `${OIDC_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
        ]);
      } catch (err) {
        log.warn('OIDC callback rejected', errMeta(err));
        const status = (err as { statusCode?: number }).statusCode ?? 401;
        sendError(res, status, errMessage(err));
      }
    });
  }

  // ---- SCIM ---------------------------------------------------------------
  if (ssoModule.scim) {
    // Register a catch-all under /api/scim/v2 by listing each verb.
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
    // We register one route per (method, depth) combination up to 2 segments
    // — the Router uses regex, not Express-style wildcards.
    const paths = [
      '/api/scim/v2/:resource',
      '/api/scim/v2/:resource/:id',
    ];
    for (const m of methods) {
      for (const p of paths) {
        router[m](p, async (req, res, params) => {
          await handleScim(ssoModule, req, res, params);
        });
      }
    }
  }
}

async function handleScim(
  ssoModule: SsoModule,
  req: IncomingMessage,
  res: ServerResponse,
  params: { path: string[]; query: Record<string, string>; body?: unknown }
): Promise<void> {
  if (!ssoModule.scim) {
    sendError(res, 404, 'SCIM not enabled');
    return;
  }
  const resource = params.path[0] ?? '';
  const id = params.path[1];
  const scimPath = id ? `${resource}/${id}` : resource;
  const auth = req.headers.authorization;

  const response = await ssoModule.scim.handle({
    method: req.method ?? 'GET',
    path: scimPath,
    authHeader: typeof auth === 'string' ? auth : undefined,
    body: params.body,
    query: params.query,
  });

  res.writeHead(response.status, {
    'Content-Type': 'application/scim+json',
  });
  if (response.status === 204 || response.body === '') {
    res.end();
  } else {
    res.end(JSON.stringify(response.body));
  }
}

/**
 * Write a successful SSO auth result to the browser:
 *   - Refresh token → HttpOnly + Secure + SameSite=Strict cookie (not in body).
 *     SameSite=Strict prevents the cookie from being attached to cross-site
 *     navigations (the refresh endpoint is same-site only).
 *   - Access token + user metadata → JSON body (short-lived; SPA stores it
 *     in memory and uses it for Authorization: Bearer headers).
 *
 * Extra `Set-Cookie` headers (e.g. clearing the OIDC tx cookie) can be passed
 * via `extraSetCookies`. We send them as an array so `writeHead` emits one
 * `Set-Cookie` per entry rather than a comma-joined header.
 */
function sendSsoAuthResult(
  res: ServerResponse,
  result: SsoAuthResult,
  extraSetCookies: string[] = []
): void {
  const refreshCookie =
    `${REFRESH_COOKIE}=${result.tokens.refreshToken}; ` +
    `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${REFRESH_COOKIE_MAX_AGE}`;

  const setCookieHeaders = [refreshCookie, ...extraSetCookies];

  // Strip refresh token from the body — browsers receive it only via cookie.
  const safeBody = {
    user: result.user,
    identity: result.identity,
    tokens: {
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
    },
  };

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': setCookieHeaders,
  });
  res.end(JSON.stringify(safeBody));
}

function readCookie(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === name) return v;
  }
  return undefined;
}

function errMeta(err: unknown): Record<string, unknown> {
  return { error: err instanceof Error ? err.message : String(err) };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Internal error';
}
