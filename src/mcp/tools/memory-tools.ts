/**
 * Memory MCP tools - store, search, get, list, delete
 */

import { z } from 'zod';
import type { MemoryManager } from '../../memory/index.js';

// Input schemas
const StoreInputSchema = z.object({
  key: z.string().min(1).max(500).describe('Unique key for the memory entry'),
  content: z.string().min(1).max(1000000).describe('Content to store'),
  namespace: z.string().min(1).max(100).optional().describe('Namespace for organization'),
  metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
  generateEmbedding: z.boolean().optional().describe('Generate embedding for vector search'),
});

const SearchInputSchema = z.object({
  query: z.string().min(1).max(1000).describe('Search query'),
  namespace: z.string().optional().describe('Namespace to search in'),
  limit: z.number().min(1).max(100).optional().describe('Maximum results'),
  threshold: z.number().min(0).max(1).optional().describe('Minimum similarity score'),
  useVector: z.boolean().optional().describe('Use vector search if available'),
});

const GetInputSchema = z.object({
  key: z.string().min(1).max(500).describe('Key to retrieve'),
  namespace: z.string().optional().describe('Namespace'),
});

const ListInputSchema = z.object({
  namespace: z.string().optional().describe('Filter by namespace'),
  limit: z.number().min(1).max(1000).optional().describe('Maximum results'),
  offset: z.number().min(0).optional().describe('Offset for pagination'),
});

const DeleteInputSchema = z.object({
  key: z.string().min(1).max(500).describe('Key to delete'),
  namespace: z.string().optional().describe('Namespace'),
});

export function createMemoryTools(memory: MemoryManager) {
  return {
    memory_store: {
      name: 'memory_store',
      description: 'Store a key-value pair in memory',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Unique key for the memory entry' },
          content: { type: 'string', description: 'Content to store' },
          namespace: { type: 'string', description: 'Namespace for organization' },
          metadata: { type: 'object', description: 'Additional metadata' },
          generateEmbedding: { type: 'boolean', description: 'Generate embedding for vector search' },
        },
        required: ['key', 'content'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = StoreInputSchema.parse(params);

        try {
          const entry = await memory.store(input.key, input.content, {
            namespace: input.namespace,
            metadata: input.metadata,
            generateEmbedding: input.generateEmbedding,
          });

          return {
            success: true,
            entry: {
              id: entry.id,
              key: entry.key,
              namespace: entry.namespace,
              createdAt: entry.createdAt.toISOString(),
              updatedAt: entry.updatedAt.toISOString(),
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },

    memory_search: {
      name: 'memory_search',
      description: 'Search memory using full-text and/or vector search',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          namespace: { type: 'string', description: 'Namespace to search in' },
          limit: { type: 'number', description: 'Maximum results' },
          threshold: { type: 'number', description: 'Minimum similarity score (0-1)' },
          useVector: { type: 'boolean', description: 'Use vector search if available' },
        },
        required: ['query'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = SearchInputSchema.parse(params);

        try {
          const results = await memory.search(input.query, {
            namespace: input.namespace,
            limit: input.limit,
            threshold: input.threshold,
            useVector: input.useVector,
          });

          return {
            count: results.length,
            results: results.map(r => ({
              key: r.entry.key,
              content: r.entry.content,
              namespace: r.entry.namespace,
              score: r.score,
              matchType: r.matchType,
              metadata: r.entry.metadata,
            })),
          };
        } catch (error) {
          return {
            count: 0,
            results: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },

    memory_get: {
      name: 'memory_get',
      description: 'Get a memory entry by key',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key to retrieve' },
          namespace: { type: 'string', description: 'Namespace' },
        },
        required: ['key'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = GetInputSchema.parse(params);
        const entry = memory.get(input.key, input.namespace);

        if (!entry) {
          return {
            found: false,
            message: 'Entry not found',
          };
        }

        return {
          found: true,
          entry: {
            id: entry.id,
            key: entry.key,
            content: entry.content,
            namespace: entry.namespace,
            metadata: entry.metadata,
            createdAt: entry.createdAt.toISOString(),
            updatedAt: entry.updatedAt.toISOString(),
          },
        };
      },
    },

    memory_list: {
      name: 'memory_list',
      description: 'List memory entries',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Filter by namespace' },
          limit: { type: 'number', description: 'Maximum results' },
          offset: { type: 'number', description: 'Offset for pagination' },
        },
      },
      handler: async (params: Record<string, unknown>) => {
        const input = ListInputSchema.parse(params);
        const entries = memory.list(input.namespace, input.limit, input.offset);
        const total = memory.count(input.namespace);

        return {
          total,
          count: entries.length,
          offset: input.offset ?? 0,
          entries: entries.map(e => ({
            id: e.id,
            key: e.key,
            namespace: e.namespace,
            contentPreview: e.content.slice(0, 200) + (e.content.length > 200 ? '...' : ''),
            metadata: e.metadata,
            createdAt: e.createdAt.toISOString(),
            updatedAt: e.updatedAt.toISOString(),
          })),
        };
      },
    },

    memory_delete: {
      name: 'memory_delete',
      description: 'Delete a memory entry',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key to delete' },
          namespace: { type: 'string', description: 'Namespace' },
        },
        required: ['key'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = DeleteInputSchema.parse(params);
        const deleted = memory.delete(input.key, input.namespace);

        return {
          success: deleted,
          message: deleted ? 'Entry deleted' : 'Entry not found',
        };
      },
    },
  };
}
