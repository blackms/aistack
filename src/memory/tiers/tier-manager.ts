/**
 * TierManager — explicit promote/demote/touch operations for memory tiers.
 *
 * The TierManager is a thin facade over the SQLite `memory` table. It does NOT
 * own the schema (see migrations/009_memory_tiers.sql) and does NOT mutate
 * existing memory write paths (see src/memory/index.ts). Auto-paging lives in
 * src/memory/tiers/auto-pager.ts.
 *
 * Concurrency note (AIG-640 interplay): the Dreaming worker performs semantic
 * consolidation by writing NEW summary entries — it does not mutate the tier
 * column. The TierManager only reads/writes tier-related columns. The two
 * workers can run in parallel without coordination.
 */

import type Database from 'better-sqlite3';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { SQLiteStore } from '../sqlite-store.js';
import type { MemoryEntry } from '../../types.js';
import { logger } from '../../utils/logger.js';
import {
  ALL_TIERS,
  TIER_RANK,
  type MemoryTier,
  type TierStats,
} from './types.js';

const log = logger.child('memory.tiers');

/**
 * Idempotent runtime schema patch matching migrations/009_memory_tiers.sql.
 *
 * sqlite-store.ts's initSchema() only runs CREATE TABLE IF NOT EXISTS; the
 * project does not yet have an automatic migration runner (see
 * migrations/README.md "Future enhancement"). We apply the tier columns on
 * the live connection so the module works against any existing DB without
 * requiring the operator to run the .sql file manually.
 *
 * Each ALTER is wrapped in try/catch: SQLite raises
 * "duplicate column name" once the column already exists, which is the
 * expected steady-state on a previously-migrated DB.
 */
export function ensureTierSchema(db: Database.Database): void {
  const alters = [
    `ALTER TABLE memory ADD COLUMN tier TEXT NOT NULL DEFAULT 'recall'`,
    `ALTER TABLE memory ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE memory ADD COLUMN last_accessed_at INTEGER`,
    `ALTER TABLE memory ADD COLUMN summary TEXT`,
    `ALTER TABLE memory ADD COLUMN archived_content BLOB`,
  ];
  for (const stmt of alters) {
    try {
      db.exec(stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('duplicate column name')) {
        throw err;
      }
    }
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_tier ON memory(tier)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_last_accessed ON memory(last_accessed_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_tier_accessed ON memory(tier, last_accessed_at DESC)`);
}

interface TierRow {
  id: string;
  key: string;
  namespace: string;
  tier: string;
  access_count: number;
  last_accessed_at: number | null;
  summary: string | null;
  archived_content: Buffer | null;
}

/**
 * Hint passed to TierManager.demote() so callers can drive archival
 * compression without depending on TierManager internals.
 */
export interface DemoteOptions {
  /** Optional summary text stored alongside the archived payload. */
  summary?: string;
}

export class TierManager {
  private readonly db: Database.Database;

  constructor(private readonly store: SQLiteStore) {
    // @ts-expect-error - accessing private db handle is intentional here, same
    // pattern used by FTSSearch in src/memory/index.ts.
    this.db = store.db;
    ensureTierSchema(this.db);
  }

  // ==================== Read ====================

  /**
   * Return the current tier for a memory id. Returns null if id is unknown.
   */
  getTier(memoryId: string): MemoryTier | null {
    const row = this.db
      .prepare('SELECT tier FROM memory WHERE id = ?')
      .get(memoryId) as { tier: string } | undefined;
    if (!row) return null;
    return this.normalizeTier(row.tier);
  }

  /**
   * Return entries currently in the given tier, ordered by recency.
   */
  listByTier(tier: MemoryTier, limit = 100, offset = 0): MemoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, key, namespace, content, embedding, metadata, agent_id, created_at, updated_at
         FROM memory
         WHERE tier = ?
         ORDER BY COALESCE(last_accessed_at, updated_at) DESC
         LIMIT ? OFFSET ?`
      )
      .all(tier, limit, offset) as Array<{
      id: string;
      key: string;
      namespace: string;
      content: string;
      embedding: Buffer | null;
      metadata: string | null;
      agent_id: string | null;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      key: row.key,
      namespace: row.namespace,
      content: row.content,
      embedding: row.embedding ? new Float32Array(row.embedding.buffer) : undefined,
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined,
      agentId: row.agent_id ?? undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  /**
   * Snapshot of current tier sizes. Cheap — three COUNT queries on indexed col.
   */
  getStats(): TierStats {
    const counts = this.db
      .prepare(`SELECT tier, COUNT(*) as count FROM memory GROUP BY tier`)
      .all() as Array<{ tier: string; count: number }>;

    const stats: TierStats = { working: 0, recall: 0, archival: 0, total: 0 };
    for (const row of counts) {
      const t = this.normalizeTier(row.tier);
      stats[t] += row.count;
      stats.total += row.count;
    }
    return stats;
  }

  // ==================== Write ====================

  /**
   * Update access_count and last_accessed_at for a memory id. Best-effort:
   * if the id does not exist this is a no-op.
   *
   * Callers should invoke this on hot read/search paths to keep the AutoPager
   * informed. The existing MemoryManager does NOT call touch automatically to
   * keep this module fully opt-in (no behavior change for AIG-635 audit).
   */
  touch(memoryId: string): void {
    this.db
      .prepare(
        `UPDATE memory
         SET access_count = access_count + 1,
             last_accessed_at = ?
         WHERE id = ?`
      )
      .run(Date.now(), memoryId);
  }

  /**
   * Promote an entry to a hotter tier (lower TIER_RANK). If `toTier` is
   * omitted, promotes one step (archival -> recall, recall -> working).
   *
   * When promoting out of archival, the archived payload is restored into the
   * `content` column and `archived_content` is cleared.
   */
  promote(memoryId: string, toTier?: MemoryTier): MemoryTier | null {
    const row = this.loadTierRow(memoryId);
    if (!row) return null;

    const current = this.normalizeTier(row.tier);
    const target = toTier ?? this.nextHotterTier(current);
    if (!target) {
      log.debug('promote: already at hottest tier', { memoryId, current });
      return current;
    }
    if (TIER_RANK[target] >= TIER_RANK[current]) {
      throw new Error(
        `promote() requires a hotter tier than current; got ${target} (current ${current})`
      );
    }

    return this.applyTransition(row, current, target);
  }

  /**
   * Demote an entry to a colder tier (higher TIER_RANK). If `toTier` is
   * omitted, demotes one step (working -> recall, recall -> archival).
   *
   * When demoting INTO archival, the current `content` is gzipped into
   * `archived_content` and replaced with an optional summary (or a short
   * preview if no summary is provided).
   */
  demote(memoryId: string, toTier?: MemoryTier, options: DemoteOptions = {}): MemoryTier | null {
    const row = this.loadTierRow(memoryId);
    if (!row) return null;

    const current = this.normalizeTier(row.tier);
    const target = toTier ?? this.nextColderTier(current);
    if (!target) {
      log.debug('demote: already at coldest tier', { memoryId, current });
      return current;
    }
    if (TIER_RANK[target] <= TIER_RANK[current]) {
      throw new Error(
        `demote() requires a colder tier than current; got ${target} (current ${current})`
      );
    }

    return this.applyTransition(row, current, target, options.summary);
  }

  /**
   * Force-set an entry's tier without inferring direction. Used by tests and
   * the CLI's `aistack memory promote/demote --to <tier>` shortcut.
   */
  setTier(memoryId: string, tier: MemoryTier, options: DemoteOptions = {}): MemoryTier | null {
    const row = this.loadTierRow(memoryId);
    if (!row) return null;
    const current = this.normalizeTier(row.tier);
    if (current === tier) return current;
    return this.applyTransition(row, current, tier, options.summary);
  }

  // ==================== Internals ====================

  private applyTransition(
    row: TierRow,
    from: MemoryTier,
    to: MemoryTier,
    summary?: string
  ): MemoryTier {
    const now = Date.now();

    // Archival entrance: gzip current content into archived_content and replace
    // content with summary/preview so FTS/vector still has something to match.
    if (to === 'archival' && from !== 'archival') {
      const contentRow = this.db
        .prepare('SELECT content FROM memory WHERE id = ?')
        .get(row.id) as { content: string } | undefined;
      const content = contentRow?.content ?? '';
      const compressed = gzipSync(Buffer.from(content, 'utf-8'));
      const previewSource = summary ?? content;
      const preview = previewSource.length > 280 ? previewSource.slice(0, 277) + '...' : previewSource;

      this.db
        .prepare(
          `UPDATE memory
           SET tier = ?,
               archived_content = ?,
               summary = ?,
               content = ?,
               updated_at = ?
           WHERE id = ?`
        )
        .run(to, compressed, summary ?? null, preview, now, row.id);

      log.info('Memory entry archived', {
        memoryId: row.id,
        key: row.key,
        compressedBytes: compressed.length,
        originalBytes: content.length,
      });
      return to;
    }

    // Archival exit: restore the gzipped payload into content and clear blob.
    if (from === 'archival' && to !== 'archival' && row.archived_content) {
      const restored = gunzipSync(row.archived_content).toString('utf-8');
      this.db
        .prepare(
          `UPDATE memory
           SET tier = ?,
               content = ?,
               archived_content = NULL,
               summary = NULL,
               updated_at = ?
           WHERE id = ?`
        )
        .run(to, restored, now, row.id);

      log.info('Memory entry restored from archival', {
        memoryId: row.id,
        key: row.key,
        to,
      });
      return to;
    }

    // Plain working <-> recall transition: just update the tier column.
    this.db
      .prepare(`UPDATE memory SET tier = ?, updated_at = ? WHERE id = ?`)
      .run(to, now, row.id);

    log.debug('Memory tier transition', { memoryId: row.id, from, to });
    return to;
  }

  /**
   * Restore an archived entry's full content without changing its tier. Used
   * for read-on-demand of cold entries.
   */
  restoreContent(memoryId: string): string | null {
    const row = this.db
      .prepare('SELECT tier, content, archived_content FROM memory WHERE id = ?')
      .get(memoryId) as
      | { tier: string; content: string; archived_content: Buffer | null }
      | undefined;
    if (!row) return null;
    if (row.tier !== 'archival' || !row.archived_content) return row.content;
    return gunzipSync(row.archived_content).toString('utf-8');
  }

  private loadTierRow(memoryId: string): TierRow | null {
    const row = this.db
      .prepare(
        `SELECT id, key, namespace, tier, access_count, last_accessed_at, summary, archived_content
         FROM memory
         WHERE id = ?`
      )
      .get(memoryId) as TierRow | undefined;
    return row ?? null;
  }

  private normalizeTier(value: string): MemoryTier {
    if ((ALL_TIERS as readonly string[]).includes(value)) {
      return value as MemoryTier;
    }
    // Defensive: any unknown value (e.g. from corrupted row) falls back to recall.
    log.warn('Unknown tier value, falling back to recall', { value });
    return 'recall';
  }

  private nextHotterTier(current: MemoryTier): MemoryTier | null {
    const rank = TIER_RANK[current];
    if (rank === 0) return null;
    return ALL_TIERS[rank - 1] ?? null;
  }

  private nextColderTier(current: MemoryTier): MemoryTier | null {
    const rank = TIER_RANK[current];
    if (rank >= ALL_TIERS.length - 1) return null;
    return ALL_TIERS[rank + 1] ?? null;
  }
}
