/**
 * AutoPager — background worker that applies the configured PagingPolicy.
 *
 * The pager runs on a fixed interval (default: 5 minutes) and performs a
 * single bounded scan of the `memory` table per tick. Step ordering is
 * deliberate so a full working tier never blocks promotion of newly-hot
 * recall entries:
 *
 *   1. Demote working overflow first — when working > maxEntries OR working
 *      tokens > maxTokens, the LRU tail is demoted to recall (selected by
 *      last_accessed_at ASC). This frees headroom for step 2.
 *   2. Promote: recall entries that look hot (access_count >= threshold AND
 *      last_accessed within recentAccessWindowMs) get promoted into working.
 *      For each candidate we *first* evict the working LRU if needed so the
 *      promotion never silently no-ops on a full working tier.
 *   3. Demote recall overflow / aged: recall entries older than maxAgeMs OR
 *      beyond maxEntries are demoted to archival (gzipped via TierManager).
 *
 * Each tick is bounded by `batchSize` to keep DB pressure predictable on
 * 10k+ memory stores (AC #5).
 */

import type Database from 'better-sqlite3';
import type { SQLiteStore } from '../sqlite-store.js';
import { TierManager, TierBudgetExceededError } from './tier-manager.js';
import {
  ALL_TIERS,
  DEFAULT_AUTO_PAGER_OPTIONS,
  type AutoPagerOptions,
  type MemoryTier,
  type PagingPolicy,
  type PagingRunResult,
} from './types.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('memory.auto-pager');

interface CandidateRow {
  id: string;
  tier: string;
  access_count: number;
  last_accessed_at: number | null;
  updated_at: number;
  created_at: number;
}

export class AutoPager {
  private readonly db: Database.Database;
  private readonly tierManager: TierManager;
  private readonly options: AutoPagerOptions;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    store: SQLiteStore,
    options: Partial<AutoPagerOptions> = {},
    tierManager?: TierManager
  ) {
    // @ts-expect-error - same pattern used elsewhere in the memory module.
    this.db = store.db;
    this.tierManager = tierManager ?? new TierManager(store);
    this.options = {
      ...DEFAULT_AUTO_PAGER_OPTIONS,
      ...options,
      policy: {
        ...DEFAULT_AUTO_PAGER_OPTIONS.policy,
        ...(options.policy ?? {}),
        tiers: {
          ...DEFAULT_AUTO_PAGER_OPTIONS.policy.tiers,
          ...((options.policy?.tiers ?? {}) as PagingPolicy['tiers']),
        },
      },
    };

    // Push per-tier token caps into the TierManager so direct
    // promote()/setTier() calls share the same enforcement as the pager.
    for (const t of ALL_TIERS) {
      const cap = this.options.policy.tiers[t]?.maxTokens ?? null;
      this.tierManager.setTokenBudget(t, cap);
    }
  }

  /**
   * Start the periodic background job. Safe to call multiple times.
   */
  start(): void {
    if (this.timer || this.options.intervalMs <= 0) return;
    this.timer = setInterval(() => {
      this.runOnce().catch(err => {
        log.error('AutoPager tick failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.options.intervalMs);
    // Allow Node to exit even if the timer is pending.
    if (typeof this.timer.unref === 'function') this.timer.unref();
    log.info('AutoPager started', { intervalMs: this.options.intervalMs });
  }

  /**
   * Stop the periodic job. Safe to call when not started.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info('AutoPager stopped');
    }
  }

  /**
   * Run a single paging pass synchronously. Returns a summary so callers
   * (and tests) can assert how many entries moved tiers.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async runOnce(): Promise<PagingRunResult> {
    if (this.running) {
      log.debug('AutoPager already running, skipping tick');
      return { promotedToWorking: 0, demotedToRecall: 0, demotedToArchival: 0, scanned: 0, durationMs: 0 };
    }
    this.running = true;
    const start = Date.now();
    const result: PagingRunResult = {
      promotedToWorking: 0,
      demotedToRecall: 0,
      demotedToArchival: 0,
      scanned: 0,
      durationMs: 0,
    };

    try {
      // Demote-first ordering: free working headroom *before* promoting so a
      // saturated working tier doesn't silently swallow promotions.
      result.demotedToRecall = this.demoteWorkingOverflow(result);
      result.promotedToWorking = this.promoteHotRecall(result);
      result.demotedToArchival = this.demoteRecallOverflowAndAged(result);
    } finally {
      this.running = false;
      result.durationMs = Date.now() - start;
      log.debug('AutoPager tick complete', result);
    }
    return result;
  }

  // ==================== Steps ====================

  private promoteHotRecall(result: PagingRunResult): number {
    const policy = this.options.policy;
    const workingCfg = policy.tiers.working;

    const now = Date.now();
    const since = now - policy.recentAccessWindowMs;

    const rows = this.db
      .prepare(
        `SELECT id, tier, access_count, last_accessed_at, updated_at, created_at
         FROM memory
         WHERE tier = 'recall'
           AND access_count >= ?
           AND last_accessed_at IS NOT NULL
           AND last_accessed_at >= ?
         ORDER BY access_count DESC, last_accessed_at DESC
         LIMIT ?`
      )
      .all(
        policy.promoteToWorkingMinAccessCount,
        since,
        this.options.batchSize
      ) as CandidateRow[];

    let promoted = 0;
    for (const row of rows) {
      // For each candidate, try promoting. If the working tier is full
      // (by entries or by token budget) evict the LRU tail of working to
      // make room — this is the "swap" behavior the previous skip-on-full
      // implementation was missing.
      if (!this.makeWorkingRoomFor(row.id, workingCfg.maxEntries, workingCfg.maxTokens)) {
        // Couldn't free enough room (e.g. budget too small for this single
        // entry). Skip this candidate; the next one might still fit.
        continue;
      }
      try {
        this.tierManager.setTier(row.id, 'working');
        promoted++;
      } catch (err) {
        if (err instanceof TierBudgetExceededError) {
          // makeWorkingRoomFor said yes but a concurrent writer changed the
          // landscape — give up on this candidate, the next tick will retry.
          log.debug('Promotion lost a race with concurrent writer', { id: row.id });
          continue;
        }
        throw err;
      }
    }
    result.scanned += rows.length;
    return promoted;
  }

  /**
   * Ensure working has room for one more `incomingId`-sized entry. Evicts
   * LRU working rows to recall until both the entry-count cap AND the
   * token-budget cap have headroom for the incoming row.
   *
   * Returns false if the entry alone exceeds the absolute token budget
   * (in which case promotion is impossible regardless of evictions).
   */
  private makeWorkingRoomFor(
    incomingId: string,
    maxEntries: number | null,
    maxTokens: number | null
  ): boolean {
    // No caps -> always fits.
    if (maxEntries === null && maxTokens === null) return true;

    // Pre-flight: does the incoming row by itself exceed the absolute budget?
    if (maxTokens !== null) {
      const tokens = this.estimateRowTokens(incomingId);
      if (tokens > maxTokens) {
        log.warn('Skipping promotion: entry alone exceeds working token budget', {
          id: incomingId,
          tokens,
          maxTokens,
        });
        return false;
      }
    }

    // Iteratively evict LRU until both caps have room. The incoming row's
    // token estimate is invariant across iterations so cache it.
    const incomingTokens = maxTokens !== null ? this.estimateRowTokens(incomingId) : 0;
    let evictions = 0;
    while (evictions < this.options.batchSize) {
      const overflowsEntries =
        maxEntries !== null && this.countTier('working') + 1 > maxEntries;
      const overflowsTokens =
        maxTokens !== null &&
        this.tierManager.getTierTokens('working') + incomingTokens > maxTokens;
      if (!overflowsEntries && !overflowsTokens) return true;

      const victim = this.db
        .prepare(
          `SELECT id FROM memory
           WHERE tier = 'working'
           ORDER BY COALESCE(last_accessed_at, updated_at) ASC
           LIMIT 1`
        )
        .get() as { id: string } | undefined;
      if (!victim) return true; // working empty -> trivially has room
      this.tierManager.setTier(victim.id, 'recall');
      evictions++;
    }
    return false;
  }

  private demoteWorkingOverflow(result: PagingRunResult): number {
    const cfg = this.options.policy.tiers.working;
    const entryCap = cfg.maxEntries;
    const tokenCap = cfg.maxTokens;
    if (entryCap === null && tokenCap === null) return 0;

    let demoted = 0;

    // Pull a candidate LRU page once — repeat the check after each eviction
    // so we stop as soon as either cap is satisfied.
    const candidates = this.db
      .prepare(
        `SELECT id, tier, access_count, last_accessed_at, updated_at, created_at
         FROM memory
         WHERE tier = 'working'
         ORDER BY COALESCE(last_accessed_at, updated_at) ASC
         LIMIT ?`
      )
      .all(this.options.batchSize) as CandidateRow[];
    result.scanned += candidates.length;

    for (const row of candidates) {
      const overflowsEntries = entryCap !== null && this.countTier('working') > entryCap;
      const overflowsTokens =
        tokenCap !== null && this.tierManager.getTierTokens('working') > tokenCap;
      if (!overflowsEntries && !overflowsTokens) break;
      this.tierManager.setTier(row.id, 'recall');
      demoted++;
    }
    return demoted;
  }

  private demoteRecallOverflowAndAged(result: PagingRunResult): number {
    const recallCfg = this.options.policy.tiers.recall;
    const now = Date.now();
    const ageCutoff =
      recallCfg.maxAgeMs !== null && recallCfg.maxAgeMs > 0
        ? now - recallCfg.maxAgeMs
        : null;
    const sizeCap = recallCfg.maxEntries;

    let demoted = 0;

    // 1) Age-based archival: any recall entry older than ageCutoff with no
    //    recent access falls into archival.
    if (ageCutoff !== null) {
      const aged = this.db
        .prepare(
          `SELECT id, tier, access_count, last_accessed_at, updated_at, created_at
           FROM memory
           WHERE tier = 'recall'
             AND COALESCE(last_accessed_at, updated_at) < ?
           ORDER BY COALESCE(last_accessed_at, updated_at) ASC
           LIMIT ?`
        )
        .all(ageCutoff, this.options.batchSize) as CandidateRow[];

      for (const row of aged) {
        this.tierManager.setTier(row.id, 'archival');
        demoted++;
      }
      result.scanned += aged.length;
    }

    // 2) Size-based archival: if recall still over cap, demote LRU tail.
    if (sizeCap !== null) {
      const recallSize = this.countTier('recall');
      if (recallSize > sizeCap) {
        const overflow = recallSize - sizeCap;
        const tail = this.db
          .prepare(
            `SELECT id, tier, access_count, last_accessed_at, updated_at, created_at
             FROM memory
             WHERE tier = 'recall'
             ORDER BY COALESCE(last_accessed_at, updated_at) ASC
             LIMIT ?`
          )
          .all(Math.min(overflow, this.options.batchSize)) as CandidateRow[];

        for (const row of tail) {
          this.tierManager.setTier(row.id, 'archival');
          demoted++;
        }
        result.scanned += tail.length;
      }
    }

    return demoted;
  }

  // ==================== Helpers ====================

  private countTier(tier: MemoryTier): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM memory WHERE tier = ?')
      .get(tier) as { count: number };
    return row.count;
  }

  private estimateRowTokens(id: string): number {
    const row = this.db
      .prepare('SELECT tier, content, archived_content FROM memory WHERE id = ?')
      .get(id) as { tier: string; content: string; archived_content: Buffer | null } | undefined;
    if (!row) return 0;
    // For archived rows, use the restored payload length so the working-tier
    // budget reflects what an end-user would see after promotion.
    const content =
      row.tier === 'archival' && row.archived_content
        ? row.archived_content.length * 3 /* conservative gzip ratio */
        : row.content?.length ?? 0;
    return Math.ceil(content / 4);
  }

  /**
   * Expose policy for tests / introspection.
   */
  getPolicy(): PagingPolicy {
    return this.options.policy;
  }
}
