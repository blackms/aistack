/**
 * REST API for HITL interrupts (AIG-644).
 *
 * GET    /api/v1/interrupts                       list all (?status=, ?sessionId=)
 * GET    /api/v1/interrupts/:id                   one record
 * POST   /api/v1/interrupts/:id/claim             mark as claimed by operator
 * POST   /api/v1/interrupts/:id/resume            body: { input, stateEdits[] }
 * POST   /api/v1/interrupts/:id/cancel            body: { reason }
 *
 * All routes require Bearer auth. The middleware throws a 401-emitting error
 * when no/invalid token is supplied; the router's try/catch turns that into
 * the final HTTP response. We additionally honour an `AISTACK_INTERRUPTS_TOKEN`
 * env shared-secret as a fallback for headless deployments where the full
 * AuthService is not provisioned (e.g. CI, sidecars).
 */

import type { AgentStackConfig } from '../../types.js';
import type { Router } from '../router.js';
import { sendJson } from '../router.js';
import { badRequest, notFound, unauthorized } from '../middleware/error.js';
import { createAuthMiddleware, isAuthServiceInitialized } from '../middleware/auth.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  getInterruptStore,
  resumeInterrupt,
  type ResumePayload,
  type InterruptStatus,
} from '../../coordination/interrupt.js';

/**
 * Guard every interrupts route. Fail-closed: must succeed against either the
 * shared-secret env token or the JWT-based AuthService. Throws ApiError(401)
 * when neither path validates, so the router's catch-all renders a clean
 * `{ error }` JSON body.
 *
 * The generic auth middleware allows requests through when no AuthService is
 * initialized in non-production environments ("dev-mode allow"). That
 * fallback is unsafe for the interrupts surface, which can replay arbitrary
 * workflow state, so we refuse to delegate to it: if neither the env token
 * NOR a real AuthService is configured we reject with 401 immediately,
 * regardless of NODE_ENV.
 */
function requireInterruptsAuth(req: IncomingMessage, res: ServerResponse): void {
  const envToken = process.env.AISTACK_INTERRUPTS_TOKEN;
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const apiKey = typeof req.headers['x-api-key'] === 'string'
    ? (req.headers['x-api-key'] as string)
    : undefined;
  const supplied = bearer ?? apiKey;

  // 1) Shared-secret path: when configured, a matching token authenticates.
  if (envToken && supplied && timingSafeEqualStr(supplied, envToken)) {
    return;
  }

  // 2) Pre-flight fail-closed check: if NEITHER credential source is
  // available we MUST refuse — never let the generic middleware's
  // dev-mode "allow when service missing" branch grant access here.
  // This is the critical guard: without it, an unauthenticated request
  // in a non-production env with no AuthService init'd would be served.
  if (!envToken && !isAuthServiceInitialized()) {
    throw unauthorized('interrupts api requires AISTACK_INTERRUPTS_TOKEN or initialized auth service');
  }

  // 3) JWT/AuthService path: delegate to the standard middleware. It writes
  // the 401 response itself when no/invalid bearer is supplied and rethrows
  // so the route handler short-circuits. Because step 2 already rejected the
  // "no service initialized" case, we know the middleware here will exercise
  // the real verify path and cannot silently allow the request.
  try {
    const ctx = createAuthMiddleware({ required: true })(req, res);
    if (ctx.authenticated && ctx.userId) return;
  } catch (err) {
    // Middleware already sent a 401 in most paths. If we got here without a
    // response we still reject — fail-closed for this sensitive surface.
    if (!res.headersSent) throw unauthorized('Authentication required');
    throw err;
  }
  // Defensive: if middleware returned a context without an authenticated
  // user (should be impossible after step 2 but belt-and-suspenders for any
  // future middleware change) reject explicitly.
  throw unauthorized('Authentication required');
}

/**
 * Constant-time string comparison to avoid leaking the env token through
 * timing side-channels. Returns false on length mismatch without comparing.
 */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function registerInterruptRoutes(router: Router, _config: AgentStackConfig): void {
  router.get('/api/v1/interrupts', (req, res, params) => {
    requireInterruptsAuth(req, res);
    const statusParam = params.query.status;
    const sessionId = params.query.sessionId;
    if (
      statusParam !== undefined &&
      statusParam !== 'pending' &&
      statusParam !== 'resolved' &&
      statusParam !== 'cancelled'
    ) {
      throw badRequest('status must be one of: pending, resolved, cancelled');
    }
    const status: InterruptStatus | undefined =
      statusParam === 'pending' || statusParam === 'resolved' || statusParam === 'cancelled'
        ? statusParam
        : undefined;
    const filter: { sessionId?: string; status?: InterruptStatus } = {};
    if (sessionId) filter.sessionId = sessionId;
    if (status) filter.status = status;
    const records = getInterruptStore().list(filter);
    sendJson(res, records);
  });

  router.get('/api/v1/interrupts/:id', (req, res, params) => {
    requireInterruptsAuth(req, res);
    const id = params.path[0];
    if (!id) throw badRequest('interrupt id required');
    const record = getInterruptStore().get(id);
    if (!record) throw notFound('Interrupt');
    sendJson(res, record);
  });

  router.post('/api/v1/interrupts/:id/claim', async (req, res, params) => {
    requireInterruptsAuth(req, res);
    const id = params.path[0];
    if (!id) throw badRequest('interrupt id required');
    const record = await getInterruptStore().claim(id);
    if (!record) throw notFound('Interrupt');
    sendJson(res, record);
  });

  router.post('/api/v1/interrupts/:id/resume', async (req, res, params) => {
    requireInterruptsAuth(req, res);
    const id = params.path[0];
    if (!id) throw badRequest('interrupt id required');
    const body = (params.body as ResumePayload | undefined) ?? {};
    const record = await resumeInterrupt(id, body);
    sendJson(res, record);
  });

  router.post('/api/v1/interrupts/:id/cancel', async (req, res, params) => {
    requireInterruptsAuth(req, res);
    const id = params.path[0];
    if (!id) throw badRequest('interrupt id required');
    const body = (params.body as { reason?: string } | undefined) ?? {};
    const record = await getInterruptStore().cancel(id, body.reason ?? 'cancelled via API');
    if (!record) throw notFound('Interrupt');
    sendJson(res, record);
  });
}
