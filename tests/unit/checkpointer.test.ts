/**
 * Checkpointer unit tests — durable execution (AIG-633).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import {
  Checkpointer,
  saveCheckpointIfEnabled,
  resetCheckpointer,
  resetStepCounters,
  __setCheckpointerForTests,
} from '../../src/persistence/checkpointer.js';
import { SQLiteStore } from '../../src/memory/sqlite-store.js';
import type { AgentStackConfig } from '../../src/types.js';

describe('Checkpointer', () => {
  let dbPath: string;
  let store: SQLiteStore;
  let db: Database.Database;
  let checkpointer: Checkpointer;

  beforeEach(() => {
    dbPath = join(tmpdir(), `aistack-checkpointer-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    // Use SQLiteStore so the agent_checkpoints schema is created via initSchema().
    store = new SQLiteStore(dbPath);
    // @ts-expect-error — reuse the same handle the production code uses.
    db = store.db as Database.Database;
    checkpointer = new Checkpointer(db);
  });

  afterEach(() => {
    store.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const path = `${dbPath}${suffix}`;
      if (existsSync(path)) unlinkSync(path);
    }
  });

  it('save + loadLatest roundtrip preserves state exactly', () => {
    const state = { progress: 0.5, items: [1, 2, 3], meta: { foo: 'bar' } };
    const saved = checkpointer.save('sess-1', 'agent-A', 'step-1', state);

    expect(saved.id).toBeDefined();
    expect(saved.sessionId).toBe('sess-1');
    expect(saved.format).toBe('json'); // small payload — no gzip

    const loaded = checkpointer.loadLatest<typeof state>('sess-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.state).toEqual(state);
    expect(loaded!.agentId).toBe('agent-A');
    expect(loaded!.stepId).toBe('step-1');
  });

  it('loadLatest returns the most recent checkpoint when many exist', () => {
    checkpointer.save('sess-2', 'agent-A', 'step-1', { v: 1 });
    // Force a different created_at by waiting at least 1ms.
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    return (async () => {
      await sleep(2);
      checkpointer.save('sess-2', 'agent-A', 'step-2', { v: 2 });
      await sleep(2);
      checkpointer.save('sess-2', 'agent-B', 'step-3', { v: 3 });

      const latest = checkpointer.loadLatest<{ v: number }>('sess-2');
      expect(latest?.state.v).toBe(3);
      expect(latest?.agentId).toBe('agent-B');
      expect(latest?.stepId).toBe('step-3');
    })();
  });

  it('prune keeps only the latest N checkpoints per session', async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 5; i++) {
      checkpointer.save('sess-3', 'agent-X', `step-${i}`, { i });
      await sleep(2);
    }

    expect(checkpointer.count('sess-3')).toBe(5);
    const deleted = checkpointer.prune('sess-3', 2);
    expect(deleted).toBe(3);
    expect(checkpointer.count('sess-3')).toBe(2);

    const latest = checkpointer.loadLatest<{ i: number }>('sess-3');
    expect(latest?.state.i).toBe(4); // latest survives
  });

  it('loadByStep enables deterministic replay (same input → same output)', () => {
    const state = { input: 'fixed-seed-42', output: 'deterministic-result' };
    checkpointer.save('sess-4', 'agent-R', 'replay-step', state);

    // Simulate a "replay" by loading the same step's state twice.
    const first = checkpointer.loadByStep<typeof state>('sess-4', 'replay-step');
    const second = checkpointer.loadByStep<typeof state>('sess-4', 'replay-step');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.state).toEqual(second!.state);
    expect(first!.state).toEqual(state);
  });

  it('gzip activates for large payloads and decompresses transparently', () => {
    // Force a small threshold so we don't need a giant fixture.
    const smallThresholdCheckpointer = new Checkpointer(db, { gzipThresholdBytes: 32 });
    const state = { big: 'x'.repeat(1000) };
    const saved = smallThresholdCheckpointer.save('sess-5', 'agent-Z', 'big-step', state);
    expect(saved.format).toBe('json+gzip');

    const loaded = smallThresholdCheckpointer.loadLatest<typeof state>('sess-5');
    expect(loaded?.state).toEqual(state);
    expect(loaded?.format).toBe('json+gzip');
  });

  it('loadLatestForAgent scopes by agent within a session', () => {
    checkpointer.save('sess-6', 'agent-A', 'a1', { who: 'A' });
    checkpointer.save('sess-6', 'agent-B', 'b1', { who: 'B' });

    const a = checkpointer.loadLatestForAgent<{ who: string }>('sess-6', 'agent-A');
    const b = checkpointer.loadLatestForAgent<{ who: string }>('sess-6', 'agent-B');
    expect(a?.state.who).toBe('A');
    expect(b?.state.who).toBe('B');
  });

  it('loadLatest returns null for unknown sessions', () => {
    expect(checkpointer.loadLatest('does-not-exist')).toBeNull();
  });

  it('save rejects missing identifiers', () => {
    expect(() => checkpointer.save('', 'a', 's', {})).toThrow();
    expect(() => checkpointer.save('s', '', 's', {})).toThrow();
    expect(() => checkpointer.save('s', 'a', '', {})).toThrow();
  });

  it('list returns checkpoints newest-first', async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    checkpointer.save('sess-7', 'agent-A', 'step-1', { i: 1 });
    await sleep(2);
    checkpointer.save('sess-7', 'agent-A', 'step-2', { i: 2 });
    await sleep(2);
    checkpointer.save('sess-7', 'agent-A', 'step-3', { i: 3 });

    const list = checkpointer.list<{ i: number }>('sess-7');
    expect(list).toHaveLength(3);
    expect(list[0].state.i).toBe(3);
    expect(list[2].state.i).toBe(1);
  });

  it('deleteSession removes all checkpoints for that session only', () => {
    checkpointer.save('sess-8a', 'agent-A', 'step-1', { x: 1 });
    checkpointer.save('sess-8a', 'agent-A', 'step-2', { x: 2 });
    checkpointer.save('sess-8b', 'agent-A', 'step-1', { y: 1 });

    const deleted = checkpointer.deleteSession('sess-8a');
    expect(deleted).toBe(2);
    expect(checkpointer.count('sess-8a')).toBe(0);
    expect(checkpointer.count('sess-8b')).toBe(1);
  });

  it('rejects oversized gzip payloads (gzip-bomb guard)', () => {
    // Construct a payload whose decompressed size easily exceeds a tiny cap.
    // 1 MiB of zeros compresses to ~1 KiB — perfect bomb proxy.
    const big = 'A'.repeat(1024 * 1024); // 1 MiB
    const compressed = gzipSync(Buffer.from(JSON.stringify({ big }), 'utf8'));
    const id = 'bomb-1';
    const now = Date.now();
    db.prepare(
      `INSERT INTO agent_checkpoints
         (id, session_id, agent_id, step_id, state_blob, format, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, 'sess-bomb', 'agent-bomb', 'step-bomb', compressed.toString('base64'), 'json+gzip', null, now);

    // 1024 byte cap — must reject the 1 MiB payload.
    const strict = new Checkpointer(db, { maxDecompressedBytes: 1024 });
    expect(() => strict.loadLatest('sess-bomb')).toThrow(/decompression failed|gzip bomb/i);

    // A generous cap accepts it fine — confirms the throw is from the cap, not corruption.
    const lenient = new Checkpointer(db, { maxDecompressedBytes: 4 * 1024 * 1024 });
    const loaded = lenient.loadLatest<{ big: string }>('sess-bomb');
    expect(loaded?.state.big.length).toBe(1024 * 1024);
  });
});

describe('saveCheckpointIfEnabled — granularity gate + deterministic stepId', () => {
  let dbPath: string;
  let store: SQLiteStore;
  let db: Database.Database;

  // Minimal config shape — only the fields the function actually reads.
  function mkConfig(overrides: Partial<NonNullable<AgentStackConfig['checkpointing']>>): AgentStackConfig {
    return {
      checkpointing: {
        enabled: true,
        granularity: 'step',
        retentionPerSession: 0,
        ...overrides,
      },
    } as unknown as AgentStackConfig;
  }

  beforeEach(() => {
    dbPath = join(tmpdir(), `aistack-cp-gran-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    store = new SQLiteStore(dbPath);
    // @ts-expect-error — reuse the same handle the production code uses.
    db = store.db as Database.Database;
    resetStepCounters();
    // Inject a Checkpointer wired to our test DB so saveCheckpointIfEnabled
    // doesn't try to spin up a real MemoryManager from `config`.
    __setCheckpointerForTests(new Checkpointer(db));
  });

  afterEach(() => {
    resetCheckpointer();
    resetStepCounters();
    store.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const path = `${dbPath}${suffix}`;
      if (existsSync(path)) unlinkSync(path);
    }
  });

  it("granularity='agent' skips per-step calls and persists only on completion", () => {
    const cp = new Checkpointer(db);
    __setCheckpointerForTests(cp);

    const cfg = mkConfig({ granularity: 'agent' });
    const sessionId = 'gran-sess';
    const agentId = 'agent-gran';

    // Three per-step calls — must all be dropped under granularity='agent'.
    saveCheckpointIfEnabled(cfg, sessionId, agentId, null, { i: 1 }, undefined, 'step');
    saveCheckpointIfEnabled(cfg, sessionId, agentId, null, { i: 2 }, undefined, 'step');
    saveCheckpointIfEnabled(cfg, sessionId, agentId, null, { i: 3 }, undefined, 'step');
    expect(cp.count(sessionId)).toBe(0);

    // Terminal ('agent') call — must persist exactly one checkpoint.
    saveCheckpointIfEnabled(
      cfg,
      sessionId,
      agentId,
      null,
      { terminal: true },
      undefined,
      'agent'
    );
    expect(cp.count(sessionId)).toBe(1);
    expect(cp.loadLatest<{ terminal: boolean }>(sessionId)?.state.terminal).toBe(true);
  });

  it("granularity='step' (default) persists every step", () => {
    const cp = new Checkpointer(db);
    __setCheckpointerForTests(cp);

    const cfg = mkConfig({ granularity: 'step' });
    const sessionId = 'gran-step';
    const agentId = 'agent-step';

    saveCheckpointIfEnabled(cfg, sessionId, agentId, null, { i: 1 });
    saveCheckpointIfEnabled(cfg, sessionId, agentId, null, { i: 2 });
    saveCheckpointIfEnabled(cfg, sessionId, agentId, null, { i: 3 }, undefined, 'agent');
    expect(cp.count(sessionId)).toBe(3);
  });

  it('assigns deterministic stepIds and loadByStep can locate each one (replay)', () => {
    const cp = new Checkpointer(db);
    __setCheckpointerForTests(cp);

    const cfg = mkConfig({ granularity: 'step' });
    const sessionId = 'replay-sess';
    const agentId = 'replay-agent';

    saveCheckpointIfEnabled(cfg, sessionId, agentId, null, { payload: 'alpha' });
    saveCheckpointIfEnabled(cfg, sessionId, agentId, null, { payload: 'beta' });
    saveCheckpointIfEnabled(cfg, sessionId, agentId, null, { payload: 'gamma' });

    // Deterministic format documented in saveCheckpointIfEnabled.
    const mk = (n: number) => `${sessionId}:${agentId}:${n}`;
    const s1 = cp.loadByStep<{ payload: string }>(sessionId, mk(1));
    const s2 = cp.loadByStep<{ payload: string }>(sessionId, mk(2));
    const s3 = cp.loadByStep<{ payload: string }>(sessionId, mk(3));

    // All three steps locatable by deterministic id — the Date.now() impl
    // produced near-collisions and made specific-step lookup impossible.
    expect(s1?.state.payload).toBe('alpha');
    expect(s2?.state.payload).toBe('beta');
    expect(s3?.state.payload).toBe('gamma');

    // Replay determinism: same stepId → same state on every load.
    const replay1 = cp.loadByStep<{ payload: string }>(sessionId, mk(2));
    const replay2 = cp.loadByStep<{ payload: string }>(sessionId, mk(2));
    expect(replay1?.state).toEqual(replay2?.state);
  });

  it('honors an explicit stepId when provided', () => {
    const cp = new Checkpointer(db);
    __setCheckpointerForTests(cp);

    const cfg = mkConfig({ granularity: 'step' });
    saveCheckpointIfEnabled(cfg, 'sess-explicit', 'agent-x', 'workflow-step-A', { v: 1 });
    const loaded = cp.loadByStep<{ v: number }>('sess-explicit', 'workflow-step-A');
    expect(loaded?.state.v).toBe(1);
  });
});
