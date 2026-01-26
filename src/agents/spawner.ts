/**
 * Agent spawner - manages running agents
 */

import { randomUUID } from 'node:crypto';
import type { SpawnedAgent, AgentStatus, AgentStackConfig, ChatMessage } from '../types.js';
import { getAgentDefinition, hasAgentType } from './registry.js';
import { getProvider } from '../providers/index.js';
import { ClaudeCodeProvider, GeminiCLIProvider, CodexProvider } from '../providers/cli-providers.js';
import { logger } from '../utils/logger.js';
import { getMemoryManager } from '../memory/index.js';
import { Semaphore, AgentPool } from '../utils/semaphore.js';

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
}

/**
 * Spawn a new agent
 */
export function spawnAgent(
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

  const agent: SpawnedAgent = {
    id,
    type,
    name,
    status: 'idle',
    createdAt: new Date(),
    sessionId: options.sessionId,
    metadata: options.metadata,
  };

  activeAgents.set(id, agent);
  agentsByName.set(name, id);

  // Persist to database
  if (configRef) {
    try {
      const memoryManager = getMemoryManager(configRef);
      memoryManager.getStore().saveActiveAgent(agent);
    } catch (error) {
      log.warn('Failed to persist agent', { id, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  log.info('Spawned agent', { id, type, name });

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

  agent.status = 'stopped';
  activeAgents.delete(id);
  agentsByName.delete(agent.name);

  // Delete from database
  if (configRef) {
    try {
      const memoryManager = getMemoryManager(configRef);
      memoryManager.getStore().deleteActiveAgent(id);
    } catch (error) {
      log.warn('Failed to delete persisted agent', { id, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  log.info('Stopped agent', { id, name: agent.name });
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
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const definition = getAgentDefinition(agent.type);
  if (!definition) {
    throw new Error(`Agent definition not found: ${agent.type}`);
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

  try {
    log.info('Executing agent task', { agentId, type: agent.type, provider: providerName });

    const response = await provider.chat(messages, { model: options.model });

    const duration = Date.now() - startTime;
    updateAgentStatus(agentId, 'idle');

    log.info('Agent task completed', { agentId, duration, model: response.model });

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
