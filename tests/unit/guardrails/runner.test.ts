/**
 * Tests for the guardrails parallel runner.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { runGuardrails } from '../../../src/guardrails/runner.js';
import {
  withGuardrails,
  GuardrailBlockedError,
  initGuardrails,
  loadCustomGuardrails,
  defaultRegistry,
} from '../../../src/guardrails/index.js';
import type {
  Guardrail,
  GuardrailAuditEvent,
} from '../../../src/guardrails/types.js';

function makeGuardrail(
  name: string,
  result: { pass: boolean; severity?: 'low' | 'high'; reason?: string },
  delayMs = 0
): Guardrail {
  return {
    name,
    direction: 'both',
    async validate() {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return result;
    },
  };
}

describe('runGuardrails — parallel execution', () => {
  it('returns pass when no guardrails configured', async () => {
    const out = await runGuardrails('hi', [], { context: { direction: 'input' } });
    expect(out.pass).toBe(true);
    expect(out.failures).toEqual([]);
  });

  it('runs guardrails concurrently (total time ~ max, not sum)', async () => {
    const guardrails = [
      makeGuardrail('a', { pass: true }, 80),
      makeGuardrail('b', { pass: true }, 80),
      makeGuardrail('c', { pass: true }, 80),
    ];
    const start = Date.now();
    const out = await runGuardrails('x', guardrails, {
      context: { direction: 'input' },
    });
    const elapsed = Date.now() - start;
    expect(out.pass).toBe(true);
    // Allow generous slack for CI noise — serial would be ~240ms.
    expect(elapsed).toBeLessThan(220);
  });

  it('aggregates multiple low-severity failures without short-circuit', async () => {
    const out = await runGuardrails('x', [
      makeGuardrail('a', { pass: false, severity: 'low', reason: 'a' }),
      makeGuardrail('b', { pass: false, severity: 'low', reason: 'b' }),
      makeGuardrail('c', { pass: true }),
    ], { context: { direction: 'input' } });
    expect(out.pass).toBe(false);
    expect(out.shortCircuited).toBe(false);
    expect(out.failures.map((f) => f.guardrail).sort()).toEqual(['a', 'b']);
  });

  it('short-circuits on first high-severity failure when killSwitch on', async () => {
    const slow = makeGuardrail('slow', { pass: true }, 500);
    const fast = makeGuardrail('fast', { pass: false, severity: 'high', reason: 'nope' }, 10);
    const start = Date.now();
    const out = await runGuardrails('x', [slow, fast], {
      context: { direction: 'input' },
    });
    const elapsed = Date.now() - start;
    expect(out.pass).toBe(false);
    expect(out.shortCircuited).toBe(true);
    // Must have returned long before the slow guardrail's 500ms.
    expect(elapsed).toBeLessThan(300);
  });

  it('does NOT short-circuit when killSwitch disabled', async () => {
    const out = await runGuardrails('x', [
      makeGuardrail('a', { pass: false, severity: 'high', reason: 'a' }, 10),
      makeGuardrail('b', { pass: false, severity: 'high', reason: 'b' }, 30),
    ], { context: { direction: 'input' }, killSwitch: false });
    expect(out.pass).toBe(false);
    expect(out.shortCircuited).toBe(false);
    expect(out.failures).toHaveLength(2);
  });

  it('isolates a buggy guardrail — does not crash the run', async () => {
    const buggy: Guardrail = {
      name: 'buggy',
      direction: 'both',
      async validate() {
        throw new Error('boom');
      },
    };
    const out = await runGuardrails('x', [
      buggy,
      makeGuardrail('ok', { pass: true }),
    ], { context: { direction: 'input' }, killSwitch: false });
    expect(out.pass).toBe(false);
    const buggyFailure = out.failures.find((f) => f.guardrail === 'buggy');
    expect(buggyFailure?.crashed).toBe(true);
    expect(buggyFailure?.reason).toMatch(/boom/);
  });

  it('enforces per-guardrail timeout', async () => {
    const slow = makeGuardrail('slow', { pass: true }, 500);
    const out = await runGuardrails('x', [slow], {
      context: { direction: 'input' },
      timeoutMs: 50,
      killSwitch: false,
      // Disable aggregate budget so the per-guardrail timeout is the cause.
      aggregateTimeoutMs: 0,
    });
    expect(out.pass).toBe(false);
    expect(out.failures[0].crashed).toBe(true);
    expect(out.failures[0].reason).toMatch(/timed out/);
  });

  it('enforces aggregate wall-clock budget across all guardrails', async () => {
    // Two slow guardrails, each well under the per-guardrail timeout, but
    // together they would burn ~500ms — the 80ms aggregate budget must drop
    // them.
    const a = makeGuardrail('a', { pass: true }, 500);
    const b = makeGuardrail('b', { pass: true }, 500);
    const start = Date.now();
    const out = await runGuardrails('x', [a, b], {
      context: { direction: 'input' },
      killSwitch: false,
      aggregateTimeoutMs: 80,
    });
    const elapsed = Date.now() - start;
    expect(out.budgetExceeded).toBe(true);
    expect(out.pass).toBe(false);
    // Both should be reported as dropped (crashed) failures.
    expect(out.failures).toHaveLength(2);
    for (const f of out.failures) {
      expect(f.crashed).toBe(true);
      expect(f.reason).toMatch(/aggregate budget/);
    }
    // We MUST have returned shortly after the budget elapsed, not waited
    // for the underlying 500ms guardrails.
    expect(elapsed).toBeLessThan(250);
  });

  it('does NOT trigger budgetExceeded when all guardrails finish in time', async () => {
    const out = await runGuardrails('x', [
      makeGuardrail('fast', { pass: true }, 5),
    ], {
      context: { direction: 'input' },
      aggregateTimeoutMs: 100,
    });
    expect(out.pass).toBe(true);
    expect(out.budgetExceeded).toBe(false);
  });

  it('aggregateTimeoutMs <= 0 disables the aggregate budget', async () => {
    const slow = makeGuardrail('slow', { pass: true }, 60);
    const out = await runGuardrails('x', [slow], {
      context: { direction: 'input' },
      // Per-guardrail timeout still applies; budget is OFF.
      timeoutMs: 500,
      aggregateTimeoutMs: 0,
    });
    expect(out.pass).toBe(true);
    expect(out.budgetExceeded).toBe(false);
  });

  it('emits audit events for each failure', async () => {
    const events: GuardrailAuditEvent[] = [];
    const out = await runGuardrails('x', [
      makeGuardrail('a', { pass: false, severity: 'low', reason: 'a' }),
      makeGuardrail('b', { pass: true }),
    ], {
      context: { direction: 'input', agentType: 'coder', taskId: 't-1' },
      killSwitch: false,
      onAudit: (e) => events.push(e),
    });
    expect(out.failures).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'guardrail.fail',
      guardrail: 'a',
      direction: 'both',
      severity: 'low',
      agentType: 'coder',
      taskId: 't-1',
    });
  });

  it('audit emitter errors do NOT break guardrails', async () => {
    const out = await runGuardrails('x', [
      makeGuardrail('a', { pass: false, severity: 'low', reason: 'a' }),
    ], {
      context: { direction: 'input' },
      onAudit: () => {
        throw new Error('audit boom');
      },
    });
    expect(out.pass).toBe(false);
    expect(out.failures).toHaveLength(1);
  });
});

describe('withGuardrails wrapper', () => {
  it('runs fn when input + output guardrails pass', async () => {
    const fn = vi.fn(async (s: string) => `out:${s}`);
    const wrapped = withGuardrails(fn, {
      input: [makeGuardrail('i', { pass: true })],
      output: [makeGuardrail('o', { pass: true })],
      context: { agentType: 'coder' },
    });
    await expect(wrapped('hi')).resolves.toBe('out:hi');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('throws GuardrailBlockedError on input failure and skips fn', async () => {
    const fn = vi.fn();
    const wrapped = withGuardrails(fn, {
      input: [makeGuardrail('i', { pass: false, severity: 'high', reason: 'block' })],
      context: { agentType: 'coder' },
    });
    await expect(wrapped('x')).rejects.toBeInstanceOf(GuardrailBlockedError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('throws GuardrailBlockedError on output failure', async () => {
    const fn = vi.fn(async () => 'bad');
    const wrapped = withGuardrails(fn, {
      output: [makeGuardrail('o', { pass: false, severity: 'high', reason: 'leak' })],
      context: { agentType: 'coder' },
    });
    await expect(wrapped('x')).rejects.toBeInstanceOf(GuardrailBlockedError);
  });

  it('outputNonBlocking lets failures through with logging only', async () => {
    const fn = vi.fn(async () => 'bad');
    const wrapped = withGuardrails(fn, {
      output: [makeGuardrail('o', { pass: false, severity: 'high', reason: 'leak' })],
      context: { agentType: 'coder' },
      outputNonBlocking: true,
    });
    await expect(wrapped('x')).resolves.toBe('bad');
  });
});

describe('loadCustomGuardrails / initGuardrails (customPaths wiring)', () => {
  function makeTempModule(filename: string, source: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'aistack-guardrails-'));
    const path = join(dir, filename);
    writeFileSync(path, source, 'utf-8');
    return path;
  }

  it('registers a guardrail from a module default export', async () => {
    const path = makeTempModule(
      'custom-default.mjs',
      `export default {
         name: 'tenant-block',
         direction: 'input',
         validate: () => ({ pass: true }),
       };`
    );
    try {
      const reg = defaultRegistry();
      const loaded = await loadCustomGuardrails([path], { registry: reg });
      expect(loaded).toBeGreaterThanOrEqual(1);
      expect(reg.get('tenant-block')).toBeDefined();
    } finally {
      rmSync(path, { force: true });
    }
  });

  it('registers an array of guardrails from a default export', async () => {
    const path = makeTempModule(
      'custom-array.mjs',
      `export default [
         { name: 'g1', direction: 'input', validate: () => ({ pass: true }) },
         { name: 'g2', direction: 'output', validate: () => ({ pass: true }) },
       ];`
    );
    try {
      const reg = defaultRegistry();
      await loadCustomGuardrails([path], { registry: reg });
      expect(reg.get('g1')).toBeDefined();
      expect(reg.get('g2')).toBeDefined();
    } finally {
      rmSync(path, { force: true });
    }
  });

  it('skips bad paths without sinking the rest', async () => {
    const good = makeTempModule(
      'good.mjs',
      `export default { name: 'g-ok', direction: 'input', validate: () => ({ pass: true }) };`
    );
    try {
      const reg = defaultRegistry();
      await loadCustomGuardrails(
        ['/path/does/not/exist/nope.mjs', good],
        { registry: reg }
      );
      expect(reg.get('g-ok')).toBeDefined();
    } finally {
      rmSync(good, { force: true });
    }
  });

  it('initGuardrails is a no-op when disabled or paths empty', async () => {
    await expect(
      initGuardrails({ enabled: false, builtin: [], customPaths: ['/whatever'] })
    ).resolves.toBe(0);
    await expect(
      initGuardrails({ enabled: true, builtin: [] })
    ).resolves.toBe(0);
  });
});
