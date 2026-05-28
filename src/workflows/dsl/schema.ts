/**
 * Workflow DSL — zod schemas
 *
 * Defines the shape of a declarative workflow document loaded from YAML/JSON.
 *
 * Variable reference syntax (resolved at runtime by executor):
 *   - `$task.input`            → workflow-level input value
 *   - `$task.<field>`          → arbitrary task context field
 *   - `$prev.output`           → output of previously executed step
 *   - `$prev.<field>`          → arbitrary field from previous step result
 *   - `$steps.<id>.output`     → output of a named step (by `id`)
 *   - `$steps.<id>.<field>`    → arbitrary field from a named step
 *
 * Strings without a leading `$` are treated as literals.
 */

import { z } from 'zod';

/**
 * Verdict-style control flow clause. Triggered when a step result contains
 * `verdict: 'REJECT'` (string match, case-insensitive). The clause may either
 * jump back to a previous step (`goto`) and retry up to `max_retries` times,
 * or surface the rejection as an error (`fail`).
 */
export const OnRejectClauseSchema = z.object({
  goto: z
    .union([z.number().int().nonnegative(), z.string().min(1)])
    .describe('Step index (0-based) or step id to jump back to'),
  max_retries: z
    .number()
    .int()
    .min(0)
    .max(20)
    .default(3)
    .describe('Maximum number of jump-back retries for this clause'),
  fail_after: z
    .boolean()
    .optional()
    .describe('If true, surface a failure once max_retries is exhausted'),
});

/**
 * Generic error clause — runs on thrown exception (not REJECT verdict).
 */
export const OnErrorClauseSchema = z.object({
  goto: z.union([z.number().int().nonnegative(), z.string().min(1)]).optional(),
  max_retries: z.number().int().min(0).max(20).default(1),
  fail_after: z.boolean().default(true),
});

/**
 * Conditional gate. The expression is a simple comparison against a
 * resolved variable; supported operators: ==, !=, contains, exists.
 * Examples:
 *   if: "$prev.verdict == APPROVE"
 *   if: "$task.skip_review != true"
 *   if: "$steps.lint.output contains warning"
 *   if: "$task.opt_in exists"
 */
export const IfExpressionSchema = z.string().min(1);

export type OnRejectClause = z.infer<typeof OnRejectClauseSchema>;
export type OnErrorClause = z.infer<typeof OnErrorClauseSchema>;

export interface Step {
  id?: string;
  agent?: string;
  name?: string;
  input?: string | Record<string, unknown>;
  if?: string;
  on_reject?: OnRejectClause;
  on_error?: OnErrorClause;
  parallel?: Step[];
  timeout_ms?: number;
}

/**
 * A single step. Either a `agent` invocation OR a `parallel` block.
 */
export const StepSchema: z.ZodType<Step, z.ZodTypeDef, unknown> = z.lazy(() =>
  z
    .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_-]+$/, 'id must be alphanumeric, underscore, or hyphen')
      .optional()
      .describe('Optional unique identifier for cross-references'),
    agent: z
      .string()
      .min(1)
      .optional()
      .describe('Agent type to spawn (e.g. coder, adversarial, tester)'),
    name: z.string().optional().describe('Friendly name for logs/UI'),
    input: z
      .union([z.string(), z.record(z.unknown())])
      .optional()
      .describe('Input passed to agent — may reference $task / $prev / $steps'),
    if: IfExpressionSchema.optional(),
    on_reject: OnRejectClauseSchema.optional(),
    on_error: OnErrorClauseSchema.optional(),
    parallel: z
      .array(z.lazy(() => StepSchema))
      .optional()
      .describe('Run nested steps in parallel and collect outputs as array'),
    timeout_ms: z.number().int().positive().optional(),
  })
  .refine(
    (step) => Boolean(step.agent) !== Boolean(step.parallel),
    { message: 'Step must define exactly one of: agent, parallel' }
  )
);

/**
 * Top-level workflow document.
 */
export const WorkflowDocSchema = z.object({
  name: z.string().min(1).describe('Workflow identifier (kebab-case recommended)'),
  description: z.string().optional(),
  version: z.string().optional().default('1'),
  max_iterations: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Global cap on total step executions (safety net for loops)'),
  defaults: z
    .object({
      timeout_ms: z.number().int().positive().optional(),
      session_id: z.string().optional(),
    })
    .optional(),
  steps: z.array(StepSchema).min(1, 'workflow must contain at least one step'),
});

export type WorkflowDoc = z.infer<typeof WorkflowDocSchema>;

/**
 * Output emitted per step by the executor.
 */
export interface StepResult {
  index: number;
  id?: string;
  agent?: string;
  output: string;
  verdict?: 'APPROVE' | 'REJECT' | string;
  durationMs: number;
  retries: number;
  skipped?: boolean;
  error?: string;
  parallelResults?: StepResult[];
}
