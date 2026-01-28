import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Semaphore, AgentPool } from '../../src/utils/semaphore.js';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe('Semaphore', () => {
  describe('constructor', () => {
    it('should create semaphore with max permits', () => {
      const sem = new Semaphore('test', 3);
      const state = sem.getState();
      expect(state.available).toBe(3);
      expect(state.maxPermits).toBe(3);
      expect(state.queued).toBe(0);
    });
  });

  describe('acquire', () => {
    it('should acquire permit when available', async () => {
      const sem = new Semaphore('test', 2);
      await sem.acquire();
      expect(sem.getState().available).toBe(1);
    });

    it('should acquire multiple permits', async () => {
      const sem = new Semaphore('test', 3);
      await sem.acquire();
      await sem.acquire();
      await sem.acquire();
      expect(sem.getState().available).toBe(0);
    });

    it('should wait when no permits available', async () => {
      const sem = new Semaphore('test', 1);
      await sem.acquire();

      let acquired = false;
      const acquirePromise = sem.acquire().then(() => {
        acquired = true;
      });

      // Should be waiting
      expect(acquired).toBe(false);
      expect(sem.getState().queued).toBe(1);

      // Release permit
      sem.release();

      await acquirePromise;
      expect(acquired).toBe(true);
    });

    it('should queue multiple waiters', async () => {
      const sem = new Semaphore('test', 1);
      await sem.acquire();

      const results: number[] = [];

      const promise1 = sem.acquire().then(() => results.push(1));
      const promise2 = sem.acquire().then(() => results.push(2));
      const promise3 = sem.acquire().then(() => results.push(3));

      expect(sem.getState().queued).toBe(3);

      // Release permits one by one
      sem.release();
      await promise1;
      expect(results).toEqual([1]);

      sem.release();
      await promise2;
      expect(results).toEqual([1, 2]);

      sem.release();
      await promise3;
      expect(results).toEqual([1, 2, 3]);
    });
  });

  describe('tryAcquire', () => {
    it('should return true and acquire when available', () => {
      const sem = new Semaphore('test', 2);
      expect(sem.tryAcquire()).toBe(true);
      expect(sem.getState().available).toBe(1);
    });

    it('should return false when no permits available', async () => {
      const sem = new Semaphore('test', 1);
      await sem.acquire();
      expect(sem.tryAcquire()).toBe(false);
      expect(sem.getState().available).toBe(0);
    });

    it('should not wait when no permits available', async () => {
      const sem = new Semaphore('test', 1);
      await sem.acquire();

      const start = Date.now();
      const result = sem.tryAcquire();
      const duration = Date.now() - start;

      expect(result).toBe(false);
      expect(duration).toBeLessThan(50); // Should return immediately
    });
  });

  describe('release', () => {
    it('should increase available permits', async () => {
      const sem = new Semaphore('test', 2);
      await sem.acquire();
      expect(sem.getState().available).toBe(1);

      sem.release();
      expect(sem.getState().available).toBe(2);
    });

    it('should give permit to waiting task', async () => {
      const sem = new Semaphore('test', 1);
      await sem.acquire();

      let acquired = false;
      const acquirePromise = sem.acquire().then(() => {
        acquired = true;
      });

      // Release to waiting task
      sem.release();
      await acquirePromise;

      expect(acquired).toBe(true);
      // Available should still be 0 because permit went to waiter
      expect(sem.getState().available).toBe(0);
    });

    it('should return permit to pool when no waiters', async () => {
      const sem = new Semaphore('test', 2);
      await sem.acquire();
      await sem.acquire();

      expect(sem.getState().available).toBe(0);

      sem.release();
      expect(sem.getState().available).toBe(1);

      sem.release();
      expect(sem.getState().available).toBe(2);
    });
  });

  describe('execute', () => {
    it('should acquire permit, run function, and release', async () => {
      const sem = new Semaphore('test', 1);

      const result = await sem.execute(async () => {
        expect(sem.getState().available).toBe(0);
        return 'result';
      });

      expect(result).toBe('result');
      expect(sem.getState().available).toBe(1);
    });

    it('should release permit even on error', async () => {
      const sem = new Semaphore('test', 1);

      await expect(
        sem.execute(async () => {
          throw new Error('test error');
        })
      ).rejects.toThrow('test error');

      expect(sem.getState().available).toBe(1);
    });

    it('should serialize concurrent operations', async () => {
      const sem = new Semaphore('test', 1);
      const order: number[] = [];

      const task1 = sem.execute(async () => {
        await new Promise((r) => setTimeout(r, 50));
        order.push(1);
        return 1;
      });

      const task2 = sem.execute(async () => {
        order.push(2);
        return 2;
      });

      await Promise.all([task1, task2]);

      // Task 1 should complete before task 2 starts
      expect(order).toEqual([1, 2]);
    });

    it('should allow concurrent operations up to permit limit', async () => {
      const sem = new Semaphore('test', 2);
      let concurrent = 0;
      let maxConcurrent = 0;

      const task = async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 20));
        concurrent--;
      };

      await Promise.all([
        sem.execute(task),
        sem.execute(task),
        sem.execute(task),
        sem.execute(task),
      ]);

      expect(maxConcurrent).toBe(2);
    });
  });

  describe('getState', () => {
    it('should return current state', async () => {
      const sem = new Semaphore('test', 3);

      expect(sem.getState()).toEqual({
        available: 3,
        maxPermits: 3,
        queued: 0,
      });

      await sem.acquire();
      await sem.acquire();

      expect(sem.getState()).toEqual({
        available: 1,
        maxPermits: 3,
        queued: 0,
      });
    });

    it('should show queued count', async () => {
      const sem = new Semaphore('test', 1);
      await sem.acquire();

      // Queue some waiters
      sem.acquire();
      sem.acquire();

      expect(sem.getState().queued).toBe(2);
    });
  });

  describe('reset', () => {
    it('should reset to initial state', async () => {
      const sem = new Semaphore('test', 3);
      await sem.acquire();
      await sem.acquire();

      sem.reset();

      expect(sem.getState()).toEqual({
        available: 3,
        maxPermits: 3,
        queued: 0,
      });
    });

    it('should resolve waiting tasks', async () => {
      const sem = new Semaphore('test', 1);
      await sem.acquire();

      const results: string[] = [];

      const promise1 = sem.acquire().then(() => results.push('acquired1'));
      const promise2 = sem.acquire().then(() => results.push('acquired2'));

      expect(sem.getState().queued).toBe(2);

      sem.reset();

      // Waiters should be resolved
      await Promise.all([promise1, promise2]);
      expect(results).toHaveLength(2);
      expect(sem.getState().queued).toBe(0);
    });
  });
});

describe('AgentPool', () => {
  describe('constructor', () => {
    it('should create pool with default size', () => {
      const pool = new AgentPool();
      expect(pool.getStats()).toEqual({});
    });

    it('should create pool with custom size', () => {
      const pool = new AgentPool(5);
      expect(pool.getStats()).toEqual({});
    });
  });

  describe('acquire', () => {
    it('should return null when pool is empty', () => {
      const pool = new AgentPool();
      expect(pool.acquire('coder')).toBeNull();
    });

    it('should return agent from pool', () => {
      const pool = new AgentPool();
      pool.release('coder', 'agent-1');

      const agentId = pool.acquire('coder');
      expect(agentId).toBe('agent-1');
    });

    it('should mark acquired agent as in use', () => {
      const pool = new AgentPool();
      pool.release('coder', 'agent-1');
      pool.acquire('coder');

      // Second acquire should return null
      expect(pool.acquire('coder')).toBeNull();
    });

    it('should return different agents of same type', () => {
      const pool = new AgentPool();
      pool.release('coder', 'agent-1');
      pool.release('coder', 'agent-2');

      const first = pool.acquire('coder');
      const second = pool.acquire('coder');

      expect([first, second].sort()).toEqual(['agent-1', 'agent-2']);
    });

    it('should only return agents of requested type', () => {
      const pool = new AgentPool();
      pool.release('coder', 'agent-1');
      pool.release('tester', 'agent-2');

      expect(pool.acquire('reviewer')).toBeNull();
      expect(pool.acquire('coder')).toBe('agent-1');
    });
  });

  describe('release', () => {
    it('should add agent to pool', () => {
      const pool = new AgentPool();
      pool.release('coder', 'agent-1');

      const stats = pool.getStats();
      expect(stats.coder.total).toBe(1);
    });

    it('should mark agent as available after release', () => {
      const pool = new AgentPool();
      pool.release('coder', 'agent-1');
      pool.acquire('coder');
      pool.release('coder', 'agent-1');

      // Should be able to acquire again
      expect(pool.acquire('coder')).toBe('agent-1');
    });

    it('should not duplicate agents in pool', () => {
      const pool = new AgentPool();
      pool.release('coder', 'agent-1');
      pool.release('coder', 'agent-1');
      pool.release('coder', 'agent-1');

      const stats = pool.getStats();
      expect(stats.coder.total).toBe(1);
    });

    it('should respect max pool size', () => {
      const pool = new AgentPool(2);
      pool.release('coder', 'agent-1');
      pool.release('coder', 'agent-2');
      pool.release('coder', 'agent-3'); // Should not be added

      const stats = pool.getStats();
      expect(stats.coder.total).toBe(2);
    });
  });

  describe('remove', () => {
    it('should remove agent from pool', () => {
      const pool = new AgentPool();
      pool.release('coder', 'agent-1');
      pool.release('coder', 'agent-2');

      pool.remove('coder', 'agent-1');

      const stats = pool.getStats();
      expect(stats.coder.total).toBe(1);
    });

    it('should remove agent from in-use set', () => {
      const pool = new AgentPool();
      pool.release('coder', 'agent-1');
      pool.acquire('coder');

      pool.remove('coder', 'agent-1');

      // Releasing a new agent should work
      pool.release('coder', 'agent-2');
      expect(pool.acquire('coder')).toBe('agent-2');
    });

    it('should handle removing non-existent agent', () => {
      const pool = new AgentPool();
      // Should not throw
      pool.remove('coder', 'nonexistent');
    });
  });

  describe('getStats', () => {
    it('should return empty stats for empty pool', () => {
      const pool = new AgentPool();
      expect(pool.getStats()).toEqual({});
    });

    it('should return stats per agent type', () => {
      const pool = new AgentPool();
      pool.release('coder', 'agent-1');
      pool.release('coder', 'agent-2');
      pool.release('tester', 'agent-3');

      const stats = pool.getStats();
      expect(stats.coder).toEqual({ total: 2, inUse: 0, available: 2 });
      expect(stats.tester).toEqual({ total: 1, inUse: 0, available: 1 });
    });

    it('should track in-use agents', () => {
      const pool = new AgentPool();
      pool.release('coder', 'agent-1');
      pool.release('coder', 'agent-2');
      pool.acquire('coder');

      const stats = pool.getStats();
      expect(stats.coder).toEqual({ total: 2, inUse: 1, available: 1 });
    });
  });

  describe('clear', () => {
    it('should clear all agents', () => {
      const pool = new AgentPool();
      pool.release('coder', 'agent-1');
      pool.release('tester', 'agent-2');
      pool.acquire('coder');

      pool.clear();

      expect(pool.getStats()).toEqual({});
    });

    it('should allow new agents after clear', () => {
      const pool = new AgentPool();
      pool.release('coder', 'agent-1');
      pool.clear();
      pool.release('coder', 'agent-2');

      expect(pool.acquire('coder')).toBe('agent-2');
    });
  });
});
