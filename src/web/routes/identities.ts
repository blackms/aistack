/**
 * Agent Identity routes
 */

import type { AgentStackConfig, AgentIdentityStatus } from '../../types.js';
import type { Router } from '../router.js';
import { sendJson, sendError } from '../router.js';
import { badRequest, notFound } from '../middleware/error.js';
import { getIdentityService } from '../../agents/identity-service.js';

interface CreateIdentityRequest {
  agentType: string;
  displayName?: string;
  description?: string;
  capabilities?: Array<{
    name: string;
    version?: string;
    enabled: boolean;
    metadata?: Record<string, unknown>;
  }>;
  metadata?: Record<string, unknown>;
  createdBy?: string;
  autoActivate?: boolean;
}

interface UpdateIdentityRequest {
  displayName?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  capabilities?: Array<{
    name: string;
    version?: string;
    enabled: boolean;
    metadata?: Record<string, unknown>;
  }>;
}

interface RetireRequest {
  reason?: string;
  actorId?: string;
}

function serializeIdentity(identity: {
  agentId: string;
  agentType: string;
  status: string;
  capabilities: unknown[];
  version: number;
  displayName?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  lastActiveAt: Date;
  retiredAt?: Date;
  retirementReason?: string;
  createdBy?: string;
  updatedAt: Date;
}) {
  return {
    agentId: identity.agentId,
    agentType: identity.agentType,
    status: identity.status,
    capabilities: identity.capabilities,
    version: identity.version,
    displayName: identity.displayName,
    description: identity.description,
    metadata: identity.metadata,
    createdAt: identity.createdAt.toISOString(),
    lastActiveAt: identity.lastActiveAt.toISOString(),
    retiredAt: identity.retiredAt?.toISOString(),
    retirementReason: identity.retirementReason,
    createdBy: identity.createdBy,
    updatedAt: identity.updatedAt.toISOString(),
  };
}

export function registerIdentityRoutes(router: Router, config: AgentStackConfig): void {
  // GET /api/v1/identities - List identities
  router.get('/api/v1/identities', (_req, res, params) => {
    const identityService = getIdentityService(config);

    const status = params.query.status as AgentIdentityStatus | undefined;
    const agentType = params.query.agentType;
    const limit = params.query.limit ? parseInt(params.query.limit, 10) : undefined;
    const offset = params.query.offset ? parseInt(params.query.offset, 10) : undefined;

    const identities = identityService.listIdentities({
      status,
      agentType,
      limit,
      offset,
    });

    sendJson(res, {
      count: identities.length,
      identities: identities.map(serializeIdentity),
    });
  });

  // POST /api/v1/identities - Create new identity
  router.post('/api/v1/identities', (_req, res, params) => {
    const body = params.body as CreateIdentityRequest | undefined;

    if (!body?.agentType) {
      throw badRequest('Agent type is required');
    }

    const identityService = getIdentityService(config);

    try {
      const identity = identityService.createIdentity({
        agentType: body.agentType,
        displayName: body.displayName,
        description: body.description,
        capabilities: body.capabilities,
        metadata: body.metadata,
        createdBy: body.createdBy,
        autoActivate: body.autoActivate,
      });

      sendJson(res, serializeIdentity(identity), 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create identity';
      sendError(res, 400, message);
    }
  });

  // GET /api/v1/identities/:id - Get identity by ID
  router.get('/api/v1/identities/:id', (_req, res, params) => {
    const agentId = params.path[0];
    if (!agentId) {
      throw badRequest('Identity ID is required');
    }

    const identityService = getIdentityService(config);
    const identity = identityService.getIdentity(agentId);

    if (!identity) {
      throw notFound('Identity');
    }

    sendJson(res, serializeIdentity(identity));
  });

  // GET /api/v1/identities/name/:name - Get identity by display name
  router.get('/api/v1/identities/name/:name', (_req, res, params) => {
    const displayName = params.path[0];
    if (!displayName) {
      throw badRequest('Display name is required');
    }

    const identityService = getIdentityService(config);
    const identity = identityService.getIdentityByName(displayName);

    if (!identity) {
      throw notFound('Identity');
    }

    sendJson(res, serializeIdentity(identity));
  });

  // PATCH /api/v1/identities/:id - Update identity metadata
  router.patch('/api/v1/identities/:id', (_req, res, params) => {
    const agentId = params.path[0];
    if (!agentId) {
      throw badRequest('Identity ID is required');
    }

    const body = params.body as UpdateIdentityRequest | undefined;
    if (!body) {
      throw badRequest('Request body is required');
    }

    const identityService = getIdentityService(config);

    try {
      const identity = identityService.updateIdentity(
        agentId,
        {
          displayName: body.displayName,
          description: body.description,
          metadata: body.metadata,
          capabilities: body.capabilities,
        },
        params.query.actorId
      );

      if (!identity) {
        throw notFound('Identity');
      }

      sendJson(res, serializeIdentity(identity));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update identity';
      if (message.includes('retired')) {
        sendError(res, 400, message);
      } else {
        throw error;
      }
    }
  });

  // POST /api/v1/identities/:id/activate - Activate identity
  router.post('/api/v1/identities/:id/activate', (_req, res, params) => {
    const agentId = params.path[0];
    if (!agentId) {
      throw badRequest('Identity ID is required');
    }

    const identityService = getIdentityService(config);

    try {
      const identity = identityService.activateIdentity(agentId, params.query.actorId);
      sendJson(res, serializeIdentity(identity));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to activate identity';
      if (message.includes('not found')) {
        throw notFound('Identity');
      }
      sendError(res, 400, message);
    }
  });

  // POST /api/v1/identities/:id/deactivate - Deactivate identity
  router.post('/api/v1/identities/:id/deactivate', (_req, res, params) => {
    const agentId = params.path[0];
    if (!agentId) {
      throw badRequest('Identity ID is required');
    }

    const body = params.body as { reason?: string; actorId?: string } | undefined;
    const identityService = getIdentityService(config);

    try {
      const identity = identityService.deactivateIdentity(
        agentId,
        body?.reason,
        body?.actorId ?? params.query.actorId
      );
      sendJson(res, serializeIdentity(identity));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to deactivate identity';
      if (message.includes('not found')) {
        throw notFound('Identity');
      }
      sendError(res, 400, message);
    }
  });

  // POST /api/v1/identities/:id/retire - Retire identity (permanent)
  router.post('/api/v1/identities/:id/retire', (_req, res, params) => {
    const agentId = params.path[0];
    if (!agentId) {
      throw badRequest('Identity ID is required');
    }

    const body = params.body as RetireRequest | undefined;
    const identityService = getIdentityService(config);

    try {
      const identity = identityService.retireIdentity(
        agentId,
        body?.reason,
        body?.actorId ?? params.query.actorId
      );
      sendJson(res, serializeIdentity(identity));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retire identity';
      if (message.includes('not found')) {
        throw notFound('Identity');
      }
      sendError(res, 400, message);
    }
  });

  // GET /api/v1/identities/:id/audit - Get audit trail
  router.get('/api/v1/identities/:id/audit', (_req, res, params) => {
    const agentId = params.path[0];
    if (!agentId) {
      throw badRequest('Identity ID is required');
    }

    const limit = params.query.limit ? parseInt(params.query.limit, 10) : 100;
    const identityService = getIdentityService(config);

    // Verify identity exists
    const identity = identityService.getIdentity(agentId);
    if (!identity) {
      throw notFound('Identity');
    }

    const auditEntries = identityService.getAuditTrail(agentId, limit);

    sendJson(res, {
      agentId,
      count: auditEntries.length,
      entries: auditEntries.map(entry => ({
        id: entry.id,
        action: entry.action,
        previousStatus: entry.previousStatus,
        newStatus: entry.newStatus,
        reason: entry.reason,
        actorId: entry.actorId,
        metadata: entry.metadata,
        timestamp: entry.timestamp.toISOString(),
      })),
    });
  });
}
