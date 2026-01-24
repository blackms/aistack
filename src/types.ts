/**
 * Core types for agentstack
 */

// Agent types
export type AgentType =
  | 'coder'
  | 'researcher'
  | 'tester'
  | 'reviewer'
  | 'architect'
  | 'coordinator'
  | 'analyst';

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
