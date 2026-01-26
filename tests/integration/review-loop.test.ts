/**
 * Review Loop Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestEnv, cleanupTestEnv, createTestConfig } from './setup.js';
import { getMemoryManager, resetMemoryManager } from '../../src/memory/index.js';
import { clearAgents } from '../../src/agents/spawner.js';
import { ReviewLoopCoordinator } from '../../src/coordination/review-loop.js';
import type { AgentStackConfig } from '../../src/types.js';

describe('Review Loop Integration', () => {
  let config: AgentStackConfig;

  beforeEach(() => {
    setupTestEnv();
    config = createTestConfig();
    clearAgents();
  });

  afterEach(() => {
    clearAgents();
    resetMemoryManager();
    cleanupTestEnv();
  });

  it('should create review loop with initial state', () => {
    const codeInput = 'Write a function to calculate fibonacci numbers';
    const loop = new ReviewLoopCoordinator(codeInput, config);

    const state = loop.getState();

    expect(state.id).toBeDefined();
    expect(state.coderId).toBeDefined();
    expect(state.adversarialId).toBeDefined();
    expect(state.status).toBe('pending');
    expect(state.codeInput).toBe(codeInput);
    expect(state.iteration).toBe(0);
    expect(state.maxIterations).toBe(3);
    expect(state.reviews).toEqual([]);
  });

  it('should persist review loop state to database', () => {
    const memory = getMemoryManager(config);
    const codeInput = 'Write a hello world function';

    const loop = new ReviewLoopCoordinator(codeInput, config, {
      maxIterations: 5,
    });

    const state = loop.getState();

    // Load from database
    const loaded = memory.getStore().loadReviewLoop(state.id);

    expect(loaded).toBeDefined();
    expect(loaded?.id).toBe(state.id);
    expect(loaded?.codeInput).toBe(codeInput);
    expect(loaded?.maxIterations).toBe(5);
    expect(loaded?.status).toBe('pending');
  });

  it('should load active review loops from database', () => {
    const memory = getMemoryManager(config);

    // Create multiple review loops
    const loop1 = new ReviewLoopCoordinator('Task 1', config);
    const loop2 = new ReviewLoopCoordinator('Task 2', config);

    // Simulate one running and one pending
    memory.getStore().saveReviewLoop(loop1.getState().id, {
      ...loop1.getState(),
      status: 'coding',
    });

    // Load active loops
    const activeLoops = memory.getStore().loadActiveReviewLoops();

    expect(activeLoops.length).toBeGreaterThanOrEqual(2);
    const ids = activeLoops.map(l => l.id);
    expect(ids).toContain(loop1.getState().id);
    expect(ids).toContain(loop2.getState().id);
  });

  it('should handle review loop lifecycle states', () => {
    const memory = getMemoryManager(config);
    const loop = new ReviewLoopCoordinator('Test task', config);
    const loopId = loop.getState().id;

    // Test state transitions
    const states = ['coding', 'reviewing', 'fixing', 'approved'] as const;

    for (const status of states) {
      const currentState = loop.getState();
      memory.getStore().saveReviewLoop(loopId, {
        ...currentState,
        status,
      });

      const loaded = memory.getStore().loadReviewLoop(loopId);
      expect(loaded?.status).toBe(status);
    }
  });

  it('should delete review loop from database', () => {
    const memory = getMemoryManager(config);
    const loop = new ReviewLoopCoordinator('Delete test', config);
    const loopId = loop.getState().id;

    // Verify it exists
    let loaded = memory.getStore().loadReviewLoop(loopId);
    expect(loaded).toBeDefined();

    // Delete it
    const deleted = memory.getStore().deleteReviewLoop(loopId);
    expect(deleted).toBe(true);

    // Verify it's gone
    loaded = memory.getStore().loadReviewLoop(loopId);
    expect(loaded).toBeNull();
  });

  it('should preserve review history in state', () => {
    const memory = getMemoryManager(config);
    const loop = new ReviewLoopCoordinator('History test', config);
    const loopId = loop.getState().id;

    const mockReview = {
      verdict: 'REJECT' as const,
      issues: [
        {
          severity: 'high' as const,
          title: 'Security issue',
          description: 'SQL injection vulnerability',
          requiredFix: 'Use parameterized queries',
        },
      ],
      summary: 'Code has security issues',
      timestamp: new Date(),
    };

    // Add review to history
    const currentState = loop.getState();
    currentState.reviews.push(mockReview);
    memory.getStore().saveReviewLoop(loopId, currentState);

    // Load and verify history preserved
    const loaded = memory.getStore().loadReviewLoop(loopId);
    expect(loaded?.reviews.length).toBe(1);
    expect(loaded?.reviews[0]?.verdict).toBe('REJECT');
    expect(loaded?.reviews[0]?.issues.length).toBe(1);
    expect(loaded?.reviews[0]?.issues[0]?.title).toBe('Security issue');
  });

  it('should cleanup completed review loops', () => {
    const memory = getMemoryManager(config);

    // Create loops with different states
    const loop1 = new ReviewLoopCoordinator('Loop 1', config);
    const loop2 = new ReviewLoopCoordinator('Loop 2', config);
    const loop3 = new ReviewLoopCoordinator('Loop 3', config);

    // Mark some as completed
    memory.getStore().saveReviewLoop(loop1.getState().id, {
      ...loop1.getState(),
      status: 'approved',
      completedAt: new Date(),
    });

    memory.getStore().saveReviewLoop(loop2.getState().id, {
      ...loop2.getState(),
      status: 'failed',
      completedAt: new Date(),
    });

    // Cleanup completed
    memory.getStore().clearCompletedReviewLoops();

    // Verify completed loops removed
    const loaded1 = memory.getStore().loadReviewLoop(loop1.getState().id);
    const loaded2 = memory.getStore().loadReviewLoop(loop2.getState().id);
    const loaded3 = memory.getStore().loadReviewLoop(loop3.getState().id);

    expect(loaded1).toBeNull();
    expect(loaded2).toBeNull();
    expect(loaded3).toBeDefined(); // Pending loop should remain
  });
});
