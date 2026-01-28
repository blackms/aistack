/**
 * Memory routes
 *
 * All operations support optional sessionId query parameter for session-based isolation.
 * When sessionId is provided, operations are scoped to the session namespace.
 */

import type { AgentStackConfig } from '../../types.js';
import type { Router } from '../router.js';
import { sendJson, sendPaginated } from '../router.js';
import { badRequest, notFound } from '../middleware/error.js';
import { getMemoryManager, getAccessControl } from '../../memory/index.js';
import type { MemoryStoreRequest, MemorySearchRequest } from '../types.js';

export function registerMemoryRoutes(router: Router, config: AgentStackConfig): void {
  const getManager = () => getMemoryManager(config);
  const accessControl = getAccessControl();

  /**
   * Helper to set session context on memory manager
   */
  function setSessionContext(manager: ReturnType<typeof getManager>, sessionId?: string, agentId?: string) {
    if (sessionId) {
      manager.setAgentContext({
        agentId: agentId ?? sessionId,
        sessionId,
      });
    }
  }

  /**
   * Helper to derive namespace from sessionId
   */
  function deriveNamespace(sessionId?: string, explicitNamespace?: string): string | undefined {
    if (explicitNamespace) return explicitNamespace;
    if (sessionId) return accessControl.getSessionNamespace(sessionId);
    return undefined;
  }

  // GET /api/v1/memory - List memory entries
  router.get('/api/v1/memory', (_req, res, params) => {
    const sessionId = params.query.sessionId;
    const namespace = deriveNamespace(sessionId, params.query.namespace);
    const limit = parseInt(params.query.limit || '50', 10);
    const offset = parseInt(params.query.offset || '0', 10);
    const agentId = params.query.agentId;

    const manager = getManager();
    setSessionContext(manager, sessionId, agentId);

    const entries = manager.list(namespace, limit, offset, { agentId });
    const total = manager.count(namespace);

    manager.clearAgentContext();

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
  // Requires sessionId for session-based isolation
  router.post('/api/v1/memory', async (_req, res, params) => {
    const body = params.body as (MemoryStoreRequest & { sessionId?: string; agentId?: string }) | undefined;

    if (!body?.key) {
      throw badRequest('Key is required');
    }
    if (!body?.content) {
      throw badRequest('Content is required');
    }

    const sessionId = body.sessionId ?? params.query.sessionId;
    if (!sessionId) {
      throw badRequest('sessionId is required for write operations');
    }

    const manager = getManager();
    const namespace = deriveNamespace(sessionId, body.namespace);

    setSessionContext(manager, sessionId, body.agentId);

    const entry = await manager.store(body.key, body.content, {
      namespace,
      metadata: body.metadata,
      generateEmbedding: body.generateEmbedding,
      agentId: body.agentId,
    });

    manager.clearAgentContext();

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

    const sessionId = params.query.sessionId;
    const namespace = deriveNamespace(sessionId, params.query.namespace);
    const limit = parseInt(params.query.limit || '10', 10);
    const threshold = parseFloat(params.query.threshold || '0.7');
    const useVector = params.query.useVector === 'true';
    const agentId = params.query.agentId;

    const manager = getManager();
    setSessionContext(manager, sessionId, agentId);

    const results = await manager.search(query, {
      namespace,
      limit,
      threshold,
      useVector,
      agentId,
    });

    manager.clearAgentContext();

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
    const body = params.body as (MemorySearchRequest & { sessionId?: string; agentId?: string }) | undefined;

    if (!body?.query) {
      throw badRequest('Query is required');
    }

    const manager = getManager();
    const sessionId = body.sessionId ?? params.query.sessionId;
    const namespace = deriveNamespace(sessionId, body.namespace);

    setSessionContext(manager, sessionId, body.agentId);

    const results = await manager.search(body.query, {
      namespace,
      limit: body.limit,
      threshold: body.threshold,
      useVector: body.useVector,
      agentId: body.agentId,
    });

    manager.clearAgentContext();

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

    const sessionId = params.query.sessionId;
    const namespace = deriveNamespace(sessionId, params.query.namespace);
    const manager = getManager();

    setSessionContext(manager, sessionId);

    const entry = manager.get(key, namespace);

    manager.clearAgentContext();

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
  // Requires sessionId for session-based isolation
  router.delete('/api/v1/memory/:key', (_req, res, params) => {
    const key = params.path[0];
    if (!key) {
      throw badRequest('Key is required');
    }

    const sessionId = params.query.sessionId;
    if (!sessionId) {
      throw badRequest('sessionId is required for delete operations');
    }

    const namespace = deriveNamespace(sessionId, params.query.namespace);
    const manager = getManager();

    setSessionContext(manager, sessionId);

    const success = manager.delete(key, namespace);

    manager.clearAgentContext();

    if (!success) {
      throw notFound('Memory entry');
    }

    sendJson(res, { deleted: true });
  });

  // GET /api/v1/memory/tags - Get all tags with usage counts
  router.get('/api/v1/memory/tags', (_req, res) => {
    const manager = getManager();
    const tags = manager.getAllTags();
    sendJson(res, tags);
  });

  // POST /api/v1/memory/:id/tags - Add tag to entry
  router.post('/api/v1/memory/:id/tags', (_req, res, params) => {
    const id = params.path[0];
    const body = params.body as { tag: string } | undefined;

    if (!id) {
      throw badRequest('Entry ID is required');
    }
    if (!body?.tag) {
      throw badRequest('Tag is required');
    }

    const manager = getManager();
    try {
      manager.addTag(id, body.tag);
      sendJson(res, { success: true }, 201);
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        throw notFound('Memory entry');
      }
      throw err;
    }
  });

  // DELETE /api/v1/memory/:id/tags/:tagName - Remove tag from entry
  router.delete('/api/v1/memory/:id/tags/:tagName', (_req, res, params) => {
    const id = params.path[0];
    const tagName = decodeURIComponent(params.path[1] || '');

    if (!id) {
      throw badRequest('Entry ID is required');
    }
    if (!tagName) {
      throw badRequest('Tag name is required');
    }

    const manager = getManager();
    const removed = manager.removeTag(id, tagName);

    if (!removed) {
      throw notFound('Tag not found on entry');
    }

    sendJson(res, { success: true });
  });

  // GET /api/v1/memory/search/tags - Search by tags
  router.get('/api/v1/memory/search/tags', (_req, res, params) => {
    const tagsParam = params.query.tags;
    if (!tagsParam) {
      throw badRequest('Tags parameter is required');
    }

    const tags = tagsParam.split(',').map((t: string) => t.trim());
    const namespace = params.query.namespace;

    const manager = getManager();
    const entries = manager.searchByTags(tags, namespace);

    sendJson(res, entries.map(entry => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      embedding: undefined,
    })));
  });

  // POST /api/v1/memory/:id/relationships - Create relationship
  router.post('/api/v1/memory/:id/relationships', (_req, res, params) => {
    const fromId = params.path[0];
    const body = params.body as {
      toId: string;
      relationshipType: string;
      metadata?: Record<string, unknown>;
    } | undefined;

    if (!fromId) {
      throw badRequest('Entry ID is required');
    }
    if (!body?.toId) {
      throw badRequest('Target entry ID (toId) is required');
    }
    if (!body?.relationshipType) {
      throw badRequest('Relationship type is required');
    }

    const manager = getManager();
    try {
      const relationshipId = manager.createRelationship(
        fromId,
        body.toId,
        body.relationshipType,
        body.metadata
      );
      sendJson(res, { id: relationshipId }, 201);
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.includes('not found')) {
          throw notFound(err.message);
        }
        if (err.message.includes('already exists')) {
          throw badRequest('Relationship already exists');
        }
      }
      throw err;
    }
  });

  // GET /api/v1/memory/:id/relationships - Get relationships for entry
  router.get('/api/v1/memory/:id/relationships', (_req, res, params) => {
    const entryId = params.path[0];
    const direction = (params.query.direction as 'outgoing' | 'incoming' | 'both') || 'both';

    if (!entryId) {
      throw badRequest('Entry ID is required');
    }

    const manager = getManager();
    const relationships = manager.getRelationships(entryId, direction);

    sendJson(res, relationships.map(rel => ({
      ...rel,
      createdAt: rel.createdAt.toISOString(),
    })));
  });

  // GET /api/v1/memory/:id/related - Get related entries
  router.get('/api/v1/memory/:id/related', (_req, res, params) => {
    const entryId = params.path[0];
    const relationshipType = params.query.type;

    if (!entryId) {
      throw badRequest('Entry ID is required');
    }

    const manager = getManager();
    const related = manager.getRelatedEntries(entryId, relationshipType);

    sendJson(res, related.map(item => ({
      entry: {
        ...item.entry,
        createdAt: item.entry.createdAt.toISOString(),
        updatedAt: item.entry.updatedAt.toISOString(),
        embedding: undefined,
      },
      relationship: item.relationship,
    })));
  });

  // DELETE /api/v1/memory/relationships/:relationshipId - Delete relationship
  router.delete('/api/v1/memory/relationships/:relationshipId', (_req, res, params) => {
    const relationshipId = params.path[0];

    if (!relationshipId) {
      throw badRequest('Relationship ID is required');
    }

    const manager = getManager();
    const deleted = manager.deleteRelationship(relationshipId);

    if (!deleted) {
      throw notFound('Relationship');
    }

    sendJson(res, { deleted: true });
  });

  // GET /api/v1/memory/:id/versions - Get version history
  router.get('/api/v1/memory/:id/versions', (_req, res, params) => {
    const entryId = params.path[0];

    if (!entryId) {
      throw badRequest('Entry ID is required');
    }

    const manager = getManager();
    const versions = manager.getVersionHistory(entryId);

    sendJson(res, versions.map(v => ({
      ...v,
      createdAt: v.createdAt.toISOString(),
    })));
  });

  // GET /api/v1/memory/:id/versions/:version - Get specific version
  router.get('/api/v1/memory/:id/versions/:version', (_req, res, params) => {
    const entryId = params.path[0];
    const version = parseInt(params.path[1] || '', 10);

    if (!entryId) {
      throw badRequest('Entry ID is required');
    }
    if (isNaN(version)) {
      throw badRequest('Version must be a number');
    }

    const manager = getManager();
    const versionEntry = manager.getVersion(entryId, version);

    if (!versionEntry) {
      throw notFound('Version');
    }

    sendJson(res, {
      ...versionEntry,
      createdAt: versionEntry.createdAt.toISOString(),
    });
  });

  // POST /api/v1/memory/:id/versions/:version/restore - Restore a version
  router.post('/api/v1/memory/:id/versions/:version/restore', (_req, res, params) => {
    const entryId = params.path[0];
    const version = parseInt(params.path[1] || '', 10);

    if (!entryId) {
      throw badRequest('Entry ID is required');
    }
    if (isNaN(version)) {
      throw badRequest('Version must be a number');
    }

    const manager = getManager();
    const restored = manager.restoreVersion(entryId, version);

    if (!restored) {
      throw notFound('Version or entry');
    }

    sendJson(res, { restored: true });
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
