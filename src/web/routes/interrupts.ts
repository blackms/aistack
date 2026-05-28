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
import { createAuthMiddleware } from '../middleware/auth.js';
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
 * `{ error }` JSON body. We intentionally do NOT fall back to the
 * dev-mode "allow when AuthService missing" behaviour of the generic
 * middleware — interrupts can replay arbitrary workflow state and must
 * be gated even in local dev.
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

  // 2) JWT/AuthService path: delegate to the standard middleware. It writes
  // the 401 response itself when no/invalid bearer is supplied and rethrows
  // so the route handler short-circuits.
  try {
    const ctx = createAuthMiddleware({ required: true })(req, res);
    if (ctx.authenticated) return;
  } catch (err) {
    // Middleware already sent a 401 in most paths. If we got here without a
    // response (e.g. dev fallback "allow when service missing") we still
    // reject — fail-closed for this sensitive surface.
    if (!res.headersSent) throw unauthorized('Authentication required');
    throw err;
  }
  // Defensive: if middleware returned a non-authenticated context without
  // throwing (dev fallback), reject explicitly.
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
