import type {
  ApiResponse,
  PaginatedResponse,
  Agent,
  AgentType,
  SpawnAgentRequest,
  ExecuteAgentRequest,
  ExecuteResult,
  MemoryEntry,
  MemorySearchResult,
  MemoryStoreRequest,
  MemorySearchRequest,
  Task,
  TaskQueueStatus,
  CreateTaskRequest,
  Session,
  Workflow,
  RunningWorkflow,
  LaunchWorkflowRequest,
  SystemStatus,
  HealthCheck,
  Project,
  CreateProjectRequest,
  UpdateProjectRequest,
  ProjectTask,
  CreateProjectTaskRequest,
  UpdateProjectTaskRequest,
  TaskPhase,
  Specification,
  CreateSpecificationRequest,
  UpdateSpecificationRequest,
  ApproveSpecificationRequest,
  RejectSpecificationRequest,
  SpecificationStatus,
  FileSystemEntry,
  BrowseResult,
  PathValidation,
} from './types';

const API_BASE = '/api/v1';

class ApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'ApiError';
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json() as ApiResponse<T>;

  if (!response.ok || !data.success) {
    throw new ApiError(
      data.error || `Request failed with status ${response.status}`,
      response.status
    );
  }

  return data.data as T;
}

async function requestPaginated<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ data: T[]; pagination: { limit: number; offset: number; total: number } }> {
  const url = `${API_BASE}${endpoint}`;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const result = await response.json() as PaginatedResponse<T>;

  if (!response.ok || !result.success) {
    throw new ApiError(
      result.error || `Request failed with status ${response.status}`,
      response.status
    );
  }

  return {
    data: result.data || [],
    pagination: result.pagination,
  };
}

// Agent API
export const agentApi = {
  list: (sessionId?: string) =>
    request<Agent[]>(`/agents${sessionId ? `?sessionId=${sessionId}` : ''}`),

  getTypes: () => request<AgentType[]>('/agents/types'),

  spawn: (data: SpawnAgentRequest) =>
    request<Agent>('/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  get: (id: string) => request<Agent>(`/agents/${id}`),

  updateStatus: (id: string, status: string) =>
    request<Agent>(`/agents/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),

  stop: (id: string) =>
    request<{ stopped: boolean }>(`/agents/${id}`, {
      method: 'DELETE',
    }),

  execute: (id: string, data: ExecuteAgentRequest) =>
    request<ExecuteResult>(`/agents/${id}/execute`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  chat: (id: string, message: string, context?: string) =>
    request<{ response: string; model: string; duration: number }>(
      `/agents/${id}/chat`,
      {
        method: 'POST',
        body: JSON.stringify({ message, context }),
      }
    ),
};

// Memory API
export const memoryApi = {
  list: (options?: { namespace?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (options?.namespace) params.set('namespace', options.namespace);
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());
    const query = params.toString();
    return requestPaginated<MemoryEntry>(`/memory${query ? `?${query}` : ''}`);
  },

  store: (data: MemoryStoreRequest) =>
    request<MemoryEntry>('/memory', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  search: (query: string, options?: Omit<MemorySearchRequest, 'query'>) => {
    const params = new URLSearchParams({ q: query });
    if (options?.namespace) params.set('namespace', options.namespace);
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.threshold) params.set('threshold', options.threshold.toString());
    if (options?.useVector) params.set('useVector', 'true');
    return request<MemorySearchResult[]>(`/memory/search?${params.toString()}`);
  },

  get: (key: string, namespace?: string) =>
    request<MemoryEntry>(
      `/memory/${encodeURIComponent(key)}${namespace ? `?namespace=${namespace}` : ''}`
    ),

  delete: (key: string, namespace?: string) =>
    request<{ deleted: boolean }>(
      `/memory/${encodeURIComponent(key)}${namespace ? `?namespace=${namespace}` : ''}`,
      { method: 'DELETE' }
    ),

  getVectorStats: (namespace?: string) =>
    request<{ total: number; indexed: number; coverage: number }>(
      `/memory/stats/vector${namespace ? `?namespace=${namespace}` : ''}`
    ),

  reindex: (namespace?: string) =>
    request<{ reindexed: number }>(
      `/memory/reindex${namespace ? `?namespace=${namespace}` : ''}`,
      { method: 'POST' }
    ),
};

// Task API
export const taskApi = {
  list: (options?: { sessionId?: string; status?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (options?.sessionId) params.set('sessionId', options.sessionId);
    if (options?.status) params.set('status', options.status);
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());
    const query = params.toString();
    return requestPaginated<Task>(`/tasks${query ? `?${query}` : ''}`);
  },

  create: (data: CreateTaskRequest) =>
    request<Task>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getQueue: () => request<TaskQueueStatus>('/tasks/queue'),

  get: (id: string) => request<Task>(`/tasks/${id}`),

  assign: (id: string, agentId: string) =>
    request<Task>(`/tasks/${id}/assign`, {
      method: 'PUT',
      body: JSON.stringify({ agentId }),
    }),

  complete: (id: string, output?: string) =>
    request<Task>(`/tasks/${id}/complete`, {
      method: 'PUT',
      body: JSON.stringify({ output }),
    }),

  fail: (id: string, error?: string, requeue?: boolean) =>
    request<Task>(`/tasks/${id}/fail${requeue ? '?requeue=true' : ''}`, {
      method: 'PUT',
      body: JSON.stringify({ error }),
    }),
};

// Session API
export const sessionApi = {
  getActive: () => request<Session | null>('/sessions/active'),

  create: (metadata?: Record<string, unknown>) =>
    request<Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ metadata }),
    }),

  get: (id: string) => request<Session>(`/sessions/${id}`),

  end: (id: string) =>
    request<Session>(`/sessions/${id}/end`, {
      method: 'PUT',
    }),
};

// Workflow API
export const workflowApi = {
  list: () => request<Workflow[]>('/workflows'),

  launch: (data: LaunchWorkflowRequest) =>
    request<{ workflowId: string; workflow: string; status: string; startedAt: string }>(
      '/workflows',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    ),

  getRunning: () => request<RunningWorkflow[]>('/workflows/running'),

  get: (id: string) => request<RunningWorkflow>(`/workflows/${id}`),
};

// System API
export const systemApi = {
  getStatus: () => request<SystemStatus>('/system/status'),

  getHealth: () => request<HealthCheck>('/system/health'),

  getConfig: () => request<Record<string, unknown>>('/system/config'),

  getMetrics: () => request<Record<string, unknown>>('/system/metrics'),
};

// Project API
export const projectApi = {
  list: (status?: 'active' | 'archived') =>
    request<Project[]>(`/projects${status ? `?status=${status}` : ''}`),

  create: (data: CreateProjectRequest) =>
    request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  get: (id: string) => request<Project>(`/projects/${id}`),

  update: (id: string, data: UpdateProjectRequest) =>
    request<Project>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<{ deleted: boolean }>(`/projects/${id}`, {
      method: 'DELETE',
    }),

  // Project Tasks
  listTasks: (projectId: string, phase?: TaskPhase) =>
    request<ProjectTask[]>(
      `/projects/${projectId}/tasks${phase ? `?phase=${phase}` : ''}`
    ),

  createTask: (projectId: string, data: CreateProjectTaskRequest) =>
    request<ProjectTask>(`/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getTask: (projectId: string, taskId: string) =>
    request<ProjectTask>(`/projects/${projectId}/tasks/${taskId}`),

  updateTask: (projectId: string, taskId: string, data: UpdateProjectTaskRequest) =>
    request<ProjectTask>(`/projects/${projectId}/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteTask: (projectId: string, taskId: string) =>
    request<{ deleted: boolean }>(`/projects/${projectId}/tasks/${taskId}`, {
      method: 'DELETE',
    }),

  transitionPhase: (projectId: string, taskId: string, phase: TaskPhase) =>
    request<ProjectTask>(`/projects/${projectId}/tasks/${taskId}/phase`, {
      method: 'PUT',
      body: JSON.stringify({ phase }),
    }),

  assignAgents: (projectId: string, taskId: string, agents: string[]) =>
    request<ProjectTask>(`/projects/${projectId}/tasks/${taskId}/assign`, {
      method: 'PUT',
      body: JSON.stringify({ agents }),
    }),
};

// Specification API
export const specificationApi = {
  list: (taskId: string, status?: SpecificationStatus) =>
    request<Specification[]>(
      `/tasks/${taskId}/specs${status ? `?status=${status}` : ''}`
    ),

  create: (taskId: string, data: CreateSpecificationRequest) =>
    request<Specification>(`/tasks/${taskId}/specs`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  get: (specId: string) => request<Specification>(`/specs/${specId}`),

  update: (specId: string, data: UpdateSpecificationRequest) =>
    request<Specification>(`/specs/${specId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (specId: string) =>
    request<{ deleted: boolean }>(`/specs/${specId}`, {
      method: 'DELETE',
    }),

  submit: (specId: string) =>
    request<Specification>(`/specs/${specId}/submit`, {
      method: 'PUT',
    }),

  approve: (specId: string, data: ApproveSpecificationRequest) =>
    request<Specification>(`/specs/${specId}/approve`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  reject: (specId: string, data: RejectSpecificationRequest) =>
    request<Specification>(`/specs/${specId}/reject`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};

// Filesystem API
export const filesystemApi = {
  getRoots: () => request<FileSystemEntry[]>('/filesystem/roots'),

  browse: (options?: { path?: string; showHidden?: boolean; showFiles?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.path) params.set('path', options.path);
    if (options?.showHidden) params.set('showHidden', 'true');
    if (options?.showFiles !== undefined) params.set('showFiles', options.showFiles.toString());
    const query = params.toString();
    return request<BrowseResult>(`/filesystem/browse${query ? `?${query}` : ''}`);
  },

  validate: (path: string) =>
    request<PathValidation>('/filesystem/validate', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  getParent: (path: string) =>
    request<{ path: string; parent: string | null; isRoot: boolean }>(
      `/filesystem/parent?path=${encodeURIComponent(path)}`
    ),
};

export { ApiError };
