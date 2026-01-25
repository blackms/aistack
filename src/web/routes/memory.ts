/**
 * Memory routes
 */

import type { AgentStackConfig } from '../../types.js';
import type { Router } from '../router.js';
import { sendJson, sendPaginated } from '../router.js';
import { badRequest, notFound } from '../middleware/error.js';
import { getMemoryManager } from '../../memory/index.js';
import type { MemoryStoreRequest, MemorySearchRequest } from '../types.js';

export function registerMemoryRoutes(router: Router, config: AgentStackConfig): void {
  const getManager = () => getMemoryManager(config);

  // GET /api/v1/memory - List memory entries
  router.get('/api/v1/memory', (_req, res, params) => {
    const namespace = params.query.namespace;
    const limit = parseInt(params.query.limit || '50', 10);
    const offset = parseInt(params.query.offset || '0', 10);

    const manager = getManager();
    const entries = manager.list(namespace, limit, offset);
    const total = manager.count(namespace);

    sendPaginated(
      res,
      entries.map(entry => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
        embedding: undefined, // Don't send embeddings in list view
      })),
      { limit, offset, total }
    );
  });

  // POST /api/v1/memory - Store entry
  router.post('/api/v1/memory', async (_req, res, params) => {
    const body = params.body as MemoryStoreRequest | undefined;

    if (!body?.key) {
      throw badRequest('Key is required');
    }
    if (!body?.content) {
      throw badRequest('Content is required');
    }

    const manager = getManager();
    const entry = await manager.store(body.key, body.content, {
      namespace: body.namespace,
      metadata: body.metadata,
      generateEmbedding: body.generateEmbedding,
    });

    sendJson(res, {
      ...entry,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      embedding: undefined,
    }, 201);
  });

  // GET /api/v1/memory/search - Search memory
  router.get('/api/v1/memory/search', async (_req, res, params) => {
    const query = params.query.q || params.query.query;
    if (!query) {
      throw badRequest('Query (q) is required');
    }

    const namespace = params.query.namespace;
    const limit = parseInt(params.query.limit || '10', 10);
    const threshold = parseFloat(params.query.threshold || '0.7');
    const useVector = params.query.useVector === 'true';

    const manager = getManager();
    const results = await manager.search(query, {
      namespace,
      limit,
      threshold,
      useVector,
    });

    sendJson(res, results.map(result => ({
      entry: {
        ...result.entry,
        createdAt: result.entry.createdAt.toISOString(),
        updatedAt: result.entry.updatedAt.toISOString(),
        embedding: undefined,
      },
      score: result.score,
      matchType: result.matchType,
    })));
  });

  // POST /api/v1/memory/search - Search memory (POST version for complex queries)
  router.post('/api/v1/memory/search', async (_req, res, params) => {
    const body = params.body as MemorySearchRequest | undefined;

    if (!body?.query) {
      throw badRequest('Query is required');
    }

    const manager = getManager();
    const results = await manager.search(body.query, {
      namespace: body.namespace,
      limit: body.limit,
      threshold: body.threshold,
      useVector: body.useVector,
    });

    sendJson(res, results.map(result => ({
      entry: {
        ...result.entry,
        createdAt: result.entry.createdAt.toISOString(),
        updatedAt: result.entry.updatedAt.toISOString(),
        embedding: undefined,
      },
      score: result.score,
      matchType: result.matchType,
    })));
  });

  // GET /api/v1/memory/:key - Get entry by key
  router.get('/api/v1/memory/:key', (_req, res, params) => {
    const key = params.path[0];
    if (!key) {
      throw badRequest('Key is required');
    }

    const namespace = params.query.namespace;
    const manager = getManager();
    const entry = manager.get(key, namespace);

    if (!entry) {
      throw notFound('Memory entry');
    }

    sendJson(res, {
      ...entry,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      embedding: undefined,
    });
  });

  // DELETE /api/v1/memory/:key - Delete entry
  router.delete('/api/v1/memory/:key', (_req, res, params) => {
    const key = params.path[0];
    if (!key) {
      throw badRequest('Key is required');
    }

    const namespace = params.query.namespace;
    const manager = getManager();
    const success = manager.delete(key, namespace);

    if (!success) {
      throw notFound('Memory entry');
    }

    sendJson(res, { deleted: true });
  });

  // GET /api/v1/memory/stats/vector - Get vector search stats
  router.get('/api/v1/memory/stats/vector', (_req, res, params) => {
    const namespace = params.query.namespace;
    const manager = getManager();
    const stats = manager.getVectorStats(namespace);

    sendJson(res, stats);
  });

  // POST /api/v1/memory/reindex - Reindex vector embeddings
  router.post('/api/v1/memory/reindex', async (_req, res, params) => {
    const namespace = params.query.namespace;
    const manager = getManager();
    const count = await manager.reindex(namespace);

    sendJson(res, { reindexed: count });
  });
}
