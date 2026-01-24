/**
 * MCP Task Tools tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTaskTools } from '../../src/mcp/tools/task-tools.js';
import { MemoryManager, resetMemoryManager } from '../../src/memory/index.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentStackConfig } from '../../src/types.js';

function createTestConfig(): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: join(tmpdir(), `aistack-mcp-task-${Date.now()}.db`),
      defaultNamespace: 'default',
      vectorSearch: { enabled: false },
    },
    providers: {
      default: 'anthropic',
      anthropic: { apiKey: 'test-key' },
    },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: false },
    plugins: { enabled: true, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
  };
}

describe('MCP Task Tools', () => {
  let memory: MemoryManager;
  let config: AgentStackConfig;
  let dbPath: string;
  let tools: ReturnType<typeof createTaskTools>;

  beforeEach(() => {
    resetMemoryManager();
    config = createTestConfig();
    dbPath = config.memory.path;
    memory = new MemoryManager(config);
    tools = createTaskTools(memory);
  });

  afterEach(() => {
    memory.close();
    resetMemoryManager();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('task_create', () => {
    it('should create a task', async () => {
      const result = await tools.task_create.handler({
        agentType: 'coder',
      });

      expect(result.success).toBe(true);
      expect(result.task).toBeDefined();
      expect(result.task.agentType).toBe('coder');
      expect(result.task.status).toBe('pending');
    });

    it('should create task with input', async () => {
      const result = await tools.task_create.handler({
        agentType: 'tester',
        input: 'write unit tests',
      });

      expect(result.success).toBe(true);
      expect(result.task.agentType).toBe('tester');
    });

    it('should create task with session', async () => {
      const session = memory.createSession();

      const result = await tools.task_create.handler({
        agentType: 'reviewer',
        sessionId: session.id,
      });

      expect(result.success).toBe(true);
      expect(result.task.sessionId).toBe(session.id);
    });

    it('should include createdAt timestamp', async () => {
      const result = await tools.task_create.handler({
        agentType: 'coder',
      });

      expect(result.success).toBe(true);
      expect(result.task.createdAt).toBeDefined();
      expect(() => new Date(result.task.createdAt)).not.toThrow();
    });

    it('should throw for missing agentType', async () => {
      await expect(
        tools.task_create.handler({})
      ).rejects.toThrow();
    });

    it('should throw for empty agentType', async () => {
      await expect(
        tools.task_create.handler({
          agentType: '',
        })
      ).rejects.toThrow();
    });

    it('should have correct tool definition', () => {
      expect(tools.task_create.name).toBe('task_create');
      expect(tools.task_create.inputSchema.required).toContain('agentType');
    });
  });

  describe('task_assign', () => {
    it('should assign task to agent', async () => {
      const task = memory.createTask('coder', 'implement feature');

      const result = await tools.task_assign.handler({
        taskId: task.id,
        agentId: '00000000-0000-0000-0000-000000000001',
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Task assigned and running');

      const updatedTask = memory.getTask(task.id);
      expect(updatedTask?.status).toBe('running');
    });

    it('should return error for non-existent task', async () => {
      const result = await tools.task_assign.handler({
        taskId: '00000000-0000-0000-0000-000000000000',
        agentId: '00000000-0000-0000-0000-000000000001',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Task not found');
    });

    it('should throw for invalid task ID format', async () => {
      await expect(
        tools.task_assign.handler({
          taskId: 'not-a-uuid',
          agentId: '00000000-0000-0000-0000-000000000001',
        })
      ).rejects.toThrow();
    });

    it('should have correct tool definition', () => {
      expect(tools.task_assign.name).toBe('task_assign');
      expect(tools.task_assign.inputSchema.required).toContain('taskId');
      expect(tools.task_assign.inputSchema.required).toContain('agentId');
    });
  });

  describe('task_complete', () => {
    it('should mark task as completed', async () => {
      const task = memory.createTask('coder', 'implement feature');

      const result = await tools.task_complete.handler({
        taskId: task.id,
      });

      expect(result.success).toBe(true);
      expect(result.task.status).toBe('completed');

      const updatedTask = memory.getTask(task.id);
      expect(updatedTask?.status).toBe('completed');
    });

    it('should mark task as failed', async () => {
      const task = memory.createTask('coder', 'implement feature');

      const result = await tools.task_complete.handler({
        taskId: task.id,
        status: 'failed',
      });

      expect(result.success).toBe(true);
      expect(result.task.status).toBe('failed');
    });

    it('should include output', async () => {
      const task = memory.createTask('coder', 'implement feature');

      const result = await tools.task_complete.handler({
        taskId: task.id,
        output: 'Feature implemented successfully',
      });

      expect(result.success).toBe(true);
      expect(result.task.hasOutput).toBe(true);

      const updatedTask = memory.getTask(task.id);
      expect(updatedTask?.output).toBe('Feature implemented successfully');
    });

    it('should return error for non-existent task', async () => {
      const result = await tools.task_complete.handler({
        taskId: '00000000-0000-0000-0000-000000000000',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Task not found');
    });

    it('should have correct tool definition', () => {
      expect(tools.task_complete.name).toBe('task_complete');
      expect(tools.task_complete.inputSchema.required).toContain('taskId');
    });
  });

  describe('task_list', () => {
    beforeEach(() => {
      memory.createTask('coder', 'task1');
      memory.createTask('tester', 'task2');
      memory.createTask('reviewer', 'task3');
    });

    it('should list all tasks', async () => {
      const result = await tools.task_list.handler({});

      expect(result.count).toBe(3);
      expect(result.tasks).toHaveLength(3);
    });

    it('should list tasks by session', async () => {
      const session = memory.createSession();
      memory.createTask('coder', 'session-task', session.id);

      const result = await tools.task_list.handler({
        sessionId: session.id,
      });

      expect(result.count).toBe(1);
      expect(result.tasks[0].sessionId).toBe(session.id);
    });

    it('should list tasks by status', async () => {
      const task = memory.createTask('coder', 'to-complete');
      memory.updateTaskStatus(task.id, 'completed');

      const result = await tools.task_list.handler({
        status: 'completed',
      });

      expect(result.count).toBe(1);
      expect(result.tasks[0].status).toBe('completed');
    });

    it('should include hasInput and hasOutput flags', async () => {
      const task = memory.createTask('coder', 'with-output');
      memory.updateTaskStatus(task.id, 'completed', 'some output');

      const result = await tools.task_list.handler({});

      const withOutput = result.tasks.find((t: { id: string }) => t.id === task.id);
      expect(withOutput).toBeDefined();
      expect(withOutput.hasInput).toBe(true);
      expect(withOutput.hasOutput).toBe(true);
    });

    it('should include completedAt for completed tasks', async () => {
      const task = memory.createTask('coder', 'completed');
      memory.updateTaskStatus(task.id, 'completed');

      const result = await tools.task_list.handler({});

      const completedTask = result.tasks.find((t: { id: string }) => t.id === task.id);
      expect(completedTask.completedAt).toBeDefined();
    });

    it('should have correct tool definition', () => {
      expect(tools.task_list.name).toBe('task_list');
    });
  });

  describe('task_get', () => {
    it('should get task by ID', async () => {
      const task = memory.createTask('coder', 'get-task');

      const result = await tools.task_get.handler({
        taskId: task.id,
      });

      expect(result.found).toBe(true);
      expect(result.task.id).toBe(task.id);
      expect(result.task.agentType).toBe('coder');
      expect(result.task.input).toBe('get-task');
    });

    it('should return not found for non-existent task', async () => {
      const result = await tools.task_get.handler({
        taskId: '00000000-0000-0000-0000-000000000000',
      });

      expect(result.found).toBe(false);
      expect(result.message).toBe('Task not found');
    });

    it('should include output for completed tasks', async () => {
      const task = memory.createTask('coder', 'task-with-output');
      memory.updateTaskStatus(task.id, 'completed', 'output data');

      const result = await tools.task_get.handler({
        taskId: task.id,
      });

      expect(result.found).toBe(true);
      expect(result.task.output).toBe('output data');
      expect(result.task.completedAt).toBeDefined();
    });

    it('should include session ID', async () => {
      const session = memory.createSession();
      const task = memory.createTask('coder', 'session-task', session.id);

      const result = await tools.task_get.handler({
        taskId: task.id,
      });

      expect(result.found).toBe(true);
      expect(result.task.sessionId).toBe(session.id);
    });

    it('should throw for invalid task ID format', async () => {
      await expect(
        tools.task_get.handler({
          taskId: 'not-a-uuid',
        })
      ).rejects.toThrow();
    });

    it('should have correct tool definition', () => {
      expect(tools.task_get.name).toBe('task_get');
      expect(tools.task_get.inputSchema.required).toContain('taskId');
    });
  });
});
