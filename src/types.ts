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
  metadata?: Record<string, unknown>;
}

export type AgentStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stopped';

// Memory types
export interface MemoryEntry {
  id: string;
  key: string;
  namespace: string;
  content: string;
  embedding?: Float32Array;
  metadata?: Record<string, unknown>;
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
}

export interface MemorySearchOptions {
  namespace?: string;
  limit?: number;
  threshold?: number;
  useVector?: boolean;
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
}

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

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
  | 'failed';
