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
  ReviewLoopCoordinator,
  ReviewLoopGuardrailError,
  createReviewLoop,
  getReviewLoop,
  listReviewLoops,
  abortReviewLoop,
  clearReviewLoops,
  interrupt,
  applyStateEdit,
  getInterruptStore,
  resetInterruptStore,
  resumeInterrupt,
  resumeLatestForSession,
  setInterruptPersistence,
  InterruptPending,
  InterruptTimeoutError,
  InterruptValidationError,
  InterruptNoListenerError,
  type QueuedTask,
  type Message,
  type CoordinatorOptions,
  type ReviewLoopOptions,
  type InterruptPersistence,
  type InterruptOptions,
  type InterruptRecord,
  type InterruptStatus,
  type InterruptValueSchema,
  type InterruptNotifyChannel,
  type ResumePayload,
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
  workflowHook,
  registerWorkflowTrigger,
  unregisterWorkflowTrigger,
  getWorkflowTriggers,
  clearWorkflowTriggers,
  registerDefaultTriggers,
  type WorkflowTrigger,
} from './hooks/index.js';

// GitHub
export {
  GitHubClient,
  createGitHubClient,
} from './github/index.js';

// Observability
export {
  initializeTracing,
  isTracingEnabled,
  sanitizeSpanAttributes,
  shutdownTracing,
  traceAsync,
  traceSync,
} from './observability/index.js';

// Workflows
export {
  // Types
  type WorkflowPhase,
  type Severity,
  type Verdict,
  type WorkflowAgent,
  type Finding,
  type PhaseResult,
  type WorkflowConfig,
  type WorkflowContext,
  type DocumentInfo,
  type DocumentType,
  type SyncResult,
  type DocumentChange,
  type DiagramUpdate,
  type WorkflowReport,
  type PhaseExecutor,
  type WorkflowEvents,
  // Runner
  WorkflowRunner,
  getWorkflowRunner,
  resetWorkflowRunner,
  // Doc Sync
  docSyncConfig,
  registerDocSyncWorkflow,
  runDocSync,
} from './workflows/index.js';

// Sandbox (AIG-634)
export {
  createSandbox,
  DEFAULT_SANDBOX_CONFIG,
  DockerSandbox,
  E2BSandbox,
  DaytonaSandbox,
  NoopSandbox,
  buildDockerArgs,
  SandboxError,
  SandboxPolicyError,
  SandboxUnavailableError,
  type SandboxAdapter,
  type SandboxOptions,
  type SandboxResult,
  type SandboxLanguage,
  type SandboxProvider,
  type ResolvedSandboxConfig,
} from './sandbox/index.js';

// Web Server
export {
  WebServer,
  startWebServer,
  stopWebServer,
  getWebServer,
  defaultWebConfig,
  agentEvents,
  getEventBridge,
  type WebConfig,
} from './web/index.js';

// Guardrails (AIG-645 engine, AIG-868 wiring)
export {
  // Engine
  runGuardrails,
  withGuardrails,
  initGuardrails,
  GuardrailBlockedError,
  // Built-ins
  secretsGuardrail,
  piiGuardrail,
  promptInjectionGuardrail,
  zodSchemaGuardrail,
  // Registry
  defaultRegistry,
  getGuardrailRegistry,
  loadCustomGuardrails,
  registerGuardrail,
  resetGuardrailRegistry,
  // Types
  type Guardrail,
  type GuardrailContext,
  type GuardrailDirection,
  type GuardrailFailure,
  type GuardrailRegistry,
  type GuardrailResult,
  type GuardrailRunOptions,
  type GuardrailRunOutcome,
  type GuardrailSeverity,
  type GuardrailAuditEvent,
  type WithGuardrailsOptions,
} from './guardrails/index.js';

// Cost Governance (AIG-867)
export {
  // Facade
  initGovernance,
  getGovernanceService,
  recordSpend,
  resetGovernanceService,
  // Core
  GovernanceService,
  CostBudgetExceededError,
  CostAggregator,
  BudgetEnforcer,
  windowStart,
  // Price table
  DEFAULT_PRICE_TABLE,
  resolvePrice,
  estimateUsdCost,
  mergePriceTable,
  DEFAULT_BUCKET,
  // Types
  type GovernanceConfig,
  type GovernanceEnforceConfig,
  type CostBudget,
  type CostBudgetScope,
  type BudgetWindow,
  type BudgetState,
  type BudgetEvaluation,
  type BudgetCheckContext,
  type ModelPrice,
  type PriceTable,
  type SpendDimension,
  type SpendRecord,
  type SpendReport,
  type SpendReportRow,
  type SpendQuery,
  type RecordSpendInput,
} from './governance/index.js';
