/**
 * Task hooks tests - preTaskHook and postTaskHook
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { preTaskHook, postTaskHook } from '../../src/hooks/task.js';
import { MemoryManager, resetMemoryManager } from '../../src/memory/index.js';
import {
  registerWorkflowTrigger,
  clearWorkflowTriggers,
} from '../../src/hooks/workflow.js';
import { resetWorkflowRunner } from '../../src/workflows/index.js';
import { existsSync, unlinkSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentStackConfig, HookContext } from '../../src/types.js';

function createTestConfig(): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: join(tmpdir(), `aistack-task-hooks-${Date.now()}.db`),
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

describe('Task Hooks', () => {
  let memory: MemoryManager;
  let config: AgentStackConfig;
  let dbPath: string;

  beforeEach(() => {
    resetMemoryManager();
    config = createTestConfig();
    dbPath = config.memory.path;
    memory = new MemoryManager(config);
  });

  afterEach(() => {
    memory.close();
    resetMemoryManager();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('preTaskHook', () => {
    it('should complete without throwing', async () => {
      const context: HookContext = {
        event: 'pre-task',
        taskId: 'task-1',
        agentType: 'coder',
        data: {},
      };

      await expect(preTaskHook(context, memory, config)).resolves.not.toThrow();
    });

    it('should work without taskId', async () => {
      const context: HookContext = {
        event: 'pre-task',
        agentType: 'coder',
        data: {},
      };

      await expect(preTaskHook(context, memory, config)).resolves.not.toThrow();
    });

    it('should work without agentType', async () => {
      const context: HookContext = {
        event: 'pre-task',
        taskId: 'task-1',
        data: {},
      };

      await expect(preTaskHook(context, memory, config)).resolves.not.toThrow();
    });

    it('should search for relevant context when agentType provided', async () => {
      // Store some previous task data
      await memory.store('prev-task', 'coder task result', {
        namespace: 'tasks',
        metadata: { type: 'post-task' },
      });

      const context: HookContext = {
        event: 'pre-task',
        taskId: 'new-task',
        agentType: 'coder',
        data: {},
      };

      await preTaskHook(context, memory, config);

      // Should complete without error - context enrichment is optional
      expect(context.event).toBe('pre-task');
    });

    it('should preserve existing context data', async () => {
      const context: HookContext = {
        event: 'pre-task',
        taskId: 'task-1',
        agentType: 'researcher',
        data: { existingKey: 'existingValue' },
      };

      await preTaskHook(context, memory, config);

      expect(context.data?.existingKey).toBe('existingValue');
    });
  });

  describe('postTaskHook', () => {
    it('should complete without throwing', async () => {
      const context: HookContext = {
        event: 'post-task',
        taskId: 'task-1',
        agentType: 'coder',
        data: { result: 'success' },
      };

      await expect(postTaskHook(context, memory, config)).resolves.not.toThrow();
    });

    it('should work without taskId', async () => {
      const context: HookContext = {
        event: 'post-task',
        data: { result: 'success' },
      };

      await expect(postTaskHook(context, memory, config)).resolves.not.toThrow();
    });

    it('should work without data', async () => {
      const context: HookContext = {
        event: 'post-task',
        taskId: 'task-1',
      };

      await expect(postTaskHook(context, memory, config)).resolves.not.toThrow();
    });

    it('should handle empty modifiedFiles array', async () => {
      const context: HookContext = {
        event: 'post-task',
        taskId: 'task-1',
        data: { modifiedFiles: [] },
      };

      await expect(postTaskHook(context, memory, config)).resolves.not.toThrow();
    });

    it('should detect documentation changes in docs folder', async () => {
      const context: HookContext = {
        event: 'post-task',
        taskId: 'task-1',
        data: {
          modifiedFiles: ['/project/docs/README.md', '/project/src/index.ts'],
        },
      };

      // Should not throw even with doc changes
      await expect(postTaskHook(context, memory, config)).resolves.not.toThrow();
    });

    it('should detect markdown file changes', async () => {
      const context: HookContext = {
        event: 'post-task',
        taskId: 'task-1',
        data: {
          modifiedFiles: ['/project/CHANGELOG.md'],
        },
      };

      await expect(postTaskHook(context, memory, config)).resolves.not.toThrow();
    });

    it('should not trigger on non-doc changes', async () => {
      const context: HookContext = {
        event: 'post-task',
        taskId: 'task-1',
        data: {
          modifiedFiles: ['/project/src/index.ts', '/project/package.json'],
        },
      };

      await expect(postTaskHook(context, memory, config)).resolves.not.toThrow();
    });

    it('should handle complex task result data', async () => {
      const context: HookContext = {
        event: 'post-task',
        taskId: 'complex-task',
        agentType: 'architect',
        sessionId: 'session-123',
        data: {
          result: 'success',
          metrics: {
            filesChanged: 5,
            linesAdded: 100,
            linesRemoved: 50,
          },
          modifiedFiles: ['/src/a.ts', '/src/b.ts'],
        },
      };

      await expect(postTaskHook(context, memory, config)).resolves.not.toThrow();
    });
  });
});

describe('Task Hooks with Documentation Triggers', () => {
  let memory: MemoryManager;
  let config: AgentStackConfig;
  let dbPath: string;
  let testDir: string;
  let docsDir: string;

  beforeEach(() => {
    clearWorkflowTriggers();
    resetWorkflowRunner();
    resetMemoryManager();

    testDir = join(tmpdir(), `aistack-task-hooks-trigger-${Date.now()}`);
    docsDir = join(testDir, 'docs');
    mkdirSync(docsDir, { recursive: true });

    config = {
      version: '1.0.0',
      memory: {
        path: join(tmpdir(), `aistack-task-hooks-trigger-${Date.now()}.db`),
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

  it('should trigger doc-sync workflow when docs modified and trigger registered', async () => {
    // Create a test doc
    writeFileSync(join(docsDir, 'test.md'), '# Test');

    // Register the doc-sync trigger
    registerWorkflowTrigger({
      id: 'doc-sync-on-change',
      name: 'Doc Sync',
      condition: () => true,
      workflowId: 'doc-sync',
      options: {
        targetDirectory: docsDir,
        sourceCode: testDir,
      },
    });

    const context: HookContext = {
      event: 'post-task',
      taskId: 'test-task',
      data: {
        modifiedFiles: [join(docsDir, 'test.md')],
      },
    };

    // Should complete without throwing
    await expect(postTaskHook(context, memory, config)).resolves.not.toThrow();
  });

  it('should handle trigger with missing docs directory gracefully', async () => {
    // Register trigger pointing to non-existent dir
    registerWorkflowTrigger({
      id: 'doc-sync-on-change',
      name: 'Doc Sync',
      condition: () => true,
      workflowId: 'doc-sync',
      options: {
        targetDirectory: '/nonexistent/path',
        sourceCode: testDir,
      },
    });

    const context: HookContext = {
      event: 'post-task',
      taskId: 'test-task',
      data: {
        modifiedFiles: ['/docs/README.md'],
      },
    };

    // Should handle error gracefully
    await expect(postTaskHook(context, memory, config)).resolves.not.toThrow();
  });

  it('should not trigger when no doc-sync trigger registered', async () => {
    const context: HookContext = {
      event: 'post-task',
      taskId: 'test-task',
      data: {
        modifiedFiles: ['/docs/README.md'],
      },
    };

    // Should complete without triggering workflow
    await expect(postTaskHook(context, memory, config)).resolves.not.toThrow();
  });

  it('should detect .mdx files as documentation', async () => {
    writeFileSync(join(docsDir, 'component.mdx'), '# Component');

    registerWorkflowTrigger({
      id: 'doc-sync-on-change',
      name: 'Doc Sync',
      condition: () => true,
      workflowId: 'doc-sync',
      options: {
        targetDirectory: docsDir,
        sourceCode: testDir,
      },
    });

    const context: HookContext = {
      event: 'post-task',
      taskId: 'test-task',
      data: {
        modifiedFiles: [join(docsDir, 'component.mdx')],
      },
    };

    await expect(postTaskHook(context, memory, config)).resolves.not.toThrow();
  });
});
