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

// Project types
export type ProjectStatus = 'active' | 'archived';

export interface Project {
  id: string;
  name: string;
  description?: string;
  path: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface CreateProjectRequest {
  name: string;
  path: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  metadata?: Record<string, unknown>;
}

// Project Task types
export type TaskPhase = 'draft' | 'specification' | 'review' | 'development' | 'completed' | 'cancelled';

export interface ProjectTask {
  id: string;
  projectId: string;
  sessionId?: string;
  title: string;
  description?: string;
  phase: TaskPhase;
  priority: number;
  assignedAgents: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CreateProjectTaskRequest {
  title: string;
  description?: string;
  priority?: number;
  assignedAgents?: string[];
}

export interface UpdateProjectTaskRequest {
  title?: string;
  description?: string;
  priority?: number;
  assignedAgents?: string[];
}

// Specification types
export type SpecificationType = 'architecture' | 'requirements' | 'design' | 'api' | 'other';
export type SpecificationStatus = 'draft' | 'pending_review' | 'approved' | 'rejected';

export interface ReviewComment {
  id: string;
  author: string;
  content: string;
  createdAt: string;
  resolved?: boolean;
}

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
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  comments?: ReviewComment[];
}

export interface CreateSpecificationRequest {
  type: SpecificationType;
  title: string;
  content: string;
  createdBy: string;
}

export interface UpdateSpecificationRequest {
  title?: string;
  content?: string;
  type?: SpecificationType;
}

export interface ApproveSpecificationRequest {
  reviewedBy: string;
  comments?: ReviewComment[];
}

export interface RejectSpecificationRequest {
  reviewedBy: string;
  comments: ReviewComment[];
}

// Filesystem types
export interface FileSystemEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileSystemEntry[];
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  name: string;
  entries: FileSystemEntry[];
}

export interface PathValidation {
  valid: boolean;
  path: string;
  exists: boolean;
  isDirectory: boolean;
  readable: boolean;
  writable: boolean;
  errors: string[];
}
