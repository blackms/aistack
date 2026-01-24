/**
 * Hooks system tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerHook,
  unregisterHooks,
  clearCustomHooks,
  getHookCount,
  executeHooks,
} from '../../src/hooks/index.js';
import { MemoryManager, resetMemoryManager } from '../../src/memory/index.js';
import type { AgentStackConfig, HookContext } from '../../src/types.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Hooks System', () => {
  let dbPath: string;
  let memory: MemoryManager;
  let config: AgentStackConfig;

  beforeEach(() => {
    clearCustomHooks();
    dbPath = join(tmpdir(), `aistack-hooks-test-${Date.now()}.db`);
    config = {
      version: '1.0.0',
      memory: {
        path: dbPath,
        defaultNamespace: 'default',
        vectorSearch: { enabled: false },
      },
      providers: { default: 'anthropic' },
      agents: { maxConcurrent: 5, defaultTimeout: 300 },
      github: { enabled: false },
      plugins: { enabled: false, directory: './plugins' },
      mcp: { transport: 'stdio' },
      hooks: {
        sessionStart: true,
        sessionEnd: true,
        preTask: true,
        postTask: true,
      },
    };
    memory = new MemoryManager(config);
  });

  afterEach(() => {
    memory.close();
    resetMemoryManager();
    clearCustomHooks();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('registerHook', () => {
    it('should register a custom hook', () => {
      const handler = vi.fn();
      registerHook('session-start', handler);

      expect(getHookCount('session-start')).toBe(1);
    });

    it('should register multiple hooks for same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      registerHook('pre-task', handler1);
      registerHook('pre-task', handler2);

      expect(getHookCount('pre-task')).toBe(2);
    });
  });

  describe('unregisterHooks', () => {
    it('should unregister all hooks for an event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      registerHook('session-end', handler1);
      registerHook('session-end', handler2);
      expect(getHookCount('session-end')).toBe(2);

      unregisterHooks('session-end');
      expect(getHookCount('session-end')).toBe(0);
    });
  });

  describe('clearCustomHooks', () => {
    it('should clear all custom hooks', () => {
      registerHook('session-start', vi.fn());
      registerHook('session-end', vi.fn());
      registerHook('pre-task', vi.fn());
      registerHook('post-task', vi.fn());

      expect(getHookCount()).toBe(4);

      clearCustomHooks();
      expect(getHookCount()).toBe(0);
    });
  });

  describe('getHookCount', () => {
    it('should return count for specific event', () => {
      registerHook('pre-task', vi.fn());
      registerHook('pre-task', vi.fn());
      registerHook('post-task', vi.fn());

      expect(getHookCount('pre-task')).toBe(2);
      expect(getHookCount('post-task')).toBe(1);
    });

    it('should return total count when no event specified', () => {
      registerHook('session-start', vi.fn());
      registerHook('pre-task', vi.fn());
      registerHook('post-task', vi.fn());

      expect(getHookCount()).toBe(3);
    });

    it('should return 0 for event with no hooks', () => {
      expect(getHookCount('session-start')).toBe(0);
    });
  });

  describe('executeHooks', () => {
    it('should execute custom hooks for an event', async () => {
      const handler = vi.fn();
      registerHook('session-start', handler);

      const context: HookContext = {
        event: 'session-start',
        sessionId: 'test-session',
      };

      await executeHooks('session-start', context, memory, config);

      expect(handler).toHaveBeenCalledWith(context, memory, config);
    });

    it('should execute multiple hooks in order', async () => {
      const order: number[] = [];

      registerHook('pre-task', async () => {
        order.push(1);
      });
      registerHook('pre-task', async () => {
        order.push(2);
      });
      registerHook('pre-task', async () => {
        order.push(3);
      });

      await executeHooks('pre-task', { event: 'pre-task' }, memory, config);

      expect(order).toEqual([1, 2, 3]);
    });

    it('should continue on hook error', async () => {
      const handler1 = vi.fn().mockRejectedValue(new Error('Hook failed'));
      const handler2 = vi.fn();

      registerHook('session-end', handler1);
      registerHook('session-end', handler2);

      // Should not throw
      await executeHooks('session-end', { event: 'session-end' }, memory, config);

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should skip when hook is disabled', async () => {
      const handler = vi.fn();
      registerHook('session-start', handler);

      const disabledConfig = {
        ...config,
        hooks: {
          ...config.hooks,
          sessionStart: false,
        },
      };

      await executeHooks('session-start', { event: 'session-start' }, memory, disabledConfig);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Hook Events', () => {
    it('should support session-start event', async () => {
      const handler = vi.fn();
      registerHook('session-start', handler);

      await executeHooks(
        'session-start',
        { event: 'session-start', sessionId: 'new-session' },
        memory,
        config
      );

      expect(handler).toHaveBeenCalled();
    });

    it('should support session-end event', async () => {
      const handler = vi.fn();
      registerHook('session-end', handler);

      await executeHooks(
        'session-end',
        { event: 'session-end', sessionId: 'ending-session' },
        memory,
        config
      );

      expect(handler).toHaveBeenCalled();
    });

    it('should support pre-task event', async () => {
      const handler = vi.fn();
      registerHook('pre-task', handler);

      await executeHooks(
        'pre-task',
        { event: 'pre-task', taskId: 'task-1', agentType: 'coder' },
        memory,
        config
      );

      expect(handler).toHaveBeenCalled();
    });

    it('should support post-task event', async () => {
      const handler = vi.fn();
      registerHook('post-task', handler);

      await executeHooks(
        'post-task',
        { event: 'post-task', taskId: 'task-1', agentType: 'coder', data: { result: 'success' } },
        memory,
        config
      );

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Async Hooks', () => {
    it('should wait for async hooks to complete', async () => {
      const results: string[] = [];

      registerHook('pre-task', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        results.push('first');
      });

      registerHook('pre-task', async () => {
        results.push('second');
      });

      await executeHooks('pre-task', { event: 'pre-task' }, memory, config);

      expect(results).toEqual(['first', 'second']);
    });
  });
});
