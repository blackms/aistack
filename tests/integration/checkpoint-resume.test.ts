/**
 * Integration test for crash-resume via the Checkpointer.
 *
 * Simulates a process crash mid-workflow by opening a Checkpointer,
 * writing a few step checkpoints, closing the DB handle, then
 * re-opening it as if from a fresh process and verifying that the
 * latest checkpoint is recovered exactly.
 *
 * Issue: AIG-633
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteStore } from '../../src/memory/sqlite-store.js';
import { Checkpointer } from '../../src/persistence/checkpointer.js';

describe('Integration: checkpoint resume after crash', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(
      tmpdir(),
      `aistack-checkpoint-resume-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });
  });

  afterEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      const p = `${dbPath}${suffix}`;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('recovers the latest checkpoint after the DB handle is closed (crash simulation)', async () => {
    const sessionId = 'session-resume-1';
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // --- "Process 1": write a few checkpoints, then crash. ---
    {
      const store = new SQLiteStore(dbPath);
      // @ts-expect-error — same handle trick used in production getCheckpointer.
      const checkpointer = new Checkpointer(store.db);

      checkpointer.save(sessionId, 'researcher', 'phase-1:gather', { progress: 0.25 });
      await sleep(2);
      checkpointer.save(sessionId, 'analyst', 'phase-2:analyze', { progress: 0.5 });
      await sleep(2);
      checkpointer.save(sessionId, 'coder', 'phase-3:implement', {
        progress: 0.75,
        partialOutput: 'function foo() { return 42; }',
      });

      // Simulate crash: close handle WITHOUT graceful shutdown.
      store.close();
    }

    // --- "Process 2": fresh handle, recover state. ---
    {
      const store = new SQLiteStore(dbPath);
      // @ts-expect-error — see above.
      const checkpointer = new Checkpointer(store.db);

      const latest = checkpointer.loadLatest<{ progress: number; partialOutput?: string }>(sessionId);
      expect(latest).not.toBeNull();
      expect(latest!.agentId).toBe('coder');
      expect(latest!.stepId).toBe('phase-3:implement');
      expect(latest!.state.progress).toBe(0.75);
      expect(latest!.state.partialOutput).toBe('function foo() { return 42; }');

      // Should also be able to enumerate the full history.
      const history = checkpointer.list(sessionId);
      expect(history).toHaveLength(3);

      store.close();
    }
  });

  it('produces deterministic replay output for a fixed step', () => {
    const sessionId = 'session-replay';

    const store = new SQLiteStore(dbPath);
    // @ts-expect-error — see above.
    const checkpointer = new Checkpointer(store.db);

    const fixedState = { seed: 'abc123', input: [1, 2, 3], output: [2, 4, 6] };
    checkpointer.save(sessionId, 'replayer', 'fixed-step', fixedState);

    // Two consecutive "replays" of the same step ID must yield identical state.
    const a = checkpointer.loadByStep<typeof fixedState>(sessionId, 'fixed-step');
    const b = checkpointer.loadByStep<typeof fixedState>(sessionId, 'fixed-step');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(JSON.stringify(a!.state)).toBe(JSON.stringify(b!.state));
    expect(a!.state).toEqual(fixedState);

    store.close();
  });
});
