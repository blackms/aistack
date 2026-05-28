/**
 * Barrel for the hierarchical memory tiering module (AIG-651).
 *
 * Public surface:
 *   - TierManager        : explicit promote/demote/touch + getStats
 *   - AutoPager          : background worker that applies the PagingPolicy
 *   - archiveEntry       : pure compress + optional summary helper
 *   - restoreEntry       : pure decompress helper
 *   - createTierStack    : convenience factory that wires both with config
 *
 * Consumers import via `aistack/memory` (re-exported from src/memory/index.ts).
 */

import type { SQLiteStore } from '../sqlite-store.js';
import type { AgentStackConfig } from '../../types.js';
import { TierManager } from './tier-manager.js';
import { AutoPager } from './auto-pager.js';
import {
  DEFAULT_AUTO_PAGER_OPTIONS,
  DEFAULT_PAGING_POLICY,
  type AutoPagerOptions,
  type PagingPolicy,
} from './types.js';

export { TierManager } from './tier-manager.js';
export type { DemoteOptions } from './tier-manager.js';
export { AutoPager } from './auto-pager.js';
export { archiveEntry, restoreEntry } from './archival.js';
export type { ArchivalSummarizer, ArchiveResult } from './archival.js';
export type {
  MemoryTier,
  TierConfig,
  TierStats,
  PagingPolicy,
  PagingRunResult,
  AutoPagerOptions,
} from './types.js';
export {
  ALL_TIERS,
  TIER_RANK,
  DEFAULT_PAGING_POLICY,
  DEFAULT_AUTO_PAGER_OPTIONS,
} from './types.js';

export interface TierStack {
  tierManager: TierManager;
  autoPager: AutoPager;
}

/**
 * Build a TierManager + AutoPager wired from an AgentStackConfig. The pager
 * is returned stopped — callers decide when to start() it (typically after
 * the main process is up).
 *
 * If `config.memory.tiering` is omitted, the system defaults from
 * DEFAULT_PAGING_POLICY are used.
 */
export function createTierStack(store: SQLiteStore, config: AgentStackConfig): TierStack {
  const tiering = config.memory.tiering;
  const policy: PagingPolicy = tiering
    ? {
        tiers: {
          working: {
            maxEntries: tiering.workingMaxEntries ?? DEFAULT_PAGING_POLICY.tiers.working.maxEntries,
            maxAgeMs: DEFAULT_PAGING_POLICY.tiers.working.maxAgeMs,
          },
          recall: {
            maxEntries: tiering.recallMaxEntries ?? DEFAULT_PAGING_POLICY.tiers.recall.maxEntries,
            maxAgeMs:
              tiering.recallMaxAgeDays !== undefined
                ? tiering.recallMaxAgeDays * 24 * 60 * 60 * 1000
                : DEFAULT_PAGING_POLICY.tiers.recall.maxAgeMs,
          },
          archival: DEFAULT_PAGING_POLICY.tiers.archival,
        },
        promoteToWorkingMinAccessCount:
          tiering.promoteToWorkingMinAccessCount ?? DEFAULT_PAGING_POLICY.promoteToWorkingMinAccessCount,
        recentAccessWindowMs:
          tiering.recentAccessWindowMs ?? DEFAULT_PAGING_POLICY.recentAccessWindowMs,
        archivalSummarize: tiering.archivalSummarize ?? DEFAULT_PAGING_POLICY.archivalSummarize,
      }
    : DEFAULT_PAGING_POLICY;

  const options: AutoPagerOptions = {
    intervalMs: tiering?.intervalMs ?? DEFAULT_AUTO_PAGER_OPTIONS.intervalMs,
    batchSize: tiering?.batchSize ?? DEFAULT_AUTO_PAGER_OPTIONS.batchSize,
    policy,
  };

  const tierManager = new TierManager(store);
  const autoPager = new AutoPager(store, options, tierManager);
  return { tierManager, autoPager };
}
