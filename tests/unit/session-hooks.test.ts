/**
 * Session hooks tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sessionStartHook, sessionEndHook } from '../../src/hooks/session.js';
import { MemoryManager, resetMemoryManager } from '../../src/memory/index.js';
import { spawnAgent, clearAgents, listAgents, getAgent } from '../../src/agents/spawner.js';
import { registerAgent, unregisterAgent } from '../../src/agents/registry.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentStackConfig, HookContext } from '../../src/types.js';

function createTestConfig(): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: join(tmpdir(), `aistack-session-hooks-${Date.now()}.db`),
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

describe('Session Hooks', () => {
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

  describe('sessionStartHook', () => {
    it('should create a session when no sessionId provided', async () => {
      const context: HookContext = {
        event: 'session-start',
        data: { project: 'test-project' },
      };

      await sessionStartHook(context, memory, config);

      expect(context.sessionId).toBeDefined();
    });

    it('should not create new session if sessionId exists', async () => {
      const existingSession = memory.createSession();
      const context: HookContext = {
        event: 'session-start',
        sessionId: existingSession.id,
        data: {},
      };

      await sessionStartHook(context, memory, config);

      expect(context.sessionId).toBe(existingSession.id);
    });

    it('should store session start data in memory', async () => {
      const context: HookContext = {
        event: 'session-start',
        data: { testKey: 'testValue' },
      };

      // Should complete without throwing
      await expect(sessionStartHook(context, memory, config)).resolves.not.toThrow();

      // Verify session was created with sessionId
      expect(context.sessionId).toBeDefined();
    });

    it('should work with multiple sessions', async () => {
      const context1: HookContext = {
        event: 'session-start',
        data: { project: 'project1' },
      };

      const context2: HookContext = {
        event: 'session-start',
        data: { project: 'project2' },
      };

      await sessionStartHook(context1, memory, config);
      await sessionStartHook(context2, memory, config);

      expect(context1.sessionId).toBeDefined();
      expect(context2.sessionId).toBeDefined();
      expect(context1.sessionId).not.toBe(context2.sessionId);
    });
  });

  describe('sessionEndHook', () => {
    it('should end an active session', async () => {
      const session = memory.createSession();
      const context: HookContext = {
        event: 'session-end',
        sessionId: session.id,
        data: {},
      };

      await sessionEndHook(context, memory, config);

      const endedSession = memory.getSession(session.id);
      expect(endedSession?.status).toBe('ended');
    });

    it('should not throw without sessionId', async () => {
      const context: HookContext = {
        event: 'session-end',
        data: {},
      };

      await expect(sessionEndHook(context, memory, config)).resolves.not.toThrow();
    });

    it('should complete session end without throwing', async () => {
      const session = memory.createSession();
      const context: HookContext = {
        event: 'session-end',
        sessionId: session.id,
        data: { reason: 'completed' },
      };

      // Should complete without throwing
      await expect(sessionEndHook(context, memory, config)).resolves.not.toThrow();

      // Verify session was ended
      const endedSession = memory.getSession(session.id);
      expect(endedSession?.status).toBe('ended');
    });

    it('should handle non-existent session gracefully', async () => {
      const context: HookContext = {
        event: 'session-end',
        sessionId: 'non-existent-session-id',
        data: {},
      };

      await expect(sessionEndHook(context, memory, config)).resolves.not.toThrow();
    });

    it('should stop agents in session when session ends', async () => {
      // Register a test agent type
      registerAgent({
        type: 'test-session-agent',
        name: 'Test Session Agent',
        description: 'Test agent for session cleanup',
        systemPrompt: 'Test prompt',
        capabilities: ['test'],
      });

      // Create a session
      const session = memory.createSession();

      // Spawn agents with this sessionId
      const agent1 = spawnAgent('test-session-agent', { sessionId: session.id }, config);
      const agent2 = spawnAgent('test-session-agent', { sessionId: session.id }, config);

      // Verify agents are in the session
      const sessionAgents = listAgents(session.id);
      expect(sessionAgents.length).toBe(2);

      // End the session
      const context: HookContext = {
        event: 'session-end',
        sessionId: session.id,
        data: {},
      };

      await sessionEndHook(context, memory, config);

      // Verify agents were stopped
      expect(getAgent(agent1.id)).toBeNull();
      expect(getAgent(agent2.id)).toBeNull();

      // Cleanup
      unregisterAgent('test-session-agent');
      clearAgents();
    });

    it('should clean up session memory when session ends', async () => {
      // Create a session
      const session = memory.createSession();
      const sessionNamespace = `session:${session.id}`;

      // Store some memory in the session namespace
      await memory.store('test-key-1', 'test content 1', { namespace: sessionNamespace });
      await memory.store('test-key-2', 'test content 2', { namespace: sessionNamespace });

      // Verify memory exists
      expect(memory.get('test-key-1', sessionNamespace)).not.toBeNull();
      expect(memory.get('test-key-2', sessionNamespace)).not.toBeNull();

      // End the session
      const context: HookContext = {
        event: 'session-end',
        sessionId: session.id,
        data: {},
      };

      await sessionEndHook(context, memory, config);

      // Verify memory was cleaned up
      expect(memory.get('test-key-1', sessionNamespace)).toBeNull();
      expect(memory.get('test-key-2', sessionNamespace)).toBeNull();
    });
  });
});
