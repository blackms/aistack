/**
 * Review Loop Coordinator - iterative coder-adversarial review pattern
 *
 * Workflow: Coder produces code → Adversarial reviews → If REJECT: Coder fixes → Repeat
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  AgentStackConfig,
  GuardrailsConfig,
  ReviewLoopState,
  ReviewResult,
  ReviewIssue,
  ReviewVerdict,
  IssueSeverity,
} from '../types.js';
import { spawnAgent, executeAgent, stopAgent, updateAgentStatus, type ExecuteResult } from '../agents/spawner.js';
import { logger } from '../utils/logger.js';
import { getMemoryManager } from '../memory/index.js';
import { Semaphore } from '../utils/semaphore.js';
import { traceAsync } from '../observability/index.js';
import { initGuardrails, runGuardrails } from '../guardrails/index.js';
import { getGuardrailRegistry } from '../guardrails/registry.js';
import type { Guardrail, GuardrailDirection, GuardrailRunOutcome } from '../guardrails/types.js';

const log = logger.child('review-loop');

/** Default built-ins applied by the gate when `builtin` is left empty. */
const DEFAULT_GUARDRAIL_BUILTINS = ['secrets', 'pii', 'prompt-injection'];

/**
 * Error raised when a blocking guardrail violation stops the review loop
 * (AIG-868). Carries the offending direction and the full outcome so
 * callers can attribute / audit the block instead of guessing.
 */
export class ReviewLoopGuardrailError extends Error {
  constructor(
    public readonly direction: GuardrailDirection,
    public readonly outcome: GuardrailRunOutcome
  ) {
    super(
      `guardrails blocked review-loop ${direction}: ${outcome.failures
        .map((f) => `${f.guardrail}(${f.severity})`)
        .join(', ')}`
    );
    this.name = 'ReviewLoopGuardrailError';
  }
}

/**
 * Resolve the guardrail instances for a direction from config.
 *
 * Returns an empty array (gate no-op) when guardrails are disabled or no
 * names are configured for the direction. Unknown names THROW via the
 * registry — fail-closed: a typo in config must not silently disable the
 * gate. A guardrail is only run in a direction it actually declares, so
 * an output-only validator is never run on input (and vice-versa).
 */
function resolveGuardrails(
  cfg: GuardrailsConfig | undefined,
  direction: 'input' | 'output'
): Guardrail[] {
  if (!cfg || !cfg.enabled) return [];
  const builtin = cfg.builtin && cfg.builtin.length > 0 ? cfg.builtin : DEFAULT_GUARDRAIL_BUILTINS;
  const names = (direction === 'input' ? cfg.input : cfg.output) ?? builtin;
  if (names.length === 0) return [];
  return getGuardrailRegistry()
    .resolve(names)
    .filter((g) => g.direction === direction || g.direction === 'both');
}

// Concurrency control for review loops
// Max 5 concurrent review loops (each loop spawns 2 agents = 10 agents max).
// Exported so the rubric grader can gate its per-criterion spawns through the
// same pool — otherwise a rubric loop could fan out N graders unbounded.
// The reverse dependency (review-loop → rubric grader) is dynamic-only, so
// the static cycle introduced by grader importing this symbol is benign.
export const reviewLoopSemaphore = new Semaphore('review-loops', 5);

export interface ReviewLoopOptions {
  maxIterations?: number;
  sessionId?: string;
  /**
   * Opt-in: when set, the loop switches from adversarial APPROVE/REJECT
   * to Outcomes-style rubric grading. Accepts a parsed RubricDoc, a YAML
   * string, a JSON string, or a plain object — see workflows/rubric.
   */
  rubric?: unknown;
}

export interface ReviewLoopEvents {
  'loop:start': (state: ReviewLoopState) => void;
  'loop:iteration': (iteration: number, state: ReviewLoopState) => void;
  'loop:review': (result: ReviewResult, state: ReviewLoopState) => void;
  'loop:fix': (iteration: number, issues: ReviewIssue[], state: ReviewLoopState) => void;
  'loop:approved': (state: ReviewLoopState) => void;
  'loop:complete': (state: ReviewLoopState) => void;
  'loop:error': (error: Error, state: ReviewLoopState) => void;
}

// Active review loops
const activeLoops: Map<string, ReviewLoopCoordinator> = new Map();

/**
 * ReviewLoopCoordinator - manages iterative code review cycles
 */
export class ReviewLoopCoordinator extends EventEmitter {
  private state: ReviewLoopState;
  private config: AgentStackConfig;
  private guardrailsInit?: Promise<void>;

  constructor(codeInput: string, config: AgentStackConfig, options: ReviewLoopOptions = {}) {
    super();
    this.config = config;

    // Spawn coder and adversarial agents
    const coder = spawnAgent('coder', {
      name: `review-loop-coder-${randomUUID().slice(0, 8)}`,
      sessionId: options.sessionId,
    }, config);

    const adversarial = spawnAgent('adversarial', {
      name: `review-loop-adversarial-${randomUUID().slice(0, 8)}`,
      sessionId: options.sessionId,
    }, config);

    this.state = {
      id: randomUUID(),
      sessionId: options.sessionId,
      coderId: coder.id,
      adversarialId: adversarial.id,
      iteration: 0,
      maxIterations: options.maxIterations ?? 3,
      status: 'pending',
      codeInput,
      currentCode: undefined,
      reviews: [],
      startedAt: new Date(),
    };

    // Register this loop
    activeLoops.set(this.state.id, this);

    // Persist initial state
    this.persistState();

    log.info('Review loop created', {
      id: this.state.id,
      coderId: this.state.coderId,
      adversarialId: this.state.adversarialId,
      maxIterations: this.state.maxIterations,
    });
  }

  /**
   * Persist state to database
   */
  private persistState(): void {
    try {
      const memoryManager = getMemoryManager(this.config);
      memoryManager.getStore().saveReviewLoop(this.state.id, this.state);
    } catch (error) {
      log.warn('Failed to persist review loop state', {
        id: this.state.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Load custom guardrail modules once per coordinator before resolving
   * config-provided names. This preserves fail-closed behavior for true
   * typos while allowing configured custom guardrails to participate.
   */
  private async ensureGuardrailsInitialized(): Promise<void> {
    const cfg = this.config.guardrails;
    if (!cfg?.enabled || !cfg.customPaths || cfg.customPaths.length === 0) return;

    this.guardrailsInit ??= initGuardrails(cfg).then(() => undefined);
    await this.guardrailsInit;
  }

  /**
   * Execute one agent task and always return the agent to idle when the
   * provider call settles, even if downstream guardrails later block.
   */
  private async executeAgentTask(agentId: string, task: string): Promise<ExecuteResult> {
    updateAgentStatus(agentId, 'running');
    try {
      return await executeAgent(agentId, task, this.config);
    } finally {
      updateAgentStatus(agentId, 'idle');
    }
  }

  /**
   * Run the configured guardrails for a direction against a payload
   * (AIG-868 gate).
   *
   * No-op (returns immediately) when guardrails are disabled or none are
   * configured for the direction. On a blocking failure the loop status is
   * marked `failed`, the offending guardrails are recorded on the state for
   * audit, and a `ReviewLoopGuardrailError` is thrown so the gate STOPS the
   * loop instead of letting a tainted payload proceed.
   *
   * INPUT failures always block (fail-closed). OUTPUT failures honour the
   * `outputNonBlocking` config flag — when set they log + record but do not
   * throw, for measuring false positives during rollout.
   */
  private async runGuardrailGate(
    payload: unknown,
    direction: 'input' | 'output',
    agentType: string
  ): Promise<void> {
    const cfg = this.config.guardrails;
    await this.ensureGuardrailsInitialized();
    const guardrails = resolveGuardrails(cfg, direction);
    if (guardrails.length === 0) return;

    const outcome = await runGuardrails(payload, guardrails, {
      context: {
        direction,
        taskId: this.state.id,
        sessionId: this.state.sessionId,
        agentType,
      },
      killSwitch: cfg?.killSwitch ?? true,
      timeoutMs: cfg?.timeoutMs,
      aggregateTimeoutMs: cfg?.aggregateTimeoutMs,
      onAudit: (event) => {
        log.warn('Guardrail violation', {
          id: this.state.id,
          direction: event.direction,
          guardrail: event.guardrail,
          severity: event.severity,
          reason: event.reason,
        });
      },
    });

    if (outcome.pass) return;

    const failureLabels = outcome.failures.map((f) => `${f.guardrail}(${f.severity})`);
    this.state.guardrailFailures = [
      ...(this.state.guardrailFailures ?? []),
      ...failureLabels,
    ];

    const nonBlocking = direction === 'output' && (cfg?.outputNonBlocking ?? false);
    if (nonBlocking) {
      log.warn('Guardrail output violation (non-blocking)', {
        id: this.state.id,
        failures: failureLabels,
      });
      this.persistState();
      return;
    }

    this.state.status = 'failed';
    this.persistState();
    log.error('Guardrail gate blocked review loop', {
      id: this.state.id,
      direction,
      failures: failureLabels,
    });
    throw new ReviewLoopGuardrailError(direction, outcome);
  }

  /**
   * Get current state
   */
  getState(): ReviewLoopState {
    return { ...this.state };
  }

  /**
   * Start the review loop
   */
  async start(): Promise<ReviewLoopState> {
    // Use semaphore to limit concurrent review loops
    return traceAsync(this.config, 'aistack.review_loop.start', {
      'review_loop.id': this.state.id,
      'review_loop.session_id': this.state.sessionId,
      'review_loop.max_iterations': this.state.maxIterations,
      'agent.coder.id': this.state.coderId,
      'agent.adversarial.id': this.state.adversarialId,
    }, async (span) => reviewLoopSemaphore.execute(async () => {
      try {
        this.emit('loop:start', this.state);
        log.info('Starting review loop', { id: this.state.id });

        // Initial code generation
        await this.generateInitialCode();

        // Run review iterations
        await this.runLoop();

        span?.setAttribute('review_loop.status', this.state.status);
        span?.setAttribute('review_loop.final_verdict', this.state.finalVerdict ?? 'none');
        span?.setAttribute('review_loop.iterations', this.state.iteration);
        return this.state;
      } catch (error) {
        this.state.status = 'failed';
        this.persistState();
        this.emit('loop:error', error as Error, this.state);
        log.error('Review loop failed', {
          id: this.state.id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }));
  }

  /**
   * Generate initial code from input
   */
  private async generateInitialCode(): Promise<void> {
    await traceAsync(this.config, 'aistack.review_loop.generate_code', {
      'review_loop.id': this.state.id,
      'agent.id': this.state.coderId,
      'agent.role': 'coder',
    }, async (span) => {
      this.state.status = 'coding';
      this.persistState();

      const task = `Generate code for the following requirements:\n\n${this.state.codeInput}\n\nProvide clean, well-structured code that addresses all requirements.`;

      // INPUT gate (AIG-868): validate requirements BEFORE the coder runs.
      await this.runGuardrailGate(this.state.codeInput, 'input', 'coder');

      const result = await this.executeAgentTask(this.state.coderId, task);

      // OUTPUT gate (AIG-868): validate the coder's output BEFORE it reaches
      // the adversarial reviewer / is persisted — leaked secrets, PII.
      await this.runGuardrailGate(result.response, 'output', 'coder');

      this.state.currentCode = result.response;
      this.persistState();
      span?.setAttribute('llm.response.model', result.model);
      span?.setAttribute('agent.duration_ms', result.duration);

      log.debug('Initial code generated', { id: this.state.id });
    });
  }

  /**
   * Main review loop
   */
  private async runLoop(): Promise<void> {
    while (this.state.iteration < this.state.maxIterations) {
      this.state.iteration++;
      this.emit('loop:iteration', this.state.iteration, this.state);

      log.info('Review loop iteration', {
        id: this.state.id,
        iteration: this.state.iteration,
        maxIterations: this.state.maxIterations,
      });

      // Perform adversarial review
      const reviewResult = await this.performReview();
      this.state.reviews.push(reviewResult);
      this.persistState();
      this.emit('loop:review', reviewResult, this.state);

      // Check verdict
      if (reviewResult.verdict === 'APPROVE') {
        this.state.status = 'approved';
        this.state.finalVerdict = 'APPROVE';
        this.state.completedAt = new Date();
        this.persistState();
        this.emit('loop:approved', this.state);
        log.info('Code approved', { id: this.state.id, iteration: this.state.iteration });
        break;
      }

      // If rejected and we have iterations left, fix the code
      if (this.state.iteration < this.state.maxIterations) {
        await this.fixCode(reviewResult.issues);
        this.emit('loop:fix', this.state.iteration, reviewResult.issues, this.state);
      }
    }

    // If we exhausted iterations without approval
    if (this.state.status !== 'approved') {
      this.state.status = 'max_iterations_reached';
      this.state.finalVerdict = 'REJECT';
      this.state.completedAt = new Date();
      this.persistState();
      log.warn('Max iterations reached without approval', {
        id: this.state.id,
        iterations: this.state.iteration,
      });
    }

    this.emit('loop:complete', this.state);
  }

  /**
   * Perform adversarial review
   */
  private async performReview(): Promise<ReviewResult> {
    return traceAsync(this.config, 'aistack.review_loop.review', {
      'review_loop.id': this.state.id,
      'review_loop.iteration': this.state.iteration,
      'agent.id': this.state.adversarialId,
      'agent.role': 'adversarial',
    }, async (span) => {
      this.state.status = 'reviewing';
      this.persistState();

      const task = `Review the following code critically. Try to break it with edge cases, find security issues, and identify bugs.

## Code to Review
\`\`\`
${this.state.currentCode}
\`\`\`

## Original Requirements
${this.state.codeInput}

Provide your analysis in this format:
1. List each issue found with severity (CRITICAL/HIGH/MEDIUM/LOW)
2. For each issue, explain the attack vector and required fix
3. End with either **VERDICT: APPROVE** or **VERDICT: REJECT**`;

      const result = await this.executeAgentTask(this.state.adversarialId, task);

      const parsed = this.parseReviewResult(result.response);
      span?.setAttribute('review.verdict', parsed.verdict);
      span?.setAttribute('review.issue_count', parsed.issues.length);
      span?.setAttribute('llm.response.model', result.model);
      span?.setAttribute('agent.duration_ms', result.duration);
      return parsed;
    });
  }

  /**
   * Parse review result from adversarial agent response
   */
  private parseReviewResult(response: string): ReviewResult {
    const reviewId = randomUUID();
    const issues: ReviewIssue[] = [];

    // Extract verdict
    const verdictMatch = response.match(/\*\*VERDICT:\s*(APPROVE|REJECT)\*\*/i);
    const verdict: ReviewVerdict = verdictMatch?.[1]?.toUpperCase() === 'APPROVE' ? 'APPROVE' : 'REJECT';

    // Extract issues - look for severity markers
    const issueRegex = /\*\*\[SEVERITY:\s*(CRITICAL|HIGH|MEDIUM|LOW)\]\*\*\s*[-–—]\s*(.+?)(?=\n\*\*\[SEVERITY:|VERDICT:|$)/gis;
    const issueMatches = response.matchAll(issueRegex);

    for (const match of issueMatches) {
      const severity = match[1].toUpperCase() as IssueSeverity;
      const content = match[2].trim();

      // Extract title (first line)
      const lines = content.split('\n');
      const title = lines[0].trim();

      // Extract components
      const locationMatch = content.match(/\*\*Location\*\*:\s*(.+)/i);
      const attackMatch = content.match(/\*\*Attack Vector\*\*:\s*(.+)/i);
      const impactMatch = content.match(/\*\*Impact\*\*:\s*(.+)/i);
      const fixMatch = content.match(/\*\*Required Fix\*\*:\s*(.+)/i);

      issues.push({
        id: randomUUID(),
        severity,
        title,
        location: locationMatch?.[1]?.trim(),
        attackVector: attackMatch?.[1]?.trim(),
        impact: impactMatch?.[1]?.trim(),
        requiredFix: fixMatch?.[1]?.trim() ?? 'Fix the identified issue',
      });
    }

    // If no structured issues found but verdict is REJECT, create generic issue
    if (issues.length === 0 && verdict === 'REJECT') {
      issues.push({
        id: randomUUID(),
        severity: 'MEDIUM',
        title: 'Issues found in code review',
        requiredFix: 'Address issues mentioned in review comments',
      });
    }

    log.debug('Parsed review result', {
      reviewId,
      verdict,
      issueCount: issues.length,
    });

    return {
      reviewId,
      verdict,
      issues,
      summary: response,
      timestamp: new Date(),
    };
  }

  /**
   * Fix code based on review issues
   */
  private async fixCode(issues: ReviewIssue[]): Promise<void> {
    await traceAsync(this.config, 'aistack.review_loop.fix_code', {
      'review_loop.id': this.state.id,
      'review_loop.iteration': this.state.iteration,
      'review.issue_count': issues.length,
      'agent.id': this.state.coderId,
      'agent.role': 'coder',
    }, async (span) => {
      this.state.status = 'fixing';
      this.persistState();

      const issuesList = issues
        .map((issue, i) => `${i + 1}. [${issue.severity}] ${issue.title}\n   Fix: ${issue.requiredFix}`)
        .join('\n');

      const task = `Fix the following issues in the code:

## Current Code
\`\`\`
${this.state.currentCode}
\`\`\`

## Issues to Fix
${issuesList}

## Original Requirements
${this.state.codeInput}

Provide the corrected code that addresses all the identified issues.`;

      // INPUT gate on the fix instructions as well: review feedback becomes
      // the next coder instruction and can carry prompt-injection text.
      await this.runGuardrailGate(issuesList, 'input', 'coder');

      const result = await this.executeAgentTask(this.state.coderId, task);

      // OUTPUT gate (AIG-868): re-validate the fixed code before it loops
      // back into review — a fix must not (re)introduce a secret / PII leak.
      await this.runGuardrailGate(result.response, 'output', 'coder');

      this.state.currentCode = result.response;
      this.persistState();
      span?.setAttribute('llm.response.model', result.model);
      span?.setAttribute('agent.duration_ms', result.duration);

      log.debug('Code fixed', { id: this.state.id, issueCount: issues.length });
    });
  }

  /**
   * Abort the review loop
   */
  abort(): void {
    this.state.status = 'aborted';
    this.state.completedAt = new Date();
    this.persistState();

    // Stop agents
    stopAgent(this.state.coderId);
    stopAgent(this.state.adversarialId);

    // Remove from active loops
    activeLoops.delete(this.state.id);

    log.info('Review loop aborted', { id: this.state.id });
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    stopAgent(this.state.coderId);
    stopAgent(this.state.adversarialId);
    activeLoops.delete(this.state.id);
    this.removeAllListeners();
  }
}

/**
 * Create and start a review loop.
 *
 * Default behaviour is the adversarial APPROVE/REJECT loop. If
 * `options.rubric` is supplied the loop routes to the Outcomes-style
 * rubric grader instead; the result is normalised back into a
 * ReviewLoopState so callers see a uniform shape.
 */
export async function createReviewLoop(
  codeInput: string,
  config: AgentStackConfig,
  options: ReviewLoopOptions = {}
): Promise<ReviewLoopState> {
  if (options.rubric != null) {
    const { runRubricReviewLoop } = await import('../workflows/rubric/index.js');
    return runRubricReviewLoop(codeInput, config, options as { rubric: unknown; maxIterations?: number; sessionId?: string });
  }
  const coordinator = new ReviewLoopCoordinator(codeInput, config, options);
  const result = await coordinator.start();
  return result;
}

/**
 * Get an active review loop by ID
 */
export function getReviewLoop(id: string): ReviewLoopCoordinator | null {
  return activeLoops.get(id) ?? null;
}

/**
 * List all active review loops
 */
export function listReviewLoops(): ReviewLoopState[] {
  return Array.from(activeLoops.values()).map(loop => loop.getState());
}

/**
 * Abort a review loop by ID
 */
export function abortReviewLoop(id: string): boolean {
  const loop = activeLoops.get(id);
  if (!loop) return false;
  loop.abort();
  return true;
}

/**
 * Clear all review loops (used for testing)
 */
export function clearReviewLoops(): void {
  for (const loop of activeLoops.values()) {
    loop.cleanup();
  }
  activeLoops.clear();
}
