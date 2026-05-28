/**
 * Tests for the guardrails parallel runner.
 */

import { describe, it, expect, vi } from 'vitest';
import { runGuardrails } from '../../../src/guardrails/runner.js';
import {
  withGuardrails,
  GuardrailBlockedError,
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
    });
    expect(out.pass).toBe(false);
    expect(out.failures[0].crashed).toBe(true);
    expect(out.failures[0].reason).toMatch(/timed out/);
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
