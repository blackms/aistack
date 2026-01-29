/**
 * Consensus Routes tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { registerConsensusRoutes } from '../../../src/web/routes/consensus.js';
import { Router } from '../../../src/web/router.js';
import type { AgentStackConfig } from '../../../src/types.js';
import { resetMemoryManager, getMemoryManager } from '../../../src/memory/index.js';
import { resetConsensusService, getConsensusService } from '../../../src/tasks/consensus-service.js';

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
  consensus: {
    enabled: true,
    requireForRiskLevels: ['high', 'medium'],
    reviewerStrategy: 'adversarial',
    timeout: 300000,
    maxDepth: 5,
    autoReject: false,
  },
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

describe('Consensus Routes', () => {
  let router: Router;

  beforeEach(() => {
    resetMemoryManager();
    resetConsensusService();
    router = new Router();
    registerConsensusRoutes(router, mockConfig);
  });

  afterEach(() => {
    resetMemoryManager();
    resetConsensusService();
  });

  describe('GET /api/v1/consensus/config', () => {
    it('should return consensus configuration', async () => {
      const req = createMockRequest('GET', '/api/v1/consensus/config');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody() as any;
      expect(body.success).toBe(true);
      expect(body.data.enabled).toBe(true);
      expect(body.data.requireForRiskLevels).toEqual(['high', 'medium']);
      expect(body.data.reviewerStrategy).toBe('adversarial');
      expect(body.data.timeout).toBe(300000);
      expect(body.data.maxDepth).toBe(5);
    });
  });

  describe('GET /api/v1/consensus/pending', () => {
    it('should return empty list when no pending checkpoints', async () => {
      const req = createMockRequest('GET', '/api/v1/consensus/pending');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody() as any;
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(0);
    });

    it('should return pending checkpoints with pagination', async () => {
      const req = createMockRequest('GET', '/api/v1/consensus/pending?limit=10&offset=0');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody() as any;
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.pagination).toBeDefined();
      expect(body.pagination.limit).toBe(10);
      expect(body.pagination.offset).toBe(0);
    });

    it('should return accurate total count independent of limit', async () => {
      // Create 3 checkpoints
      const manager = getMemoryManager(mockConfig);
      const service = getConsensusService(manager.getStore(), mockConfig);

      service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [{ id: 's1', agentType: 'coder', input: 'Test', estimatedRiskLevel: 'high', parentTaskId: 'task-1' }],
        riskLevel: 'high',
      });
      service.createCheckpoint({
        taskId: 'task-2',
        proposedSubtasks: [{ id: 's2', agentType: 'coder', input: 'Test', estimatedRiskLevel: 'high', parentTaskId: 'task-2' }],
        riskLevel: 'high',
      });
      service.createCheckpoint({
        taskId: 'task-3',
        proposedSubtasks: [{ id: 's3', agentType: 'coder', input: 'Test', estimatedRiskLevel: 'high', parentTaskId: 'task-3' }],
        riskLevel: 'high',
      });

      // Request with limit=1 should still show total=3
      const req = createMockRequest('GET', '/api/v1/consensus/pending?limit=1&offset=0');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody() as any;
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(1); // Only 1 returned due to limit
      expect(body.pagination.total).toBe(3); // But total is accurate
      expect(body.pagination.limit).toBe(1);
    });
  });

  describe('POST /api/v1/consensus/check', () => {
    it('should check if consensus is required for high-risk agent', async () => {
      const req = createMockRequest('POST', '/api/v1/consensus/check', {
        agentType: 'coder',
        input: 'Write some code',
        parentTaskId: 'some-parent-id',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody() as any;
      expect(body.success).toBe(true);
      expect(body.data.requiresConsensus).toBeDefined();
      expect(body.data.riskLevel).toBe('high'); // coder is high risk
    });

    it('should estimate low risk for researcher agent', async () => {
      const req = createMockRequest('POST', '/api/v1/consensus/check', {
        agentType: 'researcher',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody() as any;
      expect(body.success).toBe(true);
      expect(body.data.riskLevel).toBe('low'); // researcher is low risk
    });

    it('should use provided risk level override', async () => {
      const req = createMockRequest('POST', '/api/v1/consensus/check', {
        agentType: 'researcher',
        riskLevel: 'high',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody() as any;
      expect(body.success).toBe(true);
      expect(body.data.riskLevel).toBe('high');
    });

    it('should return consensus config in response', async () => {
      const req = createMockRequest('POST', '/api/v1/consensus/check', {
        agentType: 'coder',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody() as any;
      expect(body.success).toBe(true);
      expect(body.data.config).toBeDefined();
      expect(body.data.config.enabled).toBe(true);
      expect(body.data.config.requireForRiskLevels).toEqual(['high', 'medium']);
      expect(body.data.config.maxDepth).toBe(5);
    });
  });

  describe('POST /api/v1/consensus/expire', () => {
    it('should expire old checkpoints', async () => {
      const req = createMockRequest('POST', '/api/v1/consensus/expire');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody() as any;
      expect(body.success).toBe(true);
      expect(body.data.success).toBe(true);
      expect(body.data.expiredCount).toBe(0);
    });
  });

  describe('GET /api/v1/consensus/:id', () => {
    it('should return 404 for non-existent checkpoint', async () => {
      const req = createMockRequest('GET', '/api/v1/consensus/non-existent-id');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain('not found');
    });

    it('should return checkpoint details when exists', async () => {
      // Create a checkpoint first
      const manager = getMemoryManager(mockConfig);
      const service = getConsensusService(manager.getStore(), mockConfig);
      const checkpoint = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [{
          id: 'subtask-1',
          agentType: 'coder',
          input: 'Test',
          estimatedRiskLevel: 'high',
          parentTaskId: 'task-1',
        }],
        riskLevel: 'high',
      });

      const req = createMockRequest('GET', `/api/v1/consensus/${checkpoint.id}`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody() as any;
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(checkpoint.id);
      expect(body.data.taskId).toBe('task-1');
      expect(body.data.riskLevel).toBe('high');
      expect(body.data.status).toBe('pending');
    });
  });

  describe('PUT /api/v1/consensus/:id/approve', () => {
    it('should approve a checkpoint', async () => {
      // Create a checkpoint first
      const manager = getMemoryManager(mockConfig);
      const service = getConsensusService(manager.getStore(), mockConfig);
      const checkpoint = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [],
        riskLevel: 'high',
      });

      const req = createMockRequest('PUT', `/api/v1/consensus/${checkpoint.id}/approve`, {
        reviewedBy: 'user-1',
        feedback: 'Looks good',
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody() as any;
      expect(body.success).toBe(true);
      expect(body.data.success).toBe(true);
      expect(body.data.checkpoint.status).toBe('approved');
    });

    it('should fail when reviewedBy is missing', async () => {
      const manager = getMemoryManager(mockConfig);
      const service = getConsensusService(manager.getStore(), mockConfig);
      const checkpoint = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [],
        riskLevel: 'high',
      });

      const req = createMockRequest('PUT', `/api/v1/consensus/${checkpoint.id}/approve`, {});
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain('reviewedBy is required');
    });
  });

  describe('PUT /api/v1/consensus/:id/reject', () => {
    it('should reject a checkpoint', async () => {
      // Create a checkpoint first
      const manager = getMemoryManager(mockConfig);
      const service = getConsensusService(manager.getStore(), mockConfig);
      const checkpoint = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [{
          id: 'subtask-1',
          agentType: 'coder',
          input: 'Risky',
          estimatedRiskLevel: 'high',
          parentTaskId: 'task-1',
        }],
        riskLevel: 'high',
      });

      const req = createMockRequest('PUT', `/api/v1/consensus/${checkpoint.id}/reject`, {
        reviewedBy: 'user-1',
        feedback: 'Too risky',
        rejectedSubtaskIds: ['subtask-1'],
      });
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody() as any;
      expect(body.success).toBe(true);
      expect(body.data.success).toBe(true);
      expect(body.data.checkpoint.status).toBe('rejected');
    });
  });

  describe('POST /api/v1/consensus/:id/start-review', () => {
    it('should start agent review for a checkpoint', async () => {
      // Create a checkpoint first
      const manager = getMemoryManager(mockConfig);
      const service = getConsensusService(manager.getStore(), mockConfig);
      const checkpoint = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [{
          id: 'subtask-1',
          agentType: 'coder',
          input: 'Test',
          estimatedRiskLevel: 'high',
          parentTaskId: 'task-1',
        }],
        riskLevel: 'high',
      });

      const req = createMockRequest('POST', `/api/v1/consensus/${checkpoint.id}/start-review`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody() as any;
      expect(body.success).toBe(true);
      expect(body.data.success).toBe(true);
      expect(body.data.reviewerConfig).toBeDefined();
      expect(body.data.reviewerConfig.agentType).toBe('adversarial');
      expect(body.data.reviewerConfig.checkpointId).toBe(checkpoint.id);
    });

    it('should fail for non-existent checkpoint', async () => {
      const req = createMockRequest('POST', '/api/v1/consensus/non-existent/start-review');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain('Checkpoint not found');
    });
  });

  describe('GET /api/v1/consensus/:id/events', () => {
    it('should return checkpoint events', async () => {
      // Create a checkpoint first
      const manager = getMemoryManager(mockConfig);
      const service = getConsensusService(manager.getStore(), mockConfig);
      const checkpoint = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [],
        riskLevel: 'high',
      });

      // Approve it to generate events
      service.approveCheckpoint(checkpoint.id, 'user-1', 'LGTM');

      const req = createMockRequest('GET', `/api/v1/consensus/${checkpoint.id}/events`);
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody() as any;
      expect(body.success).toBe(true);
      expect(body.data.checkpointId).toBe(checkpoint.id);
      expect(body.data.events.length).toBeGreaterThanOrEqual(2); // created + approved
      expect(body.data.events.some((e: any) => e.eventType === 'created')).toBe(true);
      expect(body.data.events.some((e: any) => e.eventType === 'approved')).toBe(true);
    });

    it('should return 404 for non-existent checkpoint', async () => {
      const req = createMockRequest('GET', '/api/v1/consensus/non-existent/events');
      const res = createMockResponse();

      await router.handle(req, res);

      const body = res.getBody() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain('not found');
    });
  });
});
