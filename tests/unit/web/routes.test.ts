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
import { registerProjectRoutes } from '../../../src/web/routes/projects.js';
import { registerSpecificationRoutes } from '../../../src/web/routes/specifications.js';
import { registerFilesystemRoutes } from '../../../src/web/routes/filesystem.js';
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
        sessionId: '123e4567-e89b-12d3-a456-426614174000',
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
        sessionId: '123e4567-e89b-12d3-a456-426614174000',
        content: 'test content',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(false);
    });

    it('should return error for missing sessionId', async () => {
      const req = createMockRequest('POST', '/api/v1/memory', {
        key: 'test-key',
        content: 'test content',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(false);
      expect(body.error).toContain('sessionId');
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
      const sessionId = '123e4567-e89b-12d3-a456-426614174000';
      const namespace = `session:${sessionId}`;
      const manager = getMemoryManager(mockConfig);
      await manager.store('delete-me', 'content', { namespace });

      const req = createMockRequest('DELETE', `/api/v1/memory/delete-me?sessionId=${sessionId}`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });

    it('should return 404 for unknown key', async () => {
      const sessionId = '123e4567-e89b-12d3-a456-426614174000';
      const req = createMockRequest('DELETE', `/api/v1/memory/unknown?sessionId=${sessionId}`);
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });

    it('should return error for missing sessionId', async () => {
      const req = createMockRequest('DELETE', '/api/v1/memory/some-key');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(false);
      expect(body.error).toContain('sessionId');
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
      const sessionId = '123e4567-e89b-12d3-a456-426614174000';
      const manager = getMemoryManager(mockConfig);
      await manager.store('delete-ns-key', 'content', { namespace: 'delete-ns' });

      const req = createMockRequest('DELETE', `/api/v1/memory/delete-ns-key?sessionId=${sessionId}&namespace=delete-ns`);
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

    it('should use fallback agentType when missing (auto-dispatch)', async () => {
      const req = createMockRequest('POST', '/api/v1/tasks', {});
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      // With SmartDispatcher feature, missing agentType uses fallback
      expect(body.success).toBe(true);
      expect(body.data.agentType).toBe('coder'); // Default fallback
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
    it('should return Prometheus metrics array', async () => {
      const req = createMockRequest('GET', '/api/v1/system/metrics');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);

      // Check that metrics have the expected structure
      const firstMetric = body.data[0];
      expect(firstMetric).toHaveProperty('name');
      expect(firstMetric).toHaveProperty('type');
      expect(firstMetric).toHaveProperty('help');
      expect(firstMetric).toHaveProperty('value');
    });
  });
});

describe('Project Routes', () => {
  let router: Router;

  beforeEach(() => {
    resetMemoryManager();
    router = new Router();
    registerProjectRoutes(router, mockConfig);
  });

  afterEach(() => {
    resetMemoryManager();
  });

  describe('GET /api/v1/projects', () => {
    it('should return empty list when no projects', async () => {
      const req = createMockRequest('GET', '/api/v1/projects');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('should return list of projects', async () => {
      const manager = getMemoryManager(mockConfig);
      manager.createProject('Test Project', '/tmp/test');

      const req = createMockRequest('GET', '/api/v1/projects');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('Test Project');
    });

    it('should filter by status', async () => {
      const manager = getMemoryManager(mockConfig);
      manager.createProject('Active Project', '/tmp/active');
      const archived = manager.createProject('Archived Project', '/tmp/archived');
      manager.updateProject(archived.id, { status: 'archived' });

      const req = createMockRequest('GET', '/api/v1/projects?status=active');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('Active Project');
    });
  });

  describe('POST /api/v1/projects', () => {
    it('should create new project', async () => {
      const req = createMockRequest('POST', '/api/v1/projects', {
        name: 'New Project',
        description: 'A test project',
        path: '/tmp/new-project',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('New Project');
      expect(body.data.description).toBe('A test project');
      expect(body.data.path).toBe('/tmp/new-project');
      expect(body.data.status).toBe('active');
      expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    });

    it('should return error for missing name', async () => {
      const req = createMockRequest('POST', '/api/v1/projects', {
        path: '/tmp/test',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });

    it('should return error for missing path', async () => {
      const req = createMockRequest('POST', '/api/v1/projects', {
        name: 'Test',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });
  });

  describe('GET /api/v1/projects/:id', () => {
    it('should return project by id', async () => {
      const manager = getMemoryManager(mockConfig);
      const project = manager.createProject('Get Test', '/tmp/get');

      const req = createMockRequest('GET', `/api/v1/projects/${project.id}`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(project.id);
      expect(body.data.name).toBe('Get Test');
    });

    it('should return 404 for unknown project', async () => {
      const req = createMockRequest('GET', '/api/v1/projects/unknown-id');
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('PUT /api/v1/projects/:id', () => {
    it('should update project', async () => {
      const manager = getMemoryManager(mockConfig);
      const project = manager.createProject('Update Test', '/tmp/update');

      const req = createMockRequest('PUT', `/api/v1/projects/${project.id}`, {
        name: 'Updated Name',
        description: 'New description',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Updated Name');
      expect(body.data.description).toBe('New description');
    });

    it('should return 404 for unknown project', async () => {
      const req = createMockRequest('PUT', '/api/v1/projects/unknown-id', {
        name: 'Test',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('DELETE /api/v1/projects/:id', () => {
    it('should delete project', async () => {
      const manager = getMemoryManager(mockConfig);
      const project = manager.createProject('Delete Test', '/tmp/delete');

      const req = createMockRequest('DELETE', `/api/v1/projects/${project.id}`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });

    it('should return 404 for unknown project', async () => {
      const req = createMockRequest('DELETE', '/api/v1/projects/unknown-id');
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('GET /api/v1/projects/:id/tasks', () => {
    it('should return empty list when no tasks', async () => {
      const manager = getMemoryManager(mockConfig);
      const project = manager.createProject('Tasks Test', '/tmp/tasks');

      const req = createMockRequest('GET', `/api/v1/projects/${project.id}/tasks`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('should return list of tasks', async () => {
      const manager = getMemoryManager(mockConfig);
      const project = manager.createProject('Tasks Test', '/tmp/tasks');
      manager.createProjectTask(project.id, 'Task 1');
      manager.createProjectTask(project.id, 'Task 2');

      const req = createMockRequest('GET', `/api/v1/projects/${project.id}/tasks`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);
    });

    it('should filter by phase', async () => {
      const manager = getMemoryManager(mockConfig);
      const project = manager.createProject('Phase Test', '/tmp/phase');
      manager.createProjectTask(project.id, 'Draft Task');
      const task2 = manager.createProjectTask(project.id, 'Spec Task');
      manager.updateProjectTaskPhase(task2.id, 'specification');

      const req = createMockRequest('GET', `/api/v1/projects/${project.id}/tasks?phase=draft`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].title).toBe('Draft Task');
    });
  });

  describe('POST /api/v1/projects/:id/tasks', () => {
    it('should create new task', async () => {
      const manager = getMemoryManager(mockConfig);
      const project = manager.createProject('Create Task Test', '/tmp/create-task');

      const req = createMockRequest('POST', `/api/v1/projects/${project.id}/tasks`, {
        title: 'New Task',
        description: 'Task description',
        priority: 3,
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('New Task');
      expect(body.data.description).toBe('Task description');
      expect(body.data.priority).toBe(3);
      expect(body.data.phase).toBe('draft');
      expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    });

    it('should return error for missing title', async () => {
      const manager = getMemoryManager(mockConfig);
      const project = manager.createProject('Task Test', '/tmp/task');

      const req = createMockRequest('POST', `/api/v1/projects/${project.id}/tasks`, {});
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });
  });

  describe('GET /api/v1/projects/:projectId/tasks/:taskId', () => {
    it('should return task by id', async () => {
      const manager = getMemoryManager(mockConfig);
      const project = manager.createProject('Get Task Test', '/tmp/get-task');
      const task = manager.createProjectTask(project.id, 'Test Task');

      const req = createMockRequest('GET', `/api/v1/projects/${project.id}/tasks/${task.id}`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(task.id);
      expect(body.data.title).toBe('Test Task');
    });

    it('should return 404 for unknown task', async () => {
      const manager = getMemoryManager(mockConfig);
      const project = manager.createProject('Get Task Test', '/tmp/get-task');

      const req = createMockRequest('GET', `/api/v1/projects/${project.id}/tasks/unknown-id`);
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('PUT /api/v1/projects/:projectId/tasks/:taskId', () => {
    it('should update task', async () => {
      const manager = getMemoryManager(mockConfig);
      const project = manager.createProject('Update Task Test', '/tmp/update-task');
      const task = manager.createProjectTask(project.id, 'Original Title');

      const req = createMockRequest('PUT', `/api/v1/projects/${project.id}/tasks/${task.id}`, {
        title: 'Updated Title',
        description: 'New desc',
        priority: 1,
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('Updated Title');
      expect(body.data.description).toBe('New desc');
      expect(body.data.priority).toBe(1);
    });
  });

  describe('DELETE /api/v1/projects/:projectId/tasks/:taskId', () => {
    it('should delete task', async () => {
      const manager = getMemoryManager(mockConfig);
      const project = manager.createProject('Delete Task Test', '/tmp/delete-task');
      const task = manager.createProjectTask(project.id, 'Delete Me');

      const req = createMockRequest('DELETE', `/api/v1/projects/${project.id}/tasks/${task.id}`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });
  });

  describe('PUT /api/v1/projects/:projectId/tasks/:taskId/phase', () => {
    it('should transition task phase', async () => {
      const manager = getMemoryManager(mockConfig);
      const project = manager.createProject('Phase Test', '/tmp/phase');
      const task = manager.createProjectTask(project.id, 'Phase Task');

      const req = createMockRequest('PUT', `/api/v1/projects/${project.id}/tasks/${task.id}/phase`, {
        phase: 'specification',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.phase).toBe('specification');
    });

    it('should reject invalid phase transition', async () => {
      const manager = getMemoryManager(mockConfig);
      const project = manager.createProject('Invalid Phase Test', '/tmp/invalid-phase');
      const task = manager.createProjectTask(project.id, 'Phase Task');

      // Try to transition from draft directly to development (invalid)
      const req = createMockRequest('PUT', `/api/v1/projects/${project.id}/tasks/${task.id}/phase`, {
        phase: 'development',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });

    it('should return error for missing phase', async () => {
      const manager = getMemoryManager(mockConfig);
      const project = manager.createProject('Missing Phase Test', '/tmp/missing-phase');
      const task = manager.createProjectTask(project.id, 'Phase Task');

      const req = createMockRequest('PUT', `/api/v1/projects/${project.id}/tasks/${task.id}/phase`, {});
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });
  });

  describe('PUT /api/v1/projects/:projectId/tasks/:taskId/assign', () => {
    it('should assign agents to task', async () => {
      const manager = getMemoryManager(mockConfig);
      const project = manager.createProject('Assign Test', '/tmp/assign');
      const task = manager.createProjectTask(project.id, 'Assign Task');

      const req = createMockRequest('PUT', `/api/v1/projects/${project.id}/tasks/${task.id}/assign`, {
        agents: ['architect', 'coder'],
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.assignedAgents).toEqual(['architect', 'coder']);
    });

    it('should return error for missing agents', async () => {
      const manager = getMemoryManager(mockConfig);
      const project = manager.createProject('Assign Test', '/tmp/assign');
      const task = manager.createProjectTask(project.id, 'Assign Task');

      const req = createMockRequest('PUT', `/api/v1/projects/${project.id}/tasks/${task.id}/assign`, {});
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });
  });
});

describe('Specification Routes', () => {
  let router: Router;
  let taskId: string;

  beforeEach(() => {
    resetMemoryManager();
    router = new Router();
    registerSpecificationRoutes(router, mockConfig);

    // Create project and task for specs
    const manager = getMemoryManager(mockConfig);
    const project = manager.createProject('Spec Project', '/tmp/spec');
    const task = manager.createProjectTask(project.id, 'Spec Task');
    taskId = task.id;
  });

  afterEach(() => {
    resetMemoryManager();
  });

  describe('GET /api/v1/tasks/:taskId/specs', () => {
    it('should return empty list when no specs', async () => {
      const req = createMockRequest('GET', `/api/v1/tasks/${taskId}/specs`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('should return list of specs', async () => {
      const manager = getMemoryManager(mockConfig);
      manager.createSpecification(taskId, 'architecture', 'Spec 1', 'Content 1', 'agent');
      manager.createSpecification(taskId, 'requirements', 'Spec 2', 'Content 2', 'agent');

      const req = createMockRequest('GET', `/api/v1/tasks/${taskId}/specs`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);
    });

    it('should filter by status', async () => {
      const manager = getMemoryManager(mockConfig);
      manager.createSpecification(taskId, 'architecture', 'Draft Spec', 'Content', 'agent');
      const spec2 = manager.createSpecification(taskId, 'requirements', 'Review Spec', 'Content', 'agent');
      manager.updateSpecificationStatus(spec2.id, 'pending_review');

      const req = createMockRequest('GET', `/api/v1/tasks/${taskId}/specs?status=draft`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].title).toBe('Draft Spec');
    });
  });

  describe('POST /api/v1/tasks/:taskId/specs', () => {
    it('should create new specification', async () => {
      const req = createMockRequest('POST', `/api/v1/tasks/${taskId}/specs`, {
        type: 'architecture',
        title: 'System Architecture',
        content: '# Architecture\n\nDoc content here.',
        createdBy: 'architect-agent',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('System Architecture');
      expect(body.data.type).toBe('architecture');
      expect(body.data.status).toBe('draft');
      expect(body.data.version).toBe(1);
      expect(body.data.createdBy).toBe('architect-agent');
      expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    });

    it('should return error for missing required fields', async () => {
      const req = createMockRequest('POST', `/api/v1/tasks/${taskId}/specs`, {
        title: 'Incomplete Spec',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });
  });

  describe('GET /api/v1/specs/:specId', () => {
    it('should return specification by id', async () => {
      const manager = getMemoryManager(mockConfig);
      const spec = manager.createSpecification(taskId, 'architecture', 'Get Test Spec', 'Content', 'agent');

      const req = createMockRequest('GET', `/api/v1/specs/${spec.id}`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(spec.id);
      expect(body.data.title).toBe('Get Test Spec');
    });

    it('should return 404 for unknown spec', async () => {
      const req = createMockRequest('GET', '/api/v1/specs/unknown-id');
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('PUT /api/v1/specs/:specId', () => {
    it('should update specification', async () => {
      const manager = getMemoryManager(mockConfig);
      const spec = manager.createSpecification(taskId, 'architecture', 'Original Title', 'Original content', 'agent');

      const req = createMockRequest('PUT', `/api/v1/specs/${spec.id}`, {
        title: 'Updated Title',
        content: 'Updated content',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('Updated Title');
      expect(body.data.content).toBe('Updated content');
    });

    it('should return 404 for unknown spec', async () => {
      const req = createMockRequest('PUT', '/api/v1/specs/unknown-id', {
        title: 'Test',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('DELETE /api/v1/specs/:specId', () => {
    it('should delete specification', async () => {
      const manager = getMemoryManager(mockConfig);
      const spec = manager.createSpecification(taskId, 'architecture', 'Delete Me', 'Content', 'agent');

      const req = createMockRequest('DELETE', `/api/v1/specs/${spec.id}`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });

    it('should return 404 for unknown spec', async () => {
      const req = createMockRequest('DELETE', '/api/v1/specs/unknown-id');
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    });
  });

  describe('PUT /api/v1/specs/:specId/submit', () => {
    it('should submit spec for review', async () => {
      const manager = getMemoryManager(mockConfig);
      const spec = manager.createSpecification(taskId, 'architecture', 'Submit Test', 'Content', 'agent');

      const req = createMockRequest('PUT', `/api/v1/specs/${spec.id}/submit`, {});
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('pending_review');
    });
  });

  describe('PUT /api/v1/specs/:specId/approve', () => {
    it('should approve specification', async () => {
      const manager = getMemoryManager(mockConfig);
      const spec = manager.createSpecification(taskId, 'architecture', 'Approve Test', 'Content', 'agent');
      manager.updateSpecificationStatus(spec.id, 'pending_review');

      const req = createMockRequest('PUT', `/api/v1/specs/${spec.id}/approve`, {
        reviewedBy: 'user',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('approved');
      expect(body.data.reviewedBy).toBe('user');
    });

    it('should fail to approve draft spec', async () => {
      const manager = getMemoryManager(mockConfig);
      const spec = manager.createSpecification(taskId, 'architecture', 'Not Submitted', 'Content', 'agent');

      const req = createMockRequest('PUT', `/api/v1/specs/${spec.id}/approve`, {
        reviewedBy: 'user',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });

    it('should return error for missing reviewedBy', async () => {
      const manager = getMemoryManager(mockConfig);
      const spec = manager.createSpecification(taskId, 'architecture', 'Test', 'Content', 'agent');
      manager.updateSpecificationStatus(spec.id, 'pending_review');

      const req = createMockRequest('PUT', `/api/v1/specs/${spec.id}/approve`, {});
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });
  });

  describe('PUT /api/v1/specs/:specId/reject', () => {
    it('should reject specification', async () => {
      const manager = getMemoryManager(mockConfig);
      const spec = manager.createSpecification(taskId, 'architecture', 'Reject Test', 'Content', 'agent');
      manager.updateSpecificationStatus(spec.id, 'pending_review');

      const req = createMockRequest('PUT', `/api/v1/specs/${spec.id}/reject`, {
        reviewedBy: 'user',
        comments: [{ id: '1', author: 'user', content: 'Needs work', createdAt: new Date().toISOString(), resolved: false }],
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('rejected');
      expect(body.data.reviewedBy).toBe('user');
    });

    it('should fail to reject draft spec', async () => {
      const manager = getMemoryManager(mockConfig);
      const spec = manager.createSpecification(taskId, 'architecture', 'Not Submitted', 'Content', 'agent');

      const req = createMockRequest('PUT', `/api/v1/specs/${spec.id}/reject`, {
        reviewedBy: 'user',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });
  });
});

describe('Filesystem Routes', () => {
  let router: Router;

  beforeEach(() => {
    router = new Router();
    registerFilesystemRoutes(router, mockConfig);
  });

  describe('GET /api/v1/filesystem/roots', () => {
    it('should return filesystem roots', async () => {
      const req = createMockRequest('GET', '/api/v1/filesystem/roots');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
      // Should contain home directory
      expect(body.data.some((e: { type: string }) => e.type === 'directory')).toBe(true);
    });
  });

  describe('GET /api/v1/filesystem/browse', () => {
    it('should browse home directory by default', async () => {
      const req = createMockRequest('GET', '/api/v1/filesystem/browse');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.path).toBeDefined();
      expect(Array.isArray(body.data.entries)).toBe(true);
    });

    it('should browse specified path', async () => {
      const req = createMockRequest('GET', '/api/v1/filesystem/browse?path=/tmp');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      // Path may be resolved differently on various platforms
      expect(body.data.path).toMatch(/\/tmp$/);
    });

    it('should return 400 for non-existent path', async () => {
      const req = createMockRequest('GET', '/api/v1/filesystem/browse?path=/nonexistent-path-12345');
      const res = createMockResponse();

      await router.handle(req, res);

      // Non-existent paths return 400 (badRequest), not 404
      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });

    it('should filter hidden files when showHidden is false', async () => {
      const req = createMockRequest('GET', '/api/v1/filesystem/browse?showHidden=false');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      // Should not contain entries starting with dot
      const hasHidden = body.data.entries.some((e: { name: string }) => e.name.startsWith('.'));
      expect(hasHidden).toBe(false);
    });
  });

  describe('POST /api/v1/filesystem/validate', () => {
    it('should validate existing directory path', async () => {
      const req = createMockRequest('POST', '/api/v1/filesystem/validate', {
        path: '/tmp',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.exists).toBe(true);
      expect(body.data.isDirectory).toBe(true);
      expect(body.data.readable).toBe(true);
    });

    it('should return invalid for non-existent path', async () => {
      const req = createMockRequest('POST', '/api/v1/filesystem/validate', {
        path: '/nonexistent-path-12345',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.valid).toBe(false);
      expect(body.data.exists).toBe(false);
      expect(body.data.errors.length).toBeGreaterThan(0);
    });

    it('should return error without path', async () => {
      const req = createMockRequest('POST', '/api/v1/filesystem/validate', {});
      const res = createMockResponse();

      await router.handle(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    });

    it('should detect file vs directory (file is invalid for validation)', async () => {
      const req = createMockRequest('POST', '/api/v1/filesystem/validate', {
        path: '/etc/passwd',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody();
      expect(body.success).toBe(true);
      expect(body.data.exists).toBe(true);
      expect(body.data.isDirectory).toBe(false);
      // validate endpoint is for directories, so files are invalid
      expect(body.data.valid).toBe(false);
    });
  });
});
