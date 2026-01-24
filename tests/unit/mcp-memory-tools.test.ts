/**
 * MCP Memory Tools tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMemoryTools } from '../../src/mcp/tools/memory-tools.js';
import { MemoryManager, resetMemoryManager } from '../../src/memory/index.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

  beforeEach(() => {
    resetMemoryManager();
    config = createTestConfig();
    dbPath = config.memory.path;
    memory = new MemoryManager(config);
    tools = createMemoryTools(memory);
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
        key: 'test-key',
        content: 'test content',
      });

      expect(result.success).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry.key).toBe('test-key');
      expect(result.entry.namespace).toBe('default');
    });

    it('should store with namespace', async () => {
      const result = await tools.memory_store.handler({
        key: 'ns-key',
        content: 'namespaced content',
        namespace: 'custom-ns',
      });

      expect(result.success).toBe(true);
      expect(result.entry.namespace).toBe('custom-ns');
    });

    it('should store with metadata', async () => {
      const result = await tools.memory_store.handler({
        key: 'meta-key',
        content: 'content with metadata',
        metadata: { type: 'note', priority: 1 },
      });

      expect(result.success).toBe(true);
      expect(result.entry).toBeDefined();
    });

    it('should include timestamps in response', async () => {
      const result = await tools.memory_store.handler({
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
          key: '',
          content: 'content',
        })
      ).rejects.toThrow();
    });

    it('should throw for empty content', async () => {
      await expect(
        tools.memory_store.handler({
          key: 'key',
          content: '',
        })
      ).rejects.toThrow();
    });

    it('should have correct tool definition', () => {
      expect(tools.memory_store.name).toBe('memory_store');
      expect(tools.memory_store.description).toBe('Store a key-value pair in memory');
      expect(tools.memory_store.inputSchema.required).toContain('key');
      expect(tools.memory_store.inputSchema.required).toContain('content');
    });
  });

  describe('memory_search', () => {
    beforeEach(async () => {
      await memory.store('search-1', 'The quick brown fox jumps');
      await memory.store('search-2', 'A lazy dog sleeps');
      await memory.store('search-3', 'Quick foxes are fast');
    });

    it('should search memory entries', async () => {
      const result = await tools.memory_search.handler({
        query: 'quick fox',
      });

      expect(result.count).toBeGreaterThan(0);
      expect(result.results).toBeInstanceOf(Array);
    });

    it('should search with namespace filter', async () => {
      await memory.store('ns-search', 'apple content', { namespace: 'fruits' });

      const result = await tools.memory_search.handler({
        query: 'apple',
        namespace: 'fruits',
      });

      expect(result.count).toBe(1);
      expect(result.results[0].namespace).toBe('fruits');
    });

    it('should respect limit parameter', async () => {
      const result = await tools.memory_search.handler({
        query: 'quick',
        limit: 1,
      });

      expect(result.results.length).toBeLessThanOrEqual(1);
    });

    it('should include score and matchType in results', async () => {
      const result = await tools.memory_search.handler({
        query: 'quick',
      });

      if (result.results.length > 0) {
        expect(result.results[0].score).toBeDefined();
        expect(result.results[0].matchType).toBeDefined();
      }
    });

    it('should return empty results for no matches', async () => {
      const result = await tools.memory_search.handler({
        query: 'xyznonexistent',
      });

      expect(result.count).toBe(0);
      expect(result.results).toEqual([]);
    });

    it('should throw for invalid input (empty query)', async () => {
      await expect(
        tools.memory_search.handler({
          query: '',
        })
      ).rejects.toThrow();
    });

    it('should have correct tool definition', () => {
      expect(tools.memory_search.name).toBe('memory_search');
      expect(tools.memory_search.inputSchema.required).toContain('query');
    });
  });

  describe('memory_get', () => {
    it('should get a memory entry by key', async () => {
      await memory.store('get-key', 'get content');

      const result = await tools.memory_get.handler({
        key: 'get-key',
      });

      expect(result.found).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry.key).toBe('get-key');
      expect(result.entry.content).toBe('get content');
    });

    it('should get entry with namespace', async () => {
      await memory.store('ns-get-key', 'ns content', { namespace: 'custom' });

      const result = await tools.memory_get.handler({
        key: 'ns-get-key',
        namespace: 'custom',
      });

      expect(result.found).toBe(true);
      expect(result.entry.namespace).toBe('custom');
    });

    it('should return not found for missing entry', async () => {
      const result = await tools.memory_get.handler({
        key: 'non-existent-key',
      });

      expect(result.found).toBe(false);
      expect(result.message).toBe('Entry not found');
    });

    it('should include metadata in response', async () => {
      await memory.store('meta-get-key', 'content', { metadata: { tag: 'test' } });

      const result = await tools.memory_get.handler({
        key: 'meta-get-key',
      });

      expect(result.found).toBe(true);
      expect(result.entry.metadata).toEqual({ tag: 'test' });
    });

    it('should include timestamps in response', async () => {
      await memory.store('time-get-key', 'content');

      const result = await tools.memory_get.handler({
        key: 'time-get-key',
      });

      expect(result.found).toBe(true);
      expect(result.entry.createdAt).toBeDefined();
      expect(result.entry.updatedAt).toBeDefined();
    });

    it('should have correct tool definition', () => {
      expect(tools.memory_get.name).toBe('memory_get');
      expect(tools.memory_get.inputSchema.required).toContain('key');
    });
  });

  describe('memory_list', () => {
    beforeEach(async () => {
      await memory.store('list-1', 'content 1');
      await memory.store('list-2', 'content 2');
      await memory.store('list-3', 'content 3');
    });

    it('should list all memory entries', async () => {
      const result = await tools.memory_list.handler({});

      expect(result.total).toBe(3);
      expect(result.count).toBe(3);
      expect(result.entries).toHaveLength(3);
    });

    it('should list with namespace filter', async () => {
      await memory.store('ns-list-1', 'ns content', { namespace: 'filtered' });

      const result = await tools.memory_list.handler({
        namespace: 'filtered',
      });

      expect(result.total).toBe(1);
      expect(result.count).toBe(1);
      expect(result.entries[0].namespace).toBe('filtered');
    });

    it('should respect limit parameter', async () => {
      const result = await tools.memory_list.handler({
        limit: 2,
      });

      expect(result.count).toBe(2);
      expect(result.entries).toHaveLength(2);
    });

    it('should respect offset parameter', async () => {
      const result = await tools.memory_list.handler({
        offset: 2,
      });

      expect(result.offset).toBe(2);
      expect(result.count).toBe(1);
    });

    it('should truncate long content in preview', async () => {
      const longContent = 'x'.repeat(300);
      await memory.store('long-key', longContent);

      const result = await tools.memory_list.handler({});

      const longEntry = result.entries.find((e: { key: string }) => e.key === 'long-key');
      expect(longEntry).toBeDefined();
      expect(longEntry.contentPreview.length).toBeLessThanOrEqual(203); // 200 + '...'
      expect(longEntry.contentPreview.endsWith('...')).toBe(true);
    });

    it('should not truncate short content', async () => {
      await memory.store('short-key', 'short');

      const result = await tools.memory_list.handler({});

      const shortEntry = result.entries.find((e: { key: string }) => e.key === 'short-key');
      expect(shortEntry).toBeDefined();
      expect(shortEntry.contentPreview).toBe('short');
    });

    it('should include metadata in entries', async () => {
      await memory.store('meta-list-key', 'content', { metadata: { foo: 'bar' } });

      const result = await tools.memory_list.handler({});

      const metaEntry = result.entries.find((e: { key: string }) => e.key === 'meta-list-key');
      expect(metaEntry).toBeDefined();
      expect(metaEntry.metadata).toEqual({ foo: 'bar' });
    });

    it('should have correct tool definition', () => {
      expect(tools.memory_list.name).toBe('memory_list');
      expect(tools.memory_list.inputSchema.properties).toHaveProperty('namespace');
      expect(tools.memory_list.inputSchema.properties).toHaveProperty('limit');
      expect(tools.memory_list.inputSchema.properties).toHaveProperty('offset');
    });
  });

  describe('memory_delete', () => {
    it('should delete a memory entry', async () => {
      await memory.store('delete-key', 'to delete');

      const result = await tools.memory_delete.handler({
        key: 'delete-key',
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Entry deleted');

      // Verify deletion
      expect(memory.get('delete-key')).toBeNull();
    });

    it('should delete with namespace', async () => {
      await memory.store('ns-delete-key', 'content', { namespace: 'custom' });

      const result = await tools.memory_delete.handler({
        key: 'ns-delete-key',
        namespace: 'custom',
      });

      expect(result.success).toBe(true);
      expect(memory.get('ns-delete-key', 'custom')).toBeNull();
    });

    it('should return false for non-existent entry', async () => {
      const result = await tools.memory_delete.handler({
        key: 'non-existent-delete-key',
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Entry not found');
    });

    it('should have correct tool definition', () => {
      expect(tools.memory_delete.name).toBe('memory_delete');
      expect(tools.memory_delete.inputSchema.required).toContain('key');
    });
  });
});
