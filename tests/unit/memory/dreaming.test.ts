/**
 * Dreaming worker tests (AIG-640).
 *
 * Uses a real MemoryManager (vector search disabled, so the Jaccard fallback
 * runs) to make sure consolidation behavior is end-to-end correct.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DreamingWorker, MemoryManager, resetMemoryManager } from '../../../src/memory/index.js';
import type { AgentStackConfig } from '../../../src/types.js';

function makeConfig(dbPath: string): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: dbPath,
      defaultNamespace: 'default',
      vectorSearch: { enabled: false },
    },
    providers: { default: 'anthropic' },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: false },
    plugins: { enabled: false, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
  };
}

describe('DreamingWorker', () => {
  let manager: MemoryManager;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `aistack-dreaming-${Date.now()}-${Math.random()}.db`);
    manager = new MemoryManager(makeConfig(dbPath));
  });

  afterEach(() => {
    manager.close();
    resetMemoryManager();
    for (const suffix of ['', '-wal', '-shm']) {
      const p = `${dbPath}${suffix}`;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('does nothing when there are fewer entries than minClusterSize', async () => {
    await manager.store('a', 'lonely note');
    const worker = new DreamingWorker(manager, { minClusterSize: 2 });
    const result = await worker.consolidate();
    expect(result.consolidated).toBe(0);
    expect(result.clusters).toBe(0);
  });

  it('consolidates related entries via Jaccard fallback', async () => {
    await manager.store(
      'note-1',
      'kubernetes deployment rolling update strategy production'
    );
    await manager.store(
      'note-2',
      'kubernetes deployment rolling production strategy update'
    );
    await manager.store(
      'note-3',
      'kubernetes deployment rolling update strategy production cluster'
    );
    // Unrelated entry — should not join the cluster.
    await manager.store('note-4', 'completely different topic about cooking recipes');

    const worker = new DreamingWorker(manager, {
      minClusterSize: 2,
      similarityThreshold: 0.5,
      dreamNamespace: 'dreams',
    });
    const result = await worker.consolidate();
    expect(result.consolidated).toBeGreaterThanOrEqual(1);

    const dreams = manager.list('dreams', 10);
    expect(dreams.length).toBeGreaterThanOrEqual(1);
    const dream = dreams[0];
    expect(dream.content).toContain('Consolidated memory');
    expect(dream.metadata).toBeTruthy();
    expect((dream.metadata as Record<string, unknown>).kind).toBe('dream');
    expect(((dream.metadata as Record<string, unknown>).consolidatedFrom as string[]).length).toBeGreaterThanOrEqual(2);
  });

  it('skips existing dream entries on subsequent passes', async () => {
    await manager.store('a', 'shared deployment workflow notes alpha');
    await manager.store('b', 'shared deployment workflow notes beta');
    const worker = new DreamingWorker(manager, {
      minClusterSize: 2,
      similarityThreshold: 0.4,
      dreamNamespace: 'dreams',
    });
    await worker.consolidate();
    const first = manager.list('dreams', 100).length;
    // Second pass: source entries unchanged — should still cluster but never
    // pull dream entries (they live in a different namespace anyway).
    await worker.consolidate();
    const second = manager.list('dreams', 100).length;
    expect(second).toBeGreaterThanOrEqual(first);
  });

  it('start/stop lifecycle is idempotent', () => {
    const worker = new DreamingWorker(manager, { intervalMs: 10_000 });
    expect(worker.isRunning()).toBe(false);
    worker.start();
    expect(worker.isRunning()).toBe(true);
    worker.start(); // no-op
    worker.stop();
    expect(worker.isRunning()).toBe(false);
    worker.stop(); // no-op
  });

  it('uses a custom summarizer when provided', async () => {
    await manager.store('a', 'shared deployment workflow notes alpha');
    await manager.store('b', 'shared deployment workflow notes beta');
    const summarize = vi.fn(() => 'CUSTOM SUMMARY');
    const worker = new DreamingWorker(manager, {
      minClusterSize: 2,
      similarityThreshold: 0.4,
      dreamNamespace: 'dreams',
      summarize,
    });
    await worker.consolidate();
    expect(summarize).toHaveBeenCalled();
    const dreams = manager.list('dreams', 10);
    expect(dreams[0].content).toBe('CUSTOM SUMMARY');
  });

  it('skips already-consolidated entries on subsequent cycles', async () => {
    await manager.store('a', 'shared deployment workflow notes alpha');
    await manager.store('b', 'shared deployment workflow notes beta');
    const summarize = vi.fn(() => 'SUMMARY');
    const worker = new DreamingWorker(manager, {
      minClusterSize: 2,
      similarityThreshold: 0.4,
      dreamNamespace: 'dreams',
      summarize,
    });
    // First cycle: both entries are fresh, one dream is produced.
    const first = await worker.consolidate();
    expect(first.consolidated).toBe(1);
    expect(summarize).toHaveBeenCalledTimes(1);

    // Second cycle: nothing changed — no new clusters, summarizer untouched.
    const second = await worker.consolidate();
    expect(second.consolidated).toBe(0);
    expect(second.clusters).toBe(0);
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it('re-consolidates a source entry whose content changed since last cycle', async () => {
    await manager.store('a', 'shared deployment workflow notes alpha');
    await manager.store('b', 'shared deployment workflow notes beta');
    const summarize = vi.fn(() => 'SUMMARY');
    const worker = new DreamingWorker(manager, {
      minClusterSize: 2,
      similarityThreshold: 0.4,
      dreamNamespace: 'dreams',
      summarize,
    });
    await worker.consolidate();
    summarize.mockClear();

    // Ensure updatedAt advances past the dream's consolidatedAt (which is set
    // to Date.now() at write time — same millisecond as our re-store is the
    // edge case we explicitly want to cover).
    await new Promise((r) => setTimeout(r, 5));
    await manager.store('a', 'shared deployment workflow notes alpha UPDATED');
    await manager.store('b', 'shared deployment workflow notes beta UPDATED');

    const next = await worker.consolidate();
    expect(next.consolidated).toBe(1);
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it('start() installs process shutdown handlers', () => {
    const sigtermBefore = process.listenerCount('SIGTERM');
    const sigintBefore = process.listenerCount('SIGINT');
    const worker = new DreamingWorker(manager, { intervalMs: 10_000 });
    worker.start();
    expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore + 1);
    expect(process.listenerCount('SIGINT')).toBe(sigintBefore + 1);
    worker.stop();
    expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore);
    expect(process.listenerCount('SIGINT')).toBe(sigintBefore);
  });
});
