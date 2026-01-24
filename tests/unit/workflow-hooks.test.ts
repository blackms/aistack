/**
 * Workflow hooks tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerWorkflowTrigger,
  unregisterWorkflowTrigger,
  getWorkflowTriggers,
  clearWorkflowTriggers,
  registerDefaultTriggers,
  workflowHook,
  type WorkflowTrigger,
} from '../../src/hooks/workflow.js';
import { MemoryManager, resetMemoryManager } from '../../src/memory/index.js';
import { resetWorkflowRunner } from '../../src/workflows/index.js';
import { existsSync, unlinkSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentStackConfig, HookContext } from '../../src/types.js';

function createTestConfig(): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: join(tmpdir(), `aistack-workflow-hook-${Date.now()}.db`),
      defaultNamespace: 'default',
      vectorSearch: { enabled: false },
    },
    providers: { default: 'anthropic' },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: false },
    plugins: { enabled: true, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
  };
}

describe('Workflow Triggers', () => {
  beforeEach(() => {
    clearWorkflowTriggers();
  });

  afterEach(() => {
    clearWorkflowTriggers();
  });

  describe('registerWorkflowTrigger', () => {
    it('should register a trigger', () => {
      const trigger: WorkflowTrigger = {
        id: 'test-trigger',
        name: 'Test Trigger',
        condition: () => true,
        workflowId: 'test-workflow',
      };

      registerWorkflowTrigger(trigger);

      const triggers = getWorkflowTriggers();
      expect(triggers.length).toBe(1);
      expect(triggers[0].id).toBe('test-trigger');
    });

    it('should register multiple triggers', () => {
      registerWorkflowTrigger({
        id: 'trigger-1',
        name: 'Trigger 1',
        condition: () => true,
        workflowId: 'workflow-1',
      });

      registerWorkflowTrigger({
        id: 'trigger-2',
        name: 'Trigger 2',
        condition: () => false,
        workflowId: 'workflow-2',
      });

      expect(getWorkflowTriggers().length).toBe(2);
    });

    it('should store trigger options', () => {
      const trigger: WorkflowTrigger = {
        id: 'trigger-with-options',
        name: 'Trigger with Options',
        condition: () => true,
        workflowId: 'test',
        options: { key: 'value', number: 42 },
      };

      registerWorkflowTrigger(trigger);

      const triggers = getWorkflowTriggers();
      expect(triggers[0].options).toEqual({ key: 'value', number: 42 });
    });
  });

  describe('unregisterWorkflowTrigger', () => {
    it('should unregister a trigger by ID', () => {
      registerWorkflowTrigger({
        id: 'to-remove',
        name: 'To Remove',
        condition: () => true,
        workflowId: 'test',
      });

      const result = unregisterWorkflowTrigger('to-remove');

      expect(result).toBe(true);
      expect(getWorkflowTriggers().length).toBe(0);
    });

    it('should return false for non-existent trigger', () => {
      const result = unregisterWorkflowTrigger('non-existent');
      expect(result).toBe(false);
    });

    it('should only remove the specified trigger', () => {
      registerWorkflowTrigger({
        id: 'keep-1',
        name: 'Keep 1',
        condition: () => true,
        workflowId: 'test',
      });

      registerWorkflowTrigger({
        id: 'remove',
        name: 'Remove',
        condition: () => true,
        workflowId: 'test',
      });

      registerWorkflowTrigger({
        id: 'keep-2',
        name: 'Keep 2',
        condition: () => true,
        workflowId: 'test',
      });

      unregisterWorkflowTrigger('remove');

      const triggers = getWorkflowTriggers();
      expect(triggers.length).toBe(2);
      expect(triggers.map((t) => t.id)).toEqual(['keep-1', 'keep-2']);
    });
  });

  describe('getWorkflowTriggers', () => {
    it('should return empty array when no triggers', () => {
      expect(getWorkflowTriggers()).toEqual([]);
    });

    it('should return a copy of triggers', () => {
      registerWorkflowTrigger({
        id: 'test',
        name: 'Test',
        condition: () => true,
        workflowId: 'test',
      });

      const triggers1 = getWorkflowTriggers();
      const triggers2 = getWorkflowTriggers();

      expect(triggers1).not.toBe(triggers2);
      expect(triggers1).toEqual(triggers2);
    });
  });

  describe('clearWorkflowTriggers', () => {
    it('should clear all triggers', () => {
      registerWorkflowTrigger({
        id: 't1',
        name: 'T1',
        condition: () => true,
        workflowId: 'w1',
      });

      registerWorkflowTrigger({
        id: 't2',
        name: 'T2',
        condition: () => true,
        workflowId: 'w2',
      });

      clearWorkflowTriggers();

      expect(getWorkflowTriggers()).toEqual([]);
    });
  });

  describe('registerDefaultTriggers', () => {
    it('should register default doc-sync trigger', () => {
      registerDefaultTriggers();

      const triggers = getWorkflowTriggers();
      expect(triggers.length).toBeGreaterThan(0);

      const docSyncTrigger = triggers.find((t) => t.id === 'doc-sync-on-change');
      expect(docSyncTrigger).toBeDefined();
      expect(docSyncTrigger?.workflowId).toBe('doc-sync');
    });

    it('should trigger on docs directory', () => {
      registerDefaultTriggers();

      const trigger = getWorkflowTriggers().find((t) => t.id === 'doc-sync-on-change');
      const condition = trigger?.condition;

      expect(condition?.({ event: 'post-edit', data: { path: '/project/docs/readme.md' } })).toBe(
        true
      );
      expect(condition?.({ event: 'post-edit', data: { path: '/project/src/index.ts' } })).toBe(
        false
      );
    });

    it('should trigger on markdown files', () => {
      registerDefaultTriggers();

      const trigger = getWorkflowTriggers().find((t) => t.id === 'doc-sync-on-change');
      const condition = trigger?.condition;

      expect(condition?.({ event: 'post-edit', data: { path: '/project/README.md' } })).toBe(true);
      expect(condition?.({ event: 'post-edit', data: { path: '/project/notes.md' } })).toBe(true);
      expect(condition?.({ event: 'post-edit', data: { path: '/project/file.txt' } })).toBe(false);
    });

    it('should handle missing path', () => {
      registerDefaultTriggers();

      const trigger = getWorkflowTriggers().find((t) => t.id === 'doc-sync-on-change');
      const condition = trigger?.condition;

      expect(condition?.({ event: 'post-edit', data: {} })).toBe(false);
      expect(condition?.({ event: 'post-edit' })).toBe(false);
    });
  });

  describe('trigger conditions', () => {
    it('should evaluate condition function', () => {
      const conditionFn = vi.fn().mockReturnValue(true);

      registerWorkflowTrigger({
        id: 'conditional',
        name: 'Conditional',
        condition: conditionFn,
        workflowId: 'test',
      });

      const trigger = getWorkflowTriggers()[0];
      const context = { event: 'test', data: { key: 'value' } };

      const result = trigger.condition(context);

      expect(conditionFn).toHaveBeenCalledWith(context);
      expect(result).toBe(true);
    });

    it('should support complex conditions', () => {
      registerWorkflowTrigger({
        id: 'complex',
        name: 'Complex',
        condition: (ctx) => {
          const files = (ctx.data?.files as string[]) || [];
          return files.some((f) => f.endsWith('.test.ts'));
        },
        workflowId: 'test-runner',
      });

      const trigger = getWorkflowTriggers()[0];

      expect(trigger.condition({ event: 'change', data: { files: ['foo.ts', 'bar.test.ts'] } })).toBe(
        true
      );
      expect(trigger.condition({ event: 'change', data: { files: ['foo.ts', 'bar.ts'] } })).toBe(
        false
      );
    });
  });
});

describe('workflowHook', () => {
  let memory: MemoryManager;
  let config: AgentStackConfig;
  let dbPath: string;

  beforeEach(() => {
    clearWorkflowTriggers();
    resetMemoryManager();
    config = createTestConfig();
    dbPath = config.memory.path;
    memory = new MemoryManager(config);
  });

  afterEach(() => {
    clearWorkflowTriggers();
    memory.close();
    resetMemoryManager();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  it('should complete without throwing when no triggers registered', async () => {
    const context: HookContext = {
      event: 'workflow',
      data: {},
    };

    await expect(workflowHook(context, memory, config)).resolves.not.toThrow();
  });

  it('should handle unknown workflowId gracefully', async () => {
    const context: HookContext = {
      event: 'workflow',
      data: { workflowId: 'unknown-workflow' },
    };

    await expect(workflowHook(context, memory, config)).resolves.not.toThrow();
  });

  it('should not trigger when no conditions match', async () => {
    const handler = vi.fn().mockReturnValue(false);

    registerWorkflowTrigger({
      id: 'no-match',
      name: 'No Match',
      condition: handler,
      workflowId: 'test-workflow',
    });

    const context: HookContext = {
      event: 'workflow',
      data: { path: '/src/code.ts' },
    };

    await workflowHook(context, memory, config);

    expect(handler).toHaveBeenCalled();
  });

  it('should pass context to trigger condition', async () => {
    const conditionFn = vi.fn().mockReturnValue(false);

    registerWorkflowTrigger({
      id: 'ctx-check',
      name: 'Context Check',
      condition: conditionFn,
      workflowId: 'test',
    });

    const context: HookContext = {
      event: 'workflow',
      taskId: 'task-123',
      agentType: 'coder',
      data: { key: 'value' },
    };

    await workflowHook(context, memory, config);

    expect(conditionFn).toHaveBeenCalledWith(context);
  });

  it('should evaluate multiple triggers', async () => {
    const condition1 = vi.fn().mockReturnValue(false);
    const condition2 = vi.fn().mockReturnValue(false);
    const condition3 = vi.fn().mockReturnValue(false);

    registerWorkflowTrigger({
      id: 't1',
      name: 'T1',
      condition: condition1,
      workflowId: 'w1',
    });

    registerWorkflowTrigger({
      id: 't2',
      name: 'T2',
      condition: condition2,
      workflowId: 'w2',
    });

    registerWorkflowTrigger({
      id: 't3',
      name: 'T3',
      condition: condition3,
      workflowId: 'w3',
    });

    const context: HookContext = {
      event: 'workflow',
      data: {},
    };

    await workflowHook(context, memory, config);

    expect(condition1).toHaveBeenCalled();
    expect(condition2).toHaveBeenCalled();
    expect(condition3).toHaveBeenCalled();
  });
});

describe('workflowHook with doc-sync', () => {
  let memory: MemoryManager;
  let config: AgentStackConfig;
  let dbPath: string;
  let testDir: string;
  let docsDir: string;

  beforeEach(() => {
    clearWorkflowTriggers();
    resetMemoryManager();
    resetWorkflowRunner();

    testDir = join(tmpdir(), `aistack-workflow-docsync-${Date.now()}`);
    docsDir = join(testDir, 'docs');
    mkdirSync(docsDir, { recursive: true });

    config = {
      version: '1.0.0',
      memory: {
        path: join(tmpdir(), `aistack-workflow-hook-docsync-${Date.now()}.db`),
        defaultNamespace: 'default',
        vectorSearch: { enabled: false },
      },
      providers: { default: 'anthropic' },
      agents: { maxConcurrent: 5, defaultTimeout: 300 },
      github: { enabled: false },
      plugins: { enabled: true, directory: './plugins' },
      mcp: { transport: 'stdio' },
      hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
    };

    dbPath = config.memory.path;
    memory = new MemoryManager(config);
  });

  afterEach(() => {
    clearWorkflowTriggers();
    resetWorkflowRunner();
    memory.close();
    resetMemoryManager();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('should execute doc-sync workflow with workflowId', async () => {
    // Create a test document
    writeFileSync(join(docsDir, 'README.md'), '# Test Documentation\n\nSome content.');

    const context: HookContext = {
      event: 'workflow',
      data: {
        workflowId: 'doc-sync',
        targetDirectory: docsDir,
        sourceCode: testDir,
      },
    };

    await expect(workflowHook(context, memory, config)).resolves.not.toThrow();
  });

  it('should execute doc-sync with full workflow ID', async () => {
    writeFileSync(join(docsDir, 'test.md'), '# Test');

    const context: HookContext = {
      event: 'workflow',
      data: {
        workflowId: 'documentation_truth_sync_with_adversarial_review',
      },
    };

    await expect(workflowHook(context, memory, config)).resolves.not.toThrow();
  });

  it('should execute workflow when trigger condition matches', async () => {
    writeFileSync(join(docsDir, 'triggered.md'), '# Triggered');

    // Register a trigger that matches
    registerWorkflowTrigger({
      id: 'test-doc-trigger',
      name: 'Test Doc Trigger',
      condition: () => true,
      workflowId: 'doc-sync',
      options: {
        targetDirectory: docsDir,
        sourceCode: testDir,
      },
    });

    const context: HookContext = {
      event: 'workflow',
      data: { path: '/docs/test.md' },
    };

    await expect(workflowHook(context, memory, config)).resolves.not.toThrow();
  });

  it('should apply options to workflow config', async () => {
    writeFileSync(join(docsDir, 'custom.md'), '# Custom');

    registerWorkflowTrigger({
      id: 'options-trigger',
      name: 'Options Trigger',
      condition: () => true,
      workflowId: 'doc-sync',
      options: {
        targetDirectory: docsDir,
        sourceCode: testDir,
      },
    });

    const context: HookContext = {
      event: 'workflow',
      data: {},
    };

    await expect(workflowHook(context, memory, config)).resolves.not.toThrow();
  });
});

describe('workflowHook with executeHooks error handling', () => {
  let memory: MemoryManager;
  let config: AgentStackConfig;
  let dbPath: string;

  beforeEach(() => {
    clearWorkflowTriggers();
    resetMemoryManager();
    resetWorkflowRunner();

    config = {
      version: '1.0.0',
      memory: {
        path: join(tmpdir(), `aistack-workflow-error-${Date.now()}.db`),
        defaultNamespace: 'default',
        vectorSearch: { enabled: false },
      },
      providers: { default: 'anthropic' },
      agents: { maxConcurrent: 5, defaultTimeout: 300 },
      github: { enabled: false },
      plugins: { enabled: true, directory: './plugins' },
      mcp: { transport: 'stdio' },
      hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
    };

    dbPath = config.memory.path;
    memory = new MemoryManager(config);
  });

  afterEach(() => {
    clearWorkflowTriggers();
    resetWorkflowRunner();
    memory.close();
    resetMemoryManager();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  it('should handle error via executeHooks gracefully', async () => {
    const { executeHooks, registerHook, clearCustomHooks } = await import('../../src/hooks/index.js');

    // Register a throwing custom hook for workflow event
    registerHook('workflow', async () => {
      throw new Error('Custom workflow hook error');
    });

    const context: HookContext = {
      event: 'workflow',
      data: {},
    };

    // executeHooks catches errors and logs them, doesn't throw
    await expect(executeHooks('workflow', context, memory, config)).resolves.not.toThrow();

    clearCustomHooks();
  });

  it('should log errors from built-in hooks without throwing', async () => {
    const { executeHooks } = await import('../../src/hooks/index.js');

    // Create a context that might cause issues in session-end hook
    const context: HookContext = {
      event: 'session-end',
      sessionId: 'invalid-session-that-does-not-exist',
      data: {},
    };

    // Should handle gracefully
    await expect(executeHooks('session-end', context, memory, config)).resolves.not.toThrow();
  });
});
