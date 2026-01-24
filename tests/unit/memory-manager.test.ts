/**
 * Memory Manager tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager, getMemoryManager, resetMemoryManager } from '../../src/memory/index.js';
import type { AgentStackConfig } from '../../src/types.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('MemoryManager', () => {
  let manager: MemoryManager;
  let dbPath: string;
  let config: AgentStackConfig;

  beforeEach(() => {
    dbPath = join(tmpdir(), `aistack-mm-test-${Date.now()}.db`);
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
    manager = new MemoryManager(config);
  });

  afterEach(() => {
    manager.close();
    resetMemoryManager();
    // Clean up test database files
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('Memory Operations', () => {
    it('should store and retrieve entries', async () => {
      const entry = await manager.store('test-key', 'test content');

      expect(entry.key).toBe('test-key');
      expect(entry.content).toBe('test content');

      const retrieved = manager.get('test-key');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.content).toBe('test content');
    });

    it('should use default namespace from config', async () => {
      const entry = await manager.store('ns-key', 'ns content');
      expect(entry.namespace).toBe('default');
    });

    it('should store with custom namespace', async () => {
      const entry = await manager.store('custom-key', 'custom content', {
        namespace: 'custom-ns',
      });

      expect(entry.namespace).toBe('custom-ns');
      expect(manager.get('custom-key', 'custom-ns')).not.toBeNull();
      expect(manager.get('custom-key', 'default')).toBeNull();
    });

    it('should get entry by ID', async () => {
      const entry = await manager.store('id-key', 'id content');
      const retrieved = manager.getById(entry.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.content).toBe('id content');
    });

    it('should delete entry', async () => {
      await manager.store('delete-key', 'to delete');
      const deleted = manager.delete('delete-key');

      expect(deleted).toBe(true);
      expect(manager.get('delete-key')).toBeNull();
    });

    it('should list entries', async () => {
      await manager.store('list-1', 'c1');
      await manager.store('list-2', 'c2');
      await manager.store('list-3', 'c3');

      const entries = manager.list();
      expect(entries.length).toBe(3);
    });

    it('should count entries', async () => {
      await manager.store('count-1', 'c1');
      await manager.store('count-2', 'c2');

      expect(manager.count()).toBe(2);
    });
  });

  describe('Search Operations', () => {
    it('should search using FTS', async () => {
      await manager.store('search-1', 'The quick brown fox jumps');
      await manager.store('search-2', 'A lazy dog sleeps');
      await manager.store('search-3', 'Quick foxes are fast');

      const results = await manager.search('quick fox');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should search with namespace filter', async () => {
      await manager.store('ns-search-1', 'apple content', { namespace: 'fruits' });
      await manager.store('ns-search-2', 'banana content', { namespace: 'fruits' });
      await manager.store('ns-search-3', 'apple content', { namespace: 'other' });

      const results = await manager.search('apple', { namespace: 'fruits' });
      expect(results.length).toBe(1);
    });

    it('should limit search results', async () => {
      for (let i = 0; i < 20; i++) {
        await manager.store(`limit-${i}`, `content with keyword ${i}`);
      }

      const results = await manager.search('keyword', { limit: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Session Operations', () => {
    it('should create session', () => {
      const session = manager.createSession();

      expect(session.id).toBeDefined();
      expect(session.status).toBe('active');
    });

    it('should create session with metadata', () => {
      const session = manager.createSession({ project: 'test' });
      expect(session.metadata).toEqual({ project: 'test' });
    });

    it('should get session', () => {
      const session = manager.createSession();
      const retrieved = manager.getSession(session.id);

      expect(retrieved?.id).toBe(session.id);
    });

    it('should end session', () => {
      const session = manager.createSession();
      manager.endSession(session.id);

      const retrieved = manager.getSession(session.id);
      expect(retrieved?.status).toBe('ended');
    });

    it('should get active session', () => {
      const s1 = manager.createSession({ name: 's1' });
      const s2 = manager.createSession({ name: 's2' });

      const active = manager.getActiveSession();
      expect(active).not.toBeNull();
      expect(active?.status).toBe('active');
      // Should return one of the active sessions (order may vary due to same-millisecond timestamps)
      expect([s1.id, s2.id]).toContain(active?.id);
    });
  });

  describe('Task Operations', () => {
    it('should create task', () => {
      const task = manager.createTask('coder', 'implement feature');

      expect(task.agentType).toBe('coder');
      expect(task.input).toBe('implement feature');
      expect(task.status).toBe('pending');
    });

    it('should create task with session', () => {
      const session = manager.createSession();
      const task = manager.createTask('tester', 'test', session.id);

      expect(task.sessionId).toBe(session.id);
    });

    it('should get task', () => {
      const task = manager.createTask('researcher', 'research');
      const retrieved = manager.getTask(task.id);

      expect(retrieved?.id).toBe(task.id);
    });

    it('should update task status', () => {
      const task = manager.createTask('coder', 'work');

      manager.updateTaskStatus(task.id, 'running');
      expect(manager.getTask(task.id)?.status).toBe('running');

      manager.updateTaskStatus(task.id, 'completed', 'done');
      const completed = manager.getTask(task.id);
      expect(completed?.status).toBe('completed');
      expect(completed?.output).toBe('done');
    });

    it('should list tasks', () => {
      manager.createTask('coder', 't1');
      manager.createTask('tester', 't2');

      const tasks = manager.listTasks();
      expect(tasks.length).toBe(2);
    });

    it('should list tasks by session', () => {
      const session = manager.createSession();
      manager.createTask('coder', 't1', session.id);
      manager.createTask('coder', 't2', session.id);
      manager.createTask('coder', 't3');

      const sessionTasks = manager.listTasks(session.id);
      expect(sessionTasks.length).toBe(2);
    });

    it('should list tasks by status', () => {
      const t1 = manager.createTask('coder', 't1');
      manager.createTask('coder', 't2');

      manager.updateTaskStatus(t1.id, 'completed');

      const pending = manager.listTasks(undefined, 'pending');
      expect(pending.length).toBe(1);

      const completed = manager.listTasks(undefined, 'completed');
      expect(completed.length).toBe(1);
    });
  });

  describe('Vector Search', () => {
    it('should return empty stats when vector disabled', () => {
      const stats = manager.getVectorStats();
      expect(stats.total).toBe(0);
      expect(stats.indexed).toBe(0);
      expect(stats.coverage).toBe(0);
    });

    it('should return 0 from reindex when vector disabled', async () => {
      const count = await manager.reindex();
      expect(count).toBe(0);
    });
  });

  describe('Cleanup', () => {
    it('should vacuum database', () => {
      expect(() => manager.vacuum()).not.toThrow();
    });
  });
});

describe('getMemoryManager singleton', () => {
  let dbPath: string;
  let config: AgentStackConfig;

  beforeEach(() => {
    resetMemoryManager();
    dbPath = join(tmpdir(), `aistack-singleton-${Date.now()}.db`);
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
  });

  afterEach(() => {
    resetMemoryManager();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  it('should throw without config on first call', () => {
    expect(() => getMemoryManager()).toThrow('Configuration required');
  });

  it('should return same instance on subsequent calls', () => {
    const m1 = getMemoryManager(config);
    const m2 = getMemoryManager();

    expect(m1).toBe(m2);
  });

  it('should reset instance', () => {
    const m1 = getMemoryManager(config);
    resetMemoryManager();

    // Now requires config again
    expect(() => getMemoryManager()).toThrow('Configuration required');
  });
});
