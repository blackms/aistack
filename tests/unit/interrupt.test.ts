/**
 * Unit tests for AIG-644 HITL interrupt primitives.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  interrupt,
  resumeInterrupt,
  resumeLatestForSession,
  applyStateEdit,
  getInterruptStore,
  resetInterruptStore,
  InterruptValidationError,
  InterruptTimeoutError,
} from '../../src/coordination/interrupt.js';
import {
  getInterruptNotifier,
  resetInterruptNotifier,
  type NotifierSink,
} from '../../src/coordination/interrupt-notifier.js';
import type { InterruptRecord } from '../../src/coordination/interrupt-types.js';

/**
 * Simulated 3-step workflow used by the end-to-end tests below. Lives in
 * this file (rather than tests/integration/) so the whole HITL surface
 * stays under a single test module — keeps the change footprint minimal.
 */
interface DeployState {
  build: { sha: string };
  target?: string;
  retries: number;
  succeeded?: boolean;
}
async function runDeployWorkflow(sessionId: string): Promise<DeployState> {
  const state: DeployState = { build: { sha: 'abc1234' }, retries: 1 };
  const target = await interrupt<string>({
    sessionId,
    workflowId: 'deploy',
    prompt: 'Choose deployment target',
    schema: { type: 'enum', enum: ['staging', 'production'] },
    state,
    notify: ['console'],
    pollIntervalMs: 25,
  });
  state.target = target;
  state.succeeded = true;
  return state;
}

describe('interrupt()', () => {
  beforeEach(() => {
    resetInterruptStore();
    resetInterruptNotifier();
  });

  it('returns the value supplied by resumeInterrupt()', async () => {
    const promise = interrupt<string>({
      sessionId: 'sess-1',
      prompt: 'pick one',
      pollIntervalMs: 10,
    });
    // Tick after the record is registered.
    await new Promise((r) => setImmediate(r));
    const records = getInterruptStore().list({ sessionId: 'sess-1' });
    expect(records).toHaveLength(1);
    await resumeInterrupt(records[0]!.id, { input: 'hello' });
    const value = await promise;
    expect(value).toBe('hello');
  });

  it('validates resume value against an enum schema and rejects bad input', async () => {
    const promise = interrupt({
      sessionId: 'sess-2',
      prompt: 'env',
      schema: { type: 'enum', enum: ['staging', 'prod'] },
      pollIntervalMs: 10,
    });
    await new Promise((r) => setImmediate(r));
    const rec = getInterruptStore().list({ sessionId: 'sess-2' })[0]!;
    await resumeInterrupt(rec.id, { input: 'banana' });
    await expect(promise).rejects.toBeInstanceOf(InterruptValidationError);
    // Validation failure should reopen the interrupt so it can be retried.
    expect(getInterruptStore().get(rec.id)?.status).toBe('pending');
  });

  it('accepts a Zod-like validator and round-trips parsed data', async () => {
    const promise = interrupt<number>({
      sessionId: 'sess-3',
      prompt: 'count',
      zodSchema: {
        safeParse: (v: unknown) =>
          typeof v === 'number' && v >= 0
            ? { success: true, data: v }
            : { success: false, error: 'must be non-negative number' },
      },
      pollIntervalMs: 10,
    });
    await new Promise((r) => setImmediate(r));
    const rec = getInterruptStore().list({ sessionId: 'sess-3' })[0]!;
    await resumeInterrupt(rec.id, { input: 42 });
    await expect(promise).resolves.toBe(42);
  });

  it('times out and rejects when no resume arrives', async () => {
    vi.useFakeTimers();
    const promise = interrupt({
      sessionId: 'sess-4',
      prompt: 'will time out',
      timeoutMs: 50,
      pollIntervalMs: 10,
    });
    const tick = vi.advanceTimersByTimeAsync(100);
    await expect(promise).rejects.toBeInstanceOf(InterruptTimeoutError);
    await tick;
    vi.useRealTimers();
  });

  it('applies state edits before resolving', async () => {
    const promise = interrupt<string>({
      sessionId: 'sess-5',
      prompt: 'edit me',
      state: { config: { maxRetries: 3 }, name: 'orig' },
      pollIntervalMs: 10,
    });
    await new Promise((r) => setImmediate(r));
    const rec = getInterruptStore().list({ sessionId: 'sess-5' })[0]!;
    await resumeLatestForSession('sess-5', {
      input: 'ok',
      stateEdits: [
        { path: 'config.maxRetries', value: '5' },
        { path: 'name', value: '"renamed"' },
      ],
    });
    await expect(promise).resolves.toBe('ok');
    const after = getInterruptStore().get(rec.id)!;
    expect(after.state).toEqual({ config: { maxRetries: 5 }, name: 'renamed' });
  });

  it('notifies all requested channels on creation', async () => {
    const received: InterruptRecord[] = [];
    const customSink: NotifierSink = {
      channel: 'webhook',
      async send(r) {
        received.push(r);
      },
    };
    getInterruptNotifier().register(customSink);
    const promise = interrupt({
      sessionId: 'sess-6',
      prompt: 'notify',
      notify: ['webhook'],
      pollIntervalMs: 10,
    });
    // Wait one microtask for the fire-and-forget notify to land.
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toHaveLength(1);
    expect(received[0]!.prompt).toBe('notify');
    const rec = getInterruptStore().list({ sessionId: 'sess-6' })[0]!;
    await resumeInterrupt(rec.id, { input: null });
    await promise;
  });
});

describe('applyStateEdit()', () => {
  it('creates intermediate objects when the path does not exist', () => {
    const state = {} as Record<string, unknown>;
    applyStateEdit(state, { path: 'a.b.c', value: '42' });
    expect(state).toEqual({ a: { b: { c: 42 } } });
  });

  it('parses JSON values when possible, falls back to string', () => {
    const state = {} as Record<string, unknown>;
    applyStateEdit(state, { path: 'x', value: 'not json' });
    applyStateEdit(state, { path: 'y', value: 'true' });
    applyStateEdit(state, { path: 'z', value: '[1,2]' });
    expect(state).toEqual({ x: 'not json', y: true, z: [1, 2] });
  });

  it('supports JSONPath-style $ prefix', () => {
    const state = { foo: { bar: 1 } } as Record<string, unknown>;
    applyStateEdit(state, { path: '$.foo.bar', value: '9' });
    expect(state).toEqual({ foo: { bar: 9 } });
  });

  it('throws on empty path', () => {
    expect(() => applyStateEdit({}, { path: '', value: 'x' })).toThrow();
  });
});

describe('HITL interrupt end-to-end (workflow → inspect → resume)', () => {
  beforeEach(() => {
    resetInterruptStore();
    resetInterruptNotifier();
  });

  it('pauses, surfaces inspectable state, resumes with operator input', async () => {
    const sessionId = 'sess-e2e-1';
    const workflowPromise = runDeployWorkflow(sessionId);
    await new Promise((r) => setTimeout(r, 10));

    // CLI "inspect" equivalent — what an operator would see.
    const pending = getInterruptStore().list({ sessionId, status: 'pending' });
    expect(pending).toHaveLength(1);
    const rec = pending[0]!;
    expect(rec.prompt).toBe('Choose deployment target');
    expect(rec.schema).toEqual({ type: 'enum', enum: ['staging', 'production'] });
    expect(rec.state).toMatchObject({ build: { sha: 'abc1234' }, retries: 1 });

    // CLI "resume --input" equivalent.
    await resumeLatestForSession(sessionId, { input: 'staging' });
    const finalState = await workflowPromise;
    expect(finalState.target).toBe('staging');
    expect(finalState.succeeded).toBe(true);
    expect(getInterruptStore().get(rec.id)?.status).toBe('resolved');
  });

  it('allows the operator to edit captured state before resuming', async () => {
    const sessionId = 'sess-e2e-2';
    const workflowPromise = runDeployWorkflow(sessionId);
    await new Promise((r) => setTimeout(r, 10));
    const rec = getInterruptStore().latestPendingForSession(sessionId)!;
    await resumeInterrupt(rec.id, {
      input: 'production',
      stateEdits: [{ path: 'retries', value: '5' }],
    });
    await workflowPromise;
    expect(getInterruptStore().get(rec.id)?.state).toMatchObject({ retries: 5 });
  });

  it('rejects an invalid resume value and keeps the interrupt pending', async () => {
    const sessionId = 'sess-e2e-3';
    const workflowPromise = runDeployWorkflow(sessionId).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 10));
    const rec = getInterruptStore().latestPendingForSession(sessionId)!;
    await resumeInterrupt(rec.id, { input: 'devvvv' });
    const result = await workflowPromise;
    expect(result).toBeInstanceOf(Error);
    expect(getInterruptStore().get(rec.id)?.status).toBe('pending');
  });
});

describe('InterruptStore', () => {
  beforeEach(() => resetInterruptStore());

  it('list() filters by sessionId and status', async () => {
    const promiseA = interrupt({ sessionId: 's1', prompt: 'a', pollIntervalMs: 10 });
    const promiseB = interrupt({ sessionId: 's2', prompt: 'b', pollIntervalMs: 10 });
    await new Promise((r) => setImmediate(r));
    const store = getInterruptStore();
    expect(store.list({ sessionId: 's1' })).toHaveLength(1);
    expect(store.list({ sessionId: 's2' })).toHaveLength(1);
    expect(store.list({ status: 'pending' })).toHaveLength(2);
    // Cleanup hanging promises.
    const a = store.list({ sessionId: 's1' })[0]!;
    const b = store.list({ sessionId: 's2' })[0]!;
    await resumeInterrupt(a.id, { input: null });
    await resumeInterrupt(b.id, { input: null });
    await Promise.all([promiseA, promiseB]);
    expect(store.list({ status: 'resolved' })).toHaveLength(2);
  });
});
