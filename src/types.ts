/**
 * Core types for agentstack
 */

// Agent types
export type AgentType =
  | 'coder'
  | 'researcher'
  | 'tester'
  | 'reviewer'
  | 'adversarial'
  | 'architect'
  | 'coordinator'
  | 'analyst'
  | 'devops'
  | 'documentation'
  | 'security-auditor'
  | 'grader';

export interface AgentDefinition {
  type: AgentType | string;
  name: string;
  description: string;
  systemPrompt: string;
  capabilities: string[];
}

export interface SpawnedAgent {
  id: string;
  type: AgentType | string;
  name: string;
  status: AgentStatus;
  createdAt: Date;
  sessionId?: string;
  memoryNamespace?: string;  // Session-based memory namespace for isolation
  metadata?: Record<string, unknown>;
  identityId?: string;  // Link to persistent AgentIdentity
}

export type AgentStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stopped';

// Memory types
export type MemoryRelationshipType =
  | 'related_to'
  | 'derived_from'
  | 'references'
  | 'depends_on'
  | 'supersedes'
  | 'conflicts_with'
  | 'validates';

export interface MemoryRelationship {
  id: string;
  fromId: string;
  toId: string;
  relationshipType: MemoryRelationshipType;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface MemoryVersion {
  id: string;
  memoryId: string;
  version: number;
  key: string;
  namespace: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface MemoryEntry {
  id: string;
  key: string;
  namespace: string;
  content: string;
  embedding?: Float32Array;
  metadata?: Record<string, unknown>;
  tags?: string[];
  relationships?: MemoryRelationship[];
  version?: number;
  agentId?: string;  // Agent ownership for scoped memory
  createdAt: Date;
  updatedAt: Date;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  matchType: 'fts' | 'vector' | 'exact';
}

export interface MemoryStoreOptions {
  namespace?: string;
  metadata?: Record<string, unknown>;
  generateEmbedding?: boolean;
  agentId?: string;  // Associate memory with a specific agent
}

export interface MemorySearchOptions {
  namespace?: string;
  limit?: number;
  threshold?: number;
  useVector?: boolean;
  agentId?: string;       // Filter by agent ownership
  includeShared?: boolean; // Include shared memory (agent_id = NULL), default true
}

// Session types
export interface Session {
  id: string;
  status: SessionStatus;
  startedAt: Date;
  endedAt?: Date;
  metadata?: Record<string, unknown>;
}

export type SessionStatus = 'active' | 'ended' | 'error';

// Task types
export interface Task {
  id: string;
  sessionId?: string;
  agentType: AgentType | string;
  status: TaskStatus;
  input?: string;
  output?: string;
  createdAt: Date;
  completedAt?: Date;
  riskLevel?: TaskRiskLevel;
  consensusCheckpointId?: string;
  parentTaskId?: string;
  depth?: number;
}

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

// Task Risk Levels and Consensus Types
export type TaskRiskLevel = 'low' | 'medium' | 'high';
export type ConsensusStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type ReviewerStrategy = 'adversarial' | 'different-model' | 'human';

// Consensus Configuration
export interface ConsensusConfig {
  enabled: boolean;
  requireForRiskLevels: TaskRiskLevel[];
  reviewerStrategy: ReviewerStrategy;
  timeout: number;
  maxDepth: number;
  autoReject: boolean;
  // Risk estimation configuration
  highRiskAgentTypes?: string[];
  mediumRiskAgentTypes?: string[];
  highRiskPatterns?: string[];
  mediumRiskPatterns?: string[];
}

// Consensus Checkpoint
export interface ConsensusCheckpoint {
  id: string;
  taskId: string;
  parentTaskId?: string;
  proposedSubtasks: ProposedSubtask[];
  riskLevel: TaskRiskLevel;
  status: ConsensusStatus;
  reviewerStrategy: ReviewerStrategy;
  reviewerId?: string;
  reviewerType?: 'agent' | 'human';
  decision?: ConsensusDecision;
  createdAt: Date;
  expiresAt: Date;
  decidedAt?: Date;
}

export interface ProposedSubtask {
  id: string;
  agentType: string;
  input: string;
  estimatedRiskLevel: TaskRiskLevel;
  parentTaskId: string;
}

export interface ConsensusDecision {
  approved: boolean;
  rejectedSubtaskIds?: string[];
  feedback?: string;
  reviewedBy: string;
  reviewerType: 'agent' | 'human';
}

// Project types
export interface Project {
  id: string;
  name: string;
  description?: string;
  path: string;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

export type ProjectStatus = 'active' | 'archived';

// Project Task types
export interface ProjectTask {
  id: string;
  projectId: string;
  sessionId?: string;
  title: string;
  description?: string;
  phase: TaskPhase;
  priority: number;
  assignedAgents: string[];
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export type TaskPhase = 'draft' | 'specification' | 'review' | 'development' | 'completed' | 'cancelled';

// Specification types
export interface Specification {
  id: string;
  projectTaskId: string;
  type: SpecificationType;
  title: string;
  content: string;
  version: number;
  status: SpecificationStatus;
  createdBy: string;
  reviewedBy?: string;
  createdAt: Date;
  updatedAt: Date;
  approvedAt?: Date;
  comments?: ReviewComment[];
}

export type SpecificationType = 'architecture' | 'requirements' | 'design' | 'api' | 'other';
export type SpecificationStatus = 'draft' | 'pending_review' | 'approved' | 'rejected';

export interface ReviewComment {
  id: string;
  author: string;
  content: string;
  createdAt: Date;
  resolved?: boolean;
}

// Filesystem types
export interface FileSystemEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileSystemEntry[];
}

// Phase transition rules
export const PHASE_TRANSITIONS: Record<TaskPhase, TaskPhase[]> = {
  draft: ['specification', 'cancelled'],
  specification: ['review', 'cancelled'],
  review: ['specification', 'development', 'cancelled'],
  development: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

// Provider types
export interface LLMProvider {
  name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  embed?(text: string): Promise<number[]>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// Plugin types
export interface AgentStackPlugin {
  name: string;
  version: string;
  description?: string;
  agents?: AgentDefinition[];
  tools?: MCPToolDefinition[];
  hooks?: HookDefinition[];
  providers?: ProviderDefinition[];
  init?(config: AgentStackConfig): Promise<void>;
  cleanup?(): Promise<void>;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface HookDefinition {
  name: string;
  event: HookEvent;
  handler: (context: HookContext) => Promise<void>;
}

export type HookEvent = 'session-start' | 'session-end' | 'pre-task' | 'post-task' | 'workflow';

export interface HookContext {
  event: HookEvent;
  sessionId?: string;
  taskId?: string;
  agentType?: AgentType | string;
  data?: Record<string, unknown>;
}

export interface ProviderDefinition {
  name: string;
  factory: (config: Record<string, unknown>) => LLMProvider;
}

// Configuration types
export interface AgentStackConfig {
  version: string;
  memory: MemoryConfig;
  providers: ProvidersConfig;
  agents: AgentsConfig;
  github: GitHubConfig;
  plugins: PluginsConfig;
  mcp: MCPConfig;
  hooks: HooksConfig;
  slack?: SlackConfig;
  driftDetection?: DriftDetectionConfig;
  resourceExhaustion?: ResourceExhaustionConfig;
  consensus?: ConsensusConfig;
  smartDispatcher?: SmartDispatcherConfig;
  a2a?: A2AConfig;
  multitenancy?: MultitenancyConfig;
  daemon?: DaemonConfig;
  telemetry?: TelemetryConfig;
  audit?: AuditConfig;
  checkpointing?: CheckpointingConfig;
  sandbox?: SandboxConfig;
  integrations?: IntegrationsConfig;
  guardrails?: GuardrailsConfig;
  /** Authentication config (extended for SSO via auth.sso sub-field). AIG-646. */
  auth?: AuthConfig;
  federation?: FederationConfig;
}

// A2A (Agent-to-Agent) protocol config
export interface A2AConfig {
  enabled: boolean;
  port?: number;
  host?: string;
  publicUrl?: string;
  bearerToken?: string;
  exposedAgents?: string[];
}

// Multi-tenancy configuration (AIG-649)
export interface MultitenancyConfig {
  enabled: boolean;
  defaultTenantSlug: string;
  defaultWorkspaceSlug: string;
}

// AIG-636 — daemon (background headless runner) config. Optional sibling field.
export interface DaemonConfig {
  enabled: boolean;
  dataDir?: string;
  queueBackend: 'file' | 'redis';
  redisUrl?: string;
  webhook: {
    enabled: boolean;
    port: number;
    host: string;
    hmacSecret?: string;
  };
  maxConcurrent: number;
  pollIntervalMs: number;
  logRotationBytes: number;
}

/**
 * Opt-in anonymous telemetry configuration (AIG-655).
 *
 * Privacy-first: disabled by default. When enabled, the client posts
 * anonymized usage events (e.g. review_loop.completed, agent.spawned)
 * to a configurable endpoint. See docs/TELEMETRY.md for full policy.
 */
export interface TelemetryConfig {
  enabled: boolean;
  endpoint?: string;
  anonymizeSessionId?: boolean;
  flushIntervalMs?: number;
  batchSize?: number;
}

// Audit log configuration (AIG-635 — hash-chained immutable audit trail)
export interface AuditConfig {
  enabled: boolean;
  /** Override the audit DB path. Defaults to `<memory.path>.audit.db`. */
  path?: string;
  /**
   * HMAC-SHA256 signing key (>=32 bytes). Prefer the `AISTACK_AUDIT_KEY` env
   * var over inlining this in config files; never commit a real key to git.
   */
  signatureKey?: string;
  /** Days to retain entries before manual rotation. Informational only — the chain itself is append-only. */
  retentionDays?: number;
  /** Top-level payload fields to redact before hashing/storage (PII / secrets). */
  redactFields?: string[];
}

/**
 * Durable execution / checkpointing configuration.
 *
 * Controls whether agent state is serialized to `agent_checkpoints` after
 * each step so that workflows can be resumed via
 * `aistack workflow resume <session-id>` after a crash.
 *
 * @property enabled - Master switch. When false, all checkpoint writes are no-ops.
 * @property granularity - 'step' writes after each agent step (fine-grained,
 *   higher resume fidelity); 'agent' writes only at agent completion (cheaper).
 *   Default: 'step'.
 * @property retentionPerSession - Keep only the latest N checkpoints per session.
 *   Older rows are pruned best-effort after each save. Default: 50.
 *   Set to 0 to disable pruning.
 */
export interface CheckpointingConfig {
  enabled: boolean;
  granularity?: 'step' | 'agent';
  retentionPerSession?: number;
}

export interface SandboxConfig {
  provider: 'none' | 'docker' | 'e2b' | 'daytona';
  timeout: number;
  memoryMb: number;
  cpus: number;
  pidsLimit: number;
  network: boolean;
  images?: {
    python?: string;
    javascript?: string;
    typescript?: string;
    bash?: string;
  };
  e2bApiKey?: string;
  daytonaApiUrl?: string;
  daytonaApiKey?: string;
}

// Battle pack integrations (top-5 MCP servers)
// See src/integrations/ for adapter implementations.
export interface IntegrationsConfig {
  postgres?: PostgresIntegrationConfig;
  githubRemote?: GithubRemoteIntegrationConfig;
  sentry?: SentryIntegrationConfig;
  playwright?: PlaywrightIntegrationConfig;
  slack?: SlackMcpIntegrationConfig;
}

export interface PostgresIntegrationConfig {
  enabled?: boolean;
  connectionString?: string;
  packageName?: string;
  /** Default false. When false, the Postgres connection is forced read-only. */
  allowWrites?: boolean;
}

export interface GithubRemoteIntegrationConfig {
  enabled?: boolean;
  token?: string;
  toolsets?: string[];
  image?: string;
}

export interface SentryIntegrationConfig {
  enabled?: boolean;
  authToken?: string;
  organization?: string;
  host?: string;
  packageName?: string;
}

export interface PlaywrightIntegrationConfig {
  enabled?: boolean;
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  userDataDir?: string;
  packageName?: string;
}

export interface SlackMcpIntegrationConfig {
  enabled?: boolean;
  botToken?: string;
  teamId?: string;
  channelIds?: string[];
  packageName?: string;
  /** Default false. Write tools (post_message, reply, reaction) are disabled unless true. */
  enableWrites?: boolean;
}

/**
 * Guardrails configuration (see `src/guardrails/`).
 *
 * The framework is opt-in: `enabled: false` (default) is a no-op even
 * if `builtin` is populated. `builtin` references guardrail names
 * registered in the default registry — currently:
 *   - `secrets`
 *   - `pii`
 *   - `prompt-injection`
 *   (`zod-schema` is a factory and is composed programmatically.)
 *
 * `customPaths` lists module paths whose default export registers extra
 * guardrails. Each module is expected to call `registerGuardrail(...)`
 * on import. Resolution happens lazily in the call site that uses the
 * framework.
 */
export interface GuardrailsConfig {
  enabled: boolean;
  builtin: string[];
  customPaths?: string[];
  /** Per-guardrail timeout (ms). Default 2000. */
  timeoutMs?: number;
  /** Abort remaining guardrails on first high-severity failure. Default true. */
  killSwitch?: boolean;
}

/**
 * Authentication config (AIG-646).
 *
 * The existing JWT+bcrypt+RBAC AuthService keeps its own state; this sibling
 * field only carries the optional SSO sub-config so operators can configure
 * SAML/OIDC/SCIM via aistack.config.json. The structural shape mirrors
 * `SsoConfig` in src/auth/sso/types.ts but is duplicated here to avoid a
 * circular import from the SSO module into the root types file.
 */
export interface AuthConfig {
  sso?: {
    saml?: Record<string, unknown>;
    oidc?: Record<string, unknown>;
    scim?: Record<string, unknown>;
    defaultRole?: 'admin' | 'developer' | 'viewer';
    strictIdentityBinding?: boolean;
  };
}

// Federation types (multi-machine federation, AIG-652)
export type FederationDiscoveryMethod = 'mdns' | 'registry' | 'static';
export type FederationRoutingPolicy = 'round-robin' | 'least-loaded' | 'capability-match';

export interface FederationTlsConfig {
  certPath?: string;
  keyPath?: string;
  caPath?: string;
  requireClientCert?: boolean;
  bearerToken?: string;
}

export interface FederationConfig {
  enabled: boolean;
  nodeId?: string;
  name?: string;
  discoveryMethod: FederationDiscoveryMethod;
  advertise: boolean;
  peers: string[];
  registryUrl?: string;
  mdnsServiceType?: string;
  bindAddress?: string;
  bindPort?: number;
  routingPolicy: FederationRoutingPolicy;
  maxInputLength?: number;
  tls?: FederationTlsConfig;
  requestTimeoutMs?: number;
}

export interface MemoryConfig {
  path: string;
  defaultNamespace: string;
  vectorSearch: {
    enabled: boolean;
    /** One of `'openai' | 'ollama' | 'wasm-local'` (or future adapter id). */
    provider?: string;
    model?: string;
  };
  // AIG-640: Anthropic Memory Tool + Dreaming + filesystem sync (all opt-in)
  toolAdapter?: {
    enabled: boolean;
    namespace?: string;
    root?: string;
  };
  dreaming?: {
    enabled: boolean;
    intervalMs?: number;
    batchSize?: number;
    minClusterSize?: number;
    similarityThreshold?: number;
    namespace?: string;
    dreamNamespace?: string;
  };
  sync?: {
    enabled: boolean;
    watchPath?: string;
    namespace?: string;
    pollIntervalMs?: number;
    exportEnabled?: boolean;
    importEnabled?: boolean;
  };
  /** Hierarchical tiering configuration — see src/memory/tiers/ (AIG-651). */
  tiering?: MemoryTieringConfig;
}

/**
 * Configuration for OS-style hierarchical memory tiers (AIG-651).
 *
 * All fields are optional; omitted values fall back to DEFAULT_PAGING_POLICY
 * in src/memory/tiers/types.ts.
 */
export interface MemoryTieringConfig {
  /** Master switch — when false, AutoPager.start() is a no-op. */
  enabled?: boolean;
  /** Maximum entries kept in the hot in-context "working" tier. */
  workingMaxEntries?: number;
  /** Maximum estimated tokens kept in the working tier (defaults to 4000). */
  workingMaxTokens?: number;
  /** Soft cap on the warm "recall" tier; LRU tail demotes to archival when exceeded. */
  recallMaxEntries?: number;
  /** Age (in days) after which a recall entry is demoted to archival. */
  recallMaxAgeDays?: number;
  /** Access count threshold for recall -> working promotion. */
  promoteToWorkingMinAccessCount?: number;
  /** Recency window (ms) used together with access count for promotion. */
  recentAccessWindowMs?: number;
  /** When true, AutoPager calls the configured LLM summarizer on archival. */
  archivalSummarize?: boolean;
  /** AutoPager run interval in ms. */
  intervalMs?: number;
  /** Maximum rows scanned per AutoPager tick. */
  batchSize?: number;
}

/**
 * Configuration for the WASM-native (in-process) embedding provider.
 * Consumed by `src/memory/embedding/wasm` — kept here so external consumers
 * can typecheck their config without importing internal modules.
 *
 * Note: the on-disk cache directory is controlled by the `AISTACK_MODELS_DIR`
 * environment variable rather than this object, so there is no `cacheDir`
 * field — the field used to exist but was never read by the loader and was
 * removed in the AIG-653 review pass.
 */
export interface WasmEmbeddingConfig {
  /** Hugging Face model id, e.g. `'Xenova/all-MiniLM-L6-v2'`. */
  modelId?: string;
  /** Embedding dimensions; defaults to 384 for MiniLM-L6-v2. */
  dimensions?: number;
  /** L2-normalize embeddings so cosine == dot product. Defaults to true. */
  normalize?: boolean;
  /**
   * SHA-256 over the on-disk ONNX bytes. Required for any non-default
   * `modelId`; recommended even for the default to harden the Hub path.
   */
  expectedSha256?: string;
  /**
   * Max inputs per pipeline forward pass. Defaults to 32.
   */
  batchChunkSize?: number;
  /**
   * Soft WASM heap cap (MiB). Defaults to 256.
   */
  wasmMemoryCapMib?: number;
}

export interface ProvidersConfig {
  default: string;
  anthropic?: {
    apiKey: string;
    model?: string;
  };
  openai?: {
    apiKey: string;
    model?: string;
  };
  ollama?: {
    baseUrl: string;
    model?: string;
  };
  claude_code?: {
    command?: string;
    model?: string;
    timeout?: number;
  };
  gemini_cli?: {
    command?: string;
    model?: string;
    timeout?: number;
  };
  codex?: {
    command?: string;
    timeout?: number;
  };
}

export interface AgentsConfig {
  maxConcurrent: number;
  defaultTimeout: number;
}

export interface IssueLabelSet {
  inProgress?: string;
  blocked?: string;
  done?: string;
  claimed?: string;
}

export interface GitHubConfig {
  enabled: boolean;
  useGhCli?: boolean;
  token?: string;
  /** Shared secret for `X-Hub-Signature-256` verification on the GitHub webhook */
  webhookSecret?: string;
  /** Shared secret token compared against `X-Gitlab-Token` on the GitLab webhook */
  gitlabWebhookSecret?: string;
  /** Personal access token used when calling the GitLab REST API */
  gitlabToken?: string;
  /** Customise the lifecycle labels written back to source issues */
  labels?: IssueLabelSet;
  /**
   * Template used to render an audit-trail URL inside the PR description.
   * Supports `{provider}`, `{owner}`, `{repo}`, `{number}` placeholders.
   */
  auditUrlTemplate?: string;
}

export interface PluginsConfig {
  enabled: boolean;
  directory: string;
}

export interface MCPConfig {
  transport: 'stdio' | 'http';
  port?: number;
  host?: string;
}

export interface HooksConfig {
  sessionStart: boolean;
  sessionEnd: boolean;
  preTask: boolean;
  postTask: boolean;
}

export interface SlackConfig {
  enabled: boolean;
  webhookUrl?: string;
  channel?: string;
  username?: string;
  iconEmoji?: string;
  notifyOnAgentSpawn?: boolean;
  notifyOnWorkflowComplete?: boolean;
  notifyOnErrors?: boolean;
  notifyOnReviewLoop?: boolean;
  notifyOnResourceWarning?: boolean;
  notifyOnResourceIntervention?: boolean;
}

// Result types
export interface Result<T, E = Error> {
  ok: boolean;
  value?: T;
  error?: E;
}

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<E = Error>(error: E): Result<never, E> {
  return { ok: false, error };
}

// Review Loop types
export type ReviewVerdict = 'APPROVE' | 'REJECT';
export type IssueSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface ReviewIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  location?: string;
  attackVector?: string;
  impact?: string;
  requiredFix: string;
}

export interface ReviewResult {
  reviewId: string;
  verdict: ReviewVerdict;
  issues: ReviewIssue[];
  summary: string;
  timestamp: Date;
}

export interface ReviewLoopState {
  id: string;
  sessionId?: string;
  coderId: string;
  adversarialId: string;
  iteration: number;
  maxIterations: number;
  status: ReviewLoopStatus;
  codeInput: string;
  currentCode?: string;
  reviews: ReviewResult[];
  finalVerdict?: ReviewVerdict;
  startedAt: Date;
  completedAt?: Date;
}

export type ReviewLoopStatus =
  | 'pending'
  | 'coding'
  | 'reviewing'
  | 'fixing'
  | 'approved'
  | 'max_iterations_reached'
  | 'failed'
  | 'aborted';

// Agent Identity types
export type AgentIdentityStatus = 'created' | 'active' | 'dormant' | 'retired';

export interface AgentCapability {
  name: string;
  version?: string;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

export interface AgentIdentity {
  agentId: string;
  agentType: AgentType | string;
  status: AgentIdentityStatus;
  capabilities: AgentCapability[];
  version: number;
  displayName?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  lastActiveAt: Date;
  retiredAt?: Date;
  retirementReason?: string;
  createdBy?: string;
  updatedAt: Date;
}

export interface AgentIdentityAuditEntry {
  id: string;
  agentId: string;
  action: 'created' | 'activated' | 'deactivated' | 'retired' | 'updated' | 'spawned';
  previousStatus?: AgentIdentityStatus;
  newStatus?: AgentIdentityStatus;
  reason?: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

// Valid identity status transitions
export const IDENTITY_STATUS_TRANSITIONS: Record<AgentIdentityStatus, AgentIdentityStatus[]> = {
  created: ['active', 'retired'],
  active: ['dormant', 'retired'],
  dormant: ['active', 'retired'],
  retired: [], // Terminal state - no transitions allowed
};

// Drift Detection types
export type TaskRelationshipType = 'parent_of' | 'derived_from' | 'depends_on' | 'supersedes';

export interface TaskRelationship {
  id: string;
  fromTaskId: string;
  toTaskId: string;
  relationshipType: TaskRelationshipType;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface TaskEmbedding {
  taskId: string;
  embedding: number[];
  model: string;
  dimensions: number;
  createdAt: Date;
}

export type DriftDetectionBehavior = 'warn' | 'prevent';
export type DriftDetectionAction = 'allowed' | 'warned' | 'prevented';

export interface DriftDetectionConfig {
  enabled: boolean;
  threshold: number;
  warningThreshold?: number;
  ancestorDepth: number;
  behavior: DriftDetectionBehavior;
  asyncEmbedding: boolean;
}

export interface DriftDetectionResult {
  isDrift: boolean;
  highestSimilarity: number;
  mostSimilarTaskId?: string;
  mostSimilarTaskInput?: string;
  action: DriftDetectionAction;
  checkedAncestors: number;
}

export interface DriftDetectionEvent {
  id: string;
  taskId?: string;
  taskType: string;
  ancestorTaskId: string;
  similarityScore: number;
  threshold: number;
  actionTaken: DriftDetectionAction;
  taskInput?: string;
  createdAt: Date;
}

// Smart Dispatcher types
export interface SmartDispatcherConfig {
  enabled: boolean;
  cacheEnabled: boolean;
  cacheTTLMs: number;
  confidenceThreshold: number;
  fallbackAgentType: string;
  maxDescriptionLength: number;
  dispatchModel: string;
}

export interface DispatchDecision {
  agentType: string;
  confidence: number;
  reasoning: string;
  cached: boolean;
  latencyMs: number;
}

// Resource Exhaustion types
export type ResourceExhaustionPhase = 'normal' | 'warning' | 'intervention' | 'termination';
export type ResourceExhaustionAction = 'allowed' | 'warned' | 'paused' | 'terminated';
export type DeliverableType = 'task_completed' | 'code_committed' | 'tests_passed' | 'user_checkpoint' | 'artifact_produced';

export interface ResourceThresholds {
  maxFilesAccessed: number;
  maxApiCalls: number;
  maxSubtasksSpawned: number;
  maxTimeWithoutDeliverableMs: number;
  maxTokensConsumed: number;
}

export interface AgentResourceMetrics {
  agentId: string;
  filesRead: number;
  filesWritten: number;
  filesModified: number;
  apiCallsCount: number;
  subtasksSpawned: number;
  tokensConsumed: number;
  startedAt: Date;
  lastDeliverableAt: Date | null;
  lastActivityAt: Date;
  phase: ResourceExhaustionPhase;
  pausedAt: Date | null;
  pauseReason: string | null;
}

export interface DeliverableCheckpoint {
  id: string;
  agentId: string;
  type: DeliverableType;
  description?: string;
  artifacts?: string[];
  createdAt: Date;
}

export interface ResourceExhaustionConfig {
  enabled: boolean;
  thresholds: ResourceThresholds;
  warningThresholdPercent: number;
  checkIntervalMs: number;
  autoTerminate: boolean;
  requireConfirmationOnIntervention: boolean;
  pauseOnIntervention: boolean;
}

export interface ResourceExhaustionEvent {
  id: string;
  agentId: string;
  agentType: string;
  phase: ResourceExhaustionPhase;
  actionTaken: ResourceExhaustionAction;
  metrics: AgentResourceMetrics;
  thresholds: ResourceThresholds;
  triggeredBy: keyof ResourceThresholds;
  createdAt: Date;
}
