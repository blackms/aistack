// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

// Agent types
export type AgentStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stopped';

export interface Agent {
  id: string;
  type: string;
  name: string;
  status: AgentStatus;
  createdAt: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentType {
  type: string;
  name: string;
  description: string;
  capabilities: string[];
}

export interface SpawnAgentRequest {
  type: string;
  name?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface ExecuteAgentRequest {
  task: string;
  provider?: string;
  model?: string;
  context?: string;
}

export interface ExecuteResult {
  agentId: string;
  response: string;
  model: string;
  duration: number;
}

// Memory types
export interface MemoryEntry {
  id: string;
  key: string;
  namespace: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  matchType: 'fts' | 'vector' | 'exact';
}

export interface MemoryStoreRequest {
  key: string;
  content: string;
  namespace?: string;
  metadata?: Record<string, unknown>;
  generateEmbedding?: boolean;
}

export interface MemorySearchRequest {
  query: string;
  namespace?: string;
  limit?: number;
  threshold?: number;
  useVector?: boolean;
}

// Task types
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Task {
  id: string;
  sessionId?: string;
  agentType: string;
  status: TaskStatus;
  input?: string;
  output?: string;
  createdAt: string;
  completedAt?: string;
}

export interface QueuedTask {
  task: Task;
  priority: number;
  addedAt: string;
  assignedTo?: string;
}

export interface TaskQueueStatus {
  status: {
    queued: number;
    processing: number;
    total: number;
  };
  pending: QueuedTask[];
  processing: QueuedTask[];
}

export interface CreateTaskRequest {
  agentType: string;
  input?: string;
  sessionId?: string;
  priority?: number;
}

// Session types
export type SessionStatus = 'active' | 'ended' | 'error';

export interface Session {
  id: string;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string;
  metadata?: Record<string, unknown>;
}

// Workflow types
export interface Workflow {
  id: string;
  name: string;
  description: string;
  phases: string[];
}

export interface RunningWorkflow {
  id: string;
  workflow: string;
  startedAt: string;
  status: 'running' | 'completed' | 'failed';
  report?: unknown;
}

export interface LaunchWorkflowRequest {
  workflow: string;
  config?: Record<string, unknown>;
}

// System types
export interface SystemStatus {
  version: string;
  uptime: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  agents: {
    active: number;
    byStatus: Record<string, number>;
  };
  tasks: {
    queued: number;
    processing: number;
  };
  sessions: {
    active: number;
  };
}

export interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    database: boolean;
    memory: boolean;
    providers: boolean;
  };
}

// WebSocket message types
export interface WSMessage {
  type: string;
  payload: unknown;
  timestamp: string;
}
