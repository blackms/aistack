/**
 * Tests for Agent-Scoped Memory in MemoryManager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager, resetMemoryManager } from '../../src/memory/index.js';
import type { AgentStackConfig } from '../../src/types.js';
import { unlinkSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

describe('Memory Agent Scoping', () => {
  const testDbPath = '/tmp/test-memory-agent-scoping.db';
  let config: AgentStackConfig;
  let memory: MemoryManager;

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }

    resetMemoryManager();

    config = {
      version: '1.0.0',
      memory: {
        path: testDbPath,
        defaultNamespace: 'test',
        vectorSearch: {
          enabled: false,
        },
      },
      providers: {
        default: 'anthropic',
        anthropic: { apiKey: 'test-key' },
      },
      mcp: { enabled: true },
      web: { port: 3000 },
      agents: [],
    } as AgentStackConfig;

    memory = new MemoryManager(config);
  });

  afterEach(() => {
    memory.close();
    resetMemoryManager();

    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('Agent Context', () => {
    it('should set and get agent context', () => {
      const agentId = randomUUID();
      memory.setAgentContext({ agentId });

      const context = memory.getAgentContext();
      expect(context).not.toBeNull();
      expect(context?.agentId).toBe(agentId);
    });

    it('should set agent context with includeShared', () => {
      const agentId = randomUUID();
      memory.setAgentContext({ agentId, includeShared: true });

      const context = memory.getAgentContext();
      expect(context?.includeShared).toBe(true);
    });

    it('should clear agent context', () => {
      memory.setAgentContext({ agentId: randomUUID() });
      memory.clearAgentContext();

      expect(memory.getAgentContext()).toBeNull();
    });

    it('should return null when no context set', () => {
      expect(memory.getAgentContext()).toBeNull();
    });
  });

  describe('store() with agent context', () => {
    it('should automatically associate memory with agent context', async () => {
      const agentId = randomUUID();
      memory.setAgentContext({ agentId });

      const entry = await memory.store('test-key', 'test content');

      expect(entry.agentId).toBe(agentId);
    });

    it('should use explicit agentId over context', async () => {
      const contextAgentId = randomUUID();
      const explicitAgentId = randomUUID();
      memory.setAgentContext({ agentId: contextAgentId });

      const entry = await memory.store('test-key', 'test content', {
        agentId: explicitAgentId,
      });

      expect(entry.agentId).toBe(explicitAgentId);
    });

    it('should store without agentId when no context', async () => {
      const entry = await memory.store('test-key', 'test content');

      expect(entry.agentId).toBeUndefined();
    });
  });

  describe('storeShared()', () => {
    it('should store shared memory without agentId', async () => {
      const agentId = randomUUID();
      memory.setAgentContext({ agentId });

      const entry = await memory.storeShared('shared-key', 'shared content');

      // Should not have agentId even with context set
      expect(entry.agentId).toBeUndefined();
    });

    it('should be accessible to all agents', async () => {
      await memory.storeShared('shared-key', 'shared content');

      const agentId = randomUUID();
      memory.setAgentContext({ agentId, includeShared: true });

      const entries = memory.list('test', 100, 0, { includeShared: true });
      expect(entries.some(e => e.key === 'shared-key')).toBe(true);
    });
  });

  describe('list() with agent filtering', () => {
    const agent1Id = randomUUID();
    const agent2Id = randomUUID();

    beforeEach(async () => {
      // Store memory for agent 1
      await memory.store('agent1-key1', 'agent1 content 1', { agentId: agent1Id });
      await memory.store('agent1-key2', 'agent1 content 2', { agentId: agent1Id });

      // Store memory for agent 2
      await memory.store('agent2-key1', 'agent2 content', { agentId: agent2Id });

      // Store shared memory
      await memory.storeShared('shared-key', 'shared content');
    });

    it('should list only agent-owned memory', () => {
      const entries = memory.list('test', 100, 0, {
        agentId: agent1Id,
        includeShared: false,
      });

      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.agentId === agent1Id)).toBe(true);
    });

    it('should include shared memory when includeShared is true', () => {
      const entries = memory.list('test', 100, 0, {
        agentId: agent1Id,
        includeShared: true,
      });

      expect(entries).toHaveLength(3); // 2 agent1 + 1 shared
      const keys = entries.map(e => e.key);
      expect(keys).toContain('shared-key');
    });

    it('should use context for filtering', () => {
      memory.setAgentContext({ agentId: agent2Id, includeShared: false });

      const entries = memory.list('test');

      expect(entries).toHaveLength(1);
      expect(entries[0].key).toBe('agent2-key1');
    });

    it('should list all when no agent filter', () => {
      const entries = memory.list('test', 100);

      expect(entries).toHaveLength(4); // 2 + 1 + 1 shared
    });
  });

  describe('getAgentMemory()', () => {
    const agentId = randomUUID();

    beforeEach(async () => {
      await memory.store('key1', 'content 1', { agentId });
      await memory.store('key2', 'content 2', { agentId });
      await memory.storeShared('shared', 'shared content');
    });

    it('should return only agent-owned memory by default', () => {
      const entries = memory.getAgentMemory(agentId);

      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.agentId === agentId)).toBe(true);
    });

    it('should include shared when requested', () => {
      const entries = memory.getAgentMemory(agentId, { includeShared: true });

      expect(entries).toHaveLength(3);
    });

    it('should support limit', () => {
      const entries = memory.getAgentMemory(agentId, { limit: 1 });

      expect(entries).toHaveLength(1);
    });

    it('should support offset', () => {
      const entries = memory.getAgentMemory(agentId, { offset: 1, limit: 10 });

      expect(entries).toHaveLength(1);
    });

    it('should filter by namespace', async () => {
      await memory.store('other-ns-key', 'other ns content', {
        agentId,
        namespace: 'other',
      });

      const entries = memory.getAgentMemory(agentId, { namespace: 'other' });

      expect(entries).toHaveLength(1);
      expect(entries[0].namespace).toBe('other');
    });
  });

  describe('search() with agent filtering', () => {
    const agent1Id = randomUUID();
    const agent2Id = randomUUID();

    beforeEach(async () => {
      await memory.store('agent1-doc', 'typescript programming guide', {
        agentId: agent1Id,
      });
      await memory.store('agent2-doc', 'python programming tutorial', {
        agentId: agent2Id,
      });
      await memory.storeShared('shared-doc', 'general programming concepts');
    });

    it('should search within agent scope', async () => {
      memory.setAgentContext({ agentId: agent1Id, includeShared: false });

      const results = await memory.search('programming');

      expect(results.some(r => r.entry.key === 'agent1-doc')).toBe(true);
      expect(results.some(r => r.entry.key === 'agent2-doc')).toBe(false);
    });

    it('should include shared in search by default', async () => {
      memory.setAgentContext({ agentId: agent1Id });

      const results = await memory.search('programming');

      expect(results.some(r => r.entry.key === 'shared-doc')).toBe(true);
    });

    it('should use explicit agentId in options', async () => {
      const results = await memory.search('programming', {
        agentId: agent2Id,
        includeShared: false,
      });

      expect(results.some(r => r.entry.key === 'agent2-doc')).toBe(true);
      expect(results.some(r => r.entry.key === 'agent1-doc')).toBe(false);
    });
  });

  describe('Memory isolation', () => {
    it('should prevent agent from seeing other agent memory', async () => {
      const agent1Id = randomUUID();
      const agent2Id = randomUUID();

      await memory.store('secret-key', 'secret data', { agentId: agent1Id });

      memory.setAgentContext({ agentId: agent2Id, includeShared: false });
      const entries = memory.list('test');

      expect(entries.some(e => e.key === 'secret-key')).toBe(false);
    });

    it('should allow agent to overwrite own memory', async () => {
      const agentId = randomUUID();

      await memory.store('my-key', 'original content', { agentId });
      await memory.store('my-key', 'updated content', { agentId });

      const entry = memory.get('my-key', 'test');
      expect(entry?.content).toBe('updated content');
    });

    it('should track memory ownership correctly', async () => {
      const agentId = randomUUID();

      const entry = await memory.store('owned-key', 'owned content', { agentId });

      expect(entry.agentId).toBe(agentId);

      const retrieved = memory.get('owned-key', 'test');
      expect(retrieved?.agentId).toBe(agentId);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty agent memory', () => {
      const agentId = randomUUID();
      const entries = memory.getAgentMemory(agentId);

      expect(entries).toHaveLength(0);
    });

    it('should handle search with no results', async () => {
      const agentId = randomUUID();
      memory.setAgentContext({ agentId });

      const results = await memory.search('nonexistent');

      expect(results).toHaveLength(0);
    });

    it('should work with null context set', () => {
      memory.setAgentContext(null);
      expect(memory.getAgentContext()).toBeNull();
    });
  });
});
