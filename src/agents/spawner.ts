/**
 * Agent spawner - manages running agents
 */

import { randomUUID } from 'node:crypto';
import type { SpawnedAgent, AgentStatus, AgentStackConfig } from '../types.js';
import { getAgentDefinition, hasAgentType } from './registry.js';
import { logger } from '../utils/logger.js';

const log = logger.child('spawner');

// Active agents
const activeAgents: Map<string, SpawnedAgent> = new Map();

// Agent by name index for quick lookup
const agentsByName: Map<string, string> = new Map();

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
  _config?: AgentStackConfig
): SpawnedAgent {
  if (!hasAgentType(type)) {
    throw new Error(`Unknown agent type: ${type}`);
  }

  const definition = getAgentDefinition(type);
  if (!definition) {
    throw new Error(`Agent definition not found: ${type}`);
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
