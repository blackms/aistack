/**
 * Rubric workflow module — public surface + review-loop adapter
 *
 * Outcomes-style self-grading: declarative rubric documents + per-criterion
 * grader spawning + weighted scoring + opt-in integration with the review
 * loop. Parallel to the existing adversarial review loop (binary verdict);
 * rubrics measure adherence, adversarial looks for holes.
 *
 * See docs/RUBRIC.md for usage and template authoring.
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentStackConfig,
  ReviewLoopState,
  ReviewResult,
  ReviewIssue,
  IssueSeverity,
} from '../../types.js';
import {
  spawnAgent,
  executeAgent,
  stopAgent,
  updateAgentStatus,
} from '../../agents/spawner.js';
import { logger } from '../../utils/logger.js';
import { getMemoryManager } from '../../memory/index.js';
import { parseRubric } from './parser.js';
import { gradeOutput, buildFixPrompt } from './grader.js';
import type { CriterionScore } from './schema.js';

// ---------------------------------------------------------------------------
// Public re-exports
// ---------------------------------------------------------------------------

export {
  RubricDocSchema,
  CriterionSchema,
  CriterionScoreSchema,
  RubricResultSchema,
} from './schema.js';

export type {
  RubricDoc,
  Criterion,
  CriterionScore,
  RubricResult,
} from './schema.js';

export { parseRubric, parseYamlSubset } from './parser.js';

export {
  gradeOutput,
  computeOverallScore,
  computePassed,
  parseScoreResponse,
  buildFixPrompt,
} from './grader.js';

export type { GradeOptions } from './grader.js';

// ---------------------------------------------------------------------------
// Review-loop adapter — invoked by createReviewLoop when options.rubric is set.
// Returns the same ReviewLoopState shape as the adversarial loop so callers
// don't need to special-case the rubric branch.
// ---------------------------------------------------------------------------

const log = logger.child('rubric-loop');

export interface RubricLoopOptions {
  maxIterations?: number;
  sessionId?: string;
  rubric: unknown;
}

/**
 * Run an Outcomes-style review loop: coder produces output → grader scores
 * each criterion → if rubric passes, APPROVE; otherwise spawn coder again
 * with per-criterion fix feedback.
 */
export async function runRubricReviewLoop(
  codeInput: string,
  config: AgentStackConfig,
  options: RubricLoopOptions
): Promise<ReviewLoopState> {
  const rubric = parseRubric(options.rubric);
  const maxIterations = options.maxIterations ?? rubric.max_iterations;

  const coder = spawnAgent(
    'coder',
    {
      name: `rubric-loop-coder-${randomUUID().slice(0, 8)}`,
      sessionId: options.sessionId,
    },
    config
  );

  const state: ReviewLoopState = {
    id: randomUUID(),
    sessionId: options.sessionId,
    coderId: coder.id,
    // Reuse adversarialId slot for the "primary grader" reference. The actual
    // grader agents are spawned per-criterion by gradeOutput and cleaned up
    // there; this id is a stable placeholder for the loop record.
    adversarialId: coder.id,
    iteration: 0,
    maxIterations,
    status: 'pending',
    codeInput,
    currentCode: undefined,
    reviews: [],
    startedAt: new Date(),
  };

  persist(state, config);
  log.info('Rubric review loop started', {
    id: state.id,
    rubric: rubric.name,
    maxIterations,
  });

  try {
    // Initial code generation
    state.status = 'coding';
    persist(state, config);
    updateAgentStatus(coder.id, 'running');
    const initialTask = `Generate code/output for the following requirements. It will be graded by an Outcomes-style rubric (${rubric.name}); aim to satisfy every criterion.

## Requirements
${codeInput}

## Rubric Criteria
${rubric.rubric.map((c) => `- ${c.criterion}${c.description ? `: ${c.description}` : ''}`).join('\n')}`;
    const initial = await executeAgent(coder.id, initialTask, config);
    state.currentCode = initial.response;
    persist(state, config);
    updateAgentStatus(coder.id, 'idle');

    // Grade -> fix loop
    while (state.iteration < state.maxIterations) {
      state.iteration++;
      state.status = 'reviewing';
      persist(state, config);

      log.info('Rubric grading iteration', {
        id: state.id,
        iteration: state.iteration,
      });

      const result = await gradeOutput(rubric, state.currentCode ?? '', config, {
        sessionId: options.sessionId,
        requirements: codeInput,
      });

      // Bridge to ReviewResult / ReviewLoopState shape
      const reviewResult: ReviewResult = {
        reviewId: randomUUID(),
        verdict: result.passed ? 'APPROVE' : 'REJECT',
        issues: result.passed ? [] : scoresToIssues(result.scores),
        summary: result.summary,
        timestamp: result.timestamp,
      };
      state.reviews.push(reviewResult);
      persist(state, config);

      if (result.passed) {
        state.status = 'approved';
        state.finalVerdict = 'APPROVE';
        state.completedAt = new Date();
        persist(state, config);
        log.info('Rubric passed', {
          id: state.id,
          iteration: state.iteration,
          overallScore: result.overallScore,
        });
        break;
      }

      if (state.iteration < state.maxIterations) {
        state.status = 'fixing';
        persist(state, config);
        updateAgentStatus(coder.id, 'running');
        const fixPrompt = buildFixPrompt(result, state.currentCode ?? '', codeInput);
        const fix = await executeAgent(coder.id, fixPrompt, config);
        state.currentCode = fix.response;
        persist(state, config);
        updateAgentStatus(coder.id, 'idle');
      }
    }

    if (state.status !== 'approved') {
      state.status = 'max_iterations_reached';
      state.finalVerdict = 'REJECT';
      state.completedAt = new Date();
      persist(state, config);
      log.warn('Rubric loop exhausted iterations without passing', {
        id: state.id,
        iterations: state.iteration,
      });
    }

    return state;
  } catch (err) {
    state.status = 'failed';
    persist(state, config);
    log.error('Rubric review loop failed', {
      id: state.id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    try {
      stopAgent(coder.id);
    } catch {
      /* ignore */
    }
  }
}

function persist(state: ReviewLoopState, config: AgentStackConfig): void {
  try {
    const mm = getMemoryManager(config);
    mm.getStore().saveReviewLoop(state.id, state);
  } catch (err) {
    log.warn('Failed to persist rubric loop state', {
      id: state.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function scoresToIssues(scores: CriterionScore[]): ReviewIssue[] {
  return scores
    .filter((s) => !s.passed)
    .map((s) => ({
      id: randomUUID(),
      severity: scoreToSeverity(s.score),
      title: `Criterion '${s.criterion}' scored ${s.score.toFixed(2)}`,
      requiredFix: s.justification,
    }));
}

function scoreToSeverity(score: number): IssueSeverity {
  if (score < 0.3) return 'CRITICAL';
  if (score < 0.5) return 'HIGH';
  if (score < 0.75) return 'MEDIUM';
  return 'LOW';
}
