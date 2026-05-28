/**
 * Unit tests for AIG-644 HITL interrupt primitives.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  WebhookSink,
  WEBHOOK_SIGNATURE_HEADER,
  signWebhookBody,
  verifyWebhookSignature,
  type NotifierSink,
} from '../../src/coordination/interrupt-notifier.js';
import type { InterruptRecord } from '../../src/coordination/interrupt-types.js';
import { setInterruptPersistence } from '../../src/coordination/interrupt.js';

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

async function waitFor<T>(
  probe: () => T | undefined | null | false,
  label: string,
  timeoutMs = 1000,
  intervalMs = 5
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForPendingInterrupt(sessionId: string): Promise<InterruptRecord> {
  return waitFor(
    () => getInterruptStore().latestPendingForSession(sessionId),
    `pending interrupt for ${sessionId}`
  );
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
    await waitFor(() => received[0], 'webhook notification');
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
    const rec = await waitForPendingInterrupt(sessionId);

    // CLI "inspect" equivalent — what an operator would see.
    const pending = getInterruptStore().list({ sessionId, status: 'pending' });
    expect(pending).toHaveLength(1);
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
    const rec = await waitForPendingInterrupt(sessionId);
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
    const rec = await waitForPendingInterrupt(sessionId);
    await resumeInterrupt(rec.id, { input: 'devvvv' });
    const result = await workflowPromise;
    expect(result).toBeInstanceOf(Error);
    expect(getInterruptStore().get(rec.id)?.status).toBe('pending');
  });
});

describe('WebhookSink (HMAC + timeout)', () => {
  beforeEach(() => {
    resetInterruptStore();
    resetInterruptNotifier();
  });
  afterEach(() => {
    delete process.env.AISTACK_WEBHOOK_SECRET;
  });

  const SECRET = 'shh-its-a-secret';
  const sampleRecord: InterruptRecord = {
    id: 'int_test',
    sessionId: 's1',
    prompt: 'do thing?',
    status: 'pending',
    notify: ['webhook'],
    createdAt: '2026-05-28T00:00:00.000Z',
  };

  it('signs outbound webhook bodies with HMAC-SHA256', async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url, init) => {
        captured.url = String(url);
        captured.init = init as RequestInit;
        return new Response(null, { status: 200 });
      });
    const sink = new WebhookSink({ url: 'https://example.test/hook', secret: SECRET });
    await sink.send(sampleRecord);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const headers = captured.init?.headers as Record<string, string>;
    const sig = headers[WEBHOOK_SIGNATURE_HEADER];
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    // Receiver-side verification must succeed against the exact body sent.
    const body = String(captured.init?.body ?? '');
    expect(verifyWebhookSignature(SECRET, body, sig!)).toBe(true);
    // And fail under tampering / wrong secret.
    expect(verifyWebhookSignature(SECRET, body + 'x', sig!)).toBe(false);
    expect(verifyWebhookSignature('wrong-secret', body, sig!)).toBe(false);
    fetchSpy.mockRestore();
  });

  it('falls back to AISTACK_WEBHOOK_SECRET when options.secret is omitted', async () => {
    process.env.AISTACK_WEBHOOK_SECRET = SECRET;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }) as Response
    );
    const sink = new WebhookSink({ url: 'https://example.test/hook' });
    await sink.send(sampleRecord);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers[WEBHOOK_SIGNATURE_HEADER]).toBeDefined();
    fetchSpy.mockRestore();
  });

  it('refuses to send when no secret is configured (fail-closed)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const sink = new WebhookSink({ url: 'https://example.test/hook' });
    await sink.send(sampleRecord);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('aborts the request after the configured timeout', async () => {
    // Mock fetch to hang until the AbortSignal fires, then reject AbortError.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal;
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    });
    const sink = new WebhookSink({
      url: 'https://example.test/hook',
      secret: SECRET,
      timeoutMs: 15,
    });
    const start = Date.now();
    await sink.send(sampleRecord);
    const elapsed = Date.now() - start;
    // Should return within roughly the timeout window, not stall forever.
    expect(elapsed).toBeLessThan(500);
    fetchSpy.mockRestore();
  });

  it('signWebhookBody produces stable output for identical input', () => {
    const a = signWebhookBody(SECRET, 'hello');
    const b = signWebhookBody(SECRET, 'hello');
    expect(a).toBe(b);
    expect(signWebhookBody(SECRET, 'hellO')).not.toBe(a);
  });
});

describe('atomic resume + reopen (transactional)', () => {
  beforeEach(() => {
    resetInterruptStore();
    resetInterruptNotifier();
  });
  afterEach(() => {
    setInterruptPersistence(null);
  });

  it('rolls back state edits and status when persistence.save fails during resume', async () => {
    let allowSave = true;
    const saves: InterruptRecord[] = [];
    setInterruptPersistence({
      async save(r) {
        if (!allowSave) throw new Error('disk full');
        saves.push(JSON.parse(JSON.stringify(r)) as InterruptRecord);
      },
      loadAll: () => [],
      delete: () => {},
    });

    const promise = interrupt({
      sessionId: 'sess-atomic-1',
      prompt: 'p',
      state: { config: { tries: 1 }, name: 'before' },
      pollIntervalMs: 10,
    }).catch((e: unknown) => e); // swallow — we never actually resume successfully
    await new Promise((r) => setImmediate(r));

    const rec = getInterruptStore().list({ sessionId: 'sess-atomic-1' })[0]!;
    // Snapshot of what disk and memory look like right now.
    const beforeStatus = rec.status;
    const beforeState = JSON.parse(JSON.stringify(rec.state));

    // Flip persistence to fail and attempt a resume that mutates state.
    allowSave = false;
    await expect(
      resumeInterrupt(rec.id, {
        input: 'x',
        stateEdits: [
          { path: 'config.tries', value: '99' },
          { path: 'name', value: '"after"' },
        ],
      })
    ).rejects.toThrow(/disk full/);

    // Status AND state must be exactly what they were before the failed call.
    const after = getInterruptStore().get(rec.id)!;
    expect(after.status).toBe(beforeStatus);
    expect(after.state).toEqual(beforeState);
    // Allow next save so we can clean up the hanging interrupt() promise.
    allowSave = true;
    await resumeInterrupt(rec.id, { input: 'x' });
    await promise;
  });

  it('rolls back the reopen-on-validation-failure when persistence.save fails', async () => {
    let saveCount = 0;
    let failOnSave: number | null = null;
    setInterruptPersistence({
      async save(_r) {
        saveCount++;
        if (failOnSave !== null && saveCount === failOnSave) {
          throw new Error('rollback the reopen');
        }
      },
      loadAll: () => [],
      delete: () => {},
    });

    const promise = interrupt<string>({
      sessionId: 'sess-atomic-2',
      prompt: 'enum',
      schema: { type: 'enum', enum: ['a', 'b'] },
      pollIntervalMs: 10,
    }).catch((e: unknown) => e);
    await new Promise((r) => setImmediate(r));

    const rec = getInterruptStore().list({ sessionId: 'sess-atomic-2' })[0]!;
    // Configure save#3 to fail. Saves so far: 1 = create. Resume below does
    // 1 more save (resolveAtomic). Reopen would do the 3rd — that one fails.
    failOnSave = 3;
    await resumeInterrupt(rec.id, { input: 'bogus' });
    const result = await promise;
    expect(result).toBeInstanceOf(InterruptValidationError);

    const after = getInterruptStore().get(rec.id)!;
    // Because the reopen-save failed, the rollback restored the prior
    // (resolved) status — disk and memory agree on "still resolved".
    expect(after.status).toBe('resolved');
  });

  it('serializes concurrent resolve calls — second one sees "not pending"', async () => {
    const promise = interrupt({
      sessionId: 'sess-atomic-3',
      prompt: 'p',
      pollIntervalMs: 10,
    });
    await new Promise((r) => setImmediate(r));
    const rec = getInterruptStore().list({ sessionId: 'sess-atomic-3' })[0]!;

    const a = resumeInterrupt(rec.id, { input: 'first' });
    const b = resumeInterrupt(rec.id, { input: 'second' });
    const results = await Promise.allSettled([a, b]);
    // Exactly one wins, the other rejects with "cannot resume" / "status is".
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    await promise;
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
