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
 *
 * The `tier` column carries the same CHECK constraint as migration 009 so a
 * DB initialized through this code path enforces the same domain invariant
 * as one migrated via the SQL file. SQLite stores the CHECK in the table
 * schema and validates on INSERT/UPDATE.
 */
export function ensureTierSchema(db: Database.Database): void {
  const alters = [
    `ALTER TABLE memory ADD COLUMN tier TEXT NOT NULL DEFAULT 'recall' CHECK (tier IN ('working', 'recall', 'archival'))`,
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

/**
 * Scope filters for read-side tier APIs so callers (CLI, MemoryManager,
 * AutoPager) can apply the same tenant/workspace boundaries enforced
 * elsewhere in the memory module (see src/memory/access-control.ts and
 * SQLiteStore.list()).
 */
export interface TierScope {
  /** Restrict to a single namespace (typically session:<id> or tenant). */
  namespace?: string;
  /** Restrict to an agent's private rows. */
  agentId?: string;
  /**
   * When `agentId` is set, also include shared (NULL agent_id) rows.
   * Defaults to true to match SQLiteStore.list() default.
   */
  includeShared?: boolean;
}

/**
 * Token-budget estimation used by the working tier cap.
 *
 * No tokenizer is bundled with aistack today (see package.json — no
 * tiktoken / gpt-tokenizer). We use a tokenizer-free heuristic that is
 * conservative for English / code-mixed payloads:
 *
 *   est = max(words * 1.3, chars / 4)
 *
 * The two metrics bracket short-but-symbol-heavy content (chars/4 dominates)
 * and long natural-language content (words*1.3 dominates). The function is
 * exported so tests and the AutoPager can call it with the same definition.
 */
export function estimateTokens(content: string): number {
  if (!content) return 0;
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  const wordEstimate = Math.ceil(words * 1.3);
  const charEstimate = Math.ceil(content.length / 4);
  return Math.max(wordEstimate, charEstimate);
}

/**
 * Raised by promote/setTier when a transition into a token-capped tier
 * would push that tier over its `maxTokens` budget. Callers should either
 * evict LRU first (see AutoPager.runOnce step ordering) or pass an explicit
 * tier downgrade.
 */
export class TierBudgetExceededError extends Error {
  readonly tier: MemoryTier;
  readonly budget: number;
  readonly currentTokens: number;
  readonly incomingTokens: number;

  constructor(tier: MemoryTier, budget: number, currentTokens: number, incomingTokens: number) {
    super(
      `Promotion to ${tier} rejected: ${currentTokens} + ${incomingTokens} = ${
        currentTokens + incomingTokens
      } tokens would exceed budget ${budget}`
    );
    this.name = 'TierBudgetExceededError';
    this.tier = tier;
    this.budget = budget;
    this.currentTokens = currentTokens;
    this.incomingTokens = incomingTokens;
  }
}

export class TierManager {
  private readonly db: Database.Database;
  /**
   * Per-tier token budgets. Only set for tiers with a `maxTokens` cap.
   * Configured by AutoPager/createTierStack via setTokenBudget(); when unset
   * the TierManager performs no token-cap enforcement (preserves opt-in
   * behavior for callers that construct TierManager directly).
   */
  private readonly tokenBudgets: Partial<Record<MemoryTier, number>> = {};

  constructor(private readonly store: SQLiteStore) {
    // @ts-expect-error - accessing private db handle is intentional here, same
    // pattern used by FTSSearch in src/memory/index.ts.
    this.db = store.db;
    ensureTierSchema(this.db);
  }

  /**
   * Configure a token cap for a tier. Pass null to clear. Called by the
   * AutoPager factory so the policy.tiers.<t>.maxTokens value is enforced
   * on direct promote() / setTier() calls as well as the background pass.
   */
  setTokenBudget(tier: MemoryTier, budget: number | null): void {
    if (budget === null) {
      delete this.tokenBudgets[tier];
    } else {
      this.tokenBudgets[tier] = budget;
    }
  }

  getTokenBudget(tier: MemoryTier): number | null {
    return this.tokenBudgets[tier] ?? null;
  }

  /**
   * Sum of estimateTokens(content) across all rows currently in `tier`.
   * Cheap COUNT-style query — runs over indexed `tier` column.
   */
  getTierTokens(tier: MemoryTier, scope?: TierScope): number {
    const { sql, params } = this.buildTierFilter(tier, scope);
    const rows = this.db.prepare(`SELECT content FROM memory ${sql}`).all(...params) as Array<{
      content: string;
    }>;
    let total = 0;
    for (const r of rows) total += estimateTokens(r.content);
    return total;
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
   *
   * Honors the same tenant/agent scope filters as SQLiteStore.list() so
   * tier listings cannot bypass access control. Callers that hold a
   * MemoryAccessContext (see src/memory/access-control.ts) should pass the
   * scoped namespace explicitly.
   */
  listByTier(tier: MemoryTier, limit = 100, offset = 0, scope?: TierScope): MemoryEntry[] {
    const { sql, params } = this.buildTierFilter(tier, scope);
    const rows = this.db
      .prepare(
        `SELECT id, key, namespace, content, embedding, metadata, agent_id, created_at, updated_at
         FROM memory
         ${sql}
         ORDER BY COALESCE(last_accessed_at, updated_at) DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Array<{
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
   * Wired into MemoryManager.get / getById / search so reads keep the
   * AutoPager promotion heuristic informed (AIG-651 fix). Safe to call on
   * non-existent ids — UPDATE...WHERE id = ? is a no-op then.
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
   *
   * If the target tier has a token budget and the promotion would exceed it,
   * throws TierBudgetExceededError without mutating any row. The AutoPager
   * handles this by evicting LRU from the target first then retrying.
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

    this.enforceTokenBudget(target, row.id);
    return this.applyTransition(row.id, current, target);
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

    return this.applyTransition(row.id, current, target, options.summary);
  }

  /**
   * Force-set an entry's tier without inferring direction. Used by tests and
   * the CLI's `aistack memory promote/demote --to <tier>` shortcut.
   *
   * Enforces token budget when moving INTO a budgeted tier (matches promote()).
   */
  setTier(memoryId: string, tier: MemoryTier, options: DemoteOptions = {}): MemoryTier | null {
    const row = this.loadTierRow(memoryId);
    if (!row) return null;
    const current = this.normalizeTier(row.tier);
    if (current === tier) return current;
    if (TIER_RANK[tier] < TIER_RANK[current]) {
      this.enforceTokenBudget(tier, row.id);
    }
    return this.applyTransition(row.id, current, tier, options.summary);
  }

  // ==================== Internals ====================

  /**
   * Enforce per-tier token budget. Throws TierBudgetExceededError if adding
   * the incoming row's tokens to the current tier total would exceed the cap.
   * No-op when the tier has no configured budget.
   */
  private enforceTokenBudget(target: MemoryTier, incomingId: string): void {
    const budget = this.tokenBudgets[target];
    if (budget == null) return;

    // Estimate incoming row's tokens. For archived rows we count the restored
    // payload size since that's what will live in working memory.
    const row = this.db
      .prepare(
        'SELECT tier, content, archived_content FROM memory WHERE id = ?'
      )
      .get(incomingId) as
      | { tier: string; content: string; archived_content: Buffer | null }
      | undefined;
    if (!row) return;

    const incomingContent =
      row.tier === 'archival' && row.archived_content
        ? gunzipSync(row.archived_content).toString('utf-8')
        : row.content;
    const incoming = estimateTokens(incomingContent);

    const current = this.getTierTokens(target);
    if (current + incoming > budget) {
      throw new TierBudgetExceededError(target, budget, current, incoming);
    }
  }

  /**
   * Atomic tier transition. Wrapped in BEGIN IMMEDIATE / COMMIT so:
   *   - the archived_content read and the UPDATE that consumes it happen
   *     under the same write lock (closes the cold->hot data-loss race);
   *   - concurrent AutoPager ticks observe a consistent snapshot.
   *
   * better-sqlite3 is synchronous so the transaction holds no more than the
   * UPDATE round-trip.
   */
  private applyTransition(
    id: string,
    from: MemoryTier,
    to: MemoryTier,
    summary?: string
  ): MemoryTier {
    const now = Date.now();

    const txn = this.db.transaction(() => {
      // Re-read inside the transaction so concurrent writers can't slip a
      // mutation between the dispatch decision and the row update.
      const row = this.db
        .prepare(
          'SELECT tier, content, archived_content FROM memory WHERE id = ?'
        )
        .get(id) as
        | { tier: string; content: string; archived_content: Buffer | null }
        | undefined;
      if (!row) return;

      // Archival entrance: gzip current content into archived_content and
      // replace content with summary/preview so FTS/vector still has
      // something to match.
      if (to === 'archival' && from !== 'archival') {
        const content = row.content ?? '';
        const compressed = gzipSync(Buffer.from(content, 'utf-8'));
        const previewSource = summary ?? content;
        const preview =
          previewSource.length > 280 ? previewSource.slice(0, 277) + '...' : previewSource;

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
          .run(to, compressed, summary ?? null, preview, now, id);

        log.info('Memory entry archived', {
          memoryId: id,
          compressedBytes: compressed.length,
          originalBytes: content.length,
        });
        return;
      }

      // Archival exit: restore the gzipped payload into content and clear
      // blob. Reading archived_content here (rather than at dispatch time)
      // means we can't lose data to a concurrent writer that flipped the
      // tier out from under us — if archived_content is now null we fall
      // back to the current content column.
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
          .run(to, restored, now, id);

        log.info('Memory entry restored from archival', { memoryId: id, to });
        return;
      }

      // Plain working <-> recall transition: just update the tier column.
      this.db
        .prepare(`UPDATE memory SET tier = ?, updated_at = ? WHERE id = ?`)
        .run(to, now, id);

      log.debug('Memory tier transition', { memoryId: id, from, to });
    });

    // better-sqlite3 supports per-transaction defaults; immediate lock matches
    // the requirement to serialize the read+write atomically.
    txn.immediate();
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

  /**
   * Build a WHERE clause filtering on tier + optional namespace/agentId scope.
   * Centralized so listByTier and getTierTokens share the same scoping rules.
   */
  private buildTierFilter(
    tier: MemoryTier,
    scope?: TierScope
  ): { sql: string; params: (string | number)[] } {
    const params: (string | number)[] = [tier];
    let sql = 'WHERE tier = ?';

    if (scope?.namespace) {
      sql += ' AND namespace = ?';
      params.push(scope.namespace);
    }
    if (scope?.agentId) {
      const includeShared = scope.includeShared ?? true;
      if (includeShared) {
        sql += ' AND (agent_id = ? OR agent_id IS NULL)';
      } else {
        sql += ' AND agent_id = ?';
      }
      params.push(scope.agentId);
    }
    return { sql, params };
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
