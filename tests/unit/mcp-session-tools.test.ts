/**
 * MCP Session Tools tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSessionTools } from '../../src/mcp/tools/session-tools.js';
import { MemoryManager, resetMemoryManager } from '../../src/memory/index.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentStackConfig } from '../../src/types.js';

function createTestConfig(): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: join(tmpdir(), `aistack-mcp-session-${Date.now()}.db`),
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

describe('MCP Session Tools', () => {
  let memory: MemoryManager;
  let config: AgentStackConfig;
  let dbPath: string;
  let tools: ReturnType<typeof createSessionTools>;

  beforeEach(() => {
    resetMemoryManager();
    config = createTestConfig();
    dbPath = config.memory.path;
    memory = new MemoryManager(config);
    tools = createSessionTools(memory);
  });

  afterEach(() => {
    memory.close();
    resetMemoryManager();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('session_start', () => {
    it('should start a new session', async () => {
      const result = await tools.session_start.handler({});

      expect(result.success).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.session.id).toBeDefined();
      expect(result.session.status).toBe('active');
    });

    it('should start session with metadata', async () => {
      const result = await tools.session_start.handler({
        metadata: { project: 'test', user: 'dev' },
      });

      expect(result.success).toBe(true);
      expect(result.session.metadata).toEqual({ project: 'test', user: 'dev' });
    });

    it('should include startedAt timestamp', async () => {
      const result = await tools.session_start.handler({});

      expect(result.success).toBe(true);
      expect(result.session.startedAt).toBeDefined();
      expect(() => new Date(result.session.startedAt)).not.toThrow();
    });

    it('should have correct tool definition', () => {
      expect(tools.session_start.name).toBe('session_start');
      expect(tools.session_start.description).toBe('Start a new session');
    });
  });

  describe('session_end', () => {
    it('should end an active session', async () => {
      const session = memory.createSession();

      const result = await tools.session_end.handler({
        sessionId: session.id,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Session ended');
      expect(result.sessionId).toBe(session.id);
    });

    it('should return error for non-existent session', async () => {
      const result = await tools.session_end.handler({
        sessionId: '00000000-0000-0000-0000-000000000000',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Session not found or already ended');
    });

    it('should throw for invalid session ID format', async () => {
      await expect(
        tools.session_end.handler({
          sessionId: 'not-a-uuid',
        })
      ).rejects.toThrow();
    });

    it('should have correct tool definition', () => {
      expect(tools.session_end.name).toBe('session_end');
      expect(tools.session_end.inputSchema.required).toContain('sessionId');
    });
  });

  describe('session_status', () => {
    it('should get status of specific session', async () => {
      const session = memory.createSession({ project: 'test' });

      const result = await tools.session_status.handler({
        sessionId: session.id,
      });

      expect(result.found).toBe(true);
      expect(result.session.id).toBe(session.id);
      expect(result.session.status).toBe('active');
      expect(result.session.metadata).toEqual({ project: 'test' });
    });

    it('should get active session when no ID provided', async () => {
      memory.createSession();

      const result = await tools.session_status.handler({});

      expect(result.found).toBe(true);
      expect(result.session).toBeDefined();
    });

    it('should return not found for non-existent session', async () => {
      const result = await tools.session_status.handler({
        sessionId: '00000000-0000-0000-0000-000000000000',
      });

      expect(result.found).toBe(false);
      expect(result.message).toBe('Session not found');
    });

    it('should return no active session when none exists', async () => {
      const result = await tools.session_status.handler({});

      expect(result.found).toBe(false);
      expect(result.message).toBe('No active session');
    });

    it('should include task counts', async () => {
      const session = memory.createSession();
      memory.createTask('coder', 'task1', session.id);
      memory.createTask('tester', 'task2', session.id);
      const task3 = memory.createTask('reviewer', 'task3', session.id);
      memory.updateTaskStatus(task3.id, 'completed');

      const result = await tools.session_status.handler({
        sessionId: session.id,
      });

      expect(result.found).toBe(true);
      expect(result.session.tasks.total).toBe(3);
      expect(result.session.tasks.pending).toBe(2);
      expect(result.session.tasks.completed).toBe(1);
    });

    it('should include endedAt for ended sessions', async () => {
      const session = memory.createSession();
      memory.endSession(session.id);

      const result = await tools.session_status.handler({
        sessionId: session.id,
      });

      expect(result.found).toBe(true);
      expect(result.session.endedAt).toBeDefined();
    });

    it('should have correct tool definition', () => {
      expect(tools.session_status.name).toBe('session_status');
    });
  });

  describe('session_active', () => {
    it('should return active session when one exists', async () => {
      memory.createSession({ name: 'active-session' });

      const result = await tools.session_active.handler({});

      expect(result.active).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.session.status).toBe('active');
    });

    it('should return no active session when none exists', async () => {
      const result = await tools.session_active.handler({});

      expect(result.active).toBe(false);
      expect(result.message).toBe('No active session');
    });

    it('should include session metadata', async () => {
      memory.createSession({ project: 'myproject' });

      const result = await tools.session_active.handler({});

      expect(result.active).toBe(true);
      expect(result.session.metadata).toEqual({ project: 'myproject' });
    });

    it('should have correct tool definition', () => {
      expect(tools.session_active.name).toBe('session_active');
      expect(tools.session_active.description).toBe('Get the currently active session');
    });
  });
});
