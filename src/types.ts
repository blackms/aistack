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
  | 'security-auditor';

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
}

export interface MemoryConfig {
  path: string;
  defaultNamespace: string;
  vectorSearch: {
    enabled: boolean;
    provider?: string;
    model?: string;
  };
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

export interface GitHubConfig {
  enabled: boolean;
  useGhCli?: boolean;
  token?: string;
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
