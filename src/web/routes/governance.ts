/**
 * Cost governance REST routes (AIG-867).
 *
 * Endpoints (all read-only — governance is configured via config, not the API):
 *   GET /api/v1/governance/status   — module enabled/block state + summary
 *   GET /api/v1/governance/budgets  — configured budgets
 *   GET /api/v1/governance/spend    — grouped spend report
 *       ?dimension=tenant|workspace|project|agent (default tenant)
 *       &from=<ms|ISO>&to=<ms|ISO>&tenantId=&workspaceId=&project=
 *
 * When governance is disabled all endpoints return `{ enabled: false, ... }`
 * (mirrors the resources endpoint), never an error.
 */

import type { AgentStackConfig } from '../../types.js';
import type { Router } from '../router.js';
import { sendJson } from '../router.js';
import { getGovernanceService } from '../../governance/index.js';
import type { SpendDimension } from '../../governance/index.js';

const VALID_DIMENSIONS: SpendDimension[] = ['tenant', 'workspace', 'project', 'agent'];

/** Parse an epoch-millis or ISO-8601 timestamp; returns undefined if absent/invalid. */
function parseTs(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? undefined : ms;
}

export function registerGovernanceRoutes(router: Router, config: AgentStackConfig): void {
  // GET /api/v1/governance/status
  router.get('/api/v1/governance/status', (_req, res) => {
    const service = getGovernanceService(config);
    if (!service) {
      sendJson(res, { enabled: false, message: 'Cost governance not enabled' });
      return;
    }
    sendJson(res, service.getStatus());
  });

  // GET /api/v1/governance/budgets
  router.get('/api/v1/governance/budgets', (_req, res) => {
    const service = getGovernanceService(config);
    if (!service) {
      sendJson(res, { enabled: false, budgets: [] });
      return;
    }
    sendJson(res, { enabled: true, budgets: service.getBudgets() });
  });

  // GET /api/v1/governance/spend
  router.get('/api/v1/governance/spend', (_req, res, params) => {
    const service = getGovernanceService(config);
    if (!service) {
      sendJson(res, { enabled: false, message: 'Cost governance not enabled' });
      return;
    }

    const dimRaw = (params.query.dimension as SpendDimension) || 'tenant';
    if (!VALID_DIMENSIONS.includes(dimRaw)) {
      sendJson(
        res,
        {
          error: `invalid dimension "${dimRaw}" (use ${VALID_DIMENSIONS.join('|')})`,
        },
        400,
      );
      return;
    }

    try {
      const report = service.getReport({
        dimension: dimRaw,
        from: parseTs(params.query.from),
        to: parseTs(params.query.to),
        tenantId: params.query.tenantId,
        workspaceId: params.query.workspaceId,
        project: params.query.project,
      });
      sendJson(res, { enabled: true, ...report });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to build spend report';
      sendJson(res, { error: message }, 500);
    }
  });
}
