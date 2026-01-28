import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerReviewLoopRoutes } from '../../../../src/web/routes/review-loops.js';
import type { Router } from '../../../../src/web/router.js';
import type { AgentStackConfig } from '../../../../src/types.js';
import type { ServerResponse } from 'node:http';
import type { ReviewLoopState } from '../../../../src/types.js';

// Mock dependencies
vi.mock('../../../../src/coordination/review-loop.js', () => ({
  createReviewLoop: vi.fn(),
  getReviewLoop: vi.fn(),
  listReviewLoops: vi.fn(),
  abortReviewLoop: vi.fn(),
}));

vi.mock('../../../../src/web/websocket/event-bridge.js', () => ({
  agentEvents: {
    emit: vi.fn(),
  },
}));

import {
  createReviewLoop,
  getReviewLoop,
  listReviewLoops,
  abortReviewLoop,
} from '../../../../src/coordination/review-loop.js';
import { agentEvents } from '../../../../src/web/websocket/event-bridge.js';

describe('Review Loop Routes', () => {
  let mockRouter: Router;
  let mockConfig: AgentStackConfig;
  let routeHandlers: Record<string, Function>;
  let mockRes: Partial<ServerResponse>;
  let resStatus: number;
  let resBody: string;

  beforeEach(() => {
    routeHandlers = {};

    mockRouter = {
      get: vi.fn((path: string, handler: Function) => {
        routeHandlers[`GET ${path}`] = handler;
      }),
      post: vi.fn((path: string, handler: Function) => {
        routeHandlers[`POST ${path}`] = handler;
      }),
      put: vi.fn(),
      delete: vi.fn(),
      patch: vi.fn(),
    } as unknown as Router;

    mockConfig = {
      version: '1.0.0',
      memory: {
        path: ':memory:',
        defaultNamespace: 'test',
        vectorSearch: { enabled: false },
      },
      providers: { llm: {}, embeddings: {} },
      agents: {},
      github: { enabled: false },
      plugins: { enabled: false, directory: 'plugins' },
      mcp: { enabled: false, servers: {} },
      hooks: { session: {}, task: {}, workflow: {} },
    };

    resStatus = 0;
    resBody = '';

    mockRes = {
      writeHead: vi.fn((status: number) => {
        resStatus = status;
        return mockRes as ServerResponse;
      }),
      end: vi.fn((body?: string) => {
        if (body) resBody = body;
        return mockRes as ServerResponse;
      }),
    };

    registerReviewLoopRoutes(mockRouter, mockConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/review-loops', () => {
    it('should return empty array when no loops', () => {
      vi.mocked(listReviewLoops).mockReturnValue([]);

      const handler = routeHandlers['GET /api/v1/review-loops'];
      handler({}, mockRes, { path: [], query: {}, body: undefined });

      expect(resStatus).toBe(200);
      const response = JSON.parse(resBody);
      // sendJson wraps in { success, data, timestamp }
      expect(response.data).toEqual([]);
    });

    it('should return formatted loop list with all fields', () => {
      const startedAt = new Date('2024-01-01T10:00:00Z');
      const completedAt = new Date('2024-01-01T10:30:00Z');

      vi.mocked(listReviewLoops).mockReturnValue([
        {
          id: 'loop-123',
          coderId: 'coder-456',
          adversarialId: 'adv-789',
          sessionId: 'session-001',
          iteration: 3,
          maxIterations: 5,
          status: 'in_progress' as const,
          finalVerdict: undefined,
          startedAt,
          completedAt: undefined,
          reviews: [{ reviewId: 'r1' }, { reviewId: 'r2' }],
          codeInput: 'code',
          currentCode: 'code',
        } as unknown as ReviewLoopState,
        {
          id: 'loop-456',
          coderId: 'coder-789',
          adversarialId: 'adv-012',
          sessionId: 'session-002',
          iteration: 5,
          maxIterations: 5,
          status: 'completed' as const,
          finalVerdict: 'approved',
          startedAt,
          completedAt,
          reviews: [{ reviewId: 'r3' }],
          codeInput: 'code2',
          currentCode: 'code2',
        } as unknown as ReviewLoopState,
      ]);

      const handler = routeHandlers['GET /api/v1/review-loops'];
      handler({}, mockRes, { path: [], query: {}, body: undefined });

      expect(resStatus).toBe(200);
      const response = JSON.parse(resBody);
      expect(response.data).toHaveLength(2);
      expect(response.data[0].id).toBe('loop-123');
      expect(response.data[0].coderId).toBe('coder-456');
      expect(response.data[0].reviewCount).toBe(2);
      expect(response.data[1].completedAt).toBe('2024-01-01T10:30:00.000Z');
    });

    it('should format dates as ISO strings', () => {
      const startedAt = new Date('2024-06-15T14:30:00Z');

      vi.mocked(listReviewLoops).mockReturnValue([
        {
          id: 'loop-123',
          coderId: 'coder-456',
          adversarialId: 'adv-789',
          sessionId: 'session-001',
          iteration: 1,
          maxIterations: 3,
          status: 'in_progress' as const,
          startedAt,
          reviews: [],
          codeInput: 'code',
          currentCode: 'code',
        } as unknown as ReviewLoopState,
      ]);

      const handler = routeHandlers['GET /api/v1/review-loops'];
      handler({}, mockRes, { path: [], query: {}, body: undefined });

      const response = JSON.parse(resBody);
      expect(response.data[0].startedAt).toBe('2024-06-15T14:30:00.000Z');
    });

    it('should include review count', () => {
      vi.mocked(listReviewLoops).mockReturnValue([
        {
          id: 'loop-123',
          coderId: 'coder-456',
          adversarialId: 'adv-789',
          sessionId: 'session-001',
          iteration: 1,
          maxIterations: 3,
          status: 'in_progress' as const,
          startedAt: new Date(),
          reviews: [{}, {}, {}],
          codeInput: 'code',
          currentCode: 'code',
        } as unknown as ReviewLoopState,
      ]);

      const handler = routeHandlers['GET /api/v1/review-loops'];
      handler({}, mockRes, { path: [], query: {}, body: undefined });

      const response = JSON.parse(resBody);
      expect(response.data[0].reviewCount).toBe(3);
    });
  });

  describe('POST /api/v1/review-loops', () => {
    it('should create loop with codeInput', async () => {
      const mockLoop = {
        id: 'loop-123',
        coderId: 'coder-456',
        adversarialId: 'adv-789',
        status: 'in_progress',
        iteration: 1,
        maxIterations: 3,
        startedAt: new Date(),
      };

      vi.mocked(createReviewLoop).mockResolvedValue(mockLoop as any);
      vi.mocked(getReviewLoop).mockReturnValue(null);

      const handler = routeHandlers['POST /api/v1/review-loops'];
      await handler({}, mockRes, {
        path: [],
        query: {},
        body: { codeInput: 'function test() {}' },
      });

      expect(createReviewLoop).toHaveBeenCalledWith(
        'function test() {}',
        mockConfig,
        { maxIterations: undefined, sessionId: undefined }
      );
      expect(resStatus).toBe(202);
    });

    it('should throw badRequest when codeInput missing', async () => {
      const handler = routeHandlers['POST /api/v1/review-loops'];

      await expect(
        handler({}, mockRes, { path: [], query: {}, body: {} })
      ).rejects.toThrow('Code input is required');
    });

    it('should throw badRequest when body is undefined', async () => {
      const handler = routeHandlers['POST /api/v1/review-loops'];

      await expect(
        handler({}, mockRes, { path: [], query: {}, body: undefined })
      ).rejects.toThrow('Code input is required');
    });

    it('should pass optional maxIterations and sessionId', async () => {
      const mockLoop = {
        id: 'loop-123',
        coderId: 'coder-456',
        adversarialId: 'adv-789',
        status: 'in_progress',
        iteration: 1,
        maxIterations: 10,
        startedAt: new Date(),
      };

      vi.mocked(createReviewLoop).mockResolvedValue(mockLoop as any);
      vi.mocked(getReviewLoop).mockReturnValue(null);

      const handler = routeHandlers['POST /api/v1/review-loops'];
      await handler({}, mockRes, {
        path: [],
        query: {},
        body: {
          codeInput: 'function test() {}',
          maxIterations: 10,
          sessionId: 'my-session',
        },
      });

      expect(createReviewLoop).toHaveBeenCalledWith(
        'function test() {}',
        mockConfig,
        { maxIterations: 10, sessionId: 'my-session' }
      );
    });

    it('should return 202 with loop details', async () => {
      const startedAt = new Date('2024-01-01T10:00:00Z');
      const mockLoop = {
        id: 'loop-123',
        coderId: 'coder-456',
        adversarialId: 'adv-789',
        status: 'in_progress',
        iteration: 1,
        maxIterations: 3,
        startedAt,
      };

      vi.mocked(createReviewLoop).mockResolvedValue(mockLoop as any);
      vi.mocked(getReviewLoop).mockReturnValue(null);

      const handler = routeHandlers['POST /api/v1/review-loops'];
      await handler({}, mockRes, {
        path: [],
        query: {},
        body: { codeInput: 'code' },
      });

      expect(resStatus).toBe(202);
      const response = JSON.parse(resBody);
      // sendJson wraps in { success, data, timestamp }
      expect(response.data.id).toBe('loop-123');
      expect(response.data.coderId).toBe('coder-456');
      expect(response.data.startedAt).toBe('2024-01-01T10:00:00.000Z');
    });

    it('should handle createReviewLoop failure', async () => {
      vi.mocked(createReviewLoop).mockRejectedValue(new Error('Creation failed'));

      const handler = routeHandlers['POST /api/v1/review-loops'];

      await expect(
        handler({}, mockRes, { path: [], query: {}, body: { codeInput: 'code' } })
      ).rejects.toThrow('Failed to create review loop');
    });

    it('should attach event handlers when coordinator exists', async () => {
      const mockLoop = {
        id: 'loop-123',
        coderId: 'coder-456',
        adversarialId: 'adv-789',
        status: 'in_progress',
        iteration: 1,
        maxIterations: 3,
        startedAt: new Date(),
      };

      const mockCoordinator = {
        on: vi.fn(),
        getState: vi.fn(),
      };

      vi.mocked(createReviewLoop).mockResolvedValue(mockLoop as any);
      vi.mocked(getReviewLoop).mockReturnValue(mockCoordinator as any);

      const handler = routeHandlers['POST /api/v1/review-loops'];
      await handler({}, mockRes, {
        path: [],
        query: {},
        body: { codeInput: 'code' },
      });

      expect(mockCoordinator.on).toHaveBeenCalledWith('loop:start', expect.any(Function));
      expect(mockCoordinator.on).toHaveBeenCalledWith('loop:iteration', expect.any(Function));
      expect(mockCoordinator.on).toHaveBeenCalledWith('loop:review', expect.any(Function));
      expect(mockCoordinator.on).toHaveBeenCalledWith('loop:fix', expect.any(Function));
      expect(mockCoordinator.on).toHaveBeenCalledWith('loop:approved', expect.any(Function));
      expect(mockCoordinator.on).toHaveBeenCalledWith('loop:complete', expect.any(Function));
      expect(mockCoordinator.on).toHaveBeenCalledWith('loop:error', expect.any(Function));
    });
  });

  describe('GET /api/v1/review-loops/:id', () => {
    it('should return full loop details', () => {
      const startedAt = new Date('2024-01-01T10:00:00Z');
      const reviewTimestamp = new Date('2024-01-01T10:15:00Z');

      const mockState = {
        id: 'loop-123',
        coderId: 'coder-456',
        adversarialId: 'adv-789',
        sessionId: 'session-001',
        iteration: 2,
        maxIterations: 5,
        status: 'in_progress',
        codeInput: 'original code',
        currentCode: 'updated code',
        reviews: [
          {
            reviewId: 'review-1',
            verdict: 'needs_changes',
            issues: [{ type: 'error', message: 'Fix this' }],
            summary: 'Review summary',
            timestamp: reviewTimestamp,
          },
        ],
        finalVerdict: undefined,
        startedAt,
        completedAt: undefined,
      };

      const mockCoordinator = {
        getState: vi.fn().mockReturnValue(mockState),
      };

      vi.mocked(getReviewLoop).mockReturnValue(mockCoordinator as any);

      const handler = routeHandlers['GET /api/v1/review-loops/:id'];
      handler({}, mockRes, { path: ['loop-123'], query: {}, body: undefined });

      expect(resStatus).toBe(200);
      const response = JSON.parse(resBody);
      // sendJson wraps in { success, data, timestamp }
      expect(response.data.id).toBe('loop-123');
      expect(response.data.codeInput).toBe('original code');
      expect(response.data.currentCode).toBe('updated code');
      expect(response.data.reviews).toHaveLength(1);
      expect(response.data.reviews[0].timestamp).toBe('2024-01-01T10:15:00.000Z');
    });

    it('should throw badRequest when id missing', () => {
      const handler = routeHandlers['GET /api/v1/review-loops/:id'];

      expect(() => {
        handler({}, mockRes, { path: [], query: {}, body: undefined });
      }).toThrow('Review loop ID is required');
    });

    it('should throw notFound for nonexistent loop', () => {
      vi.mocked(getReviewLoop).mockReturnValue(null);

      const handler = routeHandlers['GET /api/v1/review-loops/:id'];

      expect(() => {
        handler({}, mockRes, { path: ['nonexistent'], query: {}, body: undefined });
      }).toThrow();
    });

    it('should format reviews array correctly', () => {
      const mockState = {
        id: 'loop-123',
        coderId: 'coder-456',
        adversarialId: 'adv-789',
        sessionId: 'session-001',
        iteration: 3,
        maxIterations: 5,
        status: 'completed',
        codeInput: 'code',
        currentCode: 'code',
        reviews: [
          {
            reviewId: 'r1',
            verdict: 'needs_changes',
            issues: [{ type: 'warning', message: 'msg1' }],
            summary: 'summary1',
            timestamp: new Date('2024-01-01T10:00:00Z'),
          },
          {
            reviewId: 'r2',
            verdict: 'approved',
            issues: [],
            summary: 'summary2',
            timestamp: new Date('2024-01-01T10:30:00Z'),
          },
        ],
        startedAt: new Date(),
      };

      const mockCoordinator = {
        getState: vi.fn().mockReturnValue(mockState),
      };

      vi.mocked(getReviewLoop).mockReturnValue(mockCoordinator as any);

      const handler = routeHandlers['GET /api/v1/review-loops/:id'];
      handler({}, mockRes, { path: ['loop-123'], query: {}, body: undefined });

      const response = JSON.parse(resBody);
      // sendJson wraps in { success, data, timestamp }
      expect(response.data.reviews).toHaveLength(2);
      expect(response.data.reviews[0].reviewId).toBe('r1');
      expect(response.data.reviews[1].verdict).toBe('approved');
    });
  });

  describe('POST /api/v1/review-loops/:id/abort', () => {
    it('should abort existing loop successfully', () => {
      vi.mocked(abortReviewLoop).mockReturnValue(true);

      const handler = routeHandlers['POST /api/v1/review-loops/:id/abort'];
      handler({}, mockRes, { path: ['loop-123'], query: {}, body: undefined });

      expect(abortReviewLoop).toHaveBeenCalledWith('loop-123');
      expect(resStatus).toBe(200);
      const response = JSON.parse(resBody);
      // sendJson wraps in { success, data, timestamp }
      expect(response.data.loopId).toBe('loop-123');
      expect(response.data.status).toBe('aborted');
    });

    it('should throw badRequest when id missing', () => {
      const handler = routeHandlers['POST /api/v1/review-loops/:id/abort'];

      expect(() => {
        handler({}, mockRes, { path: [], query: {}, body: undefined });
      }).toThrow('Review loop ID is required');
    });

    it('should throw notFound for nonexistent loop', () => {
      vi.mocked(abortReviewLoop).mockReturnValue(false);

      const handler = routeHandlers['POST /api/v1/review-loops/:id/abort'];

      expect(() => {
        handler({}, mockRes, { path: ['nonexistent'], query: {}, body: undefined });
      }).toThrow();
    });

    it('should emit review-loop:aborted event', () => {
      vi.mocked(abortReviewLoop).mockReturnValue(true);

      const handler = routeHandlers['POST /api/v1/review-loops/:id/abort'];
      handler({}, mockRes, { path: ['loop-123'], query: {}, body: undefined });

      expect(agentEvents.emit).toHaveBeenCalledWith('review-loop:aborted', {
        loopId: 'loop-123',
      });
    });
  });

  describe('event wiring', () => {
    it('should emit review-loop:start event when loop:start fires', async () => {
      const mockLoop = {
        id: 'loop-123',
        coderId: 'coder-456',
        adversarialId: 'adv-789',
        status: 'in_progress',
        iteration: 1,
        maxIterations: 3,
        startedAt: new Date(),
      };

      const eventHandlers: Record<string, Function> = {};
      const mockCoordinator = {
        on: vi.fn((event: string, handler: Function) => {
          eventHandlers[event] = handler;
        }),
        getState: vi.fn(),
      };

      vi.mocked(createReviewLoop).mockResolvedValue(mockLoop as any);
      vi.mocked(getReviewLoop).mockReturnValue(mockCoordinator as any);

      const handler = routeHandlers['POST /api/v1/review-loops'];
      await handler({}, mockRes, {
        path: [],
        query: {},
        body: { codeInput: 'code' },
      });

      // Simulate the loop:start event
      const mockState = { id: 'loop-123', status: 'in_progress' };
      eventHandlers['loop:start'](mockState);

      expect(agentEvents.emit).toHaveBeenCalledWith('review-loop:start', {
        loopId: 'loop-123',
        state: mockState,
      });
    });

    it('should emit review-loop:iteration event when loop:iteration fires', async () => {
      const mockLoop = {
        id: 'loop-123',
        coderId: 'coder-456',
        adversarialId: 'adv-789',
        status: 'in_progress',
        iteration: 1,
        maxIterations: 3,
        startedAt: new Date(),
      };

      const eventHandlers: Record<string, Function> = {};
      const mockCoordinator = {
        on: vi.fn((event: string, handler: Function) => {
          eventHandlers[event] = handler;
        }),
        getState: vi.fn(),
      };

      vi.mocked(createReviewLoop).mockResolvedValue(mockLoop as any);
      vi.mocked(getReviewLoop).mockReturnValue(mockCoordinator as any);

      const handler = routeHandlers['POST /api/v1/review-loops'];
      await handler({}, mockRes, {
        path: [],
        query: {},
        body: { codeInput: 'code' },
      });

      const mockState = { id: 'loop-123', status: 'in_progress' };
      eventHandlers['loop:iteration'](2, mockState);

      expect(agentEvents.emit).toHaveBeenCalledWith('review-loop:iteration', {
        loopId: 'loop-123',
        iteration: 2,
        state: mockState,
      });
    });

    it('should emit review-loop:error event when loop:error fires', async () => {
      const mockLoop = {
        id: 'loop-123',
        coderId: 'coder-456',
        adversarialId: 'adv-789',
        status: 'in_progress',
        iteration: 1,
        maxIterations: 3,
        startedAt: new Date(),
      };

      const eventHandlers: Record<string, Function> = {};
      const mockCoordinator = {
        on: vi.fn((event: string, handler: Function) => {
          eventHandlers[event] = handler;
        }),
        getState: vi.fn(),
      };

      vi.mocked(createReviewLoop).mockResolvedValue(mockLoop as any);
      vi.mocked(getReviewLoop).mockReturnValue(mockCoordinator as any);

      const handler = routeHandlers['POST /api/v1/review-loops'];
      await handler({}, mockRes, {
        path: [],
        query: {},
        body: { codeInput: 'code' },
      });

      const mockState = { id: 'loop-123', status: 'error' };
      const mockError = new Error('Something went wrong');
      eventHandlers['loop:error'](mockError, mockState);

      expect(agentEvents.emit).toHaveBeenCalledWith('review-loop:error', {
        loopId: 'loop-123',
        error: 'Something went wrong',
        state: mockState,
      });
    });

    it('should emit review-loop:complete event when loop:complete fires', async () => {
      const mockLoop = {
        id: 'loop-123',
        coderId: 'coder-456',
        adversarialId: 'adv-789',
        status: 'in_progress',
        iteration: 1,
        maxIterations: 3,
        startedAt: new Date(),
      };

      const eventHandlers: Record<string, Function> = {};
      const mockCoordinator = {
        on: vi.fn((event: string, handler: Function) => {
          eventHandlers[event] = handler;
        }),
        getState: vi.fn(),
      };

      vi.mocked(createReviewLoop).mockResolvedValue(mockLoop as any);
      vi.mocked(getReviewLoop).mockReturnValue(mockCoordinator as any);

      const handler = routeHandlers['POST /api/v1/review-loops'];
      await handler({}, mockRes, {
        path: [],
        query: {},
        body: { codeInput: 'code' },
      });

      const mockState = { id: 'loop-123', status: 'completed' };
      eventHandlers['loop:complete'](mockState);

      expect(agentEvents.emit).toHaveBeenCalledWith('review-loop:complete', {
        loopId: 'loop-123',
        state: mockState,
      });
    });

    it('should emit review-loop:fix event when loop:fix fires', async () => {
      const mockLoop = {
        id: 'loop-123',
        coderId: 'coder-456',
        adversarialId: 'adv-789',
        status: 'in_progress',
        iteration: 1,
        maxIterations: 3,
        startedAt: new Date(),
      };

      const eventHandlers: Record<string, Function> = {};
      const mockCoordinator = {
        on: vi.fn((event: string, handler: Function) => {
          eventHandlers[event] = handler;
        }),
        getState: vi.fn(),
      };

      vi.mocked(createReviewLoop).mockResolvedValue(mockLoop as any);
      vi.mocked(getReviewLoop).mockReturnValue(mockCoordinator as any);

      const handler = routeHandlers['POST /api/v1/review-loops'];
      await handler({}, mockRes, {
        path: [],
        query: {},
        body: { codeInput: 'code' },
      });

      const mockState = { id: 'loop-123', status: 'in_progress' };
      const mockIssues = [{ type: 'error', message: 'Fix this bug' }];
      eventHandlers['loop:fix'](2, mockIssues, mockState);

      expect(agentEvents.emit).toHaveBeenCalledWith('review-loop:fix', {
        loopId: 'loop-123',
        iteration: 2,
        issues: mockIssues,
        state: mockState,
      });
    });

    it('should emit review-loop:approved event when loop:approved fires', async () => {
      const mockLoop = {
        id: 'loop-123',
        coderId: 'coder-456',
        adversarialId: 'adv-789',
        status: 'in_progress',
        iteration: 1,
        maxIterations: 3,
        startedAt: new Date(),
      };

      const eventHandlers: Record<string, Function> = {};
      const mockCoordinator = {
        on: vi.fn((event: string, handler: Function) => {
          eventHandlers[event] = handler;
        }),
        getState: vi.fn(),
      };

      vi.mocked(createReviewLoop).mockResolvedValue(mockLoop as any);
      vi.mocked(getReviewLoop).mockReturnValue(mockCoordinator as any);

      const handler = routeHandlers['POST /api/v1/review-loops'];
      await handler({}, mockRes, {
        path: [],
        query: {},
        body: { codeInput: 'code' },
      });

      const mockState = { id: 'loop-123', status: 'approved' };
      eventHandlers['loop:approved'](mockState);

      expect(agentEvents.emit).toHaveBeenCalledWith('review-loop:approved', {
        loopId: 'loop-123',
        state: mockState,
      });
    });

    it('should emit review-loop:review event when loop:review fires', async () => {
      const mockLoop = {
        id: 'loop-123',
        coderId: 'coder-456',
        adversarialId: 'adv-789',
        status: 'in_progress',
        iteration: 1,
        maxIterations: 3,
        startedAt: new Date(),
      };

      const eventHandlers: Record<string, Function> = {};
      const mockCoordinator = {
        on: vi.fn((event: string, handler: Function) => {
          eventHandlers[event] = handler;
        }),
        getState: vi.fn(),
      };

      vi.mocked(createReviewLoop).mockResolvedValue(mockLoop as any);
      vi.mocked(getReviewLoop).mockReturnValue(mockCoordinator as any);

      const handler = routeHandlers['POST /api/v1/review-loops'];
      await handler({}, mockRes, {
        path: [],
        query: {},
        body: { codeInput: 'code' },
      });

      const mockState = { id: 'loop-123', status: 'in_progress' };
      const mockResult = { verdict: 'needs_changes', issues: [] };
      eventHandlers['loop:review'](mockResult, mockState);

      expect(agentEvents.emit).toHaveBeenCalledWith('review-loop:review', {
        loopId: 'loop-123',
        result: mockResult,
        state: mockState,
      });
    });
  });
});
