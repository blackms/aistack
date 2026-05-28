/**
 * Workflow DSL — public API.
 *
 * @packageDocumentation
 */

export {
  WorkflowDocSchema,
  StepSchema,
  OnRejectClauseSchema,
  OnErrorClauseSchema,
  type WorkflowDoc,
  type Step,
  type OnRejectClause,
  type OnErrorClause,
  type StepResult,
} from './schema.js';

export { parseWorkflow, parseWorkflowObject, WorkflowParseError } from './parser.js';

export {
  WorkflowContext,
  type TaskContext,
  type RunStepHook,
  type RunStepArgs,
  type RunStepResult,
  type WorkflowContextOptions,
} from './context.js';

export { runWorkflow, resolveInput, evaluateCondition } from './executor.js';

export {
  watchWorkflowFile,
  readAndParse,
  type HotReloadOptions,
  type HotReloadHandle,
} from './hot-reload.js';
