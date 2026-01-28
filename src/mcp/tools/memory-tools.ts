/**
 * Memory MCP tools - store, search, get, list, delete
 *
 * All operations require a sessionId for session-based isolation.
 */

import { z } from 'zod';
import type { MemoryManager } from '../../memory/index.js';
import { getAccessControl } from '../../memory/index.js';

// Input schemas - sessionId is required for all operations
const StoreInputSchema = z.object({
  sessionId: z.string().uuid().describe('Session ID for memory isolation (required)'),
  key: z.string().min(1).max(500).describe('Unique key for the memory entry'),
  content: z.string().min(1).max(1000000).describe('Content to store'),
  namespace: z.string().min(1).max(100).optional().describe('Namespace for organization (defaults to session namespace)'),
  metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
  generateEmbedding: z.boolean().optional().describe('Generate embedding for vector search'),
  agentId: z.string().uuid().optional().describe('Agent ID to associate this memory with'),
});

const SearchInputSchema = z.object({
  sessionId: z.string().uuid().describe('Session ID for memory isolation (required)'),
  query: z.string().min(1).max(1000).describe('Search query'),
  namespace: z.string().optional().describe('Namespace to search in (defaults to session namespace)'),
  limit: z.number().min(1).max(100).optional().describe('Maximum results'),
  threshold: z.number().min(0).max(1).optional().describe('Minimum similarity score'),
  useVector: z.boolean().optional().describe('Use vector search if available'),
  agentId: z.string().uuid().optional().describe('Filter by agent ownership'),
  includeShared: z.boolean().optional().describe('Include shared memory (agent_id = NULL)'),
});

const GetInputSchema = z.object({
  sessionId: z.string().uuid().describe('Session ID for memory isolation (required)'),
  key: z.string().min(1).max(500).describe('Key to retrieve'),
  namespace: z.string().optional().describe('Namespace (defaults to session namespace)'),
});

const ListInputSchema = z.object({
  sessionId: z.string().uuid().describe('Session ID for memory isolation (required)'),
  namespace: z.string().optional().describe('Filter by namespace (defaults to session namespace)'),
  limit: z.number().min(1).max(1000).optional().describe('Maximum results'),
  offset: z.number().min(0).optional().describe('Offset for pagination'),
  agentId: z.string().uuid().optional().describe('Filter by agent ownership'),
  includeShared: z.boolean().optional().describe('Include shared memory (agent_id = NULL)'),
});

const DeleteInputSchema = z.object({
  sessionId: z.string().uuid().describe('Session ID for memory isolation (required)'),
  key: z.string().min(1).max(500).describe('Key to delete'),
  namespace: z.string().optional().describe('Namespace (defaults to session namespace)'),
});

export function createMemoryTools(memory: MemoryManager) {
  const accessControl = getAccessControl();

  /**
   * Helper to execute an operation with proper context management.
   * Ensures context is always cleared, even on error.
   */
  async function withContext<T>(
    context: { sessionId: string; agentId?: string; includeShared?: boolean },
    operation: () => T | Promise<T>
  ): Promise<T> {
    memory.setAgentContext(context);
    try {
      return await operation();
    } finally {
      memory.clearAgentContext();
    }
  }

  return {
    memory_store: {
      name: 'memory_store',
      description: 'Store a key-value pair in memory (requires sessionId for isolation)',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session ID for memory isolation (required)' },
          key: { type: 'string', description: 'Unique key for the memory entry' },
          content: { type: 'string', description: 'Content to store' },
          namespace: { type: 'string', description: 'Namespace for organization (defaults to session namespace)' },
          metadata: { type: 'object', description: 'Additional metadata' },
          generateEmbedding: { type: 'boolean', description: 'Generate embedding for vector search' },
          agentId: { type: 'string', description: 'Agent ID to associate this memory with' },
        },
        required: ['sessionId', 'key', 'content'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = StoreInputSchema.parse(params);

        try {
          const namespace = input.namespace ?? accessControl.getSessionNamespace(input.sessionId);

          const entry = await withContext(
            { sessionId: input.sessionId, agentId: input.agentId },
            () => memory.store(input.key, input.content, {
              namespace,
              metadata: input.metadata,
              generateEmbedding: input.generateEmbedding,
              agentId: input.agentId,
            })
          );

          return {
            success: true,
            entry: {
              id: entry.id,
              key: entry.key,
              namespace: entry.namespace,
              agentId: entry.agentId,
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
      description: 'Search memory using full-text and/or vector search (requires sessionId for isolation)',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session ID for memory isolation (required)' },
          query: { type: 'string', description: 'Search query' },
          namespace: { type: 'string', description: 'Namespace to search in (defaults to session namespace)' },
          limit: { type: 'number', description: 'Maximum results' },
          threshold: { type: 'number', description: 'Minimum similarity score (0-1)' },
          useVector: { type: 'boolean', description: 'Use vector search if available' },
          agentId: { type: 'string', description: 'Filter by agent ownership' },
          includeShared: { type: 'boolean', description: 'Include shared memory (agent_id = NULL)' },
        },
        required: ['sessionId', 'query'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = SearchInputSchema.parse(params);

        try {
          const namespace = input.namespace ?? accessControl.getSessionNamespace(input.sessionId);
          const includeShared = input.includeShared ?? true;

          const results = await withContext(
            { sessionId: input.sessionId, agentId: input.agentId, includeShared },
            () => memory.search(input.query, {
              namespace,
              limit: input.limit,
              threshold: input.threshold,
              useVector: input.useVector,
              agentId: input.agentId,
              includeShared,
            })
          );

          return {
            count: results.length,
            results: results.map(r => ({
              key: r.entry.key,
              content: r.entry.content,
              namespace: r.entry.namespace,
              agentId: r.entry.agentId,
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
      description: 'Get a memory entry by key (requires sessionId for isolation)',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session ID for memory isolation (required)' },
          key: { type: 'string', description: 'Key to retrieve' },
          namespace: { type: 'string', description: 'Namespace (defaults to session namespace)' },
        },
        required: ['sessionId', 'key'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = GetInputSchema.parse(params);
        const namespace = input.namespace ?? accessControl.getSessionNamespace(input.sessionId);

        const entry = await withContext(
          { sessionId: input.sessionId },
          () => memory.get(input.key, namespace)
        );

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
      description: 'List memory entries (requires sessionId for isolation)',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session ID for memory isolation (required)' },
          namespace: { type: 'string', description: 'Filter by namespace (defaults to session namespace)' },
          limit: { type: 'number', description: 'Maximum results' },
          offset: { type: 'number', description: 'Offset for pagination' },
          agentId: { type: 'string', description: 'Filter by agent ownership' },
          includeShared: { type: 'boolean', description: 'Include shared memory (agent_id = NULL)' },
        },
        required: ['sessionId'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = ListInputSchema.parse(params);
        const namespace = input.namespace ?? accessControl.getSessionNamespace(input.sessionId);
        const includeShared = input.includeShared ?? true;

        const { entries, total } = await withContext(
          { sessionId: input.sessionId, agentId: input.agentId, includeShared },
          () => ({
            entries: memory.list(namespace, input.limit, input.offset, {
              agentId: input.agentId,
              includeShared,
            }),
            total: memory.count(namespace),
          })
        );

        return {
          total,
          count: entries.length,
          offset: input.offset ?? 0,
          entries: entries.map(e => ({
            id: e.id,
            key: e.key,
            namespace: e.namespace,
            agentId: e.agentId,
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
      description: 'Delete a memory entry (requires sessionId for isolation)',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session ID for memory isolation (required)' },
          key: { type: 'string', description: 'Key to delete' },
          namespace: { type: 'string', description: 'Namespace (defaults to session namespace)' },
        },
        required: ['sessionId', 'key'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = DeleteInputSchema.parse(params);
        const namespace = input.namespace ?? accessControl.getSessionNamespace(input.sessionId);

        const deleted = await withContext(
          { sessionId: input.sessionId },
          () => memory.delete(input.key, namespace)
        );

        return {
          success: deleted,
          message: deleted ? 'Entry deleted' : 'Entry not found',
        };
      },
    },
  };
}
