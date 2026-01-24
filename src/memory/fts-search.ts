/**
 * Full-text search using SQLite FTS5
 */

import type Database from 'better-sqlite3';
import type { MemoryEntry, MemorySearchResult } from '../types.js';

export interface FTSSearchOptions {
  namespace?: string;
  limit?: number;
  highlightStart?: string;
  highlightEnd?: string;
}

interface FTSRow {
  id: string;
  key: string;
  namespace: string;
  content: string;
  embedding: Buffer | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
  rank: number;
  snippet: string;
}

export class FTSSearch {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Search memory using FTS5 full-text search
   */
  search(query: string, options: FTSSearchOptions = {}): MemorySearchResult[] {
    const {
      namespace,
      limit = 10,
      highlightStart = '<b>',
      highlightEnd = '</b>',
    } = options;

    // Escape FTS5 special characters in query
    const escapedQuery = this.escapeFTSQuery(query);

    let sql = `
      SELECT
        m.id, m.key, m.namespace, m.content, m.embedding, m.metadata,
        m.created_at, m.updated_at,
        bm25(memory_fts) as rank,
        snippet(memory_fts, 1, ?, ?, '...', 32) as snippet
      FROM memory_fts fts
      JOIN memory m ON m.rowid = fts.rowid
      WHERE memory_fts MATCH ?
    `;

    const params: (string | number)[] = [highlightStart, highlightEnd, escapedQuery];

    if (namespace) {
      sql += ' AND m.namespace = ?';
      params.push(namespace);
    }

    sql += ' ORDER BY rank LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as FTSRow[];

    return rows.map(row => ({
      entry: this.rowToEntry(row),
      score: this.normalizeScore(row.rank),
      matchType: 'fts' as const,
    }));
  }

  /**
   * Search with phrase matching (exact phrase)
   */
  phraseSearch(phrase: string, options: FTSSearchOptions = {}): MemorySearchResult[] {
    // Wrap in quotes for exact phrase match
    const query = `"${phrase.replace(/"/g, '""')}"`;
    return this.search(query, options);
  }

  /**
   * Search with prefix matching (autocomplete)
   */
  prefixSearch(prefix: string, options: FTSSearchOptions = {}): MemorySearchResult[] {
    // Add * for prefix matching
    const query = prefix
      .split(/\s+/)
      .filter(term => term.length > 0)
      .map(term => `${term}*`)
      .join(' ');
    return this.search(query, options);
  }

  /**
   * Check if a term exists in the index
   */
  termExists(term: string, namespace?: string): boolean {
    let sql = `
      SELECT 1 FROM memory_fts fts
      JOIN memory m ON m.rowid = fts.rowid
      WHERE memory_fts MATCH ?
    `;
    const params: string[] = [this.escapeFTSQuery(term)];

    if (namespace) {
      sql += ' AND m.namespace = ?';
      params.push(namespace);
    }

    sql += ' LIMIT 1';

    const result = this.db.prepare(sql).get(...params);
    return result !== undefined;
  }

  /**
   * Get suggestions based on existing content
   */
  suggest(partial: string, limit: number = 5): string[] {
    const results = this.prefixSearch(partial, { limit });
    const suggestions = new Set<string>();

    for (const result of results) {
      // Extract matching terms from content
      const words = result.entry.content.toLowerCase().split(/\s+/);
      for (const word of words) {
        if (word.startsWith(partial.toLowerCase()) && word.length > partial.length) {
          suggestions.add(word);
          if (suggestions.size >= limit) break;
        }
      }
      if (suggestions.size >= limit) break;
    }

    return Array.from(suggestions);
  }

  /**
   * Escape special FTS5 characters in query
   */
  private escapeFTSQuery(query: string): string {
    // FTS5 special characters: " - ^ * ( ) { } [ ] | : AND OR NOT NEAR
    // We want to allow basic search, so we escape problematic characters
    return query
      .replace(/"/g, '""')     // Escape double quotes
      .replace(/[(){}[\]|:^]/g, ' ') // Replace special chars with spaces
      .replace(/\s+/g, ' ')    // Normalize whitespace
      .trim();
  }

  /**
   * Normalize BM25 score to 0-1 range
   * BM25 returns negative values where more negative = better match
   */
  private normalizeScore(bm25Score: number): number {
    // Convert BM25 to a positive score
    // BM25 values typically range from -25 to 0 for good matches
    const normalized = Math.min(1, Math.max(0, 1 + bm25Score / 25));
    return Math.round(normalized * 1000) / 1000; // Round to 3 decimal places
  }

  private rowToEntry(row: FTSRow): MemoryEntry {
    return {
      id: row.id,
      key: row.key,
      namespace: row.namespace,
      content: row.content,
      embedding: row.embedding
        ? new Float32Array(row.embedding.buffer)
        : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
