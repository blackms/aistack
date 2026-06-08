/**
 * Agent spawner - manages running agents
 */

import { randomUUID } from 'node:crypto';
import type { SpawnedAgent, AgentStatus, AgentStackConfig, ChatMessage } from '../types.js';
import { getAgentDefinition, hasAgentType } from './registry.js';
import { getProvider } from '../providers/index.js';
import { ClaudeCodeProvider, GeminiCLIProvider, CodexProvider } from '../providers/cli-providers.js';
import { logger } from '../utils/logger.js';
import { getMemoryManager, getAccessControl } from '../memory/index.js';
import { Semaphore, AgentPool } from '../utils/semaphore.js';
import { getIdentityService } from './identity-service.js';
import { getResourceExhaustionService } from '../monitoring/resource-exhaustion-service.js';
import {
  getActiveTenantContext,
  workspaceNamespace,
  type MultitenancyContext,
} from '../multitenancy/index.js';
import { audit } from '../audit/index.js';
import { saveCheckpointIfEnabled } from '../persistence/checkpointer.js';
import { traceAsync, traceSync } from '../observability/index.js';
import { getGovernanceService } from '../governance/index.js';

const log = logger.child('spawner');

// Active agents
const activeAgents: Map<string, SpawnedAgent> = new Map();

// Agent by name index for quick lookup
const agentsByName: Map<string, string> = new Map();

// Config reference for persistence
let configRef: AgentStackConfig | null = null;

// Concurrency control
// Max 20 concurrent agents to prevent memory exhaustion
const agentSemaphore = new Semaphore('agents', 20);

// Agent pool for reusing agents (up to 10 pooled agents per type)
const agentPool = new AgentPool(10);

export interface SpawnOptions {
  name?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  identityId?: string;      // Use existing identity
  createIdentity?: boolean; // Auto-create ephemeral identity (default: false for backward compat)
  /**
   * AIG-649: explicit tenant context for this agent's execution. When omitted,
   * the spawner falls back to `getActiveTenantContext()`. When neither is
   * available (single-tenant mode) no tenant tagging happens and the agent
   * behaves exactly as before.
   */
  tenantContext?: MultitenancyContext;
}

/**
 * Spawn a new agent
 */
export function spawnAgent(
  type: string,
  options: SpawnOptions = {},
  config?: AgentStackConfig
): SpawnedAgent {
  return traceSync(config, 'aistack.agent.spawn', {
    'agent.type': type,
    'session.id': options.sessionId,
    'agent.identity.id': options.identityId,
  }, (span) => {
    const agent = spawnAgentInternal(type, options, config);
    span?.setAttribute('agent.id', agent.id);
    span?.setAttribute('agent.name', agent.name);
    span?.setAttribute('agent.status', agent.status);
    return agent;
  });
}

function spawnAgentInternal(
  type: string,
  options: SpawnOptions = {},
  config?: AgentStackConfig
): SpawnedAgent {
  if (!hasAgentType(type)) {
    throw new Error(`Unknown agent type: ${type}`);
  }

  const definition = getAgentDefinition(type);
  if (!definition) {
    throw new Error(`Agent definition not found: ${type}`);
  }

  // Check agent limit
  if (activeAgents.size >= 20) {
    throw new Error('Maximum number of concurrent agents reached (20). Stop some agents before spawning more.');
  }

  // Save config reference for persistence
  if (config && !configRef) {
    configRef = config;
  }

  const id = randomUUID();
  const name = options.name ?? `${type}-${id.slice(0, 8)}`;

  // Check for duplicate name
  if (agentsByName.has(name)) {
    throw new Error(`Agent with name '${name}' already exists`);
  }

  // Handle identity
  let identityId = options.identityId;

  if (configRef) {
    // Validate existing identity if provided
    if (identityId) {
      try {
        const identityService = getIdentityService(configRef);
        const identity = identityService.getIdentity(identityId);
        if (!identity) {
          throw new Error(`Identity not found: ${identityId}`);
        }
        if (identity.status === 'retired') {
          throw new Error(`Cannot spawn with retired identity: ${identityId}`);
        }
        if (identity.status !== 'active') {
          throw new Error(`Identity must be active to spawn, current status: ${identity.status}`);
        }
        // Record spawn event
        identityService.recordSpawn(identityId, id);
      } catch (error) {
        if (error instanceof Error && (error.message.includes('Identity not found') ||
            error.message.includes('Cannot spawn') || error.message.includes('Identity must be'))) {
          throw error;
        }
        log.warn('Failed to validate identity', { identityId, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    } else if (options.createIdentity) {
      // Create ephemeral identity if requested
      try {
        const identityService = getIdentityService(configRef);
        const identity = identityService.createIdentity({
          agentType: type,
          displayName: name,
          autoActivate: true,
          metadata: { ephemeral: true, spawnId: id },
        });
        identityId = identity.agentId;
        identityService.recordSpawn(identityId, id);
      } catch (error) {
        log.warn('Failed to create ephemeral identity', { error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  }

  // Generate memory namespace for session isolation
  // Use provided sessionId if available, otherwise generate a unique namespace based on agent ID
  const accessControl = getAccessControl();
  let memoryNamespace = options.sessionId
    ? accessControl.getSessionNamespace(options.sessionId)
    : accessControl.getSessionNamespace(id);  // Use agent ID as fallback for isolated namespace

  // AIG-649 wire-point: when a tenant context is active (either explicit on
  // SpawnOptions or set by the request handler via runWithTenantContext),
  // prefix the memory namespace so the agent cannot read another tenant's
  // session keys even if session ids happen to collide. We also fold the
  // tenant/workspace into the agent's metadata so persistence and resource
  // tracking can scope accordingly.
  const tenantCtx = options.tenantContext ?? getActiveTenantContext();
  if (tenantCtx) {
    memoryNamespace = `${workspaceNamespace(tenantCtx)}:${memoryNamespace}`;
  }

  const agent: SpawnedAgent = {
    id,
    type,
    name,
    status: 'idle',
    createdAt: new Date(),
    sessionId: options.sessionId,  // Keep optional - only set if explicitly provided
    memoryNamespace,
    metadata: tenantCtx
      ? {
          ...options.metadata,
          tenantId: tenantCtx.tenantId,
          workspaceId: tenantCtx.workspaceId,
        }
      : options.metadata,
    identityId,
  };

  activeAgents.set(id, agent);
  agentsByName.set(name, id);

  // Persist to database
  if (configRef) {
    try {
      const memoryManager = getMemoryManager(configRef);
      memoryManager.getStore().saveActiveAgent(agent);

      // Initialize resource exhaustion tracking if enabled
      if (configRef.resourceExhaustion?.enabled) {
        try {
          const resourceService = getResourceExhaustionService(
            memoryManager.getStore(),
            configRef.resourceExhaustion
          );
          resourceService.initializeAgent(id, type);
        } catch (error) {
          log.warn('Failed to initialize resource tracking', { id, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }
    } catch (error) {
      log.warn('Failed to persist agent', { id, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  log.info('Spawned agent', { id, type, name, identityId });
  if (configRef) {
    audit(configRef, 'agent.spawn', { agentId: id, type, name, identityId, sessionId: options.sessionId });
  }

  return agent;
}

/**
 * Get an agent by ID
 */
export function getAgent(id: string): SpawnedAgent | null {
  return activeAgents.get(id) ?? null;
}

/**
 * Get an agent by name
 */
export function getAgentByName(name: string): SpawnedAgent | null {
  const id = agentsByName.get(name);
  if (!id) return null;
  return activeAgents.get(id) ?? null;
}

/**
 * List all active agents
 */
export function listAgents(sessionId?: string): SpawnedAgent[] {
  const agents: SpawnedAgent[] = [];

  for (const agent of activeAgents.values()) {
    if (!sessionId || agent.sessionId === sessionId) {
      agents.push(agent);
    }
  }

  return agents;
}

/**
 * Update agent status
 */
export function updateAgentStatus(id: string, status: AgentStatus): boolean {
  const agent = activeAgents.get(id);
  if (!agent) return false;

  agent.status = status;

  // Persist to database
  if (configRef) {
    try {
      const memoryManager = getMemoryManager(configRef);
      memoryManager.getStore().updateAgentStatus(id, status);
    } catch (error) {
      log.warn('Failed to persist agent status', { id, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  log.debug('Updated agent status', { id, status });
  return true;
}

/**
 * Stop an agent
 */
export function stopAgent(id: string): boolean {
  const agent = activeAgents.get(id);
  if (!agent) return false;

  // Durable execution (AIG-633): emit a terminal checkpoint marking the
  // agent's completion. Under granularity='agent' this is the only
  // checkpoint produced for this agent — under 'step' it complements the
  // per-step checkpoints written from executeAgent().
  if (configRef) {
    saveCheckpointIfEnabled(
      configRef,
      agent.sessionId,
      id,
      null,
      { agentType: agent.type, name: agent.name, terminal: true, status: 'stopped' },
      undefined,
      'agent'
    );
  }

  agent.status = 'stopped';
  activeAgents.delete(id);
  agentsByName.delete(agent.name);

  // Deactivate identity (transition to dormant) if linked
  if (configRef && agent.identityId) {
    try {
      const identityService = getIdentityService(configRef);
      identityService.deactivateIdentity(agent.identityId);
    } catch (error) {
      log.warn('Failed to deactivate identity', { identityId: agent.identityId, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Delete from database
  if (configRef) {
    try {
      const memoryManager = getMemoryManager(configRef);
      memoryManager.getStore().deleteActiveAgent(id);

      // Clean up resource exhaustion tracking if enabled
      if (configRef.resourceExhaustion?.enabled) {
        const resourceService = getResourceExhaustionService(
          memoryManager.getStore(),
          configRef.resourceExhaustion
        );
        resourceService.cleanupAgent(id);
      }
    } catch (error) {
      log.warn('Failed to delete persisted agent', { id, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  log.info('Stopped agent', { id, name: agent.name, identityId: agent.identityId });
  if (configRef) {
    audit(configRef, 'agent.stop', { agentId: id, name: agent.name, identityId: agent.identityId });
  }
  return true;
}

/**
 * Stop an agent by name
 */
export function stopAgentByName(name: string): boolean {
  const id = agentsByName.get(name);
  if (!id) return false;
  return stopAgent(id);
}

/**
 * Stop all agents
 */
export function stopAllAgents(sessionId?: string): number {
  let stopped = 0;

  for (const [id, agent] of activeAgents) {
    if (!sessionId || agent.sessionId === sessionId) {
      stopAgent(id);
      stopped++;
    }
  }

  log.info('Stopped all agents', { count: stopped, sessionId });
  return stopped;
}

/**
 * Get agent count
 */
export function getAgentCount(sessionId?: string): number {
  if (!sessionId) {
    return activeAgents.size;
  }

  let count = 0;
  for (const agent of activeAgents.values()) {
    if (agent.sessionId === sessionId) {
      count++;
    }
  }
  return count;
}

/**
 * Get agents by status
 */
export function getAgentsByStatus(status: AgentStatus): SpawnedAgent[] {
  const agents: SpawnedAgent[] = [];

  for (const agent of activeAgents.values()) {
    if (agent.status === status) {
      agents.push(agent);
    }
  }

  return agents;
}

/**
 * Clear all agents (used for testing)
 */
export function clearAgents(): void {
  activeAgents.clear();
  agentsByName.clear();
}

/**
 * Get the prompt for an agent, ready to use with Claude Code Task tool
 */
export function getAgentPrompt(type: string): string | null {
  const definition = getAgentDefinition(type);
  if (!definition) return null;
  return definition.systemPrompt;
}

/**
 * Get agent capabilities
 */
export function getAgentCapabilities(type: string): string[] | null {
  const definition = getAgentDefinition(type);
  if (!definition) return null;
  return definition.capabilities;
}

export interface ExecuteOptions {
  provider?: string;
  model?: string;
  context?: string;
}

export interface ExecuteResult {
  agentId: string;
  response: string;
  model: string;
  duration: number;
}

/**
 * Execute a task with an agent using a CLI provider
 */
export async function executeAgent(
  agentId: string,
  task: string,
  config: AgentStackConfig,
  options: ExecuteOptions = {}
): Promise<ExecuteResult> {
  const agent = activeAgents.get(agentId);

  return traceAsync(config, 'aistack.agent.execute', {
    'agent.id': agentId,
    'agent.type': agent?.type,
    'agent.name': agent?.name,
    'session.id': agent?.sessionId,
    'llm.provider': options.provider ?? config.providers.default,
  }, async (span) => {
    const result = await executeAgentInternal(agentId, task, config, options);
    span?.setAttribute('agent.duration_ms', result.duration);
    span?.setAttribute('llm.response.model', result.model);
    return result;
  });
}

async function executeAgentInternal(
  agentId: string,
  task: string,
  config: AgentStackConfig,
  options: ExecuteOptions = {}
): Promise<ExecuteResult> {
  const agent = activeAgents.get(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const definition = getAgentDefinition(agent.type);
  if (!definition) {
    throw new Error(`Agent definition not found: ${agent.type}`);
  }

  // Check resource exhaustion state
  if (config.resourceExhaustion?.enabled) {
    try {
      const memoryManager = getMemoryManager(config);
      const resourceService = getResourceExhaustionService(
        memoryManager.getStore(),
        config.resourceExhaustion
      );

      // Check if agent is paused
      const metrics = resourceService.getAgentMetrics(agentId);
      if (metrics?.pausedAt) {
        throw new Error(`Agent ${agentId} is paused: ${metrics.pauseReason ?? 'Resource limits exceeded'}`);
      }

      // Evaluate current phase before execution
      const phase = resourceService.evaluateAgent(agentId);
      if (phase === 'intervention' && config.resourceExhaustion.pauseOnIntervention) {
        throw new Error(`Agent ${agentId} is paused due to resource exhaustion`);
      }
    } catch (error) {
      // Re-throw pause errors, log others
      if (error instanceof Error && error.message.includes('paused')) {
        throw error;
      }
      log.warn('Failed to check resource state', { agentId, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  // Get the provider
  const providerName = options.provider ?? config.providers.default;
  const provider = getProvider(providerName, config);

  if (!provider) {
    throw new Error(`Provider '${providerName}' is not configured`);
  }

  // Check if CLI provider is available
  if (provider instanceof ClaudeCodeProvider || provider instanceof GeminiCLIProvider || provider instanceof CodexProvider) {
    if (!provider.isAvailable()) {
      throw new Error(`Provider '${providerName}' CLI is not installed or not available`);
    }
  }

  // Build messages
  const messages: ChatMessage[] = [
    { role: 'system', content: definition.systemPrompt },
  ];

  // Add context if provided
  if (options.context) {
    messages.push({ role: 'user', content: `Context:\n${options.context}` });
    messages.push({ role: 'assistant', content: 'I understand the context. What would you like me to do?' });
  }

  // Add the task
  messages.push({ role: 'user', content: task });

  // Update agent status
  updateAgentStatus(agentId, 'running');
  const startTime = Date.now();

  // Cost governance (AIG-867): attribution metadata for budgets + spend.
  // Folded into the agent metadata at spawn (tenantId/workspaceId); project is
  // an optional free-form label passed via spawn metadata. All optional — falls
  // back to default buckets when single-tenant.
  const govTenantId =
    typeof agent.metadata?.tenantId === 'string' ? agent.metadata.tenantId : undefined;
  const govWorkspaceId =
    typeof agent.metadata?.workspaceId === 'string'
      ? agent.metadata.workspaceId
      : undefined;
  const govProject =
    typeof agent.metadata?.project === 'string' ? agent.metadata.project : undefined;

  try {
    // Pre-call budget check. No-op when governance is disabled. Throws
    // CostBudgetExceededError BEFORE the LLM call only when enforce.block is on
    // and the budget is at 100%; warn/observe modes never throw.
    getGovernanceService(config)?.checkBudget({
      tenantId: govTenantId,
      workspaceId: govWorkspaceId,
      project: govProject,
      agentType: agent.type,
    });

    log.info('Executing agent task', { agentId, type: agent.type, provider: providerName });

    const response = await traceAsync(config, 'aistack.llm.chat', {
      'agent.id': agentId,
      'agent.type': agent.type,
      'llm.provider': providerName,
      'llm.request.model': options.model,
      'llm.request.messages': messages.length,
    }, async (span) => {
      const chatResponse = await provider.chat(messages, { model: options.model });
      span?.setAttribute('llm.response.model', chatResponse.model);
      if (chatResponse.usage) {
        span?.setAttribute('llm.usage.input_tokens', chatResponse.usage.inputTokens);
        span?.setAttribute('llm.usage.output_tokens', chatResponse.usage.outputTokens);
        span?.setAttribute(
          'llm.usage.total_tokens',
          chatResponse.usage.inputTokens + chatResponse.usage.outputTokens
        );
      }
      return chatResponse;
    });

    const duration = Date.now() - startTime;
    updateAgentStatus(agentId, 'idle');

    // Record API call for resource tracking
    if (config.resourceExhaustion?.enabled) {
      try {
        const memoryManager = getMemoryManager(config);
        const resourceService = getResourceExhaustionService(
          memoryManager.getStore(),
          config.resourceExhaustion
        );

        const totalTokens = response.usage
          ? response.usage.inputTokens + response.usage.outputTokens
          : undefined;
        resourceService.recordApiCall(agentId, totalTokens);

        // Re-evaluate phase after API call
        resourceService.evaluateAgent(agentId);
      } catch (error) {
        log.warn('Failed to record API call', { agentId, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }

    // Cost governance (AIG-867): post-call accounting. PRIMARY attribution site
    // (single point with llm.usage.*) — avoids double counting from review-loop
    // / consensus spans. No-op when governance is disabled or usage is absent
    // (CLI providers may not return usage). recordSpend never throws.
    if (response.usage) {
      try {
        getGovernanceService(config)?.recordSpend({
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          provider: providerName,
          model: response.model ?? options.model ?? 'unknown',
          agentType: agent.type,
          tenantId: govTenantId,
          workspaceId: govWorkspaceId,
          project: govProject,
        });
      } catch (error) {
        log.warn('Failed to record spend', { agentId, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }

    log.info('Agent task completed', { agentId, duration, model: response.model });

    // Durable execution (AIG-633): snapshot agent state after a successful step.
    // No-op when `config.checkpointing.enabled` is false or there's no sessionId.
    // When config.checkpointing.granularity === 'agent', this 'step' call is
    // skipped — only stopAgent() emits a checkpoint per full agent lifecycle.
    // Passing `null` as stepId lets saveCheckpointIfEnabled assign a
    // deterministic monotonic id of the form `${sessionId}:${agentId}:N`,
    // which keeps Checkpointer.loadByStep() usable for replay.
    saveCheckpointIfEnabled(
      config,
      agent.sessionId,
      agentId,
      null,
      { agentType: agent.type, task, response: response.content, model: response.model, duration },
      undefined,
      'step'
    );

    return {
      agentId,
      response: response.content,
      model: response.model,
      duration,
    };
  } catch (error) {
    updateAgentStatus(agentId, 'failed');
    log.error('Agent task failed', {
      agentId,
      error: error instanceof Error ? error.message : String(error)
    });
    audit(config, 'agent.error', { agentId, type: agent.type, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Spawn and execute in one step (convenience function)
 */
export async function runAgent(
  type: string,
  task: string,
  config: AgentStackConfig,
  options: SpawnOptions & ExecuteOptions = {}
): Promise<ExecuteResult> {
  const agent = spawnAgent(type, options, config);

  try {
    return await executeAgent(agent.id, task, config, options);
  } finally {
    // Optionally stop agent after execution
    // stopAgent(agent.id);
  }
}

/**
 * Restore active agents from database
 * Should be called on startup to recover from crashes
 */
export function restoreAgents(config: AgentStackConfig): number {
  try {
    const memoryManager = getMemoryManager(config);
    const persistedAgents = memoryManager.getStore().loadActiveAgents();

    if (!configRef) {
      configRef = config;
    }

    let restored = 0;
    for (const agent of persistedAgents) {
      // Only restore if not already in memory
      if (!activeAgents.has(agent.id)) {
        activeAgents.set(agent.id, agent);
        agentsByName.set(agent.name, agent.id);
        restored++;
      }
    }

    log.info('Restored agents from database', { count: restored });
    return restored;
  } catch (error) {
    log.error('Failed to restore agents', { error: error instanceof Error ? error.message : 'Unknown error' });
    return 0;
  }
}

/**
 * Get concurrency statistics
 */
export function getConcurrencyStats(): {
  agents: {
    active: number;
    maxConcurrent: number;
    byType: Record<string, number>;
  };
  semaphore: {
    available: number;
    maxPermits: number;
    queued: number;
  };
  pool: Record<string, { total: number; inUse: number; available: number }>;
} {
  const byType: Record<string, number> = {};
  for (const agent of activeAgents.values()) {
    byType[agent.type] = (byType[agent.type] || 0) + 1;
  }

  return {
    agents: {
      active: activeAgents.size,
      maxConcurrent: 20,
      byType,
    },
    semaphore: agentSemaphore.getState(),
    pool: agentPool.getStats(),
  };
}

/**
 * Pause an agent due to resource exhaustion
 */
export async function pauseAgent(agentId: string, reason: string): Promise<boolean> {
  if (!configRef?.resourceExhaustion?.enabled) {
    log.warn('Resource exhaustion not enabled, cannot pause agent', { agentId });
    return false;
  }

  try {
    const memoryManager = getMemoryManager(configRef);
    const resourceService = getResourceExhaustionService(
      memoryManager.getStore(),
      configRef.resourceExhaustion
    );
    return resourceService.pauseAgent(agentId, reason);
  } catch (error) {
    log.error('Failed to pause agent', { agentId, error: error instanceof Error ? error.message : 'Unknown error' });
    return false;
  }
}

/**
 * Resume a paused agent
 */
export function resumeAgent(agentId: string): boolean {
  if (!configRef?.resourceExhaustion?.enabled) {
    log.warn('Resource exhaustion not enabled, cannot resume agent', { agentId });
    return false;
  }

  try {
    const memoryManager = getMemoryManager(configRef);
    const resourceService = getResourceExhaustionService(
      memoryManager.getStore(),
      configRef.resourceExhaustion
    );
    return resourceService.resumeAgent(agentId);
  } catch (error) {
    log.error('Failed to resume agent', { agentId, error: error instanceof Error ? error.message : 'Unknown error' });
    return false;
  }
}

/**
 * Check if an agent is paused
 */
export function isAgentPaused(agentId: string): boolean {
  if (!configRef?.resourceExhaustion?.enabled) {
    return false;
  }

  try {
    const memoryManager = getMemoryManager(configRef);
    const resourceService = getResourceExhaustionService(
      memoryManager.getStore(),
      configRef.resourceExhaustion
    );
    return resourceService.isAgentPaused(agentId);
  } catch {
    return false;
  }
}
