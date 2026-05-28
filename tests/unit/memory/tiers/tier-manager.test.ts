/**
 * TierManager unit tests (AIG-651).
 *
 * Covers promote/demote/setTier transitions, archival roundtrip with gzip,
 * and getStats correctness.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteStore } from '../../../../src/memory/sqlite-store.js';
import { TierManager } from '../../../../src/memory/tiers/tier-manager.js';

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

describe('TierManager', () => {
  let store: SQLiteStore;
  let dbPath: string;
  let tm: TierManager;

  beforeEach(() => {
    dbPath = join(tmpdir(), `aistack-tier-mgr-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    store = new SQLiteStore(dbPath);
    tm = new TierManager(store);
  });

  afterEach(() => {
    store.close();
    cleanupDb(dbPath);
  });

  it('defaults new entries to tier=recall', () => {
    const entry = store.store('hello', 'world');
    expect(tm.getTier(entry.id)).toBe('recall');
  });

  it('returns null tier for unknown ids', () => {
    expect(tm.getTier('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('touch() increments access_count and sets last_accessed_at', () => {
    const entry = store.store('k1', 'v1');
    tm.touch(entry.id);
    tm.touch(entry.id);

    // Read raw columns to verify counter / timestamp updates.
    // @ts-expect-error private db access in test
    const row = store.db
      .prepare('SELECT access_count, last_accessed_at FROM memory WHERE id = ?')
      .get(entry.id) as { access_count: number; last_accessed_at: number | null };
    expect(row.access_count).toBe(2);
    expect(row.last_accessed_at).not.toBeNull();
  });

  it('promote() walks one step hotter by default (recall -> working)', () => {
    const entry = store.store('promo', 'content');
    expect(tm.promote(entry.id)).toBe('working');
    expect(tm.getTier(entry.id)).toBe('working');
  });

  it('promote() returns current tier when already at the hottest tier', () => {
    const entry = store.store('top', 'content');
    tm.setTier(entry.id, 'working');
    // Already at working, promote is a no-op.
    expect(tm.promote(entry.id)).toBe('working');
  });

  it('promote() rejects when target is colder than current', () => {
    const entry = store.store('bad', 'content');
    expect(() => tm.promote(entry.id, 'archival')).toThrow(/hotter tier/);
  });

  it('demote() walks one step colder by default (recall -> archival)', () => {
    const entry = store.store('cool', 'content');
    expect(tm.demote(entry.id)).toBe('archival');
    expect(tm.getTier(entry.id)).toBe('archival');
  });

  it('demote() into archival compresses content and stores it in archived_content', () => {
    const original = 'this is some content that will be archived ' + 'x'.repeat(500);
    const entry = store.store('arch-key', original);

    tm.demote(entry.id);
    expect(tm.getTier(entry.id)).toBe('archival');

    // Original content is replaced with a preview; full payload lives in
    // archived_content as gzip — TierManager.restoreContent gives it back.
    const restored = tm.restoreContent(entry.id);
    expect(restored).toBe(original);

    // @ts-expect-error private db
    const row = store.db
      .prepare('SELECT content, archived_content FROM memory WHERE id = ?')
      .get(entry.id) as { content: string; archived_content: Buffer | null };
    expect(row.archived_content).not.toBeNull();
    expect(row.archived_content!.length).toBeGreaterThan(0);
    expect(row.content.length).toBeLessThanOrEqual(280);
  });

  it('promote() from archival restores compressed content', () => {
    const original = 'roundtrip payload';
    const entry = store.store('rt', original);
    tm.demote(entry.id); // -> archival
    tm.promote(entry.id); // archival -> recall

    expect(tm.getTier(entry.id)).toBe('recall');
    // @ts-expect-error private db
    const row = store.db
      .prepare('SELECT content, archived_content FROM memory WHERE id = ?')
      .get(entry.id) as { content: string; archived_content: Buffer | null };
    expect(row.content).toBe(original);
    expect(row.archived_content).toBeNull();
  });

  it('demote() into archival respects custom summary text', () => {
    const entry = store.store('summ', 'long original content goes here');
    tm.demote(entry.id, undefined, { summary: 'short summary' });

    // @ts-expect-error private db
    const row = store.db
      .prepare('SELECT content, summary FROM memory WHERE id = ?')
      .get(entry.id) as { content: string; summary: string | null };
    expect(row.summary).toBe('short summary');
    expect(row.content).toBe('short summary'); // preview falls back to summary
  });

  it('setTier() updates tier in either direction', () => {
    const entry = store.store('any', 'content');
    expect(tm.setTier(entry.id, 'archival')).toBe('archival');
    expect(tm.setTier(entry.id, 'working')).toBe('working');
    expect(tm.getTier(entry.id)).toBe('working');
  });

  it('getStats() reports correct distribution across all tiers', () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(store.store(`a${i}`, `content-${i}`).id);
    for (let i = 0; i < 3; i++) ids.push(store.store(`b${i}`, `content-b${i}`).id);

    // Move first 2 to working, last 3 to archival; rest stay recall.
    tm.setTier(ids[0], 'working');
    tm.setTier(ids[1], 'working');
    tm.setTier(ids[5], 'archival');
    tm.setTier(ids[6], 'archival');
    tm.setTier(ids[7], 'archival');

    const stats = tm.getStats();
    expect(stats).toEqual({ working: 2, recall: 3, archival: 3, total: 8 });
  });

  it('listByTier() returns entries from that tier ordered by recency', () => {
    const e1 = store.store('one', 'c1');
    const e2 = store.store('two', 'c2');
    tm.setTier(e1.id, 'working');
    tm.setTier(e2.id, 'working');
    tm.touch(e1.id); // e1 most recent

    const list = tm.listByTier('working');
    expect(list).toHaveLength(2);
    expect(list[0].key).toBe('one');
  });
});
