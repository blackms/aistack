/**
 * Memory module - unified interface for storage and search
 */

import type {
  MemoryEntry,
  MemorySearchResult,
  MemoryStoreOptions,
  MemorySearchOptions,
  AgentStackConfig,
  Session,
  Task,
} from '../types.js';
import { SQLiteStore } from './sqlite-store.js';
import { FTSSearch } from './fts-search.js';
import { VectorSearch } from './vector-search.js';
import { logger } from '../utils/logger.js';

const log = logger.child('memory');

export class MemoryManager {
  private sqliteStore: SQLiteStore;
  private fts: FTSSearch;
  private vector: VectorSearch;
  private config: AgentStackConfig;

  constructor(config: AgentStackConfig) {
    this.config = config;
    this.sqliteStore = new SQLiteStore(config.memory.path);
    // @ts-expect-error - accessing internal db for FTS
    this.fts = new FTSSearch(this.sqliteStore.db);
    this.vector = new VectorSearch(this.sqliteStore, config);

    log.info('Memory manager initialized', {
      path: config.memory.path,
      vectorEnabled: this.vector.isEnabled(),
    });
  }

  // ==================== Memory Operations ====================

  /**
   * Store a key-value pair in memory
   */
  async store(
    key: string,
    content: string,
    options: MemoryStoreOptions = {}
  ): Promise<MemoryEntry> {
    const namespace = options.namespace ?? this.config.memory.defaultNamespace;
    const entry = this.sqliteStore.store(key, content, { ...options, namespace });

    // Index for vector search if enabled
    if (options.generateEmbedding !== false && this.vector.isEnabled()) {
      await this.vector.indexEntry(entry);
    }

    log.debug('Stored memory entry', { key, namespace });
    return entry;
  }

  /**
   * Get a memory entry by key
   */
  get(key: string, namespace?: string): MemoryEntry | null {
    return this.sqliteStore.get(key, namespace ?? this.config.memory.defaultNamespace);
  }

  /**
   * Get a memory entry by ID
   */
  getById(id: string): MemoryEntry | null {
    return this.sqliteStore.getById(id);
  }

  /**
   * Delete a memory entry
   */
  delete(key: string, namespace?: string): boolean {
    return this.sqliteStore.delete(key, namespace ?? this.config.memory.defaultNamespace);
  }

  /**
   * List memory entries
   */
  list(namespace?: string, limit?: number, offset?: number): MemoryEntry[] {
    return this.sqliteStore.list(namespace, limit, offset);
  }

  /**
   * Count memory entries
   */
  count(namespace?: string): number {
    return this.sqliteStore.count(namespace);
  }

  /**
   * Search memory using FTS and optionally vector search
   */
  async search(
    query: string,
    options: MemorySearchOptions = {}
  ): Promise<MemorySearchResult[]> {
    const { namespace, limit = 10, threshold = 0.7, useVector } = options;

    // Decide whether to use vector search
    const shouldUseVector = useVector ?? this.vector.isEnabled();

    let results: MemorySearchResult[] = [];

    // Try vector search first if enabled
    if (shouldUseVector && this.vector.isEnabled()) {
      const vectorResults = await this.vector.search(query, {
        namespace,
        limit,
        threshold,
      });
      results = vectorResults;
    }

    // If no vector results or vector disabled, use FTS
    if (results.length === 0) {
      results = this.fts.search(query, { namespace, limit });
    }

    // If we have both, merge and deduplicate
    if (shouldUseVector && this.vector.isEnabled() && results.length > 0) {
      const ftsResults = this.fts.search(query, { namespace, limit });
      results = this.mergeResults(results, ftsResults, limit);
    }

    log.debug('Search completed', {
      query: query.slice(0, 50),
      results: results.length,
    });

    return results;
  }

  /**
   * Merge and deduplicate search results from different sources
   */
  private mergeResults(
    vectorResults: MemorySearchResult[],
    ftsResults: MemorySearchResult[],
    limit: number
  ): MemorySearchResult[] {
    const seen = new Set<string>();
    const merged: MemorySearchResult[] = [];

    // Add vector results first (higher quality)
    for (const result of vectorResults) {
      if (!seen.has(result.entry.id)) {
        seen.add(result.entry.id);
        merged.push(result);
      }
    }

    // Add FTS results that weren't in vector results
    for (const result of ftsResults) {
      if (!seen.has(result.entry.id) && merged.length < limit) {
        seen.add(result.entry.id);
        merged.push(result);
      }
    }

    return merged.slice(0, limit);
  }

  // ==================== Session Operations ====================

  createSession(metadata?: Record<string, unknown>): Session {
    return this.sqliteStore.createSession(metadata);
  }

  getSession(id: string): Session | null {
    return this.sqliteStore.getSession(id);
  }

  endSession(id: string): boolean {
    return this.sqliteStore.endSession(id);
  }

  getActiveSession(): Session | null {
    return this.sqliteStore.getActiveSession();
  }

  // ==================== Task Operations ====================

  createTask(agentType: string, input?: string, sessionId?: string): Task {
    return this.sqliteStore.createTask(agentType, input, sessionId);
  }

  getTask(id: string): Task | null {
    return this.sqliteStore.getTask(id);
  }

  updateTaskStatus(id: string, status: Task['status'], output?: string): boolean {
    return this.sqliteStore.updateTaskStatus(id, status, output);
  }

  listTasks(sessionId?: string, status?: Task['status']): Task[] {
    return this.sqliteStore.listTasks(sessionId, status);
  }

  // ==================== Vector Search ====================

  /**
   * Reindex all entries for vector search
   */
  async reindex(namespace?: string): Promise<number> {
    if (!this.vector.isEnabled()) {
      log.warn('Vector search not enabled');
      return 0;
    }

    const entries = this.sqliteStore.list(namespace, 10000);
    return this.vector.indexBatch(entries);
  }

  /**
   * Get vector search statistics
   */
  getVectorStats(namespace?: string): { total: number; indexed: number; coverage: number } {
    return this.vector.getStats(namespace);
  }

  // ==================== Cleanup ====================

  close(): void {
    this.sqliteStore.close();
    log.info('Memory manager closed');
  }

  vacuum(): void {
    this.sqliteStore.vacuum();
  }
}

// Export components
export { SQLiteStore } from './sqlite-store.js';
export { FTSSearch } from './fts-search.js';
export { VectorSearch } from './vector-search.js';

// Singleton instance
let instance: MemoryManager | null = null;

/**
 * Get or create the memory manager instance
 */
export function getMemoryManager(config?: AgentStackConfig): MemoryManager {
  if (!instance) {
    if (!config) {
      throw new Error('Configuration required to initialize memory manager');
    }
    instance = new MemoryManager(config);
  }
  return instance;
}

/**
 * Reset the memory manager instance
 */
export function resetMemoryManager(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
