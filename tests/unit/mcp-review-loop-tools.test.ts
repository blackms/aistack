/**
 * Tests for MCP Review Loop Tools
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createReviewLoopTools } from '../../src/mcp/tools/review-loop-tools.js';
import {
  clearReviewLoops,
  ReviewLoopCoordinator,
  getReviewLoop,
  listReviewLoops,
} from '../../src/coordination/review-loop.js';
import { clearAgents } from '../../src/agents/spawner.js';
import type { AgentStackConfig } from '../../src/types.js';

// Mock the spawner module for executeAgent
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

describe('MCP Review Loop Tools', () => {
  let tools: ReturnType<typeof createReviewLoopTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearReviewLoops();
    clearAgents();
    tools = createReviewLoopTools(mockConfig);
  });

  afterEach(() => {
    clearReviewLoops();
    clearAgents();
  });

  describe('review_loop_start', () => {
    it('should have correct metadata', () => {
      expect(tools.review_loop_start.name).toBe('review_loop_start');
      expect(tools.review_loop_start.description).toContain('adversarial review loop');
      expect(tools.review_loop_start.inputSchema.required).toContain('code');
    });

    it('should start a review loop and return results on approval', async () => {
      const mockExecute = vi.mocked(executeAgent);

      // First call: coder generates code
      mockExecute.mockResolvedValueOnce({
        agentId: 'coder-1',
        response: 'function test() { return true; }',
        model: 'test',
        duration: 100,
      });

      // Second call: adversarial approves
      mockExecute.mockResolvedValueOnce({
        agentId: 'adversarial-1',
        response: 'Code looks good.\n\n**VERDICT: APPROVE**',
        model: 'test',
        duration: 100,
      });

      const result = await tools.review_loop_start.handler({
        code: 'write a test function',
      });

      expect(result.success).toBe(true);
      expect(result.loop.status).toBe('approved');
      expect(result.finalCode).toBe('function test() { return true; }');
      expect(result.message).toContain('approved');
    });

    it('should accept custom maxIterations', async () => {
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

      const result = await tools.review_loop_start.handler({
        code: 'write a function',
        maxIterations: 5,
      });

      expect(result.success).toBe(true);
      expect(result.loop.maxIterations).toBe(5);
    });

    it('should handle errors gracefully', async () => {
      const mockExecute = vi.mocked(executeAgent);
      mockExecute.mockRejectedValueOnce(new Error('Provider not configured'));

      const result = await tools.review_loop_start.handler({
        code: 'write a function',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Provider not configured');
    });

    it('should validate input schema', async () => {
      await expect(tools.review_loop_start.handler({})).rejects.toThrow();
      await expect(tools.review_loop_start.handler({ code: '' })).rejects.toThrow();
    });

    it('should return correct message for max_iterations_reached', async () => {
      const mockExecute = vi.mocked(executeAgent);

      mockExecute.mockResolvedValueOnce({
        agentId: 'coder-1',
        response: 'bad code',
        model: 'test',
        duration: 100,
      });

      // Two iterations: reject, fix, reject (max reached)
      mockExecute.mockResolvedValueOnce({
        agentId: 'adversarial-1',
        response: '**VERDICT: REJECT**',
        model: 'test',
        duration: 100,
      });
      mockExecute.mockResolvedValueOnce({
        agentId: 'coder-1',
        response: 'still bad',
        model: 'test',
        duration: 100,
      });
      mockExecute.mockResolvedValueOnce({
        agentId: 'adversarial-1',
        response: '**VERDICT: REJECT**',
        model: 'test',
        duration: 100,
      });

      const result = await tools.review_loop_start.handler({
        code: 'write code',
        maxIterations: 2,
      });

      expect(result.success).toBe(true);
      expect(result.loop.status).toBe('max_iterations_reached');
      expect(result.message).toContain('max_iterations_reached');
    });
  });

  describe('review_loop_status', () => {
    it('should have correct metadata', () => {
      expect(tools.review_loop_status.name).toBe('review_loop_status');
      expect(tools.review_loop_status.inputSchema.required).toContain('loopId');
    });

    it('should return not found for non-existent loop', async () => {
      const result = await tools.review_loop_status.handler({
        loopId: '123e4567-e89b-12d3-a456-426614174000',
      });

      expect(result.found).toBe(false);
      expect(result.message).toBe('Review loop not found');
    });

    it('should return status for existing loop', async () => {
      const coordinator = new ReviewLoopCoordinator('test code', mockConfig);
      const id = coordinator.getState().id;

      const result = await tools.review_loop_status.handler({ loopId: id });

      expect(result.found).toBe(true);
      expect(result.loop.id).toBe(id);
      expect(result.loop.status).toBe('pending');
      expect(result.latestReview).toBeNull();

      coordinator.cleanup();
    });

    it('should include latest review info when available', async () => {
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

      const coordinator = new ReviewLoopCoordinator('test code', mockConfig);
      await coordinator.start();
      const id = coordinator.getState().id;

      const result = await tools.review_loop_status.handler({ loopId: id });

      expect(result.found).toBe(true);
      expect(result.latestReview).not.toBeNull();
      expect(result.latestReview.verdict).toBe('APPROVE');

      coordinator.cleanup();
    });
  });

  describe('review_loop_abort', () => {
    it('should have correct metadata', () => {
      expect(tools.review_loop_abort.name).toBe('review_loop_abort');
      expect(tools.review_loop_abort.inputSchema.required).toContain('loopId');
    });

    it('should return failure for non-existent loop', async () => {
      const result = await tools.review_loop_abort.handler({
        loopId: '123e4567-e89b-12d3-a456-426614174000',
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Review loop not found');
    });

    it('should abort existing loop', async () => {
      const coordinator = new ReviewLoopCoordinator('test code', mockConfig);
      const id = coordinator.getState().id;

      const result = await tools.review_loop_abort.handler({ loopId: id });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Review loop aborted');
      expect(getReviewLoop(id)).toBeNull();
    });
  });

  describe('review_loop_issues', () => {
    it('should have correct metadata', () => {
      expect(tools.review_loop_issues.name).toBe('review_loop_issues');
      expect(tools.review_loop_issues.inputSchema.required).toContain('loopId');
    });

    it('should return not found for non-existent loop', async () => {
      const result = await tools.review_loop_issues.handler({
        loopId: '123e4567-e89b-12d3-a456-426614174000',
      });

      expect(result.found).toBe(false);
    });

    it('should return issues from reviews', async () => {
      const mockExecute = vi.mocked(executeAgent);

      mockExecute.mockResolvedValueOnce({
        agentId: 'coder-1',
        response: 'code',
        model: 'test',
        duration: 100,
      });
      mockExecute.mockResolvedValueOnce({
        agentId: 'adversarial-1',
        response: `**[SEVERITY: HIGH]** - Test Issue
- **Location**: test.ts:1
- **Required Fix**: Fix it

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

      const coordinator = new ReviewLoopCoordinator('test code', mockConfig);
      await coordinator.start();
      const id = coordinator.getState().id;

      const result = await tools.review_loop_issues.handler({ loopId: id });

      expect(result.found).toBe(true);
      expect(result.reviews.length).toBe(2);
      expect(result.reviews[0].issues.length).toBe(1);
      expect(result.reviews[0].issues[0].severity).toBe('HIGH');
      expect(result.reviews[0].issues[0].title).toContain('Test Issue');

      coordinator.cleanup();
    });
  });

  describe('review_loop_list', () => {
    it('should have correct metadata', () => {
      expect(tools.review_loop_list.name).toBe('review_loop_list');
    });

    it('should return empty list when no loops', async () => {
      const result = await tools.review_loop_list.handler({});

      expect(result.count).toBe(0);
      expect(result.loops).toEqual([]);
    });

    it('should return all active loops', async () => {
      const c1 = new ReviewLoopCoordinator('test1', mockConfig);
      const c2 = new ReviewLoopCoordinator('test2', mockConfig);

      const result = await tools.review_loop_list.handler({});

      expect(result.count).toBe(2);
      expect(result.loops.length).toBe(2);

      c1.cleanup();
      c2.cleanup();
    });
  });

  describe('review_loop_get_code', () => {
    it('should have correct metadata', () => {
      expect(tools.review_loop_get_code.name).toBe('review_loop_get_code');
      expect(tools.review_loop_get_code.inputSchema.required).toContain('loopId');
    });

    it('should return not found for non-existent loop', async () => {
      const result = await tools.review_loop_get_code.handler({
        loopId: '123e4567-e89b-12d3-a456-426614174000',
      });

      expect(result.found).toBe(false);
    });

    it('should return code from loop', async () => {
      const mockExecute = vi.mocked(executeAgent);

      mockExecute.mockResolvedValueOnce({
        agentId: 'coder-1',
        response: 'function hello() { return "world"; }',
        model: 'test',
        duration: 100,
      });
      mockExecute.mockResolvedValueOnce({
        agentId: 'adversarial-1',
        response: '**VERDICT: APPROVE**',
        model: 'test',
        duration: 100,
      });

      const coordinator = new ReviewLoopCoordinator('write hello function', mockConfig);
      await coordinator.start();
      const id = coordinator.getState().id;

      const result = await tools.review_loop_get_code.handler({ loopId: id });

      expect(result.found).toBe(true);
      expect(result.loopId).toBe(id);
      expect(result.status).toBe('approved');
      expect(result.originalInput).toBe('write hello function');
      expect(result.currentCode).toBe('function hello() { return "world"; }');
      expect(result.finalVerdict).toBe('APPROVE');

      coordinator.cleanup();
    });
  });
});
