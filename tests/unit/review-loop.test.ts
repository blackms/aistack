/**
 * Tests for ReviewLoopCoordinator
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ReviewLoopCoordinator,
  createReviewLoop,
  getReviewLoop,
  listReviewLoops,
  abortReviewLoop,
  clearReviewLoops,
} from '../../src/coordination/review-loop.js';
import { clearAgents } from '../../src/agents/spawner.js';
import type { AgentStackConfig } from '../../src/types.js';

// Mock the spawner module
vi.mock('../../src/agents/spawner.js', async () => {
  const actual = await vi.importActual('../../src/agents/spawner.js');
  return {
    ...actual,
    executeAgent: vi.fn(),
  };
});

import { executeAgent } from '../../src/agents/spawner.js';

const mockConfig: AgentStackConfig = {
  version: '1.0.0',
  memory: {
    path: ':memory:',
    defaultNamespace: 'test',
    vectorSearch: { enabled: false },
  },
  providers: {
    default: 'anthropic',
    anthropic: { apiKey: 'test-key' },
  },
  agents: { maxConcurrent: 5, defaultTimeout: 30000 },
  github: { enabled: false },
  plugins: { enabled: false, directory: '' },
  mcp: { transport: 'stdio' },
  hooks: { sessionStart: false, sessionEnd: false, preTask: false, postTask: false },
};

describe('ReviewLoopCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearReviewLoops();
    clearAgents();
  });

  afterEach(() => {
    clearReviewLoops();
    clearAgents();
  });

  describe('constructor', () => {
    it('should create a review loop with default options', () => {
      const coordinator = new ReviewLoopCoordinator('test code', mockConfig);
      const state = coordinator.getState();

      expect(state.id).toBeDefined();
      expect(state.codeInput).toBe('test code');
      expect(state.maxIterations).toBe(3);
      expect(state.iteration).toBe(0);
      expect(state.status).toBe('pending');
      expect(state.reviews).toEqual([]);

      coordinator.cleanup();
    });

    it('should create a review loop with custom options', () => {
      const coordinator = new ReviewLoopCoordinator('test code', mockConfig, {
        maxIterations: 5,
        sessionId: '123e4567-e89b-12d3-a456-426614174000',
      });
      const state = coordinator.getState();

      expect(state.maxIterations).toBe(5);
      expect(state.sessionId).toBe('123e4567-e89b-12d3-a456-426614174000');

      coordinator.cleanup();
    });

    it('should register the loop in active loops', () => {
      const coordinator = new ReviewLoopCoordinator('test code', mockConfig);
      const state = coordinator.getState();

      expect(getReviewLoop(state.id)).toBe(coordinator);

      coordinator.cleanup();
    });
  });

  describe('getState', () => {
    it('should return a copy of the state', () => {
      const coordinator = new ReviewLoopCoordinator('test code', mockConfig);
      const state1 = coordinator.getState();
      const state2 = coordinator.getState();

      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2);

      coordinator.cleanup();
    });
  });

  describe('start', () => {
    it('should complete with approval on first review', async () => {
      const mockExecute = vi.mocked(executeAgent);

      // First call: coder generates code
      mockExecute.mockResolvedValueOnce({
        agentId: 'coder-1',
        response: 'function add(a, b) { return a + b; }',
        model: 'test',
        duration: 100,
      });

      // Second call: adversarial approves
      mockExecute.mockResolvedValueOnce({
        agentId: 'adversarial-1',
        response: 'Code looks good. No issues found.\n\n**VERDICT: APPROVE**',
        model: 'test',
        duration: 100,
      });

      const coordinator = new ReviewLoopCoordinator('write an add function', mockConfig);
      const result = await coordinator.start();

      expect(result.status).toBe('approved');
      expect(result.finalVerdict).toBe('APPROVE');
      expect(result.iteration).toBe(1);
      expect(result.reviews.length).toBe(1);
      expect(result.currentCode).toBe('function add(a, b) { return a + b; }');

      coordinator.cleanup();
    });

    it('should iterate when review rejects code', async () => {
      const mockExecute = vi.mocked(executeAgent);

      // First call: coder generates code
      mockExecute.mockResolvedValueOnce({
        agentId: 'coder-1',
        response: 'function add(a, b) { return a + b; }',
        model: 'test',
        duration: 100,
      });

      // Second call: adversarial rejects
      mockExecute.mockResolvedValueOnce({
        agentId: 'adversarial-1',
        response: '**[SEVERITY: HIGH]** - Missing input validation\n- **Location**: line 1\n- **Required Fix**: Add type checks\n\n**VERDICT: REJECT**',
        model: 'test',
        duration: 100,
      });

      // Third call: coder fixes
      mockExecute.mockResolvedValueOnce({
        agentId: 'coder-1',
        response: 'function add(a, b) { if (typeof a !== "number") throw new Error(); return a + b; }',
        model: 'test',
        duration: 100,
      });

      // Fourth call: adversarial approves
      mockExecute.mockResolvedValueOnce({
        agentId: 'adversarial-1',
        response: 'Code now validates input.\n\n**VERDICT: APPROVE**',
        model: 'test',
        duration: 100,
      });

      const coordinator = new ReviewLoopCoordinator('write an add function', mockConfig);
      const result = await coordinator.start();

      expect(result.status).toBe('approved');
      expect(result.finalVerdict).toBe('APPROVE');
      expect(result.iteration).toBe(2);
      expect(result.reviews.length).toBe(2);

      coordinator.cleanup();
    });

    it('should reach max iterations when never approved', async () => {
      const mockExecute = vi.mocked(executeAgent);

      // Coder generates initial code
      mockExecute.mockResolvedValueOnce({
        agentId: 'coder-1',
        response: 'bad code',
        model: 'test',
        duration: 100,
      });

      // Adversarial always rejects
      for (let i = 0; i < 3; i++) {
        mockExecute.mockResolvedValueOnce({
          agentId: 'adversarial-1',
          response: '**VERDICT: REJECT**',
          model: 'test',
          duration: 100,
        });
        if (i < 2) {
          mockExecute.mockResolvedValueOnce({
            agentId: 'coder-1',
            response: 'still bad code',
            model: 'test',
            duration: 100,
          });
        }
      }

      const coordinator = new ReviewLoopCoordinator('write code', mockConfig, { maxIterations: 3 });
      const result = await coordinator.start();

      expect(result.status).toBe('max_iterations_reached');
      expect(result.finalVerdict).toBe('REJECT');
      expect(result.iteration).toBe(3);

      coordinator.cleanup();
    });

    it('should emit events during loop', async () => {
      const mockExecute = vi.mocked(executeAgent);

      mockExecute.mockResolvedValueOnce({
        agentId: 'coder-1',
        response: 'code',
        model: 'test',
        duration: 100,
      });
      mockExecute.mockResolvedValueOnce({
        agentId: 'adversarial-1',
        response: '**VERDICT: APPROVE**',
        model: 'test',
        duration: 100,
      });

      const coordinator = new ReviewLoopCoordinator('task', mockConfig);

      const events: string[] = [];
      coordinator.on('loop:start', () => events.push('start'));
      coordinator.on('loop:iteration', () => events.push('iteration'));
      coordinator.on('loop:review', () => events.push('review'));
      coordinator.on('loop:approved', () => events.push('approved'));
      coordinator.on('loop:complete', () => events.push('complete'));

      await coordinator.start();

      expect(events).toContain('start');
      expect(events).toContain('iteration');
      expect(events).toContain('review');
      expect(events).toContain('approved');
      expect(events).toContain('complete');

      coordinator.cleanup();
    });

    it('should handle execution errors', async () => {
      const mockExecute = vi.mocked(executeAgent);
      mockExecute.mockRejectedValueOnce(new Error('Execution failed'));

      const coordinator = new ReviewLoopCoordinator('task', mockConfig);

      const errorHandler = vi.fn();
      coordinator.on('loop:error', errorHandler);

      await expect(coordinator.start()).rejects.toThrow('Execution failed');
      expect(coordinator.getState().status).toBe('failed');
      expect(errorHandler).toHaveBeenCalled();

      coordinator.cleanup();
    });
  });

  describe('abort', () => {
    it('should abort a running loop', () => {
      const coordinator = new ReviewLoopCoordinator('test code', mockConfig);
      const id = coordinator.getState().id;

      coordinator.abort();

      expect(coordinator.getState().status).toBe('failed');
      expect(coordinator.getState().completedAt).toBeDefined();
      expect(getReviewLoop(id)).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should remove loop from active loops and stop agents', () => {
      const coordinator = new ReviewLoopCoordinator('test code', mockConfig);
      const id = coordinator.getState().id;

      coordinator.cleanup();

      expect(getReviewLoop(id)).toBeNull();
    });
  });

  describe('parseReviewResult', () => {
    it('should parse structured issues from review', async () => {
      const mockExecute = vi.mocked(executeAgent);

      mockExecute.mockResolvedValueOnce({
        agentId: 'coder-1',
        response: 'code',
        model: 'test',
        duration: 100,
      });

      mockExecute.mockResolvedValueOnce({
        agentId: 'adversarial-1',
        response: `**[SEVERITY: CRITICAL]** - SQL Injection vulnerability
- **Location**: db.ts:45
- **Attack Vector**: Unescaped user input
- **Impact**: Full database access
- **Required Fix**: Use parameterized queries

**[SEVERITY: HIGH]** - Missing authentication
- **Location**: api.ts:10
- **Required Fix**: Add auth middleware

**VERDICT: REJECT**`,
        model: 'test',
        duration: 100,
      });

      mockExecute.mockResolvedValueOnce({
        agentId: 'coder-1',
        response: 'fixed code',
        model: 'test',
        duration: 100,
      });

      mockExecute.mockResolvedValueOnce({
        agentId: 'adversarial-1',
        response: '**VERDICT: APPROVE**',
        model: 'test',
        duration: 100,
      });

      const coordinator = new ReviewLoopCoordinator('task', mockConfig);
      const result = await coordinator.start();

      const firstReview = result.reviews[0];
      expect(firstReview.verdict).toBe('REJECT');
      expect(firstReview.issues.length).toBe(2);

      const criticalIssue = firstReview.issues.find(i => i.severity === 'CRITICAL');
      expect(criticalIssue).toBeDefined();
      expect(criticalIssue?.title).toContain('SQL Injection');
      expect(criticalIssue?.location).toBe('db.ts:45');
      expect(criticalIssue?.attackVector).toBe('Unescaped user input');
      expect(criticalIssue?.impact).toBe('Full database access');
      expect(criticalIssue?.requiredFix).toBe('Use parameterized queries');

      coordinator.cleanup();
    });

    it('should create generic issue when no structured issues found', async () => {
      const mockExecute = vi.mocked(executeAgent);

      mockExecute.mockResolvedValueOnce({
        agentId: 'coder-1',
        response: 'code',
        model: 'test',
        duration: 100,
      });

      mockExecute.mockResolvedValueOnce({
        agentId: 'adversarial-1',
        response: 'The code has problems. **VERDICT: REJECT**',
        model: 'test',
        duration: 100,
      });

      mockExecute.mockResolvedValueOnce({
        agentId: 'coder-1',
        response: 'fixed code',
        model: 'test',
        duration: 100,
      });

      mockExecute.mockResolvedValueOnce({
        agentId: 'adversarial-1',
        response: '**VERDICT: APPROVE**',
        model: 'test',
        duration: 100,
      });

      const coordinator = new ReviewLoopCoordinator('task', mockConfig);
      const result = await coordinator.start();

      const firstReview = result.reviews[0];
      expect(firstReview.issues.length).toBe(1);
      expect(firstReview.issues[0].severity).toBe('MEDIUM');
      expect(firstReview.issues[0].title).toBe('Issues found in code review');

      coordinator.cleanup();
    });
  });
});

describe('Review Loop Helper Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearReviewLoops();
    clearAgents();
  });

  afterEach(() => {
    clearReviewLoops();
    clearAgents();
  });

  describe('createReviewLoop', () => {
    it('should create and start a review loop', async () => {
      const mockExecute = vi.mocked(executeAgent);

      mockExecute.mockResolvedValueOnce({
        agentId: 'coder-1',
        response: 'code',
        model: 'test',
        duration: 100,
      });
      mockExecute.mockResolvedValueOnce({
        agentId: 'adversarial-1',
        response: '**VERDICT: APPROVE**',
        model: 'test',
        duration: 100,
      });

      const result = await createReviewLoop('task', mockConfig);

      expect(result.status).toBe('approved');
      expect(result.finalVerdict).toBe('APPROVE');
    });
  });

  describe('getReviewLoop', () => {
    it('should return null for non-existent loop', () => {
      expect(getReviewLoop('non-existent-id')).toBeNull();
    });

    it('should return coordinator for existing loop', () => {
      const coordinator = new ReviewLoopCoordinator('test', mockConfig);
      const id = coordinator.getState().id;

      expect(getReviewLoop(id)).toBe(coordinator);

      coordinator.cleanup();
    });
  });

  describe('listReviewLoops', () => {
    it('should return empty array when no loops', () => {
      expect(listReviewLoops()).toEqual([]);
    });

    it('should return all active loops', () => {
      const c1 = new ReviewLoopCoordinator('test1', mockConfig);
      const c2 = new ReviewLoopCoordinator('test2', mockConfig);

      const loops = listReviewLoops();
      expect(loops.length).toBe(2);
      expect(loops.map(l => l.codeInput)).toContain('test1');
      expect(loops.map(l => l.codeInput)).toContain('test2');

      c1.cleanup();
      c2.cleanup();
    });
  });

  describe('abortReviewLoop', () => {
    it('should return false for non-existent loop', () => {
      expect(abortReviewLoop('non-existent-id')).toBe(false);
    });

    it('should abort existing loop', () => {
      const coordinator = new ReviewLoopCoordinator('test', mockConfig);
      const id = coordinator.getState().id;

      expect(abortReviewLoop(id)).toBe(true);
      expect(getReviewLoop(id)).toBeNull();
    });
  });

  describe('clearReviewLoops', () => {
    it('should clear all loops', () => {
      const c1 = new ReviewLoopCoordinator('test1', mockConfig);
      const c2 = new ReviewLoopCoordinator('test2', mockConfig);

      expect(listReviewLoops().length).toBe(2);

      clearReviewLoops();

      expect(listReviewLoops().length).toBe(0);
    });
  });
});
