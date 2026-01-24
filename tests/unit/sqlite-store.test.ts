/**
 * SQLite Store tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStore } from '../../src/memory/sqlite-store.js';
import { existsSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('SQLiteStore', () => {
  let store: SQLiteStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `aistack-test-${Date.now()}.db`);
    store = new SQLiteStore(dbPath);
  });

  afterEach(() => {
    store.close();
    // Clean up test database files
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('Memory Operations', () => {
    it('should store and retrieve a memory entry', () => {
      const entry = store.store('test-key', 'test content');

      expect(entry.key).toBe('test-key');
      expect(entry.content).toBe('test content');
      expect(entry.namespace).toBe('default');
      expect(entry.id).toBeDefined();

      const retrieved = store.get('test-key');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.content).toBe('test content');
    });

    it('should store with custom namespace', () => {
      const entry = store.store('key1', 'content1', { namespace: 'custom' });

      expect(entry.namespace).toBe('custom');

      const retrieved = store.get('key1', 'custom');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.namespace).toBe('custom');

      // Should not find in default namespace
      const notFound = store.get('key1', 'default');
      expect(notFound).toBeNull();
    });

    it('should store with metadata', () => {
      const metadata = { type: 'note', priority: 1 };
      const entry = store.store('key-meta', 'content', { metadata });

      expect(entry.metadata).toEqual(metadata);

      const retrieved = store.get('key-meta');
      expect(retrieved?.metadata).toEqual(metadata);
    });

    it('should update existing entry', () => {
      store.store('update-key', 'original content');
      const updated = store.store('update-key', 'updated content');

      expect(updated.content).toBe('updated content');

      const retrieved = store.get('update-key');
      expect(retrieved?.content).toBe('updated content');
    });

    it('should get entry by ID', () => {
      const entry = store.store('id-key', 'id content');
      const retrieved = store.getById(entry.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.content).toBe('id content');
    });

    it('should return null for non-existent entry', () => {
      const result = store.get('non-existent-key');
      expect(result).toBeNull();
    });

    it('should delete entry by key', () => {
      store.store('delete-key', 'to delete');
      const deleted = store.delete('delete-key');

      expect(deleted).toBe(true);
      expect(store.get('delete-key')).toBeNull();
    });

    it('should delete entry by ID', () => {
      const entry = store.store('delete-id-key', 'to delete');
      const deleted = store.deleteById(entry.id);

      expect(deleted).toBe(true);
      expect(store.getById(entry.id)).toBeNull();
    });

    it('should return false when deleting non-existent entry', () => {
      const deleted = store.delete('non-existent');
      expect(deleted).toBe(false);
    });

    it('should list entries', () => {
      store.store('list-key-1', 'content 1');
      store.store('list-key-2', 'content 2');
      store.store('list-key-3', 'content 3');

      const entries = store.list();
      expect(entries.length).toBe(3);
    });

    it('should list entries with namespace filter', () => {
      store.store('ns-key-1', 'content 1', { namespace: 'ns1' });
      store.store('ns-key-2', 'content 2', { namespace: 'ns1' });
      store.store('ns-key-3', 'content 3', { namespace: 'ns2' });

      const ns1Entries = store.list('ns1');
      expect(ns1Entries.length).toBe(2);

      const ns2Entries = store.list('ns2');
      expect(ns2Entries.length).toBe(1);
    });

    it('should list entries with limit and offset', () => {
      for (let i = 0; i < 10; i++) {
        store.store(`page-key-${i}`, `content ${i}`);
      }

      const page1 = store.list(undefined, 3, 0);
      expect(page1.length).toBe(3);

      const page2 = store.list(undefined, 3, 3);
      expect(page2.length).toBe(3);

      const page4 = store.list(undefined, 3, 9);
      expect(page4.length).toBe(1);
    });

    it('should count entries', () => {
      store.store('count-1', 'c1');
      store.store('count-2', 'c2');
      store.store('count-3', 'c3', { namespace: 'other' });

      expect(store.count()).toBe(3);
      expect(store.count('default')).toBe(2);
      expect(store.count('other')).toBe(1);
    });

    it('should store and retrieve embeddings', () => {
      const entry = store.store('embed-key', 'embed content');
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];

      store.storeEmbedding(entry.id, embedding);

      const entriesWithEmbeddings = store.getEntriesWithEmbeddings();
      expect(entriesWithEmbeddings.length).toBe(1);
      expect(entriesWithEmbeddings[0].id).toBe(entry.id);
      expect(entriesWithEmbeddings[0].embedding.length).toBe(5);
    });
  });

  describe('Session Operations', () => {
    it('should create a session', () => {
      const session = store.createSession();

      expect(session.id).toBeDefined();
      expect(session.status).toBe('active');
      expect(session.startedAt).toBeInstanceOf(Date);
    });

    it('should create session with metadata', () => {
      const metadata = { user: 'test', project: 'demo' };
      const session = store.createSession(metadata);

      expect(session.metadata).toEqual(metadata);
    });

    it('should get session by ID', () => {
      const session = store.createSession();
      const retrieved = store.getSession(session.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(session.id);
    });

    it('should end a session', () => {
      const session = store.createSession();
      const ended = store.endSession(session.id);

      expect(ended).toBe(true);

      const retrieved = store.getSession(session.id);
      expect(retrieved?.status).toBe('ended');
      expect(retrieved?.endedAt).toBeInstanceOf(Date);
    });

    it('should get active session', () => {
      const session1 = store.createSession({ name: 'session1' });
      const session2 = store.createSession({ name: 'session2' });

      const active = store.getActiveSession();
      expect(active).not.toBeNull();
      expect(active?.status).toBe('active');
      // Should return one of the active sessions (order may vary due to same-millisecond timestamps)
      expect([session1.id, session2.id]).toContain(active?.id);
    });

    it('should return null when no active session', () => {
      const session = store.createSession();
      store.endSession(session.id);

      const active = store.getActiveSession();
      expect(active).toBeNull();
    });
  });

  describe('Task Operations', () => {
    it('should create a task', () => {
      const task = store.createTask('coder', 'implement feature');

      expect(task.id).toBeDefined();
      expect(task.agentType).toBe('coder');
      expect(task.status).toBe('pending');
      expect(task.input).toBe('implement feature');
    });

    it('should create task with session ID', () => {
      const session = store.createSession();
      const task = store.createTask('tester', 'write tests', session.id);

      expect(task.sessionId).toBe(session.id);
    });

    it('should get task by ID', () => {
      const task = store.createTask('researcher', 'research topic');
      const retrieved = store.getTask(task.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.agentType).toBe('researcher');
    });

    it('should update task status', () => {
      const task = store.createTask('coder', 'task');

      store.updateTaskStatus(task.id, 'running');
      let updated = store.getTask(task.id);
      expect(updated?.status).toBe('running');

      store.updateTaskStatus(task.id, 'completed', 'done successfully');
      updated = store.getTask(task.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.output).toBe('done successfully');
      expect(updated?.completedAt).toBeInstanceOf(Date);
    });

    it('should list tasks', () => {
      store.createTask('coder', 'task 1');
      store.createTask('tester', 'task 2');
      store.createTask('reviewer', 'task 3');

      const tasks = store.listTasks();
      expect(tasks.length).toBe(3);
    });

    it('should list tasks by session', () => {
      const session1 = store.createSession();
      const session2 = store.createSession();

      store.createTask('coder', 't1', session1.id);
      store.createTask('coder', 't2', session1.id);
      store.createTask('coder', 't3', session2.id);

      const s1Tasks = store.listTasks(session1.id);
      expect(s1Tasks.length).toBe(2);

      const s2Tasks = store.listTasks(session2.id);
      expect(s2Tasks.length).toBe(1);
    });

    it('should list tasks by status', () => {
      const task1 = store.createTask('coder', 't1');
      store.createTask('coder', 't2');
      store.createTask('coder', 't3');

      store.updateTaskStatus(task1.id, 'completed');

      const pending = store.listTasks(undefined, 'pending');
      expect(pending.length).toBe(2);

      const completed = store.listTasks(undefined, 'completed');
      expect(completed.length).toBe(1);
    });
  });

  describe('Database Maintenance', () => {
    it('should vacuum database', () => {
      store.store('key1', 'content1');
      store.delete('key1');

      // Should not throw
      expect(() => store.vacuum()).not.toThrow();
    });
  });
});

describe('SQLiteStore directory creation', () => {
  it('should create parent directory if it does not exist', () => {
    const nestedDir = join(tmpdir(), `aistack-nested-${Date.now()}`, 'level1', 'level2');
    const nestedPath = join(nestedDir, 'test.db');

    // Directory should not exist
    expect(existsSync(nestedDir)).toBe(false);

    const nestedStore = new SQLiteStore(nestedPath);

    // Store should be created and directory should exist now
    expect(existsSync(nestedDir)).toBe(true);

    nestedStore.close();

    // Clean up
    rmSync(join(tmpdir(), `aistack-nested-${Date.now().toString().slice(0, -3)}`), {
      recursive: true,
      force: true,
    });
  });
});
