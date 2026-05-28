/**
 * AutoPager — background worker that applies the configured PagingPolicy.
 *
 * The pager runs on a fixed interval (default: 5 minutes) and performs a
 * single bounded scan of the `memory` table per tick:
 *
 *   1. Promote: recall entries that look hot (access_count >= threshold AND
 *      last_accessed within recentAccessWindowMs) get promoted into working,
 *      respecting working tier's maxEntries cap.
 *   2. Demote working overflow: when working > maxEntries, the LRU tail is
 *      demoted to recall (selected by last_accessed_at ASC).
 *   3. Demote recall overflow / aged: recall entries older than maxAgeMs OR
 *      beyond maxEntries are demoted to archival (gzipped via TierManager).
 *
 * Each tick is bounded by `batchSize` to keep DB pressure predictable on
 * 10k+ memory stores (AC #5).
 */

import type Database from 'better-sqlite3';
import type { SQLiteStore } from '../sqlite-store.js';
import { TierManager } from './tier-manager.js';
import {
  DEFAULT_AUTO_PAGER_OPTIONS,
  type AutoPagerOptions,
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
      result.promotedToWorking = this.promoteHotRecall(result);
      result.demotedToRecall = this.demoteWorkingOverflow(result);
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
    const workingCap = workingCfg.maxEntries;

    // If working is already full and bounded, skip — demotion runs next.
    if (workingCap !== null) {
      const workingSize = this.countTier('working');
      if (workingSize >= workingCap) return 0;
    }

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
    const headroom = workingCap === null ? Number.MAX_SAFE_INTEGER : workingCap - this.countTier('working');
    for (const row of rows) {
      if (promoted >= headroom) break;
      this.tierManager.setTier(row.id, 'working');
      promoted++;
    }
    result.scanned += rows.length;
    return promoted;
  }

  private demoteWorkingOverflow(result: PagingRunResult): number {
    const cap = this.options.policy.tiers.working.maxEntries;
    if (cap === null) return 0;
    const workingSize = this.countTier('working');
    if (workingSize <= cap) return 0;

    const overflow = workingSize - cap;
    const rows = this.db
      .prepare(
        `SELECT id, tier, access_count, last_accessed_at, updated_at, created_at
         FROM memory
         WHERE tier = 'working'
         ORDER BY COALESCE(last_accessed_at, updated_at) ASC
         LIMIT ?`
      )
      .all(Math.min(overflow, this.options.batchSize)) as CandidateRow[];

    let demoted = 0;
    for (const row of rows) {
      this.tierManager.setTier(row.id, 'recall');
      demoted++;
    }
    result.scanned += rows.length;
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

  private countTier(tier: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM memory WHERE tier = ?')
      .get(tier) as { count: number };
    return row.count;
  }

  /**
   * Expose policy for tests / introspection.
   */
  getPolicy(): PagingPolicy {
    return this.options.policy;
  }
}
