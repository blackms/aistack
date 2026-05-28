/**
 * REST API for HITL interrupts (AIG-644).
 *
 * GET    /api/v1/interrupts                       list all (?status=, ?sessionId=)
 * GET    /api/v1/interrupts/:id                   one record
 * POST   /api/v1/interrupts/:id/claim             mark as claimed by operator
 * POST   /api/v1/interrupts/:id/resume            body: { input, stateEdits[] }
 * POST   /api/v1/interrupts/:id/cancel            body: { reason }
 */

import type { AgentStackConfig } from '../../types.js';
import type { Router } from '../router.js';
import { sendJson } from '../router.js';
import { badRequest, notFound } from '../middleware/error.js';
import {
  getInterruptStore,
  resumeInterrupt,
  type ResumePayload,
  type InterruptStatus,
} from '../../coordination/interrupt.js';

export function registerInterruptRoutes(router: Router, _config: AgentStackConfig): void {
  router.get('/api/v1/interrupts', (_req, res, params) => {
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

  router.get('/api/v1/interrupts/:id', (_req, res, params) => {
    const id = params.path[0];
    if (!id) throw badRequest('interrupt id required');
    const record = getInterruptStore().get(id);
    if (!record) throw notFound('Interrupt');
    sendJson(res, record);
  });

  router.post('/api/v1/interrupts/:id/claim', async (_req, res, params) => {
    const id = params.path[0];
    if (!id) throw badRequest('interrupt id required');
    const record = await getInterruptStore().claim(id);
    if (!record) throw notFound('Interrupt');
    sendJson(res, record);
  });

  router.post('/api/v1/interrupts/:id/resume', async (_req, res, params) => {
    const id = params.path[0];
    if (!id) throw badRequest('interrupt id required');
    const body = (params.body as ResumePayload | undefined) ?? {};
    const record = await resumeInterrupt(id, body);
    sendJson(res, record);
  });

  router.post('/api/v1/interrupts/:id/cancel', async (_req, res, params) => {
    const id = params.path[0];
    if (!id) throw badRequest('interrupt id required');
    const body = (params.body as { reason?: string } | undefined) ?? {};
    const record = await getInterruptStore().cancel(id, body.reason ?? 'cancelled via API');
    if (!record) throw notFound('Interrupt');
    sendJson(res, record);
  });
}
