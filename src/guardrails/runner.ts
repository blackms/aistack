/**
 * Parallel guardrail runner.
 *
 * Strategy:
 *   - All guardrails are launched concurrently (`Promise.all`-style).
 *   - Each is wrapped so an individual crash / timeout becomes a synthetic
 *     `pass: false, severity: 'high', crashed: true` failure — one bad
 *     guardrail never takes the whole agent down (isolation contract).
 *   - When `killSwitch` is on (default), the first HIGH-severity failure
 *     resolves the outer promise immediately via a `Promise.race` between
 *     the aggregate and a kill-signal — but we still let the other
 *     guardrails finish in the background so we can attribute audit
 *     events to them.
 *
 * Latency is masked: the outer await is `max(durations)` when nothing
 * fails, and `min(time-to-first-high-failure)` on a fail-fast path.
 */

import { logger } from '../utils/logger.js';
import type {
  Guardrail,
  GuardrailAuditEvent,
  GuardrailFailure,
  GuardrailRunOptions,
  GuardrailRunOutcome,
  GuardrailResult,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Run a set of guardrails against a payload.
 *
 * Returns an aggregated outcome. Never throws — even if every guardrail
 * crashes, the caller gets back a `pass: false` outcome with `crashed`
 * failures.
 */
export async function runGuardrails(
  payload: unknown,
  guardrails: Guardrail[],
  options: GuardrailRunOptions
): Promise<GuardrailRunOutcome> {
  const start = Date.now();
  const killSwitch = options.killSwitch ?? true;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (guardrails.length === 0) {
    return { pass: true, failures: [], durationMs: 0, shortCircuited: false };
  }

  const failures: GuardrailFailure[] = [];
  let shortCircuited = false;

  // Promise-based kill signal: resolves on first high-severity failure.
  let killResolve: (() => void) | null = null;
  const killSignal = new Promise<void>((resolve) => {
    killResolve = resolve;
  });

  const runOne = async (g: Guardrail): Promise<void> => {
    let result: GuardrailResult;
    try {
      result = await withTimeout(
        Promise.resolve(g.validate(payload, options.context)),
        timeoutMs,
        g.name
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const failure: GuardrailFailure = {
        guardrail: g.name,
        reason: `guardrail crashed: ${reason}`,
        severity: 'high',
        crashed: true,
      };
      failures.push(failure);
      emitAudit(options, failure, g);
      logger.warn('guardrail crashed', { guardrail: g.name, error: reason });
      if (killSwitch && killResolve) {
        shortCircuited = true;
        killResolve();
      }
      return;
    }

    if (!result.pass) {
      const severity = result.severity ?? 'high';
      const failure: GuardrailFailure = {
        guardrail: g.name,
        reason: result.reason ?? 'guardrail failed',
        severity,
        matches: result.matches,
      };
      failures.push(failure);
      emitAudit(options, failure, g);
      if (killSwitch && severity === 'high' && killResolve) {
        shortCircuited = true;
        killResolve();
      }
    }
  };

  const allDone = Promise.all(guardrails.map(runOne));

  if (killSwitch) {
    // Outer race: whichever happens first wins (kill OR all-finished).
    // The Promise.all continues to settle so its `runOne` calls can
    // still push to `failures` for audit purposes, but we don't await
    // them here.
    await Promise.race([allDone, killSignal]);
  } else {
    await allDone;
  }

  return {
    pass: failures.length === 0,
    failures: [...failures],
    durationMs: Date.now() - start,
    shortCircuited,
  };
}

/**
 * Wrap a promise with a hard timeout. On timeout the inner promise is
 * left to settle (we can't cancel it) — we just stop waiting.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`guardrail '${label}' timed out after ${ms}ms`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function emitAudit(
  options: GuardrailRunOptions,
  failure: GuardrailFailure,
  g: Guardrail
): void {
  if (!options.onAudit) return;
  const event: GuardrailAuditEvent = {
    type: 'guardrail.fail',
    guardrail: failure.guardrail,
    direction: g.direction,
    severity: failure.severity,
    reason: failure.reason,
    agentType: options.context.agentType,
    taskId: options.context.taskId,
    sessionId: options.context.sessionId,
    timestamp: new Date(),
    crashed: failure.crashed,
  };
  try {
    options.onAudit(event);
  } catch (err) {
    // Audit failures must never break guardrails.
    logger.warn('audit emitter threw', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
