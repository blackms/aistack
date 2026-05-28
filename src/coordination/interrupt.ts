/**
 * First-class HITL (Human-In-The-Loop) primitive — `interrupt()`.
 *
 * Inspired by LangGraph's interrupt() and Temporal's signal pattern. Lets
 * a workflow or agent pause execution, persist its state, notify a human
 * reviewer, and resume with the value (and optionally modified state) the
 * reviewer supplies.
 *
 * Usage:
 *   const choice = await interrupt({
 *     sessionId: ctx.sessionId,
 *     prompt: 'Choose deployment target',
 *     schema: { type: 'enum', enum: ['staging', 'production'] },
 *     state: { build: ctx.buildArtifact },
 *     notify: ['console', 'slack'],
 *   });
 *
 * The Promise resolves when an operator calls `resumeInterrupt()` via the
 * CLI (`aistack workflow resume`), the web UI (`POST /api/v1/interrupts/:id/resume`),
 * or programmatically. Resolution carries the (validated) input value back
 * into the workflow.
 *
 * Persistence: by default uses an in-memory store. Hosts that have
 * AIG-633's Checkpointer available can plug it in via
 * `setInterruptPersistence()` so interrupts survive process restarts.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  type InterruptOptions,
  type InterruptRecord,
  type InterruptStatus,
  type ResumePayload,
  InterruptPending,
  InterruptTimeoutError,
  InterruptValidationError,
} from './interrupt-types.js';
import { getInterruptNotifier } from './interrupt-notifier.js';
import { logger } from '../utils/logger.js';

const log = logger.child('interrupt');

/**
 * Optional pluggable persistence layer. When set, the store mirrors every
 * write through these hooks so interrupts can be loaded after a crash.
 * Designed to slot directly onto AIG-633's `Checkpointer.save` /
 * `loadLatest` — the host wires them up at boot.
 */
export interface InterruptPersistence {
  save(record: InterruptRecord): Promise<void> | void;
  loadAll(): Promise<InterruptRecord[]> | InterruptRecord[];
  delete(id: string): Promise<void> | void;
}

let persistence: InterruptPersistence | null = null;

export function setInterruptPersistence(p: InterruptPersistence | null): void {
  persistence = p;
}

/**
 * Snapshot the mutable fields of an InterruptRecord so a failed write can be
 * rolled back. `state` is shallow-cloned because state edits mutate it in
 * place via `applyStateEdit`; deep nested objects share references, which is
 * fine for the rollback semantics we need (we only ever overwrite the top
 * level of `state` on rollback) — and far cheaper than `structuredClone`.
 */
interface RecordSnapshot {
  status: InterruptStatus;
  state?: Record<string, unknown>;
  resumeValue: unknown;
  resolvedAt?: string;
  cancelReason?: string;
  claimedAt?: string;
}

function snapshot(r: InterruptRecord): RecordSnapshot {
  return {
    status: r.status,
    state: r.state ? structuredClone(r.state) : undefined,
    resumeValue: r.resumeValue,
    resolvedAt: r.resolvedAt,
    cancelReason: r.cancelReason,
    claimedAt: r.claimedAt,
  };
}

function restore(r: InterruptRecord, s: RecordSnapshot): void {
  r.status = s.status;
  r.state = s.state;
  r.resumeValue = s.resumeValue;
  r.resolvedAt = s.resolvedAt;
  r.cancelReason = s.cancelReason;
  r.claimedAt = s.claimedAt;
}

/**
 * In-process store of interrupt records. Emits `created`, `resolved`,
 * `cancelled` events so the Promise returned by interrupt() can wake up
 * without polling when running in the same process. Polling is still used
 * as a fallback for cross-process resumes (CLI <-> daemon).
 *
 * Concurrency: each record has an async mutex queue so concurrent
 * resume/cancel/reopen operations serialize. Combined with snapshot-based
 * rollback this gives us BEGIN/COMMIT/ROLLBACK semantics — even when the
 * pluggable persistence layer is asynchronous (e.g. SQLite IMMEDIATE) the
 * in-memory and durable views can never disagree.
 */
export class InterruptStore extends EventEmitter {
  private records = new Map<string, InterruptRecord>();
  /** Tail of the per-record serialization chain. */
  private locks = new Map<string, Promise<unknown>>();

  /**
   * Run `fn` while holding the lock for `id`. Operations against the same
   * record execute strictly in submission order; different records run in
   * parallel. Errors propagate to the caller; the lock is always released.
   */
  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prev.then(() => gate);
    this.locks.set(id, chained);
    try {
      await prev;
      return await fn();
    } finally {
      release();
      // Best-effort GC: when no later acquirer chained on top of us, drop
      // the entry so the map does not grow unbounded across many records.
      if (this.locks.get(id) === chained) {
        this.locks.delete(id);
      }
    }
  }

  list(filter?: { sessionId?: string; status?: InterruptStatus }): InterruptRecord[] {
    const all = Array.from(this.records.values());
    return all
      .filter((r) => (filter?.sessionId ? r.sessionId === filter.sessionId : true))
      .filter((r) => (filter?.status ? r.status === filter.status : true))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id: string): InterruptRecord | undefined {
    return this.records.get(id);
  }

  /** Latest pending interrupt for a session (used by `workflow inspect`). */
  latestPendingForSession(sessionId: string): InterruptRecord | undefined {
    return this.list({ sessionId, status: 'pending' }).pop();
  }

  async create(record: InterruptRecord): Promise<InterruptRecord> {
    this.records.set(record.id, record);
    if (persistence) {
      try {
        await persistence.save(record);
      } catch (err) {
        log.error('Interrupt persistence.save failed (continuing in-memory)', { err, id: record.id });
      }
    }
    this.emit('created', record);
    return record;
  }

  /** Mark an interrupt as claimed (an operator started reviewing it). */
  async claim(id: string): Promise<InterruptRecord | undefined> {
    return this.withLock(id, async () => {
      const r = this.records.get(id);
      if (!r || r.status !== 'pending') return r;
      const snap = snapshot(r);
      r.claimedAt = new Date().toISOString();
      if (persistence) {
        try {
          await persistence.save(r);
        } catch (err) {
          restore(r, snap);
          throw err;
        }
      }
      return r;
    });
  }

  /**
   * Atomically apply `stateEdits` (mutating record.state) and mark the record
   * resolved. The whole sequence is wrapped in a per-record lock so concurrent
   * resumes/cancels cannot interleave, and a single persistence.save commits
   * both the new state and the resolved status together. If persistence
   * fails, the in-memory record is rolled back to its pre-call snapshot —
   * leaving the interrupt pending — and no `resolved` event is emitted.
   */
  async resolveAtomic(
    id: string,
    value: unknown,
    mutate?: (r: InterruptRecord) => void
  ): Promise<InterruptRecord | undefined> {
    return this.withLock(id, async () => {
      const r = this.records.get(id);
      if (!r) return undefined;
      if (r.status !== 'pending') {
        throw new Error(`Cannot resolve interrupt ${id}: status is ${r.status}`);
      }
      const snap = snapshot(r);
      try {
        // Apply user-supplied state mutations BEFORE marking resolved so
        // both transitions land in a single persistence.save (the "COMMIT").
        if (mutate) mutate(r);
        r.status = 'resolved';
        r.resumeValue = value;
        r.resolvedAt = new Date().toISOString();
        if (persistence) await persistence.save(r);
      } catch (err) {
        // ROLLBACK — leave the record exactly as we found it.
        restore(r, snap);
        throw err;
      }
      this.emit('resolved', r);
      return r;
    });
  }

  /**
   * @deprecated Use {@link resolveAtomic} which also commits state edits in
   * the same transaction. Kept for source-compat; internally delegates so
   * concurrent callers still serialize.
   */
  async resolve(id: string, value: unknown): Promise<InterruptRecord | undefined> {
    return this.resolveAtomic(id, value);
  }

  async cancel(id: string, reason: string): Promise<InterruptRecord | undefined> {
    return this.withLock(id, async () => {
      const r = this.records.get(id);
      if (!r) return undefined;
      if (r.status !== 'pending') return r;
      const snap = snapshot(r);
      try {
        r.status = 'cancelled';
        r.cancelReason = reason;
        r.resolvedAt = new Date().toISOString();
        if (persistence) await persistence.save(r);
      } catch (err) {
        restore(r, snap);
        throw err;
      }
      this.emit('cancelled', r);
      return r;
    });
  }

  /**
   * Atomic reopen: used when a validation check on the resume value fails
   * AFTER the record was marked resolved. Re-acquires the per-record lock so
   * we cannot race with a concurrent operator action, clears the resume
   * fields, flips status back to `pending`, and persists in one shot. On
   * persistence failure rolls back to the prior (resolved) snapshot so the
   * in-memory view does not drift from disk.
   */
  async reopen(id: string): Promise<InterruptRecord | undefined> {
    return this.withLock(id, async () => {
      const r = this.records.get(id);
      if (!r) return undefined;
      const snap = snapshot(r);
      try {
        r.status = 'pending';
        r.resumeValue = undefined;
        r.resolvedAt = undefined;
        if (persistence) await persistence.save(r);
      } catch (err) {
        restore(r, snap);
        throw err;
      }
      return r;
    });
  }

  async hydrate(): Promise<void> {
    if (!persistence) return;
    const loaded = await persistence.loadAll();
    for (const r of loaded) this.records.set(r.id, r);
    log.debug('Hydrated interrupt store', { count: loaded.length });
  }

  clear(): void {
    this.records.clear();
    this.locks.clear();
    this.removeAllListeners();
  }
}

let defaultStore: InterruptStore | null = null;
export function getInterruptStore(): InterruptStore {
  if (!defaultStore) defaultStore = new InterruptStore();
  return defaultStore;
}
export function resetInterruptStore(): void {
  defaultStore?.clear();
  defaultStore = null;
}

/**
 * Apply a state edit expressed as a `path=value` pair in dot notation
 * (e.g. `config.maxRetries=5`). Mutates `state` in place and returns it.
 * Values are JSON-parsed when possible (so `5`, `"foo"`, `true`, `null`,
 * arrays/objects all work); on parse failure they are treated as strings.
 */
export function applyStateEdit(
  state: Record<string, unknown>,
  edit: { path: string; value: unknown }
): Record<string, unknown> {
  const segments = edit.path.replace(/^\$\.?/, '').split('.').filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`Invalid state edit path: ${edit.path}`);
  }
  let cursor: Record<string, unknown> = state;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i]!;
    const next = cursor[key];
    if (next === null || next === undefined || typeof next !== 'object' || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  const last = segments[segments.length - 1]!;
  let parsed: unknown = edit.value;
  if (typeof edit.value === 'string') {
    try {
      parsed = JSON.parse(edit.value);
    } catch {
      parsed = edit.value;
    }
  }
  cursor[last] = parsed;
  return state;
}

function validateResumeValue(opts: InterruptOptions, value: unknown): unknown {
  if (opts.zodSchema) {
    const result = opts.zodSchema.safeParse(value);
    if (!result.success) {
      throw new InterruptValidationError(
        `Resume value failed zod validation for interrupt on session ${opts.sessionId}`,
        result.error
      );
    }
    return result.data;
  }
  const schema = opts.schema;
  if (!schema) return value;
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') throw new InterruptValidationError('expected string');
      return value;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) throw new InterruptValidationError('expected number');
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') throw new InterruptValidationError('expected boolean');
      return value;
    case 'array':
      if (!Array.isArray(value)) throw new InterruptValidationError('expected array');
      return value;
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new InterruptValidationError('expected object');
      }
      return value;
    case 'enum': {
      const allowed = schema.enum ?? [];
      if (!allowed.includes(value as string | number)) {
        throw new InterruptValidationError(
          `value ${JSON.stringify(value)} not in enum ${JSON.stringify(allowed)}`
        );
      }
      return value;
    }
    default:
      return value;
  }
}

/**
 * The core HITL primitive. Pauses the calling async flow, registers an
 * interrupt record, notifies subscribed channels, and returns a Promise
 * that resolves with the (validated) operator-supplied value.
 *
 * Throws `InterruptTimeoutError` when `timeoutMs` elapses without a resume.
 * Throws `InterruptValidationError` when the resume value fails schema.
 */
export async function interrupt<T = unknown>(opts: InterruptOptions): Promise<T> {
  if (!opts.sessionId) throw new Error('interrupt(): sessionId is required');
  if (!opts.prompt) throw new Error('interrupt(): prompt is required');

  const store = getInterruptStore();
  const notifier = getInterruptNotifier();

  const record: InterruptRecord = {
    id: `int_${randomUUID()}`,
    sessionId: opts.sessionId,
    workflowId: opts.workflowId,
    prompt: opts.prompt,
    schema: opts.schema,
    state: opts.state,
    status: 'pending',
    notify: opts.notify ?? ['console'],
    createdAt: new Date().toISOString(),
  };

  await store.create(record);
  // Fire-and-forget notify so we don't block the workflow on slow webhooks;
  // failures are already logged inside each sink.
  void notifier.notify(record);

  log.info('interrupt registered', {
    id: record.id,
    sessionId: record.sessionId,
    workflowId: record.workflowId,
  });

  const pollMs = opts.pollIntervalMs ?? 250;
  return new Promise<T>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    let interval: NodeJS.Timeout | null = null;
    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      if (interval) clearInterval(interval);
      store.off('resolved', onResolved);
      store.off('cancelled', onCancelled);
    };
    const onResolved = (r: InterruptRecord): void => {
      if (r.id !== record.id) return;
      cleanup();
      let validated: unknown;
      try {
        validated = validateResumeValue(opts, r.resumeValue);
      } catch (err) {
        // Reopen the interrupt atomically: validation failed, operator must
        // retry. We go through the store so the reopen takes the per-record
        // lock (preventing races with a concurrent resume/cancel) AND so the
        // persistence write is rolled back on failure — leaving disk and
        // memory in agreement.
        log.warn('Resume value rejected by schema; reopening interrupt', { id: r.id });
        store
          .reopen(r.id)
          .catch((reopenErr) => {
            log.error('Failed to reopen interrupt after validation failure', {
              id: r.id,
              err: reopenErr,
            });
          })
          .finally(() => reject(err));
        return;
      }
      resolve(validated as T);
    };
    const onCancelled = (r: InterruptRecord): void => {
      if (r.id !== record.id) return;
      cleanup();
      reject(new InterruptPending(r));
    };
    store.on('resolved', onResolved);
    store.on('cancelled', onCancelled);

    // Cross-process safety net: even without events, poll periodically.
    interval = setInterval(() => {
      const current = store.get(record.id);
      if (!current) return;
      if (current.status === 'resolved') onResolved(current);
      else if (current.status === 'cancelled') onCancelled(current);
    }, pollMs);
    // Allow the host process to exit naturally when the only thing keeping
    // the loop alive is this poll (mostly relevant for tests).
    if (typeof interval.unref === 'function') interval.unref();

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        // Detach listeners first so the cancel() we trigger below does not
        // race with onCancelled and surface InterruptPending instead.
        cleanup();
        void store.cancel(record.id, 'timeout');
        reject(new InterruptTimeoutError(record.id));
      }, opts.timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    }
  });
}

/**
 * Resume an interrupt with the supplied payload. Applies any `stateEdits`
 * to the record's `state` snapshot AND marks the record resolved as a single
 * atomic transaction — on persistence failure the state mutations are
 * rolled back along with the status change, so the interrupt remains
 * pending and the operator can retry against a clean record.
 *
 * Used by the CLI (`workflow resume --input`) and the web route.
 */
export async function resumeInterrupt(
  id: string,
  payload: ResumePayload
): Promise<InterruptRecord> {
  const store = getInterruptStore();
  const record = store.get(id);
  if (!record) throw new Error(`Interrupt ${id} not found`);
  if (record.status !== 'pending') {
    throw new Error(`Interrupt ${id} is ${record.status}, cannot resume`);
  }
  const resolved = await store.resolveAtomic(id, payload.input, (r) => {
    if (payload.stateEdits && payload.stateEdits.length > 0) {
      r.state = r.state ?? {};
      for (const edit of payload.stateEdits) {
        applyStateEdit(r.state, edit);
      }
    }
  });
  if (!resolved) throw new Error(`Failed to resolve interrupt ${id}`);
  return resolved;
}

/**
 * Resume the *latest pending* interrupt for a session. Convenience wrapper
 * used by the CLI when the operator passes only a session id.
 */
export async function resumeLatestForSession(
  sessionId: string,
  payload: ResumePayload
): Promise<InterruptRecord> {
  const store = getInterruptStore();
  const latest = store.latestPendingForSession(sessionId);
  if (!latest) throw new Error(`No pending interrupt for session ${sessionId}`);
  return resumeInterrupt(latest.id, payload);
}

export {
  InterruptPending,
  InterruptTimeoutError,
  InterruptValidationError,
} from './interrupt-types.js';

export type {
  InterruptOptions,
  InterruptRecord,
  InterruptStatus,
  ResumePayload,
  InterruptValueSchema,
  InterruptNotifyChannel,
} from './interrupt-types.js';
