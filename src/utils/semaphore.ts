/**
 * Semaphore for concurrency control
 */

import { logger } from './logger.js';

const log = logger.child('semaphore');

export class Semaphore {
  private permits: number;
  private maxPermits: number;
  private queue: Array<() => void> = [];
  private readonly name: string;

  constructor(name: string, maxPermits: number) {
    this.name = name;
    this.permits = maxPermits;
    this.maxPermits = maxPermits;
  }

  /**
   * Acquire a permit
   * Waits if no permits available
   */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      log.debug('Permit acquired', {
        name: this.name,
        available: this.permits,
        queued: this.queue.length,
      });
      return;
    }

    // Wait for permit
    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
      log.debug('Waiting for permit', {
        name: this.name,
        queued: this.queue.length,
      });
    });
  }

  /**
   * Try to acquire a permit without waiting
   * Returns true if acquired, false otherwise
   */
  tryAcquire(): boolean {
    if (this.permits > 0) {
      this.permits--;
      log.debug('Permit acquired (try)', {
        name: this.name,
        available: this.permits,
      });
      return true;
    }
    return false;
  }

  /**
   * Release a permit
   */
  release(): void {
    const next = this.queue.shift();
    if (next) {
      // Give permit to waiting task
      next();
      log.debug('Permit released (waiting task)', {
        name: this.name,
        available: this.permits,
        queued: this.queue.length,
      });
    } else {
      // Return permit to pool
      this.permits++;
      log.debug('Permit released', {
        name: this.name,
        available: this.permits,
      });
    }
  }

  /**
   * Execute function with acquired permit
   * Automatically releases permit when done
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Get current state
   */
  getState(): {
    available: number;
    maxPermits: number;
    queued: number;
  } {
    return {
      available: this.permits,
      maxPermits: this.maxPermits,
      queued: this.queue.length,
    };
  }

  /**
   * Reset semaphore to initial state
   */
  reset(): void {
    // Reject all waiting tasks
    for (const resolve of this.queue) {
      resolve();
    }
    this.queue = [];
    this.permits = this.maxPermits;
    log.info('Semaphore reset', { name: this.name });
  }
}

/**
 * Agent pool for reusing agents
 */
export class AgentPool {
  private pool: Map<string, string[]> = new Map(); // type -> agentIds[]
  private inUse: Set<string> = new Set();
  private maxPoolSize: number;

  constructor(maxPoolSize: number = 10) {
    this.maxPoolSize = maxPoolSize;
  }

  /**
   * Get an agent from the pool or null if none available
   */
  acquire(agentType: string): string | null {
    const available = this.pool.get(agentType) || [];
    const agentId = available.find((id) => !this.inUse.has(id));

    if (agentId) {
      this.inUse.add(agentId);
      log.debug('Agent acquired from pool', { agentType, agentId });
      return agentId;
    }

    return null;
  }

  /**
   * Return an agent to the pool
   */
  release(agentType: string, agentId: string): void {
    this.inUse.delete(agentId);

    const pool = this.pool.get(agentType) || [];
    if (!pool.includes(agentId) && pool.length < this.maxPoolSize) {
      pool.push(agentId);
      this.pool.set(agentType, pool);
      log.debug('Agent returned to pool', { agentType, agentId });
    }
  }

  /**
   * Remove an agent from the pool
   */
  remove(agentType: string, agentId: string): void {
    this.inUse.delete(agentId);

    const pool = this.pool.get(agentType) || [];
    const index = pool.indexOf(agentId);
    if (index !== -1) {
      pool.splice(index, 1);
      this.pool.set(agentType, pool);
      log.debug('Agent removed from pool', { agentType, agentId });
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): Record<string, { total: number; inUse: number; available: number }> {
    const stats: Record<string, { total: number; inUse: number; available: number }> = {};

    for (const [agentType, agentIds] of this.pool.entries()) {
      const inUseCount = agentIds.filter((id) => this.inUse.has(id)).length;
      stats[agentType] = {
        total: agentIds.length,
        inUse: inUseCount,
        available: agentIds.length - inUseCount,
      };
    }

    return stats;
  }

  /**
   * Clear the pool
   */
  clear(): void {
    this.pool.clear();
    this.inUse.clear();
    log.info('Agent pool cleared');
  }
}
