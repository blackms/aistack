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
  devopsAgent,
  documentationAgent,
  securityAuditorAgent,
} from './definitions/index.js';
import { graderAgent } from './definitions/grader.js';
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
  ['devops', devopsAgent],
  ['documentation', documentationAgent],
  ['security-auditor', securityAuditorAgent],
  // 'grader' is registered as an extended core type via string cast to avoid
  // widening the AgentType union; consumers use 'grader' as plain string.
  ['grader' as AgentType, graderAgent],
]);

// Custom agents from plugins
const customAgents: Map<string, AgentDefinition> = new Map();

/**
 * Allowed shape for agent type identifiers.
 *
 * Enforced on `registerAgent` to prevent malicious plugins from supplying
 * types that break downstream consumers:
 *   - path traversal in `exportAllAgents` (the type is interpolated into a
 *     filename via `join(outputDir, ...)`, so values like `../../evil` would
 *     escape the output directory)
 *   - YAML injection in `exportAgentToMarkdown` (the type is interpolated
 *     unquoted into the `name:` frontmatter field, so values containing `:`,
 *     newlines, etc. could inject forbidden keys like `hooks`, `mcpServers`,
 *     `permissionMode`)
 *
 * Matches the kebab-case convention already used by all core agents
 * (`coder`, `security-auditor`, …).
 */
const AGENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

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
  const { type } = definition;

  if (typeof type !== 'string' || !AGENT_TYPE_PATTERN.test(type)) {
    throw new Error(
      `Invalid agent type "${String(type)}": must match /^[a-z0-9][a-z0-9-]*$/`,
    );
  }

  if (CORE_AGENTS.has(type as AgentType)) {
    log.warn('Cannot override core agent type', { type });
    return;
  }

  if (customAgents.has(type)) {
    log.warn('Overwriting existing custom agent', { type });
  }

  customAgents.set(type, definition);
  log.info('Registered custom agent', { type });
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
