/**
 * Agents module exports
 */

export {
  getAgentDefinition,
  listAgentTypes,
  listAgentDefinitions,
  registerAgent,
  unregisterAgent,
  hasAgentType,
  getAgentCount as getRegisteredAgentCount,
  clearCustomAgents,
} from './registry.js';

export {
  spawnAgent,
  getAgent,
  getAgentByName,
  listAgents,
  updateAgentStatus,
  stopAgent,
  stopAgentByName,
  stopAllAgents,
  getAgentCount as getActiveAgentCount,
  getAgentsByStatus,
  clearAgents,
  getAgentPrompt,
  getAgentCapabilities,
  type SpawnOptions,
} from './spawner.js';

export * from './definitions/index.js';
