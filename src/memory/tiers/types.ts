/**
 * Hierarchical memory tier types (AIG-651).
 *
 * aistack memory is organized in three tiers inspired by MemGPT / Letta's
 * OS-style memory hierarchy:
 *
 *   working  -> hot, in-context, small fixed budget (token-bounded)
 *   recall   -> warm, SQLite FTS5 + vector index (current default backend)
 *   archival -> cold, compressed, optional LLM-generated summary
 *
 * The TierManager (src/memory/tiers/tier-manager.ts) owns explicit
 * promote/demote operations; the AutoPager (src/memory/tiers/auto-pager.ts)
 * applies the configured PagingPolicy on a background interval.
 *
 * This module is purely additive over the existing MemoryManager and
 * SQLiteStore — no behavior of the existing memory module is changed.
 */

/**
 * Memory tiers, ordered from hottest to coldest.
 */
export type MemoryTier = 'working' | 'recall' | 'archival';

export const ALL_TIERS: readonly MemoryTier[] = ['working', 'recall', 'archival'] as const;

/**
 * Numeric ranking used to compare tiers (0 = hottest).
 */
export const TIER_RANK: Record<MemoryTier, number> = {
  working: 0,
  recall: 1,
  archival: 2,
};

/**
 * Static configuration for a single tier.
 */
export interface TierConfig {
  /** Maximum number of entries allowed in this tier. `null` means unbounded. */
  maxEntries: number | null;
  /**
   * Maximum age (in milliseconds) an entry may stay in this tier before
   * becoming eligible for demotion to the next tier. `null` means no age cap.
   */
  maxAgeMs: number | null;
}

/**
 * Policy applied by the AutoPager when deciding what to move where.
 */
export interface PagingPolicy {
  /** Default per-tier sizing/age constraints. */
  tiers: Record<MemoryTier, TierConfig>;
  /**
   * When a recall entry's access_count exceeds this and it was accessed within
   * `recentAccessWindowMs`, the AutoPager promotes it into working.
   */
  promoteToWorkingMinAccessCount: number;
  /** Window (ms) for "recently accessed" used in promotion decisions. */
  recentAccessWindowMs: number;
  /** When true, the AutoPager generates an LLM summary on archival. */
  archivalSummarize: boolean;
}

/**
 * Snapshot of tier sizes returned by TierManager.getStats().
 */
export interface TierStats {
  working: number;
  recall: number;
  archival: number;
  total: number;
}

/**
 * Result of a single AutoPager pass — useful for tests and observability.
 */
export interface PagingRunResult {
  promotedToWorking: number;
  demotedToRecall: number;
  demotedToArchival: number;
  scanned: number;
  durationMs: number;
}

/**
 * Default policy. Conservative numbers chosen so the working set fits comfortably
 * in a Claude system prompt (~4k tokens, assuming ~80 tokens/entry on average).
 *
 * Tunable via `memory.tiering` in aistack.config.json — see src/utils/config.ts.
 */
export const DEFAULT_PAGING_POLICY: PagingPolicy = {
  tiers: {
    working: { maxEntries: 50, maxAgeMs: null },
    // Default recall ceiling matches what a single project typically accumulates
    // over a few weeks of active use; raise it for long-lived workspaces.
    recall: { maxEntries: 5000, maxAgeMs: 30 * 24 * 60 * 60 * 1000 /* 30 days */ },
    archival: { maxEntries: null, maxAgeMs: null },
  },
  promoteToWorkingMinAccessCount: 3,
  recentAccessWindowMs: 24 * 60 * 60 * 1000 /* 24 hours */,
  archivalSummarize: false,
};

/**
 * Static configuration consumed by AutoPager. Pulled from AgentStackConfig at
 * factory time so consumers don't have to reconstruct the policy themselves.
 */
export interface AutoPagerOptions {
  /** Run the paging job every N ms. Set to 0 to disable scheduling. */
  intervalMs: number;
  /** Maximum entries to consider per pass (caps DB scan cost). */
  batchSize: number;
  /** Policy applied when promoting/demoting. */
  policy: PagingPolicy;
}

export const DEFAULT_AUTO_PAGER_OPTIONS: AutoPagerOptions = {
  intervalMs: 5 * 60 * 1000 /* 5 minutes */,
  batchSize: 500,
  policy: DEFAULT_PAGING_POLICY,
};
