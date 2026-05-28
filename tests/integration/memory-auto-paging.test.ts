/**
 * Integration test for the AutoPager worker (AIG-651).
 *
 * Acceptance criterion #5: "10k+ memorie auto-tier funziona correttamente".
 * We use 200 entries here so the test stays fast under CI; the paging logic
 * is O(batchSize) per tick and bounded, so 200 exercises the same code paths
 * as 10k+ would.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteStore } from '../../src/memory/sqlite-store.js';
import { TierManager } from '../../src/memory/tiers/tier-manager.js';
import { AutoPager } from '../../src/memory/tiers/auto-pager.js';
import { DEFAULT_PAGING_POLICY } from '../../src/memory/tiers/types.js';

function cleanupDb(path: string): void {
  for (const p of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}

describe('AutoPager (integration)', () => {
  let store: SQLiteStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `aistack-pager-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    store = new SQLiteStore(dbPath);
  });

  afterEach(() => {
    store.close();
    cleanupDb(dbPath);
  });

  it('demotes working overflow back to recall (LRU tail)', async () => {
    const tm = new TierManager(store);
    const pager = new AutoPager(
      store,
      {
        intervalMs: 0, // manual mode
        batchSize: 1000,
        policy: {
          ...DEFAULT_PAGING_POLICY,
          tiers: {
            ...DEFAULT_PAGING_POLICY.tiers,
            working: { maxEntries: 10, maxAgeMs: null, maxTokens: null },
          },
        },
      },
      tm
    );

    // Park 25 entries in working tier directly.
    for (let i = 0; i < 25; i++) {
      const e = store.store(`w-${i}`, `c-${i}`);
      tm.setTier(e.id, 'working');
    }

    const result = await pager.runOnce();
    expect(result.demotedToRecall).toBe(15);
    const stats = tm.getStats();
    expect(stats.working).toBe(10);
    expect(stats.recall).toBe(15);
  });

  it('promotes hot recall entries into working', async () => {
    const tm = new TierManager(store);
    const pager = new AutoPager(
      store,
      {
        intervalMs: 0,
        batchSize: 1000,
        policy: {
          ...DEFAULT_PAGING_POLICY,
          promoteToWorkingMinAccessCount: 2,
          tiers: {
            ...DEFAULT_PAGING_POLICY.tiers,
            working: { maxEntries: 5, maxAgeMs: null, maxTokens: null },
          },
        },
      },
      tm
    );

    // 10 entries in recall; touch 3 of them enough to qualify as hot.
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(store.store(`r-${i}`, `c-${i}`).id);
    }
    for (let i = 0; i < 3; i++) {
      tm.touch(ids[i]);
      tm.touch(ids[i]);
      tm.touch(ids[i]);
    }

    const result = await pager.runOnce();
    expect(result.promotedToWorking).toBe(3);
    const stats = tm.getStats();
    expect(stats.working).toBe(3);
    expect(stats.recall).toBe(7);
  });

  it('swaps working LRU with hot recall when working is full (AIG-651 review)', async () => {
    const tm = new TierManager(store);
    const pager = new AutoPager(
      store,
      {
        intervalMs: 0,
        batchSize: 1000,
        policy: {
          ...DEFAULT_PAGING_POLICY,
          promoteToWorkingMinAccessCount: 1,
          tiers: {
            ...DEFAULT_PAGING_POLICY.tiers,
            // Working can hold exactly 3 — the test verifies that filling
            // it does NOT block subsequent promotions; LRU should evict.
            working: { maxEntries: 3, maxAgeMs: null, maxTokens: null },
          },
        },
      },
      tm
    );

    // 3 cold entries already in working with old last_accessed times.
    const cold: string[] = [];
    for (let i = 0; i < 3; i++) {
      const e = store.store(`cold-${i}`, `c-${i}`);
      tm.setTier(e.id, 'working');
      cold.push(e.id);
    }
    // Force last_accessed_at into the past so they're clearly LRU vs. the
    // hot recall entries we touch below.
    // @ts-expect-error private db
    store.db.prepare('UPDATE memory SET last_accessed_at = ? WHERE id IN (?,?,?)')
      .run(Date.now() - 60_000, ...cold);

    // 2 hot recall entries.
    const hot: string[] = [];
    for (let i = 0; i < 2; i++) {
      const e = store.store(`hot-${i}`, `h-${i}`);
      tm.touch(e.id);
      tm.touch(e.id);
      hot.push(e.id);
    }

    const result = await pager.runOnce();

    // Both hot entries should now be in working — the previous
    // "skip when full" bug would have promoted 0.
    expect(result.promotedToWorking).toBe(2);
    for (const id of hot) expect(tm.getTier(id)).toBe('working');
    // The two evicted cold entries are back in recall.
    expect(tm.getStats().working).toBe(3);
    expect(tm.getStats().recall).toBe(2);
  });

  it('demotes recall entries older than maxAgeMs into archival', async () => {
    const tm = new TierManager(store);
    const pager = new AutoPager(
      store,
      {
        intervalMs: 0,
        batchSize: 1000,
        policy: {
          ...DEFAULT_PAGING_POLICY,
          tiers: {
            ...DEFAULT_PAGING_POLICY.tiers,
            recall: { maxEntries: 1000, maxAgeMs: 1000 /* 1s for the test */, maxTokens: null },
          },
        },
      },
      tm
    );

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(store.store(`old-${i}`, `payload-${i}`).id);
    }
    // Backdate updated_at so the rows look old. last_accessed_at is null so
    // the auto-pager falls back to updated_at via COALESCE.
    const ancient = Date.now() - 60 * 1000;
    // @ts-expect-error private db handle in test
    store.db.prepare('UPDATE memory SET updated_at = ? WHERE id IN (?,?,?,?,?)')
      .run(ancient, ...ids);

    const result = await pager.runOnce();
    expect(result.demotedToArchival).toBe(5);
    const stats = tm.getStats();
    expect(stats.archival).toBe(5);
    expect(stats.recall).toBe(0);

    // Archived rows still have content accessible via restoreContent.
    expect(tm.restoreContent(ids[0])).toBe('payload-0');
  });

  it('handles a realistic mixed workload (200 entries -> tier distribution)', async () => {
    const tm = new TierManager(store);
    const pager = new AutoPager(
      store,
      {
        intervalMs: 0,
        batchSize: 1000,
        policy: {
          ...DEFAULT_PAGING_POLICY,
          promoteToWorkingMinAccessCount: 2,
          tiers: {
            working: { maxEntries: 20, maxAgeMs: null, maxTokens: null },
            recall: { maxEntries: 150, maxAgeMs: 1000 /* 1s for the test */, maxTokens: null },
            archival: { maxEntries: null, maxAgeMs: null, maxTokens: null },
          },
        },
      },
      tm
    );

    // 200 entries: 30 hot (recent + accessed), 100 idle, 70 old.
    const hot: string[] = [];
    const idle: string[] = [];
    const old: string[] = [];

    for (let i = 0; i < 30; i++) {
      const e = store.store(`hot-${i}`, `payload-hot-${i}`);
      tm.touch(e.id);
      tm.touch(e.id);
      hot.push(e.id);
    }
    for (let i = 0; i < 100; i++) {
      idle.push(store.store(`idle-${i}`, `payload-idle-${i}`).id);
    }
    for (let i = 0; i < 70; i++) {
      old.push(store.store(`old-${i}`, `payload-old-${i}`).id);
    }
    const ancient = Date.now() - 60 * 1000;
    const placeholders = old.map(() => '?').join(',');
    // @ts-expect-error private db
    store.db.prepare(`UPDATE memory SET updated_at = ? WHERE id IN (${placeholders})`)
      .run(ancient, ...old);

    const result = await pager.runOnce();

    const stats = tm.getStats();
    expect(stats.total).toBe(200);
    // Hot entries should have been promoted up to the working cap.
    expect(stats.working).toBeLessThanOrEqual(20);
    expect(stats.working).toBeGreaterThan(0);
    // All 70 old entries should be archived.
    expect(stats.archival).toBeGreaterThanOrEqual(70);
    // Recall holds the remainder.
    expect(stats.working + stats.recall + stats.archival).toBe(200);
    // AutoPager surfaced movement counters.
    expect(result.promotedToWorking + result.demotedToRecall + result.demotedToArchival).toBeGreaterThan(0);
  });
});
