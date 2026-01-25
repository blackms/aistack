/**
 * Web server types
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export interface WebConfig {
  enabled: boolean;
  port: number;
  host: string;
  cors: {
    origins: string[];
  };
}

export interface RouteHandler {
  (req: IncomingMessage, res: ServerResponse, params: RouteParams): Promise<void> | void;
}

export interface RouteParams {
  path: string[];
  query: Record<string, string>;
  body?: unknown;
}

export interface Route {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
  paramNames: string[];
}

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

// WebSocket message types
export interface WSMessage {
  type: string;
  payload: unknown;
  timestamp: string;
}

export interface WSClientInfo {
  id: string;
  connectedAt: Date;
  subscriptions: Set<string>;
}

// API request/response types
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

export interface ChatRequest {
  message: string;
  context?: string;
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

export interface CreateTaskRequest {
  agentType: string;
  input?: string;
  sessionId?: string;
  priority?: number;
}

export interface AssignTaskRequest {
  agentId: string;
}

export interface CompleteTaskRequest {
  output?: string;
}

export interface LaunchWorkflowRequest {
  workflow: string;
  config?: Record<string, unknown>;
}

export interface CreateSessionRequest {
  metadata?: Record<string, unknown>;
}

// System status types
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
