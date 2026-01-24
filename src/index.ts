/**
 * agentstack - Clean agent orchestration for Claude Code
 *
 * @packageDocumentation
 */

// Types
export * from './types.js';

// Utils
export {
  logger,
  createLogger,
  loadConfig,
  getConfig,
  getDefaultConfig,
  saveConfig,
  validateConfig,
  resetConfig,
  createEmbeddingProvider,
  cosineSimilarity,
  normalizeVector,
} from './utils/index.js';

// Memory
export {
  MemoryManager,
  SQLiteStore,
  FTSSearch,
  VectorSearch,
  getMemoryManager,
  resetMemoryManager,
} from './memory/index.js';

// Agents
export {
  // Registry
  getAgentDefinition,
  listAgentTypes,
  listAgentDefinitions,
  registerAgent,
  unregisterAgent,
  hasAgentType,
  getRegisteredAgentCount,
  clearCustomAgents,
  // Spawner
  spawnAgent,
  getAgent,
  getAgentByName,
  listAgents,
  stopAgent,
  stopAgentByName,
  stopAllAgents,
  updateAgentStatus,
  getActiveAgentCount,
  getAgentsByStatus,
  clearAgents,
  getAgentPrompt,
  getAgentCapabilities,
  // Definitions
  coderAgent,
  researcherAgent,
  testerAgent,
  reviewerAgent,
  architectAgent,
  coordinatorAgent,
  analystAgent,
} from './agents/index.js';

// Providers
export {
  AnthropicProvider,
  OpenAIProvider,
  OllamaProvider,
  createProvider,
  registerProvider,
  getProvider,
} from './providers/index.js';

// MCP
export {
  MCPServer,
  startMCPServer,
} from './mcp/index.js';

// Coordination
export {
  TaskQueue,
  MessageBus,
  getMessageBus,
  resetMessageBus,
  HierarchicalCoordinator,
} from './coordination/index.js';

// Plugins
export {
  loadPlugin,
  discoverPlugins,
  getPlugin,
  listPlugins,
  unloadPlugin,
  getPluginCount,
} from './plugins/index.js';

// Hooks
export {
  executeHooks,
  registerHook,
  unregisterHooks,
  clearCustomHooks,
  getHookCount,
} from './hooks/index.js';

// GitHub
export {
  GitHubClient,
  createGitHubClient,
} from './github/index.js';
