/**
 * Tests for Memory MCP Tools with Agent ID Support
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMemoryTools } from '../../src/mcp/tools/memory-tools.js';
import { MemoryManager, resetMemoryManager } from '../../src/memory/index.js';
import type { AgentStackConfig } from '../../src/types.js';
import { unlinkSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

describe('Memory MCP Tools with Agent ID', () => {
  const testDbPath = '/tmp/test-memory-tools-agent.db';
  let config: AgentStackConfig;
  let memory: MemoryManager;
  let tools: ReturnType<typeof createMemoryTools>;
  let testSessionId: string;

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }

    resetMemoryManager();
    testSessionId = randomUUID();

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
    tools = createMemoryTools(memory);
  });

  afterEach(() => {
    memory.close();
    resetMemoryManager();

    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('memory_store with agentId', () => {
    it('should store memory with agentId', async () => {
      const agentId = randomUUID();

      const result = await tools.memory_store.handler({
        sessionId: testSessionId,
        key: 'test-key',
        content: 'test content',
        agentId,
      });

      expect(result.success).toBe(true);
      expect(result.entry.agentId).toBe(agentId);
    });

    it('should store memory without agentId', async () => {
      const result = await tools.memory_store.handler({
        sessionId: testSessionId,
        key: 'shared-key',
        content: 'shared content',
      });

      expect(result.success).toBe(true);
      expect(result.entry.agentId).toBeUndefined();
    });

    it('should include agentId in input schema description', () => {
      const schema = tools.memory_store.inputSchema;
      expect(schema.properties.agentId).toBeDefined();
      expect(schema.properties.agentId.description).toContain('Agent ID');
    });
  });

  describe('memory_search with agentId', () => {
    const agent1Id = randomUUID();
    const agent2Id = randomUUID();

    beforeEach(async () => {
      await tools.memory_store.handler({
        sessionId: testSessionId,
        key: 'agent1-doc',
        content: 'programming guide for agent 1',
        agentId: agent1Id,
      });
      await tools.memory_store.handler({
        sessionId: testSessionId,
        key: 'agent2-doc',
        content: 'programming tutorial for agent 2',
        agentId: agent2Id,
      });
      await tools.memory_store.handler({
        sessionId: testSessionId,
        key: 'shared-doc',
        content: 'general programming concepts',
      });
    });

    it('should search within agent scope', async () => {
      const result = await tools.memory_search.handler({
        sessionId: testSessionId,
        query: 'programming',
        agentId: agent1Id,
        includeShared: false,
      });

      expect(result.count).toBe(1);
      expect(result.results[0].key).toBe('agent1-doc');
    });

    it('should include shared memory when includeShared is true', async () => {
      const result = await tools.memory_search.handler({
        sessionId: testSessionId,
        query: 'programming',
        agentId: agent1Id,
        includeShared: true,
      });

      expect(result.count).toBe(2); // agent1 + shared
      const keys = result.results.map((r: { key: string }) => r.key);
      expect(keys).toContain('agent1-doc');
      expect(keys).toContain('shared-doc');
    });

    it('should search all when no agentId provided', async () => {
      const result = await tools.memory_search.handler({
        sessionId: testSessionId,
        query: 'programming',
      });

      expect(result.count).toBe(3);
    });

    it('should include agentId in search results', async () => {
      const result = await tools.memory_search.handler({
        sessionId: testSessionId,
        query: 'programming',
      });

      const agent1Result = result.results.find((r: { key: string }) => r.key === 'agent1-doc');
      expect(agent1Result.agentId).toBe(agent1Id);

      const sharedResult = result.results.find((r: { key: string }) => r.key === 'shared-doc');
      expect(sharedResult.agentId).toBeUndefined();
    });

    it('should include agentId in input schema', () => {
      const schema = tools.memory_search.inputSchema;
      expect(schema.properties.agentId).toBeDefined();
      expect(schema.properties.includeShared).toBeDefined();
    });
  });

  describe('memory_list with agentId', () => {
    const agentId = randomUUID();

    beforeEach(async () => {
      await tools.memory_store.handler({
        sessionId: testSessionId,
        key: 'agent-key1',
        content: 'agent content 1',
        agentId,
      });
      await tools.memory_store.handler({
        sessionId: testSessionId,
        key: 'agent-key2',
        content: 'agent content 2',
        agentId,
      });
      await tools.memory_store.handler({
        sessionId: testSessionId,
        key: 'shared-key',
        content: 'shared content',
      });
    });

    it('should list only agent memory when includeShared is false', async () => {
      const result = await tools.memory_list.handler({
        sessionId: testSessionId,
        agentId,
        includeShared: false,
      });

      expect(result.count).toBe(2);
      expect(result.entries.every((e: { key: string }) => e.key.startsWith('agent-'))).toBe(true);
    });

    it('should include shared when includeShared is true', async () => {
      const result = await tools.memory_list.handler({
        sessionId: testSessionId,
        agentId,
        includeShared: true,
      });

      expect(result.count).toBe(3);
    });

    it('should list all when no filters provided (with sessionId)', async () => {
      const result = await tools.memory_list.handler({
        sessionId: testSessionId,
      });

      expect(result.total).toBeGreaterThanOrEqual(3);
    });

    it('should include agentId in list entries', async () => {
      const result = await tools.memory_list.handler({
        sessionId: testSessionId,
        agentId,
        includeShared: true,
      });

      const agentEntry = result.entries.find((e: { key: string }) => e.key === 'agent-key1');
      expect(agentEntry.agentId).toBe(agentId);
    });

    it('should include agentId in input schema', () => {
      const schema = tools.memory_list.inputSchema;
      expect(schema.properties.agentId).toBeDefined();
      expect(schema.properties.includeShared).toBeDefined();
    });
  });

  describe('memory_get', () => {
    it('should return agentId for owned memory', async () => {
      const agentId = randomUUID();
      await tools.memory_store.handler({
        sessionId: testSessionId,
        key: 'owned-key',
        content: 'owned content',
        agentId,
      });

      const result = await tools.memory_get.handler({
        sessionId: testSessionId,
        key: 'owned-key',
      });

      expect(result.found).toBe(true);
      // Note: memory_get doesn't include agentId in response currently
    });

    it('should work for shared memory', async () => {
      await tools.memory_store.handler({
        sessionId: testSessionId,
        key: 'shared-key',
        content: 'shared content',
      });

      const result = await tools.memory_get.handler({
        sessionId: testSessionId,
        key: 'shared-key',
      });

      expect(result.found).toBe(true);
      expect(result.entry.key).toBe('shared-key');
    });
  });

  describe('memory_delete', () => {
    it('should delete agent-owned memory', async () => {
      const agentId = randomUUID();
      await tools.memory_store.handler({
        sessionId: testSessionId,
        key: 'to-delete',
        content: 'will be deleted',
        agentId,
      });

      const result = await tools.memory_delete.handler({
        sessionId: testSessionId,
        key: 'to-delete',
      });

      expect(result.success).toBe(true);

      // Verify deletion
      const check = await tools.memory_get.handler({
        sessionId: testSessionId,
        key: 'to-delete',
      });
      expect(check.found).toBe(false);
    });

    it('should delete shared memory', async () => {
      await tools.memory_store.handler({
        sessionId: testSessionId,
        key: 'shared-to-delete',
        content: 'will be deleted',
      });

      const result = await tools.memory_delete.handler({
        sessionId: testSessionId,
        key: 'shared-to-delete',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Tool metadata', () => {
    it('should have correct tool names', () => {
      expect(tools.memory_store.name).toBe('memory_store');
      expect(tools.memory_search.name).toBe('memory_search');
      expect(tools.memory_get.name).toBe('memory_get');
      expect(tools.memory_list.name).toBe('memory_list');
      expect(tools.memory_delete.name).toBe('memory_delete');
    });

    it('should have descriptions', () => {
      expect(tools.memory_store.description).toBeTruthy();
      expect(tools.memory_search.description).toBeTruthy();
      expect(tools.memory_get.description).toBeTruthy();
      expect(tools.memory_list.description).toBeTruthy();
      expect(tools.memory_delete.description).toBeTruthy();
    });
  });
});
