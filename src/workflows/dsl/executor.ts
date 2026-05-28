/**
 * Workflow DSL executor.
 *
 * Reads a validated WorkflowDoc and runs it via the pluggable runStep hook
 * supplied through WorkflowContext. Supports:
 *   - linear execution
 *   - $task / $prev / $steps.<id> variable resolution (in string inputs)
 *   - on_reject loop-back (jump to earlier step, capped by max_retries)
 *   - on_error loop-back / fail
 *   - if-conditional skip (==, !=, contains, exists)
 *   - parallel blocks (Promise.all over nested steps)
 *
 * Emits results as an AsyncGenerator<StepResult> so callers can stream
 * progress (CLI tail-print, websocket bridge, etc.).
 */

import type { Step, StepResult, WorkflowDoc, OnRejectClause, OnErrorClause } from './schema.js';
import { WorkflowContext } from './context.js';

/**
 * Resolve a value or string containing $-prefixed variable references.
 *
 * Replaces `$task.foo`, `$prev.bar`, `$steps.id.baz`. Unknown references
 * resolve to the empty string with a console.warn (non-fatal).
 *
 * If the input is a plain object, each leaf string is resolved recursively
 * and the object is JSON-stringified for the agent call.
 */
export function resolveInput(
  input: string | Record<string, unknown> | undefined,
  ctx: WorkflowContext
): string {
  if (input === undefined) return '';
  if (typeof input === 'string') {
    return resolveString(input, ctx);
  }
  // Object: deep-resolve string leaves
  const resolved = deepResolve(input, ctx);
  return JSON.stringify(resolved, null, 2);
}

function deepResolve(value: unknown, ctx: WorkflowContext): unknown {
  if (typeof value === 'string') return resolveString(value, ctx);
  if (Array.isArray(value)) return value.map((v) => deepResolve(v, ctx));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepResolve(v, ctx);
    }
    return out;
  }
  return value;
}

const VAR_RE = /\$(task|prev|steps)(?:\.([a-zA-Z0-9_-]+))?(?:\.([a-zA-Z0-9_.-]+))?/g;

function resolveString(input: string, ctx: WorkflowContext): string {
  // Fast path: no $ → literal
  if (!input.includes('$')) return input;

  return input.replace(VAR_RE, (match, root: string, mid: string | undefined, tail: string | undefined) => {
    const resolved = lookup(root, mid, tail, ctx);
    if (resolved === undefined || resolved === null) {
      return '';
    }
    return typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
  });
}

function lookup(root: string, mid: string | undefined, tail: string | undefined, ctx: WorkflowContext): unknown {
  switch (root) {
    case 'task': {
      // $task or $task.<field>
      if (!mid) return ctx.task;
      return readPath(ctx.task as Record<string, unknown>, mid + (tail ? '.' + tail : ''));
    }
    case 'prev': {
      if (!ctx.prev) return undefined;
      if (!mid) return ctx.prev.output;
      return readPath(ctx.prev as unknown as Record<string, unknown>, mid + (tail ? '.' + tail : ''));
    }
    case 'steps': {
      // $steps.<id>.<field>  — mid = id, tail = field path
      if (!mid) return undefined;
      const step = ctx.getStepById(mid);
      if (!step) return undefined;
      if (!tail) return step.output;
      return readPath(step as unknown as Record<string, unknown>, tail);
    }
    default:
      return undefined;
  }
}

/**
 * Keys that would let a malicious workflow walk up to Object.prototype and
 * read/inject globals. Rejected during dotted-path traversal.
 */
const FORBIDDEN_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function readPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (FORBIDDEN_PATH_KEYS.has(p)) return undefined;
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    // Use Object.hasOwn to avoid resolving inherited properties (e.g. toString).
    if (!Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/**
 * Evaluate a simple if-expression. Supported forms:
 *   "$var == literal"
 *   "$var != literal"
 *   "$var contains literal"
 *   "$var exists"
 */
export function evaluateCondition(expr: string, ctx: WorkflowContext): boolean {
  const trimmed = expr.trim();

  // exists
  const existsMatch = trimmed.match(/^(\S+)\s+exists$/i);
  if (existsMatch) {
    const lhs = resolveString(existsMatch[1], ctx);
    return lhs.length > 0;
  }

  // contains
  const containsMatch = trimmed.match(/^(.+?)\s+contains\s+(.+)$/i);
  if (containsMatch) {
    const lhs = resolveString(containsMatch[1].trim(), ctx);
    const rhs = resolveString(containsMatch[2].trim(), ctx);
    return lhs.includes(rhs);
  }

  // != / ==
  const cmpMatch = trimmed.match(/^(.+?)\s*(==|!=)\s*(.+)$/);
  if (cmpMatch) {
    const lhs = resolveString(cmpMatch[1].trim(), ctx);
    const op = cmpMatch[2];
    const rhs = resolveString(cmpMatch[3].trim(), ctx);
    return op === '==' ? lhs === rhs : lhs !== rhs;
  }

  // Bare reference — truthy if non-empty
  const resolved = resolveString(trimmed, ctx);
  return resolved.length > 0 && resolved !== 'false' && resolved !== '0';
}

/**
 * Resolve a step reference (numeric index or string id) to an index in the
 * workflow's top-level steps array. Returns -1 if not found.
 */
function resolveStepRef(ref: number | string, doc: WorkflowDoc): number {
  if (typeof ref === 'number') return ref;
  return doc.steps.findIndex((s) => s.id === ref);
}

interface RetryState {
  rejectRetries: Map<number, number>;
  errorRetries: Map<number, number>;
}

/**
 * Run a workflow. Yields each step result as it completes; the final yielded
 * result may have `error` set if a clause caused termination.
 */
export async function* runWorkflow(
  doc: WorkflowDoc,
  ctx: WorkflowContext
): AsyncGenerator<StepResult, void, void> {
  const state: RetryState = {
    rejectRetries: new Map(),
    errorRetries: new Map(),
  };

  const maxTotal = doc.max_iterations ?? doc.steps.length * 10;
  let totalExecutions = 0;
  let i = 0;

  while (i < doc.steps.length) {
    if (ctx.abortSignal?.aborted) {
      return;
    }
    // Pre-increment check: allow exactly `maxTotal` executions, fail on the
    // (maxTotal+1)-th attempt. Postfix `> maxTotal` previously allowed N+1.
    if (totalExecutions >= maxTotal) {
      const failure: StepResult = {
        index: i,
        output: '',
        durationMs: 0,
        retries: 0,
        error: `Exceeded max_iterations (${maxTotal})`,
      };
      yield failure;
      return;
    }
    totalExecutions++;

    const step = doc.steps[i];
    const result = await executeStep(step, i, ctx);

    // Handle if-condition skip — propagate without retry logic
    if (result.skipped) {
      ctx.record(result);
      yield result;
      i++;
      continue;
    }

    // Error handling
    if (result.error && !result.verdict) {
      const handled = handleErrorClause(step.on_error, i, doc, state);
      if (handled !== null) {
        // jump back
        ctx.record(result);
        yield result;
        i = handled;
        continue;
      }
      // surface and stop (or proceed, based on fail_after)
      ctx.record(result);
      yield result;
      if (step.on_error?.fail_after === false) {
        i++;
        continue;
      }
      return;
    }

    // REJECT verdict handling
    const verdict = (result.verdict ?? '').toUpperCase();
    if (verdict === 'REJECT' && step.on_reject) {
      const jumpTo = handleRejectClause(step.on_reject, i, doc, state);
      ctx.record(result);
      yield result;
      if (jumpTo !== null) {
        i = jumpTo;
        continue;
      }
      // Retries exhausted
      if (step.on_reject.fail_after) {
        const exhausted: StepResult = {
          index: i,
          id: step.id,
          agent: step.agent,
          output: result.output,
          verdict: 'REJECT',
          durationMs: 0,
          retries: state.rejectRetries.get(i) ?? 0,
          error: `on_reject retries exhausted (max=${step.on_reject.max_retries})`,
        };
        yield exhausted;
        return;
      }
      i++;
      continue;
    }

    ctx.record(result);
    yield result;
    i++;
  }
}

function handleRejectClause(
  clause: OnRejectClause,
  currentIdx: number,
  doc: WorkflowDoc,
  state: RetryState
): number | null {
  const used = state.rejectRetries.get(currentIdx) ?? 0;
  if (used >= clause.max_retries) {
    return null;
  }
  state.rejectRetries.set(currentIdx, used + 1);
  const target = resolveStepRef(clause.goto, doc);
  if (target < 0) return null;
  return target;
}

function handleErrorClause(
  clause: OnErrorClause | undefined,
  currentIdx: number,
  doc: WorkflowDoc,
  state: RetryState
): number | null {
  if (!clause || clause.goto === undefined) return null;
  const used = state.errorRetries.get(currentIdx) ?? 0;
  if (used >= clause.max_retries) return null;
  state.errorRetries.set(currentIdx, used + 1);
  const target = resolveStepRef(clause.goto, doc);
  if (target < 0) return null;
  return target;
}

async function executeStep(
  step: Step,
  index: number,
  ctx: WorkflowContext,
  signalOverride?: AbortSignal
): Promise<StepResult> {
  // if-condition: skip if false
  if (step.if !== undefined && !evaluateCondition(step.if, ctx)) {
    return {
      index,
      id: step.id,
      agent: step.agent,
      output: '',
      durationMs: 0,
      retries: 0,
      skipped: true,
    };
  }

  // Parallel block — fail-fast: if any child errors, abort all siblings via a
  // shared AbortController so long-running siblings (HTTP, agent spawns) don't
  // continue burning resources after the first failure.
  if (step.parallel && step.parallel.length > 0) {
    const start = Date.now();
    const groupController = new AbortController();
    // Forward outer aborts to the group controller.
    const outerSignal = signalOverride ?? ctx.abortSignal;
    if (outerSignal) {
      if (outerSignal.aborted) {
        groupController.abort();
      } else {
        outerSignal.addEventListener('abort', () => groupController.abort(), { once: true });
      }
    }

    const childPromises = step.parallel.map((sub, subIdx) =>
      executeStep(sub, index * 1000 + subIdx, ctx, groupController.signal).then((r) => {
        if (r.error) groupController.abort();
        return r;
      })
    );
    const results = await Promise.all(childPromises);
    return {
      index,
      id: step.id,
      output: results.map((r) => r.output).join('\n---\n'),
      durationMs: Date.now() - start,
      retries: 0,
      parallelResults: results,
    };
  }

  // Single agent invocation
  if (!step.agent) {
    return {
      index,
      id: step.id,
      output: '',
      durationMs: 0,
      retries: 0,
      error: 'step has no agent and no parallel block',
    };
  }

  const input = resolveInput(step.input, ctx);
  const start = Date.now();
  const effectiveSignal = signalOverride ?? ctx.abortSignal;
  try {
    const res = await ctx.runStep({
      agent: step.agent,
      input,
      stepIndex: index,
      stepId: step.id,
      signal: effectiveSignal,
    });
    return {
      index,
      id: step.id,
      agent: step.agent,
      output: res.output,
      verdict: res.verdict,
      durationMs: Date.now() - start,
      retries: 0,
    };
  } catch (err) {
    return {
      index,
      id: step.id,
      agent: step.agent,
      output: '',
      durationMs: Date.now() - start,
      retries: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
