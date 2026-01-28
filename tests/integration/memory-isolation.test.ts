/**
 * Memory Isolation Integration Tests
 *
 * Tests end-to-end session isolation to verify that agents in different
 * sessions cannot access each other's memory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager, resetMemoryManager, getAccessControl } from '../../src/memory/index.js';
import type { AgentStackConfig } from '../../src/types.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

describe('Memory Session Isolation', () => {
  let manager: MemoryManager;
  let dbPath: string;
  let config: AgentStackConfig;
  let accessControl: ReturnType<typeof getAccessControl>;

  beforeEach(() => {
    dbPath = join(tmpdir(), `aistack-isolation-test-${Date.now()}.db`);
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
    accessControl = getAccessControl();
  });

  afterEach(() => {
    manager.close();
    resetMemoryManager();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('Cross-Session Memory Access', () => {
    it('Session A cannot read Session B memory', async () => {
      const sessionA = randomUUID();
      const sessionB = randomUUID();
      const namespaceA = accessControl.getSessionNamespace(sessionA);
      const namespaceB = accessControl.getSessionNamespace(sessionB);

      // Session B stores data
      manager.setAgentContext({ agentId: 'agent-b', sessionId: sessionB });
      await manager.store('secret-key', 'secret-value-for-session-b', { namespace: namespaceB });
      manager.clearAgentContext();

      // Session A tries to read Session B's data
      manager.setAgentContext({ agentId: 'agent-a', sessionId: sessionA });

      // Direct read should fail (access control will validate namespace)
      expect(() => {
        manager.get('secret-key', namespaceB);
      }).toThrow('Access denied');

      // List should only show session A's data (none)
      const entries = manager.list(namespaceA);
      expect(entries.length).toBe(0);

      manager.clearAgentContext();
    });

    it('Session A cannot write to Session B namespace', async () => {
      const sessionA = randomUUID();
      const sessionB = randomUUID();
      const namespaceB = accessControl.getSessionNamespace(sessionB);

      // Session A tries to write to Session B's namespace
      manager.setAgentContext({ agentId: 'agent-a', sessionId: sessionA });

      await expect(
        manager.store('malicious-key', 'malicious-content', { namespace: namespaceB })
      ).rejects.toThrow('Access denied');

      manager.clearAgentContext();
    });

    it('getById denies access to other session entries', async () => {
      const sessionA = randomUUID();
      const sessionB = randomUUID();

      // Session B stores data
      manager.setAgentContext({ agentId: 'agent-b', sessionId: sessionB });
      const entryB = await manager.store('test-key', 'test-value');
      manager.clearAgentContext();

      // Session A tries to access by ID
      manager.setAgentContext({ agentId: 'agent-a', sessionId: sessionA });
      const result = manager.getById(entryB.id);
      expect(result).toBeNull(); // Access denied returns null

      manager.clearAgentContext();
    });

    it('Search respects session boundaries', async () => {
      const sessionA = randomUUID();
      const sessionB = randomUUID();

      // Session A stores data
      manager.setAgentContext({ agentId: 'agent-a', sessionId: sessionA });
      await manager.store('session-a-key', 'searchable content alpha');
      manager.clearAgentContext();

      // Session B stores data
      manager.setAgentContext({ agentId: 'agent-b', sessionId: sessionB });
      await manager.store('session-b-key', 'searchable content beta');
      manager.clearAgentContext();

      // Session A searches - should only find own data
      manager.setAgentContext({ agentId: 'agent-a', sessionId: sessionA });
      const resultsA = await manager.search('searchable content');
      expect(resultsA.length).toBe(1);
      expect(resultsA[0].entry.key).toBe('session-a-key');
      manager.clearAgentContext();

      // Session B searches - should only find own data
      manager.setAgentContext({ agentId: 'agent-b', sessionId: sessionB });
      const resultsB = await manager.search('searchable content');
      expect(resultsB.length).toBe(1);
      expect(resultsB[0].entry.key).toBe('session-b-key');
      manager.clearAgentContext();
    });
  });

  describe('Session Namespace Derivation', () => {
    it('should auto-derive session namespace when storing without explicit namespace', async () => {
      const sessionId = randomUUID();
      const expectedNamespace = accessControl.getSessionNamespace(sessionId);

      manager.setAgentContext({ agentId: 'agent-1', sessionId });
      const entry = await manager.store('auto-ns-key', 'auto-ns-value');

      expect(entry.namespace).toBe(expectedNamespace);
      manager.clearAgentContext();
    });

    it('should auto-derive session namespace when listing without explicit namespace', async () => {
      const sessionId = randomUUID();

      // Store some data
      manager.setAgentContext({ agentId: 'agent-1', sessionId });
      await manager.store('list-key-1', 'value-1');
      await manager.store('list-key-2', 'value-2');

      // List without namespace - should use session namespace
      const entries = manager.list();
      expect(entries.length).toBe(2);

      manager.clearAgentContext();
    });
  });

  describe('Session Cleanup', () => {
    it('deleteByNamespace removes all session memory', async () => {
      const sessionId = randomUUID();
      const namespace = accessControl.getSessionNamespace(sessionId);

      // Store multiple entries
      manager.setAgentContext({ agentId: 'agent-1', sessionId });
      await manager.store('key-1', 'value-1');
      await manager.store('key-2', 'value-2');
      await manager.store('key-3', 'value-3');
      manager.clearAgentContext();

      // Verify entries exist
      const store = manager.getStore();
      const countBefore = store.count(namespace);
      expect(countBefore).toBe(3);

      // Delete by namespace
      const deletedCount = store.deleteByNamespace(namespace);
      expect(deletedCount).toBe(3);

      // Verify entries are gone
      const countAfter = store.count(namespace);
      expect(countAfter).toBe(0);
    });
  });

  describe('Agent Scoping Within Session', () => {
    it('agents within same session can share memory', async () => {
      const sessionId = randomUUID();
      const namespace = accessControl.getSessionNamespace(sessionId);

      // Agent A stores shared data (no agentId)
      manager.setAgentContext({ agentId: 'agent-a', sessionId, includeShared: true });
      await manager.storeShared('shared-key', 'shared-value');
      manager.clearAgentContext();

      // Agent B reads shared data
      manager.setAgentContext({ agentId: 'agent-b', sessionId, includeShared: true });
      const entries = manager.list(namespace);
      expect(entries.length).toBe(1);
      expect(entries[0].key).toBe('shared-key');
      expect(entries[0].agentId).toBeUndefined(); // Shared entries have no agentId

      manager.clearAgentContext();
    });

    it('agents can scope their own private memory within session', async () => {
      const sessionId = randomUUID();

      // Agent A stores private data
      manager.setAgentContext({ agentId: 'agent-a', sessionId });
      await manager.store('private-a-key', 'private-a-value', { agentId: 'agent-a' });
      manager.clearAgentContext();

      // Agent B stores private data
      manager.setAgentContext({ agentId: 'agent-b', sessionId });
      await manager.store('private-b-key', 'private-b-value', { agentId: 'agent-b' });
      manager.clearAgentContext();

      // Agent A lists only own entries (includeShared: false)
      manager.setAgentContext({ agentId: 'agent-a', sessionId, includeShared: false });
      const entriesA = manager.list(undefined, undefined, undefined, { includeShared: false });
      expect(entriesA.length).toBe(1);
      expect(entriesA[0].key).toBe('private-a-key');
      manager.clearAgentContext();

      // Agent B lists only own entries (includeShared: false)
      manager.setAgentContext({ agentId: 'agent-b', sessionId, includeShared: false });
      const entriesB = manager.list(undefined, undefined, undefined, { includeShared: false });
      expect(entriesB.length).toBe(1);
      expect(entriesB[0].key).toBe('private-b-key');
      manager.clearAgentContext();
    });
  });

  describe('Delete Operations', () => {
    it('Session A cannot delete Session B entries', async () => {
      const sessionA = randomUUID();
      const sessionB = randomUUID();
      const namespaceB = accessControl.getSessionNamespace(sessionB);

      // Session B stores data
      manager.setAgentContext({ agentId: 'agent-b', sessionId: sessionB });
      await manager.store('delete-target', 'to-be-protected');
      manager.clearAgentContext();

      // Session A tries to delete Session B's data
      manager.setAgentContext({ agentId: 'agent-a', sessionId: sessionA });
      expect(() => {
        manager.delete('delete-target', namespaceB);
      }).toThrow('Access denied');

      manager.clearAgentContext();

      // Verify data still exists
      manager.setAgentContext({ agentId: 'agent-b', sessionId: sessionB });
      const entry = manager.get('delete-target');
      expect(entry).not.toBeNull();
      expect(entry?.content).toBe('to-be-protected');
      manager.clearAgentContext();
    });
  });

  describe('Non-Session Namespace Access', () => {
    it('should allow read access to global namespaces', async () => {
      // Store data in global namespace (without context)
      await manager.store('global-key', 'global-value', { namespace: 'global' });

      // Session can read global namespace
      const sessionId = randomUUID();
      manager.setAgentContext({ agentId: 'agent-1', sessionId });

      // Reading from non-session namespace is allowed
      const entry = manager.get('global-key', 'global');
      expect(entry).not.toBeNull();
      expect(entry?.content).toBe('global-value');

      manager.clearAgentContext();
    });
  });
});
