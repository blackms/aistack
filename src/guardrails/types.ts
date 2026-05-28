/**
 * Guardrails framework — types & interfaces.
 *
 * Guardrails are pluggable input/output validators that run *in parallel*
 * to agent execution. They are intended as a CHEAP first-line defense
 * (regex / schema validation) complementary to the heavier adversarial
 * review loop (LLM-based post-hoc review).
 *
 * Design references:
 *   - OpenAI Agents SDK guardrails primitive
 *   - 2026 layered defense: pattern matching (~0.1ms) + heuristics
 *     + optional LLM deep scan (~500ms)
 */

/**
 * Direction in which a guardrail is applied.
 *
 *   - `input`  — validate task payload BEFORE agent runs
 *               (prompt injection, PII in user input, ...)
 *   - `output` — validate agent output BEFORE emit/persist
 *               (leaked secrets, schema violation, ...)
 *   - `both`   — applicable in both directions
 */
export type GuardrailDirection = 'input' | 'output' | 'both';

/**
 * Severity of a guardrail failure.
 *
 *   - `low`  — collected but does not abort the parallel race
 *   - `high` — triggers kill-switch (Promise.race short-circuit)
 */
export type GuardrailSeverity = 'low' | 'high';

/**
 * Context passed to every guardrail invocation.
 *
 * `direction` lets a single guardrail behave differently on input vs output.
 * `agentType` / `taskId` are best-effort, depending on the call site.
 */
export interface GuardrailContext {
  direction: GuardrailDirection;
  agentType?: string;
  taskId?: string;
  sessionId?: string;
  /** Arbitrary metadata the caller wants to forward (e.g. tenant id). */
  metadata?: Record<string, unknown>;
}

/**
 * Result returned by `Guardrail.validate`.
 *
 * `pass: true` means the payload is clean.
 * `pass: false` MUST be accompanied by a human-readable `reason`.
 * `severity` defaults to `'high'` (fail-closed) when omitted on failure.
 */
export interface GuardrailResult {
  pass: boolean;
  reason?: string;
  severity?: GuardrailSeverity;
  /** Optional structured findings for audit trails. */
  matches?: Array<{ kind: string; sample?: string; index?: number }>;
}

/**
 * Pluggable validator. Implementations MUST be pure (no side effects)
 * and SHOULD be fast — guardrails run on every task hop.
 */
export interface Guardrail {
  /** Stable identifier used in config & audit logs. */
  name: string;
  /** Where this guardrail can be applied. */
  direction: GuardrailDirection;
  /** Optional human description (shown in `aistack` CLI). */
  description?: string;
  /**
   * Validate a payload. MUST NOT throw — caught failures are logged and
   * treated as `{ pass: false, reason: 'guardrail crashed: <err>' }`
   * (see `runner.ts` isolation logic).
   */
  validate(payload: unknown, context: GuardrailContext): Promise<GuardrailResult> | GuardrailResult;
}

/**
 * One entry in the aggregated failure list produced by `runGuardrails`.
 */
export interface GuardrailFailure {
  guardrail: string;
  reason: string;
  severity: GuardrailSeverity;
  matches?: GuardrailResult['matches'];
  /** True if the guardrail threw — separate from a regular `pass: false`. */
  crashed?: boolean;
}

/**
 * Aggregated outcome of running a set of guardrails in parallel.
 */
export interface GuardrailRunOutcome {
  pass: boolean;
  failures: GuardrailFailure[];
  /** Total wall-clock time spent (ms). */
  durationMs: number;
  /** True when the run aborted early because of a high-severity failure. */
  shortCircuited: boolean;
}

/**
 * Options accepted by `runGuardrails`.
 */
export interface GuardrailRunOptions {
  context: GuardrailContext;
  /**
   * If true (default), the first `high` severity failure aborts the
   * remaining checks via Promise.race. Low-severity failures are always
   * accumulated.
   */
  killSwitch?: boolean;
  /** Per-guardrail timeout in ms. Defaults to 2000. */
  timeoutMs?: number;
  /**
   * Optional audit emitter. Called once per failure. Intentionally generic
   * so we don't take a hard dep on the audit module (AIG-635).
   */
  onAudit?: (event: GuardrailAuditEvent) => void;
}

/**
 * Audit event emitted on failure. Consumers can persist or forward to
 * the central audit trail (see AIG-635).
 */
export interface GuardrailAuditEvent {
  type: 'guardrail.fail';
  guardrail: string;
  direction: GuardrailDirection;
  severity: GuardrailSeverity;
  reason: string;
  agentType?: string;
  taskId?: string;
  sessionId?: string;
  timestamp: Date;
  crashed?: boolean;
}

/**
 * Registry of guardrails — map name → instance. Custom guardrails are
 * registered via `registerGuardrail`. Resolution by string name is the
 * mechanism that makes the YAML/JSON config (`guardrails: [secrets, pii]`)
 * possible.
 */
export interface GuardrailRegistry {
  register(guardrail: Guardrail): void;
  unregister(name: string): boolean;
  get(name: string): Guardrail | undefined;
  list(): Guardrail[];
  /** Resolve a list of names into Guardrail instances, throwing on unknown. */
  resolve(names: string[]): Guardrail[];
}
