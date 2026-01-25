/**
 * Agent type registry - manages core and custom agent definitions
 */

import type { AgentDefinition, AgentType } from '../types.js';
import {
  coderAgent,
  researcherAgent,
  testerAgent,
  reviewerAgent,
  adversarialAgent,
  architectAgent,
  coordinatorAgent,
  analystAgent,
} from './definitions/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child('registry');

// Core agent types
const CORE_AGENTS: Map<AgentType, AgentDefinition> = new Map([
  ['coder', coderAgent],
  ['researcher', researcherAgent],
  ['tester', testerAgent],
  ['reviewer', reviewerAgent],
  ['adversarial', adversarialAgent],
  ['architect', architectAgent],
  ['coordinator', coordinatorAgent],
  ['analyst', analystAgent],
]);

// Custom agents from plugins
const customAgents: Map<string, AgentDefinition> = new Map();

/**
 * Get an agent definition by type
 */
export function getAgentDefinition(type: string): AgentDefinition | null {
  // Check core agents first
  const coreAgent = CORE_AGENTS.get(type as AgentType);
  if (coreAgent) {
    return coreAgent;
  }

  // Check custom agents
  return customAgents.get(type) ?? null;
}

/**
 * List all available agent types
 */
export function listAgentTypes(): string[] {
  const types: string[] = [];

  for (const type of CORE_AGENTS.keys()) {
    types.push(type);
  }

  for (const type of customAgents.keys()) {
    types.push(type);
  }

  return types;
}

/**
 * List all agent definitions
 */
export function listAgentDefinitions(): AgentDefinition[] {
  const definitions: AgentDefinition[] = [];

  for (const def of CORE_AGENTS.values()) {
    definitions.push(def);
  }

  for (const def of customAgents.values()) {
    definitions.push(def);
  }

  return definitions;
}

/**
 * Register a custom agent type from a plugin
 */
export function registerAgent(definition: AgentDefinition): void {
  if (CORE_AGENTS.has(definition.type as AgentType)) {
    log.warn('Cannot override core agent type', { type: definition.type });
    return;
  }

  if (customAgents.has(definition.type)) {
    log.warn('Overwriting existing custom agent', { type: definition.type });
  }

  customAgents.set(definition.type, definition);
  log.info('Registered custom agent', { type: definition.type });
}

/**
 * Unregister a custom agent type
 */
export function unregisterAgent(type: string): boolean {
  if (CORE_AGENTS.has(type as AgentType)) {
    log.warn('Cannot unregister core agent type', { type });
    return false;
  }

  const deleted = customAgents.delete(type);
  if (deleted) {
    log.info('Unregistered custom agent', { type });
  }
  return deleted;
}

/**
 * Check if an agent type exists
 */
export function hasAgentType(type: string): boolean {
  return CORE_AGENTS.has(type as AgentType) || customAgents.has(type);
}

/**
 * Get the count of registered agents
 */
export function getAgentCount(): { core: number; custom: number; total: number } {
  return {
    core: CORE_AGENTS.size,
    custom: customAgents.size,
    total: CORE_AGENTS.size + customAgents.size,
  };
}

/**
 * Clear all custom agents (used for testing)
 */
export function clearCustomAgents(): void {
  customAgents.clear();
}
