/**
 * Routes tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Router } from '../../../src/web/router.js';
import { registerAgentRoutes } from '../../../src/web/routes/agents.js';
import { registerMemoryRoutes } from '../../../src/web/routes/memory.js';
import { registerTaskRoutes } from '../../../src/web/routes/tasks.js';
import { registerSessionRoutes } from '../../../src/web/routes/sessions.js';
import { registerWorkflowRoutes } from '../../../src/web/routes/workflows.js';
import { registerSystemRoutes } from '../../../src/web/routes/system.js';
import { clearAgents, spawnAgent } from '../../../src/agents/index.js';
import { resetMemoryManager, getMemoryManager } from '../../../src/memory/index.js';
import type { AgentStackConfig } from '../../../src/types.js';

// Mock config
const mockConfig: AgentStackConfig = {
  version: '1.0.0',
  memory: {
    path: ':memory:',
    defaultNamespace: 'default',
    vectorSearch: { enabled: false },
  },
  providers: { default: 'anthropic' },
  agents: { maxConcurrent: 5, defaultTimeout: 300 },
  github: { enabled: false },
  plugins: { enabled: false, directory: './plugins' },
  mcp: { transport: 'stdio' },
  hooks: { sessionStart: false, sessionEnd: false, preTask: false, postTask: false },
};

// Mock response
function createMockResponse() {
  let body = '';
  const res = {
    writeHead: vi.fn(),
    end: vi.fn((data: string) => { body = data; }),
    headersSent: false,
    getBody: () => body ? JSON.parse(body) : null,
  } as unknown as ServerResponse & { getBody: () => unknown };
  return res;
}

// Mock request
function createMockRequest(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {}
): IncomingMessage {
  const req = {
    method,
    url,
    headers,
    on: vi.fn((event: string, callback: (data?: Buffer) => void) => {
      if (event === 'data' && body) {
        callback(Buffer.from(JSON.stringify(body)));
      }
      if (event === 'end') {
        callback();
      }
      return req;
    }),
  } as unknown as IncomingMessage;
  return req;
}

describe('Agent Routes', () => {
  let router: Router;

  beforeEach(() => {
    clearAgents();
    router = new Router();
    registerAgentRoutes(router, mockConfig);
  });

  afterEach(() => {
    clearAgents();
  });

  describe('GET /api/v1/agents', () => {
    it('should return empty list when no agents', async () => {
      const req = createMockRequest('GET', '/api/v1/agents');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('should return list of agents', async () => {
      spawnAgent('coder', { name: 'test-coder' }, mockConfig);

      const req = createMockRequest('GET', '/api/v1/agents');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('test-coder');
    });

    it('should filter by sessionId', async () => {
      spawnAgent('coder', { name: 'agent1', sessionId: 'session1' }, mockConfig);
      spawnAgent('coder', { name: 'agent2', sessionId: 'session2' }, mockConfig);

      const req = createMockRequest('GET', '/api/v1/agents?sessionId=session1');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('agent1');
    });
  });

  describe('GET /api/v1/agents/types', () => {
    it('should return list of agent types', async () => {
      const req = createMockRequest('GET', '/api/v1/agents/types');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0]).toHaveProperty('type');
      expect(body.data[0]).toHaveProperty('name');
      expect(body.data[0]).toHaveProperty('description');
      expect(body.data[0]).toHaveProperty('capabilities');
    });
  });

  describe('POST /api/v1/agents', () => {
    it('should spawn new agent', async () => {
      const req = createMockRequest('POST', '/api/v1/agents', {
        type: 'coder',
        name: 'my-coder',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('my-coder');
      expect(body.data.type).toBe('coder');
      expect(body.data.status).toBe('idle');
      expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    });

    it('should return error for missing type', async () => {
      const req = createMockRequest('POST', '/api/v1/agents', {});
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(false);
    });

    it('should return error for invalid type', async () => {
      const req = createMockRequest('POST', '/api/v1/agents', {
        type: 'invalid-type',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/agents/:id', () => {
    it('should return agent by id', async () => {
      const agent = spawnAgent('coder', { name: 'test' }, mockConfig);

      const req = createMockRequest('GET', `/api/v1/agents/${agent.id}`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(agent.id);
    });

    it('should return 404 for unknown agent', async () => {
      const req = createMockRequest('GET', '/api/v1/agents/unknown-id');
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('DELETE /api/v1/agents/:id', () => {
    it('should stop agent', async () => {
      const agent = spawnAgent('coder', { name: 'test' }, mockConfig);

      const req = createMockRequest('DELETE', `/api/v1/agents/${agent.id}`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.stopped).toBe(true);
    });

    it('should return 404 for unknown agent', async () => {
      const req = createMockRequest('DELETE', '/api/v1/agents/unknown-id');
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('PUT /api/v1/agents/:id/status', () => {
    it('should update agent status', async () => {
      const agent = spawnAgent('coder', { name: 'test' }, mockConfig);

      const req = createMockRequest('PUT', `/api/v1/agents/${agent.id}/status`, {
        status: 'running',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('running');
    });

    it('should return error for invalid status', async () => {
      const agent = spawnAgent('coder', { name: 'test' }, mockConfig);

      const req = createMockRequest('PUT', `/api/v1/agents/${agent.id}/status`, {
        status: 'invalid',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(false);
    });

    it('should return error for missing status', async () => {
      const agent = spawnAgent('coder', { name: 'test' }, mockConfig);

      const req = createMockRequest('PUT', `/api/v1/agents/${agent.id}/status`, {});
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });

    it('should return 404 for unknown agent', async () => {
      const req = createMockRequest('PUT', '/api/v1/agents/unknown-id/status', {
        status: 'running',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('POST /api/v1/agents/:id/execute', () => {
    it('should return error for missing task', async () => {
      const agent = spawnAgent('coder', { name: 'test-exec' }, mockConfig);

      const req = createMockRequest('POST', `/api/v1/agents/${agent.id}/execute`, {});
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });

    it('should return 404 for unknown agent', async () => {
      const req = createMockRequest('POST', '/api/v1/agents/unknown-id/execute', {
        task: 'test task',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('POST /api/v1/agents/:id/chat', () => {
    it('should return error for missing message', async () => {
      const agent = spawnAgent('coder', { name: 'test-chat' }, mockConfig);

      const req = createMockRequest('POST', `/api/v1/agents/${agent.id}/chat`, {});
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });

    it('should return 404 for unknown agent', async () => {
      const req = createMockRequest('POST', '/api/v1/agents/unknown-id/chat', {
        message: 'hello',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('POST /api/v1/agents with sessionId and metadata', () => {
    it('should spawn agent with sessionId and metadata', async () => {
      const req = createMockRequest('POST', '/api/v1/agents', {
        type: 'coder',
        name: 'full-agent',
        sessionId: 'test-session',
        metadata: { key: 'value' },
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
    });
  });
});

describe('Memory Routes', () => {
  let router: Router;

  beforeEach(() => {
    resetMemoryManager();
    router = new Router();
    registerMemoryRoutes(router, mockConfig);
  });

  afterEach(() => {
    resetMemoryManager();
  });

  describe('GET /api/v1/memory', () => {
    it('should return empty list', async () => {
      const req = createMockRequest('GET', '/api/v1/memory');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
      expect(body.pagination).toBeDefined();
    });

    it('should return list of entries', async () => {
      const manager = getMemoryManager(mockConfig);
      await manager.store('key1', 'content1');

      const req = createMockRequest('GET', '/api/v1/memory');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].key).toBe('key1');
    });

    it('should support pagination', async () => {
      const manager = getMemoryManager(mockConfig);
      await manager.store('key1', 'content1');
      await manager.store('key2', 'content2');

      const req = createMockRequest('GET', '/api/v1/memory?limit=1&offset=0');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.data).toHaveLength(1);
      expect(body.pagination.limit).toBe(1);
      expect(body.pagination.total).toBe(2);
    });
  });

  describe('POST /api/v1/memory', () => {
    it('should store new entry', async () => {
      const req = createMockRequest('POST', '/api/v1/memory', {
        key: 'test-key',
        content: 'test content',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.key).toBe('test-key');
      expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    });

    it('should return error for missing key', async () => {
      const req = createMockRequest('POST', '/api/v1/memory', {
        content: 'test content',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/memory/:key', () => {
    it('should return entry by key', async () => {
      const manager = getMemoryManager(mockConfig);
      await manager.store('my-key', 'my content');

      const req = createMockRequest('GET', '/api/v1/memory/my-key');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.key).toBe('my-key');
      expect(body.data.content).toBe('my content');
    });

    it('should return 404 for unknown key', async () => {
      const req = createMockRequest('GET', '/api/v1/memory/unknown');
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('DELETE /api/v1/memory/:key', () => {
    it('should delete entry', async () => {
      const manager = getMemoryManager(mockConfig);
      await manager.store('delete-me', 'content');

      const req = createMockRequest('DELETE', '/api/v1/memory/delete-me');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });

    it('should return 404 for unknown key', async () => {
      const req = createMockRequest('DELETE', '/api/v1/memory/unknown');
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('GET /api/v1/memory/search', () => {
    it('should search memory entries', async () => {
      const manager = getMemoryManager(mockConfig);
      await manager.store('search-key', 'searchable content here');

      const req = createMockRequest('GET', '/api/v1/memory/search?q=searchable');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('should return error without query', async () => {
      const req = createMockRequest('GET', '/api/v1/memory/search');
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });
  });

  describe('POST /api/v1/memory/search', () => {
    it('should search memory with POST body', async () => {
      const manager = getMemoryManager(mockConfig);
      await manager.store('post-search-key', 'post searchable content');

      const req = createMockRequest('POST', '/api/v1/memory/search', {
        query: 'post searchable',
        limit: 5,
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
    });

    it('should return error without query in body', async () => {
      const req = createMockRequest('POST', '/api/v1/memory/search', {});
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });
  });

  describe('GET /api/v1/memory/stats/vector', () => {
    it('should return vector stats', async () => {
      const req = createMockRequest('GET', '/api/v1/memory/stats/vector');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
    });
  });

  describe('POST /api/v1/memory/reindex', () => {
    it('should reindex memory entries', async () => {
      const req = createMockRequest('POST', '/api/v1/memory/reindex', {});
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('reindexed');
    });
  });

  describe('POST /api/v1/memory with missing content', () => {
    it('should return error for missing content', async () => {
      const req = createMockRequest('POST', '/api/v1/memory', {
        key: 'test-key',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/memory with namespace', () => {
    it('should filter by namespace', async () => {
      const manager = getMemoryManager(mockConfig);
      await manager.store('ns-key', 'content', { namespace: 'test-ns' });

      const req = createMockRequest('GET', '/api/v1/memory?namespace=test-ns');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
    });
  });

  describe('GET /api/v1/memory/:key with namespace', () => {
    it('should get entry with namespace', async () => {
      const manager = getMemoryManager(mockConfig);
      await manager.store('ns-key2', 'content', { namespace: 'test-ns2' });

      const req = createMockRequest('GET', '/api/v1/memory/ns-key2?namespace=test-ns2');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect((body as { data: { key: string } }).data.key).toBe('ns-key2');
    });
  });

  describe('DELETE /api/v1/memory/:key with namespace', () => {
    it('should delete entry with namespace', async () => {
      const manager = getMemoryManager(mockConfig);
      await manager.store('delete-ns-key', 'content', { namespace: 'delete-ns' });

      const req = createMockRequest('DELETE', '/api/v1/memory/delete-ns-key?namespace=delete-ns');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
    });
  });
});

describe('Task Routes', () => {
  let router: Router;

  beforeEach(() => {
    resetMemoryManager();
    router = new Router();
    registerTaskRoutes(router, mockConfig);
  });

  afterEach(() => {
    resetMemoryManager();
  });

  describe('GET /api/v1/tasks', () => {
    it('should return list of tasks', async () => {
      const manager = getMemoryManager(mockConfig);
      manager.createTask('coder', 'test input');

      const req = createMockRequest('GET', '/api/v1/tasks');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
    });
  });

  describe('POST /api/v1/tasks', () => {
    it('should create new task', async () => {
      const req = createMockRequest('POST', '/api/v1/tasks', {
        agentType: 'coder',
        input: 'test input',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.agentType).toBe('coder');
      expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    });

    it('should return error for missing agentType', async () => {
      const req = createMockRequest('POST', '/api/v1/tasks', {});
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/tasks/queue', () => {
    it('should return queue status', async () => {
      const req = createMockRequest('GET', '/api/v1/tasks/queue');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.status).toBeDefined();
      expect(body.data.pending).toBeDefined();
      expect(body.data.processing).toBeDefined();
    });
  });

  describe('GET /api/v1/tasks/:id', () => {
    it('should return task by id', async () => {
      const manager = getMemoryManager(mockConfig);
      const task = manager.createTask('coder', 'test input');

      const req = createMockRequest('GET', `/api/v1/tasks/${task.id}`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(task.id);
    });

    it('should return 404 for unknown task', async () => {
      const req = createMockRequest('GET', '/api/v1/tasks/unknown-id');
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('PUT /api/v1/tasks/:id/complete', () => {
    it('should complete task', async () => {
      const manager = getMemoryManager(mockConfig);
      const task = manager.createTask('coder', 'test input');

      const req = createMockRequest('PUT', `/api/v1/tasks/${task.id}/complete`, {
        output: 'task output',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('completed');
    });

    it('should return 404 for unknown task', async () => {
      const req = createMockRequest('PUT', '/api/v1/tasks/unknown-id/complete', {});
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('PUT /api/v1/tasks/:id/fail', () => {
    it('should fail task', async () => {
      const manager = getMemoryManager(mockConfig);
      const task = manager.createTask('coder', 'test input');

      const req = createMockRequest('PUT', `/api/v1/tasks/${task.id}/fail`, {
        error: 'task failed',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('failed');
    });

    it('should return 404 for unknown task', async () => {
      const req = createMockRequest('PUT', '/api/v1/tasks/unknown-id/fail', {});
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });

    it('should fail task with requeue option', async () => {
      const manager = getMemoryManager(mockConfig);
      const task = manager.createTask('coder', 'test input');

      const req = createMockRequest('PUT', `/api/v1/tasks/${task.id}/fail?requeue=true`, {
        error: 'task failed',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
    });
  });

  describe('POST /api/v1/tasks with priority', () => {
    it('should create task and add to queue', async () => {
      const req = createMockRequest('POST', '/api/v1/tasks', {
        agentType: 'coder',
        input: 'test input',
        priority: 5,
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
    });
  });

  describe('PUT /api/v1/tasks/:id/assign', () => {
    it('should return error for missing agentId', async () => {
      const manager = getMemoryManager(mockConfig);
      const task = manager.createTask('coder', 'test input');

      const req = createMockRequest('PUT', `/api/v1/tasks/${task.id}/assign`, {});
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });

    it('should return 404 for task not in queue', async () => {
      const manager = getMemoryManager(mockConfig);
      const task = manager.createTask('coder', 'test input');

      const req = createMockRequest('PUT', `/api/v1/tasks/${task.id}/assign`, {
        agentId: 'agent-123',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      // Task exists but not in queue
      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('GET /api/v1/tasks with filters', () => {
    it('should filter by sessionId', async () => {
      const manager = getMemoryManager(mockConfig);
      // Create a session first due to FK constraint
      const session = manager.createSession();
      manager.createTask('coder', 'test input', session.id);

      const req = createMockRequest('GET', `/api/v1/tasks?sessionId=${session.id}`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
    });

    it('should filter by status', async () => {
      const manager = getMemoryManager(mockConfig);
      manager.createTask('coder', 'test input');

      const req = createMockRequest('GET', '/api/v1/tasks?status=pending');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
    });
  });
});

describe('Session Routes', () => {
  let router: Router;

  beforeEach(() => {
    resetMemoryManager();
    router = new Router();
    registerSessionRoutes(router, mockConfig);
  });

  afterEach(() => {
    resetMemoryManager();
  });

  describe('GET /api/v1/sessions/active', () => {
    it('should return null when no active session', async () => {
      const req = createMockRequest('GET', '/api/v1/sessions/active');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toBeNull();
    });

    it('should return active session', async () => {
      const manager = getMemoryManager(mockConfig);
      manager.createSession();

      const req = createMockRequest('GET', '/api/v1/sessions/active');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).not.toBeNull();
      expect(body.data.status).toBe('active');
    });
  });

  describe('POST /api/v1/sessions', () => {
    it('should create new session', async () => {
      const req = createMockRequest('POST', '/api/v1/sessions', {});
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('active');
      expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    });

    it('should end existing session when creating new one', async () => {
      const manager = getMemoryManager(mockConfig);
      manager.createSession();

      const req = createMockRequest('POST', '/api/v1/sessions', {
        metadata: { test: true },
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
    });
  });

  describe('GET /api/v1/sessions/:id', () => {
    it('should return session by id', async () => {
      const manager = getMemoryManager(mockConfig);
      const session = manager.createSession();

      const req = createMockRequest('GET', `/api/v1/sessions/${session.id}`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(session.id);
    });

    it('should return 404 for unknown session', async () => {
      const req = createMockRequest('GET', '/api/v1/sessions/unknown-id');
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('PUT /api/v1/sessions/:id/end', () => {
    it('should end session', async () => {
      const manager = getMemoryManager(mockConfig);
      const session = manager.createSession();

      const req = createMockRequest('PUT', `/api/v1/sessions/${session.id}/end`, {});
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('ended');
    });

    it('should return 404 for unknown session', async () => {
      const req = createMockRequest('PUT', '/api/v1/sessions/unknown-id/end', {});
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });
});

describe('Workflow Routes', () => {
  let router: Router;

  beforeEach(() => {
    router = new Router();
    registerWorkflowRoutes(router, mockConfig);
  });

  describe('GET /api/v1/workflows', () => {
    it('should return list of workflows', async () => {
      const req = createMockRequest('GET', '/api/v1/workflows');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0]).toHaveProperty('id');
      expect(body.data[0]).toHaveProperty('name');
      expect(body.data[0]).toHaveProperty('phases');
    });
  });

  describe('GET /api/v1/workflows/running', () => {
    it('should return empty list when no workflows running', async () => {
      const req = createMockRequest('GET', '/api/v1/workflows/running');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });
  });

  describe('POST /api/v1/workflows', () => {
    it('should launch doc-sync workflow', async () => {
      const req = createMockRequest('POST', '/api/v1/workflows', {
        workflow: 'doc-sync',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.workflow).toBe('doc-sync');
      expect(body.data.status).toBe('running');
      expect(res.writeHead).toHaveBeenCalledWith(202, expect.any(Object));
    });

    it('should return error for missing workflow', async () => {
      const req = createMockRequest('POST', '/api/v1/workflows', {});
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });

    it('should return error for unknown workflow', async () => {
      const req = createMockRequest('POST', '/api/v1/workflows', {
        workflow: 'unknown-workflow',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });
  });

  describe('GET /api/v1/workflows/:id', () => {
    it('should return 404 for unknown workflow', async () => {
      const req = createMockRequest('GET', '/api/v1/workflows/unknown-id');
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });

    it('should return launched workflow by id', async () => {
      // First launch a workflow
      const launchReq = createMockRequest('POST', '/api/v1/workflows', {
        workflow: 'doc-sync',
      });
      const launchRes = createMockResponse();

      await router.handle(launchReq, launchRes);

      const launchBody = launchRes.getBody();
      const workflowId = (launchBody as { data: { workflowId: string } }).data.workflowId;

      // Then get it by ID
      const req = createMockRequest('GET', `/api/v1/workflows/${workflowId}`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect((body as { data: { id: string } }).data.id).toBe(workflowId);
    });
  });

  describe('GET /api/v1/workflows/running after launch', () => {
    it('should include launched workflow', async () => {
      // First launch a workflow
      const launchReq = createMockRequest('POST', '/api/v1/workflows', {
        workflow: 'doc-sync',
      });
      const launchRes = createMockResponse();

      await router.handle(launchReq, launchRes);

      // Then check running workflows
      const req = createMockRequest('GET', '/api/v1/workflows/running');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect((body as { data: unknown[] }).data.length).toBeGreaterThan(0);
    });
  });
});

describe('System Routes', () => {
  let router: Router;

  beforeEach(() => {
    router = new Router();
    registerSystemRoutes(router, mockConfig);
  });

  describe('GET /api/v1/system/status', () => {
    it('should return system status', async () => {
      const req = createMockRequest('GET', '/api/v1/system/status');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('version');
      expect(body.data).toHaveProperty('uptime');
      expect(body.data).toHaveProperty('memory');
      expect(body.data).toHaveProperty('agents');
      expect(body.data).toHaveProperty('tasks');
      expect(body.data).toHaveProperty('sessions');
    });
  });

  describe('GET /api/v1/system/health', () => {
    it('should return health check', async () => {
      const req = createMockRequest('GET', '/api/v1/system/health');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('status');
      expect(body.data).toHaveProperty('checks');
    });
  });

  describe('GET /api/v1/system/config', () => {
    it('should return sanitized config', async () => {
      const req = createMockRequest('GET', '/api/v1/system/config');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('version');
      expect(body.data).toHaveProperty('memory');
      expect(body.data).toHaveProperty('providers');
      // Should not contain API keys
      expect(body.data.providers.apiKey).toBeUndefined();
    });
  });

  describe('GET /api/v1/system/metrics', () => {
    it('should return metrics', async () => {
      const req = createMockRequest('GET', '/api/v1/system/metrics');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('timestamp');
      expect(body.data).toHaveProperty('uptime');
      expect(body.data).toHaveProperty('memory');
      expect(body.data).toHaveProperty('cpu');
      expect(body.data).toHaveProperty('node');
    });
  });
});
