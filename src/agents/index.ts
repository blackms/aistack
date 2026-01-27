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
  executeAgent,
  runAgent,
  type SpawnOptions,
  type ExecuteOptions,
  type ExecuteResult,
} from './spawner.js';

export {
  IdentityService,
  getIdentityService,
  resetIdentityService,
  type CreateIdentityOptions,
  type ListIdentitiesFilters,
} from './identity-service.js';

export * from './definitions/index.js';
