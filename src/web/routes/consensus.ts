/**
 * Consensus checkpoint routes
 */

import type { AgentStackConfig } from '../../types.js';
import type { Router } from '../router.js';
import { sendJson, sendPaginated } from '../router.js';
import { badRequest, notFound } from '../middleware/error.js';
import { getMemoryManager } from '../../memory/index.js';
import { getConsensusService } from '../../tasks/consensus-service.js';
import { agentEvents } from '../websocket/event-bridge.js';

export function registerConsensusRoutes(router: Router, config: AgentStackConfig): void {
  const getManager = () => getMemoryManager(config);
  const getService = () => {
    const manager = getManager();
    return getConsensusService(manager.getStore(), config);
  };

  // GET /api/v1/consensus/config - Get consensus configuration
  router.get('/api/v1/consensus/config', (_req, res) => {
    const service = getService();
    const cfg = service.getConfig();

    sendJson(res, {
      enabled: cfg.enabled,
      requireForRiskLevels: cfg.requireForRiskLevels,
      reviewerStrategy: cfg.reviewerStrategy,
      timeout: cfg.timeout,
      maxDepth: cfg.maxDepth,
      autoReject: cfg.autoReject,
    });
  });

  // GET /api/v1/consensus/pending - List pending checkpoints
  router.get('/api/v1/consensus/pending', (_req, res, params) => {
    const limit = parseInt(params.query.limit || '50', 10);
    const offset = parseInt(params.query.offset || '0', 10);

    const service = getService();
    const checkpoints = service.listPendingCheckpoints({ limit, offset });
    const total = service.countPendingCheckpoints();

    sendPaginated(
      res,
      checkpoints.map(cp => ({
        id: cp.id,
        taskId: cp.taskId,
        parentTaskId: cp.parentTaskId,
        riskLevel: cp.riskLevel,
        status: cp.status,
        reviewerStrategy: cp.reviewerStrategy,
        proposedSubtaskCount: cp.proposedSubtasks.length,
        createdAt: cp.createdAt.toISOString(),
        expiresAt: cp.expiresAt.toISOString(),
      })),
      { limit, offset, total }
    );
  });

  // POST /api/v1/consensus/check - Check if consensus is required
  router.post('/api/v1/consensus/check', (_req, res, params) => {
    const body = params.body as {
      riskLevel?: string;
      depth?: number;
      parentTaskId?: string;
      agentType?: string;
      input?: string;
    } | undefined;

    const service = getService();

    // Estimate risk level if not provided
    let riskLevel = body?.riskLevel as 'low' | 'medium' | 'high' | undefined;
    if (!riskLevel && body?.agentType) {
      riskLevel = service.estimateRiskLevel(body.agentType, body.input);
    }
    if (!riskLevel) {
      riskLevel = 'low';
    }

    // Calculate depth if not provided
    let depth = body?.depth;
    if (depth === undefined && body?.parentTaskId) {
      depth = service.calculateTaskDepth(body.parentTaskId);
    }
    if (depth === undefined) {
      depth = 0;
    }

    const result = service.requiresConsensus(riskLevel, depth, body?.parentTaskId);

    sendJson(res, {
      requiresConsensus: result.requiresConsensus,
      reason: result.reason,
      riskLevel: result.riskLevel || riskLevel,
      depth: result.depth ?? depth,
      config: {
        enabled: service.isEnabled(),
        requireForRiskLevels: service.getConfig().requireForRiskLevels,
        maxDepth: service.getConfig().maxDepth,
      },
    });
  });

  // POST /api/v1/consensus/expire - Manually expire old checkpoints
  router.post('/api/v1/consensus/expire', (_req, res) => {
    const service = getService();
    const count = service.expireCheckpoints();

    sendJson(res, {
      success: true,
      expiredCount: count,
    });
  });

  // Routes with :id parameter - more specific routes MUST come before less specific ones

  // GET /api/v1/consensus/:id/events - Get checkpoint audit log
  router.get('/api/v1/consensus/:id/events', (_req, res, params) => {
    const checkpointId = params.path[0];
    if (!checkpointId) {
      throw badRequest('Checkpoint ID is required');
    }

    const limit = parseInt(params.query.limit || '100', 10);

    const service = getService();
    const checkpoint = service.getCheckpoint(checkpointId);

    if (!checkpoint) {
      throw notFound('Consensus checkpoint');
    }

    const events = service.getCheckpointEvents(checkpointId, limit);

    sendJson(res, {
      checkpointId,
      events: events.map(e => ({
        id: e.id,
        eventType: e.eventType,
        actorId: e.actorId,
        actorType: e.actorType,
        details: e.details,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  });

  // PUT /api/v1/consensus/:id/approve - Approve a checkpoint
  router.put('/api/v1/consensus/:id/approve', (_req, res, params) => {
    const checkpointId = params.path[0];
    if (!checkpointId) {
      throw badRequest('Checkpoint ID is required');
    }

    const body = params.body as {
      reviewedBy?: string;
      feedback?: string;
    } | undefined;

    if (!body?.reviewedBy) {
      throw badRequest('reviewedBy is required');
    }

    const service = getService();
    const result = service.approveCheckpoint(
      checkpointId,
      body.reviewedBy,
      body.feedback
    );

    if (!result.success) {
      throw badRequest(result.error || 'Failed to approve checkpoint');
    }

    // Emit WebSocket event
    agentEvents.emit('consensus:checkpoint:approved', {
      checkpointId,
      reviewedBy: body.reviewedBy,
    });

    sendJson(res, {
      success: true,
      checkpoint: result.checkpoint ? {
        id: result.checkpoint.id,
        status: result.checkpoint.status,
        decidedAt: result.checkpoint.decidedAt?.toISOString(),
      } : undefined,
    });
  });

  // PUT /api/v1/consensus/:id/reject - Reject a checkpoint
  router.put('/api/v1/consensus/:id/reject', (_req, res, params) => {
    const checkpointId = params.path[0];
    if (!checkpointId) {
      throw badRequest('Checkpoint ID is required');
    }

    const body = params.body as {
      reviewedBy?: string;
      feedback?: string;
      rejectedSubtaskIds?: string[];
    } | undefined;

    if (!body?.reviewedBy) {
      throw badRequest('reviewedBy is required');
    }

    const service = getService();
    const result = service.rejectCheckpoint(
      checkpointId,
      body.reviewedBy,
      body.feedback,
      body.rejectedSubtaskIds
    );

    if (!result.success) {
      throw badRequest(result.error || 'Failed to reject checkpoint');
    }

    // Emit WebSocket event
    agentEvents.emit('consensus:checkpoint:rejected', {
      checkpointId,
      reviewedBy: body.reviewedBy,
      rejectedSubtaskIds: body.rejectedSubtaskIds,
    });

    sendJson(res, {
      success: true,
      checkpoint: result.checkpoint ? {
        id: result.checkpoint.id,
        status: result.checkpoint.status,
        decidedAt: result.checkpoint.decidedAt?.toISOString(),
      } : undefined,
    });
  });

  // POST /api/v1/consensus/:id/start-review - Start agent review
  router.post('/api/v1/consensus/:id/start-review', (_req, res, params) => {
    const checkpointId = params.path[0];
    if (!checkpointId) {
      throw badRequest('Checkpoint ID is required');
    }

    const service = getService();
    const result = service.startAgentReview(checkpointId);

    if (!result.success) {
      throw badRequest(result.error || 'Failed to start review');
    }

    sendJson(res, {
      success: true,
      reviewerConfig: result.reviewerConfig,
    });
  });

  // GET /api/v1/consensus/:id - Get checkpoint details (MUST be after more specific :id routes)
  router.get('/api/v1/consensus/:id', (_req, res, params) => {
    const checkpointId = params.path[0];
    if (!checkpointId) {
      throw badRequest('Checkpoint ID is required');
    }

    const service = getService();
    const checkpoint = service.getCheckpoint(checkpointId);

    if (!checkpoint) {
      throw notFound('Consensus checkpoint');
    }

    sendJson(res, {
      id: checkpoint.id,
      taskId: checkpoint.taskId,
      parentTaskId: checkpoint.parentTaskId,
      proposedSubtasks: checkpoint.proposedSubtasks,
      riskLevel: checkpoint.riskLevel,
      status: checkpoint.status,
      reviewerStrategy: checkpoint.reviewerStrategy,
      reviewerId: checkpoint.reviewerId,
      reviewerType: checkpoint.reviewerType,
      decision: checkpoint.decision,
      createdAt: checkpoint.createdAt.toISOString(),
      expiresAt: checkpoint.expiresAt.toISOString(),
      decidedAt: checkpoint.decidedAt?.toISOString(),
    });
  });
}
