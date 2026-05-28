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
 * In-process store of interrupt records. Emits `created`, `resolved`,
 * `cancelled` events so the Promise returned by interrupt() can wake up
 * without polling when running in the same process. Polling is still used
 * as a fallback for cross-process resumes (CLI <-> daemon).
 */
export class InterruptStore extends EventEmitter {
  private records = new Map<string, InterruptRecord>();

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
    const r = this.records.get(id);
    if (!r || r.status !== 'pending') return r;
    r.claimedAt = new Date().toISOString();
    if (persistence) await persistence.save(r);
    return r;
  }

  async resolve(id: string, value: unknown): Promise<InterruptRecord | undefined> {
    const r = this.records.get(id);
    if (!r) return undefined;
    if (r.status !== 'pending') {
      throw new Error(`Cannot resolve interrupt ${id}: status is ${r.status}`);
    }
    r.status = 'resolved';
    r.resumeValue = value;
    r.resolvedAt = new Date().toISOString();
    if (persistence) await persistence.save(r);
    this.emit('resolved', r);
    return r;
  }

  async cancel(id: string, reason: string): Promise<InterruptRecord | undefined> {
    const r = this.records.get(id);
    if (!r) return undefined;
    if (r.status !== 'pending') return r;
    r.status = 'cancelled';
    r.cancelReason = reason;
    r.resolvedAt = new Date().toISOString();
    if (persistence) await persistence.save(r);
    this.emit('cancelled', r);
    return r;
  }

  async hydrate(): Promise<void> {
    if (!persistence) return;
    const loaded = await persistence.loadAll();
    for (const r of loaded) this.records.set(r.id, r);
    log.debug('Hydrated interrupt store', { count: loaded.length });
  }

  clear(): void {
    this.records.clear();
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
      try {
        const validated = validateResumeValue(opts, r.resumeValue);
        resolve(validated as T);
      } catch (err) {
        // Reopen the interrupt: validation failed, operator must retry.
        r.status = 'pending';
        r.resumeValue = undefined;
        r.resolvedAt = undefined;
        if (persistence) void persistence.save(r);
        log.warn('Resume value rejected by schema; reopening interrupt', { id: r.id });
        reject(err);
      }
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
 * to the record's `state` snapshot before resolving the waiting Promise.
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
  if (payload.stateEdits && payload.stateEdits.length > 0) {
    record.state = record.state ?? {};
    for (const edit of payload.stateEdits) {
      applyStateEdit(record.state, edit);
    }
    if (persistence) await persistence.save(record);
  }
  const resolved = await store.resolve(id, payload.input);
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
