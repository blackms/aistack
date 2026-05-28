/**
 * Public surface of the guardrails framework.
 *
 * Integration is OPT-IN: call sites wrap their existing executor with
 * `withGuardrails(fn, guardrails, opts)` rather than the framework
 * monkey-patching anything. This keeps the spawner / review-loop free
 * of cross-cutting concerns (cf. AIG-633 / AIG-635 / AIG-641 overlap
 * rules).
 */

export type {
  Guardrail,
  GuardrailContext,
  GuardrailDirection,
  GuardrailFailure,
  GuardrailRegistry,
  GuardrailResult,
  GuardrailRunOptions,
  GuardrailRunOutcome,
  GuardrailSeverity,
  GuardrailAuditEvent,
} from './types.js';

export { runGuardrails } from './runner.js';

export { secretsGuardrail } from './builtin/secrets.js';
export { piiGuardrail } from './builtin/pii.js';
export { promptInjectionGuardrail } from './builtin/prompt-injection.js';
export { zodSchemaGuardrail } from './builtin/zod-schema.js';

export {
  defaultRegistry,
  getGuardrailRegistry,
  registerGuardrail,
  resetGuardrailRegistry,
} from './registry.js';

export {
  SECRET_PATTERNS,
  PROMPT_INJECTION_PATTERNS,
  EMAIL_PATTERN,
  US_SSN_PATTERN,
  IT_CODICE_FISCALE_PATTERN,
  CREDIT_CARD_CANDIDATE,
  IPV4_PATTERN,
  HIGH_ENTROPY_TOKEN,
  luhnCheck,
} from './patterns.js';

import type {
  Guardrail,
  GuardrailContext,
  GuardrailRunOptions,
  GuardrailRunOutcome,
} from './types.js';
import { runGuardrails } from './runner.js';

/**
 * Error thrown by `withGuardrails` when input/output validation blocks
 * the wrapped function. Carries the full outcome for audit handling.
 */
export class GuardrailBlockedError extends Error {
  constructor(
    public readonly stage: 'input' | 'output',
    public readonly outcome: GuardrailRunOutcome
  ) {
    super(
      `guardrails blocked ${stage}: ${outcome.failures
        .map((f) => `${f.guardrail}(${f.severity})`)
        .join(', ')}`
    );
    this.name = 'GuardrailBlockedError';
  }
}

export interface WithGuardrailsOptions {
  input?: Guardrail[];
  output?: Guardrail[];
  context: Omit<GuardrailContext, 'direction'>;
  runOptions?: Omit<GuardrailRunOptions, 'context'>;
  /**
   * If true, output guardrail failures only log (don't throw). Default
   * `false`. Useful during rollout to measure false positives.
   */
  outputNonBlocking?: boolean;
}

/**
 * Higher-order wrapper. Validates `arg` against input guardrails, runs
 * `fn`, validates its return value against output guardrails.
 *
 * Throws `GuardrailBlockedError` on a blocking failure. Call sites adopt
 * this explicitly — there is no implicit injection into the spawner.
 */
export function withGuardrails<TArg, TOut>(
  fn: (arg: TArg) => Promise<TOut>,
  opts: WithGuardrailsOptions
): (arg: TArg) => Promise<TOut> {
  return async (arg: TArg) => {
    const inputGuardrails = opts.input ?? [];
    if (inputGuardrails.length > 0) {
      const outcome = await runGuardrails(arg, inputGuardrails, {
        ...opts.runOptions,
        context: { ...opts.context, direction: 'input' },
      });
      if (!outcome.pass) {
        throw new GuardrailBlockedError('input', outcome);
      }
    }

    const result = await fn(arg);

    const outputGuardrails = opts.output ?? [];
    if (outputGuardrails.length > 0) {
      const outcome = await runGuardrails(result, outputGuardrails, {
        ...opts.runOptions,
        context: { ...opts.context, direction: 'output' },
      });
      if (!outcome.pass && !opts.outputNonBlocking) {
        throw new GuardrailBlockedError('output', outcome);
      }
    }

    return result;
  };
}
