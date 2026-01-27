/**
 * Agent routes
 */

import type { AgentStackConfig } from '../../types.js';
import type { Router } from '../router.js';
import { sendJson, sendError } from '../router.js';
import { badRequest, notFound } from '../middleware/error.js';
import {
  spawnAgent,
  getAgent,
  listAgents,
  stopAgent,
  updateAgentStatus,
  executeAgent,
  listAgentDefinitions,
  pauseAgent,
  resumeAgent,
} from '../../agents/index.js';
import { getResourceExhaustionService } from '../../monitoring/resource-exhaustion-service.js';
import { getMemoryManager } from '../../memory/index.js';
import type { DeliverableType } from '../../types.js';
import { agentEvents } from '../websocket/event-bridge.js';
import type { SpawnAgentRequest, ExecuteAgentRequest, ChatRequest } from '../types.js';

export function registerAgentRoutes(router: Router, config: AgentStackConfig): void {
  // GET /api/v1/agents - List agents
  router.get('/api/v1/agents', (_req, res, params) => {
    const sessionId = params.query.sessionId;
    const agents = listAgents(sessionId);

    sendJson(res, agents.map(agent => ({
      ...agent,
      createdAt: agent.createdAt.toISOString(),
    })));
  });

  // GET /api/v1/agents/types - List available agent types
  router.get('/api/v1/agents/types', (_req, res) => {
    const definitions = listAgentDefinitions();

    sendJson(res, definitions.map(def => ({
      type: def.type,
      name: def.name,
      description: def.description,
      capabilities: def.capabilities,
    })));
  });

  // POST /api/v1/agents - Spawn new agent
  router.post('/api/v1/agents', (_req, res, params) => {
    const body = params.body as SpawnAgentRequest | undefined;

    if (!body?.type) {
      throw badRequest('Agent type is required');
    }

    try {
      const agent = spawnAgent(body.type, {
        name: body.name,
        sessionId: body.sessionId,
        metadata: body.metadata,
      }, config);

      // Emit event for WebSocket clients
      agentEvents.emit('agent:spawned', {
        id: agent.id,
        type: agent.type,
        name: agent.name,
      });

      sendJson(res, {
        ...agent,
        createdAt: agent.createdAt.toISOString(),
      }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to spawn agent';
      sendError(res, 400, message);
    }
  });

  // GET /api/v1/agents/:id - Get agent by ID
  router.get('/api/v1/agents/:id', (_req, res, params) => {
    const agentId = params.path[0];
    if (!agentId) {
      throw badRequest('Agent ID is required');
    }

    const agent = getAgent(agentId);
    if (!agent) {
      throw notFound('Agent');
    }

    sendJson(res, {
      ...agent,
      createdAt: agent.createdAt.toISOString(),
    });
  });

  // PUT /api/v1/agents/:id/status - Update agent status
  router.put('/api/v1/agents/:id/status', (_req, res, params) => {
    const agentId = params.path[0];
    if (!agentId) {
      throw badRequest('Agent ID is required');
    }

    const body = params.body as { status?: string } | undefined;
    if (!body?.status) {
      throw badRequest('Status is required');
    }

    const validStatuses = ['idle', 'running', 'completed', 'failed', 'stopped'];
    if (!validStatuses.includes(body.status)) {
      throw badRequest(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const success = updateAgentStatus(agentId, body.status as 'idle' | 'running' | 'completed' | 'failed' | 'stopped');
    if (!success) {
      throw notFound('Agent');
    }

    // Emit event for WebSocket clients
    agentEvents.emit('agent:status', {
      id: agentId,
      status: body.status,
    });

    const agent = getAgent(agentId);
    sendJson(res, {
      ...agent,
      createdAt: agent?.createdAt.toISOString(),
    });
  });

  // DELETE /api/v1/agents/:id - Stop agent
  router.delete('/api/v1/agents/:id', (_req, res, params) => {
    const agentId = params.path[0];
    if (!agentId) {
      throw badRequest('Agent ID is required');
    }

    const success = stopAgent(agentId);
    if (!success) {
      throw notFound('Agent');
    }

    // Emit event for WebSocket clients
    agentEvents.emit('agent:stopped', { id: agentId });

    sendJson(res, { stopped: true });
  });

  // POST /api/v1/agents/:id/execute - Execute task with agent
  router.post('/api/v1/agents/:id/execute', async (_req, res, params) => {
    const agentId = params.path[0];
    if (!agentId) {
      throw badRequest('Agent ID is required');
    }

    const body = params.body as ExecuteAgentRequest | undefined;
    if (!body?.task) {
      throw badRequest('Task is required');
    }

    const agent = getAgent(agentId);
    if (!agent) {
      throw notFound('Agent');
    }

    try {
      const result = await executeAgent(agentId, body.task, config, {
        provider: body.provider,
        model: body.model,
        context: body.context,
      });

      sendJson(res, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Execution failed';
      sendError(res, 500, message);
    }
  });

  // POST /api/v1/agents/:id/chat - Chat with agent
  router.post('/api/v1/agents/:id/chat', async (_req, res, params) => {
    const agentId = params.path[0];
    if (!agentId) {
      throw badRequest('Agent ID is required');
    }

    const body = params.body as ChatRequest | undefined;
    if (!body?.message) {
      throw badRequest('Message is required');
    }

    const agent = getAgent(agentId);
    if (!agent) {
      throw notFound('Agent');
    }

    try {
      const result = await executeAgent(agentId, body.message, config, {
        context: body.context,
      });

      // Emit message events for WebSocket clients
      agentEvents.emit('message:received', {
        from: 'user',
        to: agentId,
        content: body.message,
      });

      agentEvents.emit('message:received', {
        from: agentId,
        to: 'user',
        content: result.response,
      });

      sendJson(res, {
        response: result.response,
        model: result.model,
        duration: result.duration,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Chat failed';
      sendError(res, 500, message);
    }
  });

  // GET /api/v1/agents/:id/resources - Get agent resource metrics
  router.get('/api/v1/agents/:id/resources', (_req, res, params) => {
    const agentId = params.path[0];
    if (!agentId) {
      throw badRequest('Agent ID is required');
    }

    const agent = getAgent(agentId);
    if (!agent) {
      throw notFound('Agent');
    }

    if (!config.resourceExhaustion?.enabled) {
      sendJson(res, { error: 'Resource exhaustion monitoring not enabled' }, 400);
      return;
    }

    try {
      const memoryManager = getMemoryManager(config);
      const resourceService = getResourceExhaustionService(
        memoryManager.getStore(),
        config.resourceExhaustion
      );

      const metrics = resourceService.getAgentMetrics(agentId);
      if (!metrics) {
        sendJson(res, { error: 'No metrics available for this agent' }, 404);
        return;
      }

      sendJson(res, {
        ...metrics,
        startedAt: metrics.startedAt.toISOString(),
        lastDeliverableAt: metrics.lastDeliverableAt?.toISOString() ?? null,
        lastActivityAt: metrics.lastActivityAt.toISOString(),
        pausedAt: metrics.pausedAt?.toISOString() ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get resource metrics';
      sendError(res, 500, message);
    }
  });

  // POST /api/v1/agents/:id/deliverable - Record a deliverable checkpoint
  router.post('/api/v1/agents/:id/deliverable', (_req, res, params) => {
    const agentId = params.path[0];
    if (!agentId) {
      throw badRequest('Agent ID is required');
    }

    const agent = getAgent(agentId);
    if (!agent) {
      throw notFound('Agent');
    }

    const body = params.body as { type?: string; description?: string; artifacts?: string[] } | undefined;
    if (!body?.type) {
      throw badRequest('Deliverable type is required');
    }

    const validTypes = ['task_completed', 'code_committed', 'tests_passed', 'user_checkpoint', 'artifact_produced'];
    if (!validTypes.includes(body.type)) {
      throw badRequest(`Invalid deliverable type. Must be one of: ${validTypes.join(', ')}`);
    }

    if (!config.resourceExhaustion?.enabled) {
      sendJson(res, { error: 'Resource exhaustion monitoring not enabled' }, 400);
      return;
    }

    try {
      const memoryManager = getMemoryManager(config);
      const resourceService = getResourceExhaustionService(
        memoryManager.getStore(),
        config.resourceExhaustion
      );

      const checkpoint = resourceService.recordDeliverable(
        agentId,
        body.type as DeliverableType,
        body.description,
        body.artifacts
      );

      sendJson(res, {
        ...checkpoint,
        createdAt: checkpoint.createdAt.toISOString(),
      }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to record deliverable';
      sendError(res, 500, message);
    }
  });

  // POST /api/v1/agents/:id/pause - Pause an agent
  router.post('/api/v1/agents/:id/pause', async (_req, res, params) => {
    const agentId = params.path[0];
    if (!agentId) {
      throw badRequest('Agent ID is required');
    }

    const agent = getAgent(agentId);
    if (!agent) {
      throw notFound('Agent');
    }

    const body = params.body as { reason?: string } | undefined;
    const reason = body?.reason ?? 'Manual pause via API';

    if (!config.resourceExhaustion?.enabled) {
      sendJson(res, { error: 'Resource exhaustion monitoring not enabled' }, 400);
      return;
    }

    try {
      const success = await pauseAgent(agentId, reason);
      if (success) {
        agentEvents.emit('agent:paused', { id: agentId, reason });
        sendJson(res, { paused: true, reason });
      } else {
        sendJson(res, { error: 'Failed to pause agent' }, 500);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pause agent';
      sendError(res, 500, message);
    }
  });

  // POST /api/v1/agents/:id/resume - Resume a paused agent
  router.post('/api/v1/agents/:id/resume', (_req, res, params) => {
    const agentId = params.path[0];
    if (!agentId) {
      throw badRequest('Agent ID is required');
    }

    const agent = getAgent(agentId);
    if (!agent) {
      throw notFound('Agent');
    }

    if (!config.resourceExhaustion?.enabled) {
      sendJson(res, { error: 'Resource exhaustion monitoring not enabled' }, 400);
      return;
    }

    try {
      const success = resumeAgent(agentId);
      if (success) {
        agentEvents.emit('agent:resumed', { id: agentId });
        sendJson(res, { resumed: true });
      } else {
        sendJson(res, { error: 'Agent was not paused or failed to resume' }, 400);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resume agent';
      sendError(res, 500, message);
    }
  });
}
