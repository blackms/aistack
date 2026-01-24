/**
 * Hooks index tests - executeHooks and hook management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  executeHooks,
  registerHook,
  unregisterHooks,
  clearCustomHooks,
  getHookCount,
} from '../../src/hooks/index.js';
import { MemoryManager, resetMemoryManager } from '../../src/memory/index.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentStackConfig, HookContext } from '../../src/types.js';

function createTestConfig(hooksEnabled = true): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: join(tmpdir(), `aistack-hooks-index-${Date.now()}.db`),
      defaultNamespace: 'default',
      vectorSearch: { enabled: false },
    },
    providers: { default: 'anthropic' },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: false },
    plugins: { enabled: true, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: {
      sessionStart: hooksEnabled,
      sessionEnd: hooksEnabled,
      preTask: hooksEnabled,
      postTask: hooksEnabled,
    },
  };
}

describe('Hooks Index', () => {
  let memory: MemoryManager;
  let config: AgentStackConfig;
  let dbPath: string;

  beforeEach(() => {
    clearCustomHooks();
    resetMemoryManager();
    config = createTestConfig();
    dbPath = config.memory.path;
    memory = new MemoryManager(config);
  });

  afterEach(() => {
    clearCustomHooks();
    memory.close();
    resetMemoryManager();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('executeHooks', () => {
    it('should execute session-start hook', async () => {
      const context: HookContext = {
        event: 'session-start',
        data: {},
      };

      await expect(executeHooks('session-start', context, memory, config)).resolves.not.toThrow();
    });

    it('should execute session-end hook', async () => {
      const session = memory.createSession();
      const context: HookContext = {
        event: 'session-end',
        sessionId: session.id,
        data: {},
      };

      await expect(executeHooks('session-end', context, memory, config)).resolves.not.toThrow();
    });

    it('should execute pre-task hook', async () => {
      const context: HookContext = {
        event: 'pre-task',
        taskId: 'test-task-1',
        agentType: 'coder',
        data: {},
      };

      await expect(executeHooks('pre-task', context, memory, config)).resolves.not.toThrow();
    });

    it('should execute post-task hook', async () => {
      const context: HookContext = {
        event: 'post-task',
        taskId: 'test-task-1',
        agentType: 'coder',
        data: { result: 'success' },
      };

      await expect(executeHooks('post-task', context, memory, config)).resolves.not.toThrow();
    });

    it('should skip disabled hooks', async () => {
      const disabledConfig = createTestConfig(false);
      const localMemory = new MemoryManager(disabledConfig);

      const context: HookContext = {
        event: 'session-start',
        data: {},
      };

      await executeHooks('session-start', context, localMemory, disabledConfig);

      // Session should not be created because hook is disabled
      expect(context.sessionId).toBeUndefined();

      localMemory.close();
      if (existsSync(disabledConfig.memory.path)) {
        unlinkSync(disabledConfig.memory.path);
      }
    });

    it('should execute custom hooks', async () => {
      const customHandler = vi.fn().mockResolvedValue(undefined);
      registerHook('session-start', customHandler);

      const context: HookContext = {
        event: 'session-start',
        data: {},
      };

      await executeHooks('session-start', context, memory, config);

      expect(customHandler).toHaveBeenCalledTimes(1);
      expect(customHandler).toHaveBeenCalledWith(context, memory, config);
    });

    it('should execute multiple custom hooks in order', async () => {
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

      const context: HookContext = {
        event: 'pre-task',
        data: {},
      };

      await executeHooks('pre-task', context, memory, config);

      expect(order).toEqual([1, 2, 3]);
    });

    it('should continue on custom hook error', async () => {
      const successHandler = vi.fn().mockResolvedValue(undefined);

      registerHook('post-task', async () => {
        throw new Error('Hook failed');
      });
      registerHook('post-task', successHandler);

      const context: HookContext = {
        event: 'post-task',
        data: {},
      };

      await executeHooks('post-task', context, memory, config);

      // Second handler should still be called
      expect(successHandler).toHaveBeenCalledTimes(1);
    });

    it('should execute workflow hook', async () => {
      const context: HookContext = {
        event: 'workflow',
        data: { workflowId: 'unknown-workflow' },
      };

      await expect(executeHooks('workflow', context, memory, config)).resolves.not.toThrow();
    });
  });

  describe('registerHook', () => {
    it('should register a hook', () => {
      registerHook('session-start', async () => {});

      expect(getHookCount('session-start')).toBe(1);
    });

    it('should register multiple hooks for same event', () => {
      registerHook('pre-task', async () => {});
      registerHook('pre-task', async () => {});
      registerHook('pre-task', async () => {});

      expect(getHookCount('pre-task')).toBe(3);
    });
  });

  describe('unregisterHooks', () => {
    it('should unregister all hooks for an event', () => {
      registerHook('session-end', async () => {});
      registerHook('session-end', async () => {});

      unregisterHooks('session-end');

      expect(getHookCount('session-end')).toBe(0);
    });

    it('should not affect other events', () => {
      registerHook('session-start', async () => {});
      registerHook('session-end', async () => {});

      unregisterHooks('session-start');

      expect(getHookCount('session-start')).toBe(0);
      expect(getHookCount('session-end')).toBe(1);
    });
  });

  describe('clearCustomHooks', () => {
    it('should clear all custom hooks', () => {
      registerHook('session-start', async () => {});
      registerHook('session-end', async () => {});
      registerHook('pre-task', async () => {});
      registerHook('post-task', async () => {});

      clearCustomHooks();

      expect(getHookCount()).toBe(0);
    });
  });

  describe('getHookCount', () => {
    it('should return 0 for event with no hooks', () => {
      expect(getHookCount('session-start')).toBe(0);
    });

    it('should return count for specific event', () => {
      registerHook('pre-task', async () => {});
      registerHook('pre-task', async () => {});

      expect(getHookCount('pre-task')).toBe(2);
    });

    it('should return total count when no event specified', () => {
      registerHook('session-start', async () => {});
      registerHook('session-end', async () => {});
      registerHook('pre-task', async () => {});

      expect(getHookCount()).toBe(3);
    });
  });

  describe('error handling', () => {
    it('should handle and log errors from custom hooks', async () => {
      const successHandler = vi.fn().mockResolvedValue(undefined);

      registerHook('pre-task', async () => {
        throw new Error('Custom hook error');
      });
      registerHook('pre-task', successHandler);

      const context: HookContext = {
        event: 'pre-task',
        data: {},
      };

      // Should not throw and should continue to next handler
      await executeHooks('pre-task', context, memory, config);

      expect(successHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple failing custom hooks', async () => {
      registerHook('post-task', async () => {
        throw new Error('First error');
      });
      registerHook('post-task', async () => {
        throw new Error('Second error');
      });

      const context: HookContext = {
        event: 'post-task',
        data: {},
      };

      // Should complete without throwing
      await expect(executeHooks('post-task', context, memory, config)).resolves.not.toThrow();
    });
  });
});
