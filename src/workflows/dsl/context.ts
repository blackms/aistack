/**
 * WorkflowContext — runtime state passed to the DSL executor.
 *
 * The executor pulls `task`, `prev`, and `steps` data out of context for
 * variable resolution. The `runStep` hook is the pluggable agent invocation —
 * tests stub it; the CLI wires it to `executeAgent()` from src/agents/spawner.
 */

import type { StepResult } from './schema.js';

export interface TaskContext {
  input?: unknown;
  [key: string]: unknown;
}

/**
 * Result returned from a runStep hook — must include `output` (string) and
 * may include `verdict`. Additional fields are exposed via $steps.<id>.<field>.
 */
export interface RunStepResult {
  output: string;
  verdict?: string;
  [key: string]: unknown;
}

export interface RunStepArgs {
  agent: string;
  input: string;
  stepIndex: number;
  stepId?: string;
  signal?: AbortSignal;
}

/**
 * Pluggable agent invocation. Returning `{ output, verdict }` lets on_reject
 * clauses detect a REJECT verdict and trigger the loop-back behaviour.
 */
export type RunStepHook = (args: RunStepArgs) => Promise<RunStepResult>;

export interface WorkflowContextOptions {
  task?: TaskContext;
  runStep: RunStepHook;
  abortSignal?: AbortSignal;
}

/**
 * Mutable context shared across step executions in a single workflow run.
 */
export class WorkflowContext {
  readonly task: TaskContext;
  readonly steps: Map<string, StepResult> = new Map();
  readonly history: StepResult[] = [];
  readonly runStep: RunStepHook;
  readonly abortSignal: AbortSignal | undefined;
  prev: StepResult | null = null;

  constructor(opts: WorkflowContextOptions) {
    this.task = opts.task ?? {};
    this.runStep = opts.runStep;
    this.abortSignal = opts.abortSignal;
  }

  /**
   * Record a completed step result, updating `prev` and the `steps` map (if
   * the step had an id) for future variable resolution.
   */
  record(result: StepResult): void {
    this.history.push(result);
    this.prev = result;
    if (result.id) {
      this.steps.set(result.id, result);
    }
  }

  /**
   * Look up a step result by id (returns null if not yet executed).
   */
  getStepById(id: string): StepResult | null {
    return this.steps.get(id) ?? null;
  }
}
