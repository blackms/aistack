/**
 * MCP Memory Tools tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryTools } from '../../src/mcp/tools/memory-tools.js';
import { MemoryManager, resetMemoryManager } from '../../src/memory/index.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { AgentStackConfig } from '../../src/types.js';

function createTestConfig(): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: join(tmpdir(), `aistack-mcp-memory-${Date.now()}.db`),
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

describe('MCP Memory Tools', () => {
  let memory: MemoryManager;
  let config: AgentStackConfig;
  let dbPath: string;
  let tools: ReturnType<typeof createMemoryTools>;
  let testSessionId: string;

  beforeEach(() => {
    resetMemoryManager();
    config = createTestConfig();
    dbPath = config.memory.path;
    memory = new MemoryManager(config);
    tools = createMemoryTools(memory);
    testSessionId = randomUUID();
  });

  afterEach(() => {
    memory.close();
    resetMemoryManager();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('memory_store', () => {
    it('should store a memory entry', async () => {
      const result = await tools.memory_store.handler({
        sessionId: testSessionId,
        key: 'test-key',
        content: 'test content',
      });

      expect(result.success).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry.key).toBe('test-key');
      expect(result.entry.namespace).toBe(`session:${testSessionId}`);
    });

    it('should store with namespace', async () => {
      const result = await tools.memory_store.handler({
        sessionId: testSessionId,
        key: 'ns-key',
        content: 'namespaced content',
        namespace: `session:${testSessionId}`,
      });

      expect(result.success).toBe(true);
      expect(result.entry.namespace).toBe(`session:${testSessionId}`);
    });

    it('should store with metadata', async () => {
      const result = await tools.memory_store.handler({
        sessionId: testSessionId,
        key: 'meta-key',
        content: 'content with metadata',
        metadata: { type: 'note', priority: 1 },
      });

      expect(result.success).toBe(true);
      expect(result.entry).toBeDefined();
    });

    it('should include timestamps in response', async () => {
      const result = await tools.memory_store.handler({
        sessionId: testSessionId,
        key: 'time-key',
        content: 'timestamp content',
      });

      expect(result.success).toBe(true);
      expect(result.entry.createdAt).toBeDefined();
      expect(result.entry.updatedAt).toBeDefined();
      // Should be ISO string format
      expect(() => new Date(result.entry.createdAt)).not.toThrow();
    });

    it('should throw for invalid input (empty key)', async () => {
      await expect(
        tools.memory_store.handler({
          sessionId: testSessionId,
          key: '',
          content: 'content',
        })
      ).rejects.toThrow();
    });

    it('should throw for empty content', async () => {
      await expect(
        tools.memory_store.handler({
          sessionId: testSessionId,
          key: 'key',
          content: '',
        })
      ).rejects.toThrow();
    });

    it('should throw for missing sessionId', async () => {
      await expect(
        tools.memory_store.handler({
          key: 'key',
          content: 'content',
        })
      ).rejects.toThrow();
    });

    it('should have correct tool definition', () => {
      expect(tools.memory_store.name).toBe('memory_store');
      expect(tools.memory_store.description).toContain('Store a key-value pair');
      expect(tools.memory_store.inputSchema.required).toContain('sessionId');
      expect(tools.memory_store.inputSchema.required).toContain('key');
      expect(tools.memory_store.inputSchema.required).toContain('content');
    });
  });

  describe('memory_search', () => {
    beforeEach(async () => {
      // Store test data with sessionId context
      const namespace = `session:${testSessionId}`;
      await memory.store('search-1', 'The quick brown fox jumps', { namespace });
      await memory.store('search-2', 'A lazy dog sleeps', { namespace });
      await memory.store('search-3', 'Quick foxes are fast', { namespace });
    });

    it('should search memory entries', async () => {
      const result = await tools.memory_search.handler({
        sessionId: testSessionId,
        query: 'quick fox',
      });

      expect(result.count).toBeGreaterThan(0);
      expect(result.results).toBeInstanceOf(Array);
    });

    it('should search with namespace filter', async () => {
      const fruitsNamespace = `session:${testSessionId}`;
      await memory.store('ns-search', 'apple content', { namespace: fruitsNamespace });

      const result = await tools.memory_search.handler({
        sessionId: testSessionId,
        query: 'apple',
        namespace: fruitsNamespace,
      });

      expect(result.count).toBeGreaterThanOrEqual(1);
    });

    it('should respect limit parameter', async () => {
      const result = await tools.memory_search.handler({
        sessionId: testSessionId,
        query: 'quick',
        limit: 1,
      });

      expect(result.results.length).toBeLessThanOrEqual(1);
    });

    it('should include score and matchType in results', async () => {
      const result = await tools.memory_search.handler({
        sessionId: testSessionId,
        query: 'quick',
      });

      if (result.results.length > 0) {
        expect(result.results[0].score).toBeDefined();
        expect(result.results[0].matchType).toBeDefined();
      }
    });

    it('should return empty results for no matches', async () => {
      const result = await tools.memory_search.handler({
        sessionId: testSessionId,
        query: 'xyznonexistent',
      });

      expect(result.count).toBe(0);
      expect(result.results).toEqual([]);
    });

    it('should throw for invalid input (empty query)', async () => {
      await expect(
        tools.memory_search.handler({
          sessionId: testSessionId,
          query: '',
        })
      ).rejects.toThrow();
    });

    it('should throw for missing sessionId', async () => {
      await expect(
        tools.memory_search.handler({
          query: 'test',
        })
      ).rejects.toThrow();
    });

    it('should have correct tool definition', () => {
      expect(tools.memory_search.name).toBe('memory_search');
      expect(tools.memory_search.inputSchema.required).toContain('sessionId');
      expect(tools.memory_search.inputSchema.required).toContain('query');
    });
  });

  describe('memory_get', () => {
    it('should get a memory entry by key', async () => {
      const namespace = `session:${testSessionId}`;
      await memory.store('get-key', 'get content', { namespace });

      const result = await tools.memory_get.handler({
        sessionId: testSessionId,
        key: 'get-key',
      });

      expect(result.found).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry.key).toBe('get-key');
      expect(result.entry.content).toBe('get content');
    });

    it('should get entry with namespace', async () => {
      const namespace = `session:${testSessionId}`;
      await memory.store('ns-get-key', 'ns content', { namespace });

      const result = await tools.memory_get.handler({
        sessionId: testSessionId,
        key: 'ns-get-key',
        namespace,
      });

      expect(result.found).toBe(true);
      expect(result.entry.namespace).toBe(namespace);
    });

    it('should return not found for missing entry', async () => {
      const result = await tools.memory_get.handler({
        sessionId: testSessionId,
        key: 'non-existent-key',
      });

      expect(result.found).toBe(false);
      expect(result.message).toBe('Entry not found');
    });

    it('should include metadata in response', async () => {
      const namespace = `session:${testSessionId}`;
      await memory.store('meta-get-key', 'content', { namespace, metadata: { tag: 'test' } });

      const result = await tools.memory_get.handler({
        sessionId: testSessionId,
        key: 'meta-get-key',
      });

      expect(result.found).toBe(true);
      expect(result.entry.metadata).toEqual({ tag: 'test' });
    });

    it('should include timestamps in response', async () => {
      const namespace = `session:${testSessionId}`;
      await memory.store('time-get-key', 'content', { namespace });

      const result = await tools.memory_get.handler({
        sessionId: testSessionId,
        key: 'time-get-key',
      });

      expect(result.found).toBe(true);
      expect(result.entry.createdAt).toBeDefined();
      expect(result.entry.updatedAt).toBeDefined();
    });

    it('should throw for missing sessionId', async () => {
      await expect(
        tools.memory_get.handler({
          key: 'test-key',
        })
      ).rejects.toThrow();
    });

    it('should have correct tool definition', () => {
      expect(tools.memory_get.name).toBe('memory_get');
      expect(tools.memory_get.inputSchema.required).toContain('sessionId');
      expect(tools.memory_get.inputSchema.required).toContain('key');
    });
  });

  describe('memory_list', () => {
    beforeEach(async () => {
      const namespace = `session:${testSessionId}`;
      await memory.store('list-1', 'content 1', { namespace });
      await memory.store('list-2', 'content 2', { namespace });
      await memory.store('list-3', 'content 3', { namespace });
    });

    it('should list all memory entries in session', async () => {
      const result = await tools.memory_list.handler({
        sessionId: testSessionId,
      });

      expect(result.total).toBe(3);
      expect(result.count).toBe(3);
      expect(result.entries).toHaveLength(3);
    });

    it('should list with namespace filter', async () => {
      const namespace = `session:${testSessionId}`;
      await memory.store('ns-list-1', 'ns content', { namespace });

      const result = await tools.memory_list.handler({
        sessionId: testSessionId,
        namespace,
      });

      expect(result.count).toBeGreaterThanOrEqual(1);
    });

    it('should respect limit parameter', async () => {
      const result = await tools.memory_list.handler({
        sessionId: testSessionId,
        limit: 2,
      });

      expect(result.count).toBe(2);
      expect(result.entries).toHaveLength(2);
    });

    it('should respect offset parameter', async () => {
      const result = await tools.memory_list.handler({
        sessionId: testSessionId,
        offset: 2,
      });

      expect(result.offset).toBe(2);
      expect(result.count).toBe(1);
    });

    it('should truncate long content in preview', async () => {
      const longContent = 'x'.repeat(300);
      const namespace = `session:${testSessionId}`;
      await memory.store('long-key', longContent, { namespace });

      const result = await tools.memory_list.handler({
        sessionId: testSessionId,
      });

      const longEntry = result.entries.find((e: { key: string }) => e.key === 'long-key');
      expect(longEntry).toBeDefined();
      expect(longEntry.contentPreview.length).toBeLessThanOrEqual(203); // 200 + '...'
      expect(longEntry.contentPreview.endsWith('...')).toBe(true);
    });

    it('should not truncate short content', async () => {
      const namespace = `session:${testSessionId}`;
      await memory.store('short-key', 'short', { namespace });

      const result = await tools.memory_list.handler({
        sessionId: testSessionId,
      });

      const shortEntry = result.entries.find((e: { key: string }) => e.key === 'short-key');
      expect(shortEntry).toBeDefined();
      expect(shortEntry.contentPreview).toBe('short');
    });

    it('should include metadata in entries', async () => {
      const namespace = `session:${testSessionId}`;
      await memory.store('meta-list-key', 'content', { namespace, metadata: { foo: 'bar' } });

      const result = await tools.memory_list.handler({
        sessionId: testSessionId,
      });

      const metaEntry = result.entries.find((e: { key: string }) => e.key === 'meta-list-key');
      expect(metaEntry).toBeDefined();
      expect(metaEntry.metadata).toEqual({ foo: 'bar' });
    });

    it('should throw for missing sessionId', async () => {
      await expect(
        tools.memory_list.handler({})
      ).rejects.toThrow();
    });

    it('should have correct tool definition', () => {
      expect(tools.memory_list.name).toBe('memory_list');
      expect(tools.memory_list.inputSchema.required).toContain('sessionId');
      expect(tools.memory_list.inputSchema.properties).toHaveProperty('namespace');
      expect(tools.memory_list.inputSchema.properties).toHaveProperty('limit');
      expect(tools.memory_list.inputSchema.properties).toHaveProperty('offset');
    });
  });

  describe('memory_delete', () => {
    it('should delete a memory entry', async () => {
      const namespace = `session:${testSessionId}`;
      await memory.store('delete-key', 'to delete', { namespace });

      const result = await tools.memory_delete.handler({
        sessionId: testSessionId,
        key: 'delete-key',
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Entry deleted');

      // Verify deletion
      expect(memory.get('delete-key', namespace)).toBeNull();
    });

    it('should delete with namespace', async () => {
      const namespace = `session:${testSessionId}`;
      await memory.store('ns-delete-key', 'content', { namespace });

      const result = await tools.memory_delete.handler({
        sessionId: testSessionId,
        key: 'ns-delete-key',
        namespace,
      });

      expect(result.success).toBe(true);
      expect(memory.get('ns-delete-key', namespace)).toBeNull();
    });

    it('should return false for non-existent entry', async () => {
      const result = await tools.memory_delete.handler({
        sessionId: testSessionId,
        key: 'non-existent-delete-key',
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Entry not found');
    });

    it('should throw for missing sessionId', async () => {
      await expect(
        tools.memory_delete.handler({
          key: 'some-key',
        })
      ).rejects.toThrow();
    });

    it('should have correct tool definition', () => {
      expect(tools.memory_delete.name).toBe('memory_delete');
      expect(tools.memory_delete.inputSchema.required).toContain('sessionId');
      expect(tools.memory_delete.inputSchema.required).toContain('key');
    });
  });

  describe('error handling', () => {
    it('should handle memory_store errors gracefully', async () => {
      // Mock memory.store to throw an error
      const originalStore = memory.store.bind(memory);
      vi.spyOn(memory, 'store').mockImplementation(() => {
        throw new Error('Storage failure');
      });

      const result = await tools.memory_store.handler({
        sessionId: testSessionId,
        key: 'error-key',
        content: 'error content',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Storage failure');

      // Restore original
      vi.spyOn(memory, 'store').mockImplementation(originalStore);
    });

    it('should handle memory_store errors with non-Error types', async () => {
      // Mock memory.store to throw a string
      const originalStore = memory.store.bind(memory);
      vi.spyOn(memory, 'store').mockImplementation(() => {
        throw 'String error';
      });

      const result = await tools.memory_store.handler({
        sessionId: testSessionId,
        key: 'error-key',
        content: 'error content',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('String error');

      // Restore original
      vi.spyOn(memory, 'store').mockImplementation(originalStore);
    });

    it('should handle memory_search errors gracefully', async () => {
      // Mock memory.search to throw an error
      const originalSearch = memory.search.bind(memory);
      vi.spyOn(memory, 'search').mockImplementation(() => {
        throw new Error('Search failure');
      });

      const result = await tools.memory_search.handler({
        sessionId: testSessionId,
        query: 'test query',
      });

      expect(result.count).toBe(0);
      expect(result.results).toEqual([]);
      expect(result.error).toBe('Search failure');

      // Restore original
      vi.spyOn(memory, 'search').mockImplementation(originalSearch);
    });

    it('should handle memory_search errors with non-Error types', async () => {
      // Mock memory.search to throw a string
      const originalSearch = memory.search.bind(memory);
      vi.spyOn(memory, 'search').mockImplementation(() => {
        throw 'String search error';
      });

      const result = await tools.memory_search.handler({
        sessionId: testSessionId,
        query: 'test query',
      });

      expect(result.count).toBe(0);
      expect(result.results).toEqual([]);
      expect(result.error).toBe('String search error');

      // Restore original
      vi.spyOn(memory, 'search').mockImplementation(originalSearch);
    });
  });
});
