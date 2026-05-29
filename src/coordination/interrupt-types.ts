/**
 * Types for HITL (Human-In-The-Loop) interrupt primitives.
 *
 * See `interrupt.ts` for the runtime + store, and docs/HITL.md for the
 * conceptual model (LangGraph-style interrupt + state edit + resume).
 */

export type InterruptStatus = 'pending' | 'resolved' | 'cancelled';

export type InterruptNotifyChannel = 'console' | 'slack' | 'webhook';

/**
 * Minimal schema descriptor (subset of JSON Schema) used to describe the
 * expected shape of the human-supplied resume value. Kept intentionally tiny
 * so it can be serialized into a checkpoint without a Zod-to-JSONSchema
 * dependency. Real Zod schemas can be passed too (via `zodSchema`) and will
 * be validated at runtime when available.
 */
export interface InterruptValueSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'enum';
  /** Allowed values when `type` is `'enum'`. */
  enum?: ReadonlyArray<string | number>;
  /** Free-form description shown to the human reviewer. */
  description?: string;
  /** Optional default value if the reviewer accepts the suggested value. */
  default?: unknown;
}

/**
 * Lightweight "Zod-like" validator surface: anything exposing `safeParse`
 * is acceptable. Avoids a hard dependency on zod in this module while still
 * allowing callers to pass a real `z.string()` / `z.enum([...])`.
 */
export interface ZodLike<T = unknown> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown };
}

export interface InterruptOptions {
  /** Stable identifier of the running workflow / session. */
  sessionId: string;
  /** Optional logical workflow id (e.g. dsl workflow name). */
  workflowId?: string;
  /** Human-readable prompt shown to the reviewer. */
  prompt: string;
  /** Optional schema descriptor for the expected resume value. */
  schema?: InterruptValueSchema;
  /** Optional Zod-like validator. Takes precedence over `schema` when validating. */
  zodSchema?: ZodLike;
  /** Snapshot of workflow state to expose to the reviewer (for inspect/edit). */
  state?: Record<string, unknown>;
  /** Channels to notify when the interrupt is created. */
  notify?: InterruptNotifyChannel[];
  /**
   * Maximum time to wait for resolution, in milliseconds. When elapsed
   * without a resume call, the Promise rejects with `InterruptTimeout` and
   * the record is marked `cancelled`. Defaults to no timeout.
   */
  timeoutMs?: number;
  /**
   * Internal: polling interval used by the Promise to detect resolution.
   * Mostly exposed for tests; defaults to 250 ms.
   */
  pollIntervalMs?: number;
}

export interface InterruptRecord {
  id: string;
  sessionId: string;
  workflowId?: string;
  prompt: string;
  schema?: InterruptValueSchema;
  state?: Record<string, unknown>;
  status: InterruptStatus;
  notify: InterruptNotifyChannel[];
  resumeValue?: unknown;
  claimedAt?: string; // ISO timestamp set when an operator starts working on it
  resolvedAt?: string; // ISO timestamp set when resume() lands
  createdAt: string;
  /** Reason for cancellation, when status === 'cancelled'. */
  cancelReason?: string;
  /**
   * PID of the process that registered this interrupt via `interrupt()`.
   * Used by `resumeInterrupt` to gate the "no-listener" detection: if a
   * resume is dispatched from the SAME process that owns the awaiter and
   * no awaiter is currently registered, the awaiter has died (e.g. after a
   * validation-failure reopen race) and resolving would orphan the record.
   * When the resume comes from a different process this field guards
   * against false positives — the awaiter naturally lives elsewhere.
   */
  originPid?: number;
}

export interface ResumePayload {
  /** Value to feed back into the interrupt() Promise. */
  input?: unknown;
  /**
   * Optional state mutation, expressed as a list of `path=value` pairs in
   * dot notation, e.g. `config.maxRetries=5`. Applied before resolving the
   * Promise. `value` is parsed as JSON when possible, falling back to string.
   */
  stateEdits?: Array<{ path: string; value: unknown }>;
}

/**
 * Thrown by `interrupt()` when the wait exceeds `timeoutMs`. Callers can
 * catch this to surface a user-friendly message; the underlying record is
 * marked `cancelled` automatically.
 */
export class InterruptTimeoutError extends Error {
  constructor(public readonly interruptId: string) {
    super(`Interrupt ${interruptId} timed out waiting for human input`);
    this.name = 'InterruptTimeoutError';
  }
}

/**
 * Thrown by `interrupt()` when the resume payload fails schema validation.
 */
export class InterruptValidationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'InterruptValidationError';
  }
}

/**
 * Marker error used by the runtime to signal that a workflow paused on an
 * interrupt — useful when a host wants to checkpoint without awaiting.
 */
export class InterruptPending extends Error {
  constructor(public readonly record: InterruptRecord) {
    super(`Workflow paused on interrupt ${record.id}: ${record.prompt}`);
    this.name = 'InterruptPending';
  }
}

/**
 * Raised by `resumeInterrupt` when the targeted record is pending but has
 * no live in-process awaiter — which happens after a validation-failure
 * reopen race orphans the original `interrupt()` Promise. Resolving in this
 * state would silently lose the resume payload (the workflow has already
 * rejected and moved on), so we refuse and let the operator decide whether
 * to cancel the orphaned record.
 */
export class InterruptNoListenerError extends Error {
  readonly code = 'no_listener' as const;
  constructor(public readonly interruptId: string) {
    super(
      `Interrupt ${interruptId} has no active listener (workflow likely died ` +
        `after a validation-failure reopen). Cancel the record instead of resuming.`
    );
    this.name = 'InterruptNoListenerError';
  }
}
