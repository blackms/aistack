/**
 * Vector similarity search using embeddings
 * Uses external embedding APIs - honest about capabilities
 */

import type { MemoryEntry, MemorySearchResult, AgentStackConfig } from '../types.js';
import { createEmbeddingProvider, cosineSimilarity, type EmbeddingProvider } from '../utils/embeddings.js';
import { logger } from '../utils/logger.js';
import type { SQLiteStore } from './sqlite-store.js';

const log = logger.child('vector');

export interface VectorSearchOptions {
  namespace?: string;
  limit?: number;
  threshold?: number;
  agentId?: string;
  includeShared?: boolean;
}

export class VectorSearch {
  private store: SQLiteStore;
  private embedder: EmbeddingProvider | null = null;
  private enabled: boolean = false;

  constructor(store: SQLiteStore, config: AgentStackConfig) {
    this.store = store;
    this.embedder = createEmbeddingProvider(config);
    this.enabled = this.embedder !== null;

    if (this.enabled) {
      log.info('Vector search enabled', {
        provider: config.memory.vectorSearch.provider,
        model: config.memory.vectorSearch.model,
      });
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Generate and store embedding for a memory entry
   */
  async indexEntry(entry: MemoryEntry): Promise<void> {
    if (!this.embedder) {
      log.debug('Vector search disabled, skipping embedding');
      return;
    }

    try {
      const embedding = await this.embedder.embed(entry.content);
      this.store.storeEmbedding(entry.id, embedding);
      log.debug('Stored embedding', { id: entry.id, dimensions: embedding.length });
    } catch (error) {
      log.warn('Failed to generate embedding', {
        id: entry.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Batch index multiple entries
   */
  async indexBatch(entries: MemoryEntry[]): Promise<number> {
    if (!this.embedder || entries.length === 0) {
      return 0;
    }

    try {
      const texts = entries.map(e => e.content);
      const embeddings = await this.embedder.embedBatch(texts);

      let indexed = 0;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const embedding = embeddings[i];
        if (entry && embedding) {
          this.store.storeEmbedding(entry.id, embedding);
          indexed++;
        }
      }

      log.debug('Batch indexed entries', { count: indexed });
      return indexed;
    } catch (error) {
      log.warn('Failed to batch index', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Search using vector similarity
   */
  async search(
    query: string,
    options: VectorSearchOptions = {}
  ): Promise<MemorySearchResult[]> {
    if (!this.embedder) {
      log.debug('Vector search disabled');
      return [];
    }

    const { namespace, limit = 10, threshold = 0.7, agentId, includeShared = true } = options;

    try {
      // Generate query embedding
      const queryEmbedding = await this.embedder.embed(query);

      // Get all entries with embeddings (with agent filtering)
      const entriesWithEmbeddings = this.store.getEntriesWithEmbeddings(namespace, {
        agentId,
        includeShared,
      });

      if (entriesWithEmbeddings.length === 0) {
        log.debug('No entries with embeddings found');
        return [];
      }

      // Calculate similarities
      const scored: Array<{ id: string; score: number }> = [];

      for (const { id, embedding } of entriesWithEmbeddings) {
        const score = cosineSimilarity(queryEmbedding, embedding);
        if (score >= threshold) {
          scored.push({ id, score });
        }
      }

      // Sort by score descending and take top results
      scored.sort((a, b) => b.score - a.score);
      const topResults = scored.slice(0, limit);

      // Fetch full entries
      const results: MemorySearchResult[] = [];
      for (const { id, score } of topResults) {
        const entry = this.store.getById(id);
        if (entry) {
          results.push({
            entry,
            score: Math.round(score * 1000) / 1000,
            matchType: 'vector',
          });
        }
      }

      log.debug('Vector search completed', {
        query: query.slice(0, 50),
        candidates: entriesWithEmbeddings.length,
        results: results.length,
        agentId,
      });

      return results;
    } catch (error) {
      log.warn('Vector search failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find similar entries to a given entry
   */
  async findSimilar(
    entryId: string,
    options: VectorSearchOptions = {}
  ): Promise<MemorySearchResult[]> {
    const entry = this.store.getById(entryId);
    if (!entry || !entry.embedding) {
      return [];
    }

    const { namespace, limit = 10, threshold = 0.7 } = options;
    const queryEmbedding = Array.from(entry.embedding);

    // Get all entries with embeddings
    const entriesWithEmbeddings = this.store.getEntriesWithEmbeddings(namespace);

    // Calculate similarities (excluding the source entry)
    const scored: Array<{ id: string; score: number }> = [];

    for (const { id, embedding } of entriesWithEmbeddings) {
      if (id === entryId) continue;

      const score = cosineSimilarity(queryEmbedding, embedding);
      if (score >= threshold) {
        scored.push({ id, score });
      }
    }

    // Sort and return top results
    scored.sort((a, b) => b.score - a.score);
    const topResults = scored.slice(0, limit);

    const results: MemorySearchResult[] = [];
    for (const { id, score } of topResults) {
      const foundEntry = this.store.getById(id);
      if (foundEntry) {
        results.push({
          entry: foundEntry,
          score: Math.round(score * 1000) / 1000,
          matchType: 'vector',
        });
      }
    }

    return results;
  }

  /**
   * Get statistics about indexed entries
   */
  getStats(namespace?: string): { total: number; indexed: number; coverage: number } {
    const total = this.store.count(namespace);
    const entriesWithEmbeddings = this.store.getEntriesWithEmbeddings(namespace);
    const indexed = entriesWithEmbeddings.length;
    const coverage = total > 0 ? Math.round((indexed / total) * 100) : 0;

    return { total, indexed, coverage };
  }
}
