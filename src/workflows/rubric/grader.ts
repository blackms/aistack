/**
 * Rubric grader — Outcomes-style self-grading engine
 *
 * Given a {@link RubricDoc} and a candidate output (typically code or a
 * design proposal), spawns a `grader` agent per criterion to produce a
 * focused 0..1 score with justification. Scores are aggregated with the
 * per-criterion weights into a normalised overall score; pass/fail is
 * decided by overall + per-criterion thresholds.
 *
 * Per-criterion spawning is deliberate: it keeps the grader's attention
 * window small (one criterion at a time) and reduces hallucinated
 * average-the-vibes scoring observed when asking a single agent to score
 * all criteria in one shot.
 */

import { randomUUID } from 'node:crypto';
import type { AgentStackConfig } from '../../types.js';
import { spawnAgent, executeAgent, stopAgent, updateAgentStatus } from '../../agents/spawner.js';
import { hasAgentType } from '../../agents/registry.js';
import { logger } from '../../utils/logger.js';
import type { Criterion, CriterionScore, RubricDoc, RubricResult } from './schema.js';

const log = logger.child('rubric-grader');

export interface GradeOptions {
  sessionId?: string;
  /** Original task / requirements the candidate output was meant to satisfy */
  requirements?: string;
  /** Provider override forwarded to executeAgent */
  provider?: string;
  /** Override agent type used for grading (defaults to 'grader'; falls back
   *  to 'reviewer' if 'grader' isn't registered, e.g. in tests). */
  graderAgentType?: string;
}

const SCORE_RE = /"?score"?\s*:\s*([0-9]*\.?[0-9]+)/i;
const JUSTIFICATION_RE = /"?justification"?\s*:\s*"((?:\\.|[^"\\])*)"/i;
const FENCED_JSON_RE = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/i;

/**
 * Grade a candidate output against a rubric. Returns a {@link RubricResult}
 * with per-criterion scores and an aggregated PASS/FAIL.
 */
export async function gradeOutput(
  rubric: RubricDoc,
  output: string,
  config: AgentStackConfig,
  options: GradeOptions = {}
): Promise<RubricResult> {
  const desiredType = options.graderAgentType ?? 'grader';
  const agentType = hasAgentType(desiredType)
    ? desiredType
    : hasAgentType('reviewer')
    ? 'reviewer'
    : desiredType;

  log.info('Starting rubric grading', {
    rubric: rubric.name,
    criteria: rubric.rubric.length,
    agentType,
  });

  const scores: CriterionScore[] = [];
  for (const criterion of rubric.rubric) {
    const score = await gradeCriterion(criterion, output, config, agentType, options);
    scores.push(score);
  }

  const overallScore = computeOverallScore(scores);
  const passed = computePassed(rubric, scores, overallScore);
  const summary = buildSummary(rubric, scores, overallScore, passed);

  return {
    rubricName: rubric.name,
    scores,
    overallScore,
    passed,
    summary,
    timestamp: new Date(),
  };
}

async function gradeCriterion(
  criterion: Criterion,
  output: string,
  config: AgentStackConfig,
  agentType: string,
  options: GradeOptions
): Promise<CriterionScore> {
  const agent = spawnAgent(
    agentType,
    {
      name: `rubric-grader-${criterion.criterion}-${randomUUID().slice(0, 8)}`,
      sessionId: options.sessionId,
    },
    config
  );

  try {
    updateAgentStatus(agent.id, 'running');
    const prompt = buildCriterionPrompt(criterion, output, options.requirements);
    const result = await executeAgent(agent.id, prompt, config, {
      provider: options.provider,
    });
    updateAgentStatus(agent.id, 'idle');

    const { score, justification } = parseScoreResponse(result.response);
    const threshold = criterion.pass_threshold;
    const passed = threshold == null ? true : score >= threshold;

    log.debug('Criterion graded', {
      criterion: criterion.criterion,
      score,
      passed,
      threshold,
    });

    return {
      criterion: criterion.criterion,
      score,
      justification,
      passed,
      weight: criterion.weight,
    };
  } finally {
    // Best-effort cleanup — don't mask original errors
    try {
      stopAgent(agent.id);
    } catch {
      /* ignore */
    }
  }
}

function buildCriterionPrompt(
  criterion: Criterion,
  output: string,
  requirements?: string
): string {
  const checksBlock =
    criterion.checks && criterion.checks.length > 0
      ? `\n## Specific Checks\n${criterion.checks.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n`
      : '';
  const desc = criterion.description ?? criterion.criterion;
  const reqBlock = requirements
    ? `\n## Original Requirements\n${requirements}\n`
    : '';

  return `You are an Outcomes-style rubric GRADER. Score ONE criterion only.

## Criterion: ${criterion.criterion}
${desc}
${checksBlock}${reqBlock}
## Candidate Output
\`\`\`
${output}
\`\`\`

## Scoring Rubric (0.0 .. 1.0)
- 1.0 — fully satisfies the criterion, no meaningful gaps
- 0.8 — satisfies in all important respects, minor gaps
- 0.6 — partially satisfies; notable gaps that should be addressed
- 0.4 — weak; multiple important gaps
- 0.2 — barely addresses the criterion
- 0.0 — does not address the criterion at all

## Output Format (STRICT)
Respond with a single JSON object on its own line:
\`\`\`json
{"score": <number 0..1>, "justification": "<one paragraph explaining the score>"}
\`\`\`

Do not include any other commentary outside the JSON block.`;
}

/**
 * Extract {score, justification} from a model response. Tolerant of:
 *  - fenced ```json blocks
 *  - bare JSON
 *  - prose with embedded "score: 0.7"
 */
export function parseScoreResponse(response: string): { score: number; justification: string } {
  // Try fenced JSON first
  const fenced = response.match(FENCED_JSON_RE);
  const candidates: string[] = [];
  if (fenced && fenced[1]) candidates.push(fenced[1]);
  // Try first {...} block
  const braceStart = response.indexOf('{');
  const braceEnd = response.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    candidates.push(response.slice(braceStart, braceEnd + 1));
  }
  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate);
      const score = clamp01(Number(obj.score));
      const justification = String(obj.justification ?? '').trim() || 'No justification provided.';
      if (Number.isFinite(score)) {
        return { score, justification };
      }
    } catch {
      // try next strategy
    }
  }
  // Fallback regex
  const scoreMatch = response.match(SCORE_RE);
  const justMatch = response.match(JUSTIFICATION_RE);
  if (scoreMatch) {
    return {
      score: clamp01(parseFloat(scoreMatch[1])),
      justification: justMatch ? justMatch[1] : response.trim().slice(0, 500),
    };
  }
  log.warn('Failed to parse grader response; defaulting score to 0', {
    snippet: response.slice(0, 200),
  });
  return { score: 0, justification: `Unparseable grader response: ${response.slice(0, 200)}` };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Normalised weighted average. Weights are summed and divided into to
 * support both absolute (0.4, 0.3) and relative (4, 3) authoring styles.
 */
export function computeOverallScore(scores: CriterionScore[]): number {
  if (scores.length === 0) return 0;
  const totalWeight = scores.reduce((s, c) => s + c.weight, 0);
  if (totalWeight <= 0) return 0;
  const weighted = scores.reduce((s, c) => s + c.score * c.weight, 0);
  return clamp01(weighted / totalWeight);
}

export function computePassed(
  rubric: RubricDoc,
  scores: CriterionScore[],
  overallScore: number
): boolean {
  if (overallScore < rubric.overall_threshold) return false;
  return scores.every((s) => s.passed);
}

function buildSummary(
  rubric: RubricDoc,
  scores: CriterionScore[],
  overallScore: number,
  passed: boolean
): string {
  const lines: string[] = [];
  lines.push(`# Rubric: ${rubric.name}`);
  lines.push(`Overall: ${overallScore.toFixed(3)} (threshold ${rubric.overall_threshold}) — ${passed ? 'PASS' : 'FAIL'}`);
  lines.push('');
  for (const s of scores) {
    const thresh = rubric.rubric.find((c) => c.criterion === s.criterion)?.pass_threshold;
    const marker = s.passed ? 'PASS' : 'FAIL';
    const thresholdStr = thresh != null ? ` (>= ${thresh})` : '';
    lines.push(`- [${marker}] ${s.criterion}: ${s.score.toFixed(2)}${thresholdStr} weight=${s.weight}`);
    lines.push(`    ${s.justification}`);
  }
  return lines.join('\n');
}

/**
 * Format a fix-prompt for a coder agent based on a failed rubric pass.
 * Surfaces failing criteria + justifications so the coder can target the
 * gaps in the next iteration.
 */
export function buildFixPrompt(result: RubricResult, currentOutput: string, requirements?: string): string {
  const failing = result.scores.filter((s) => !s.passed);
  const failBlock = failing.length === 0
    ? 'Overall threshold not met; improve weakest criteria below.'
    : failing
        .map((s) => `- [${s.criterion}] scored ${s.score.toFixed(2)}: ${s.justification}`)
        .join('\n');
  return `Your previous output did not satisfy the rubric (${result.rubricName}).

## Rubric Failures
${failBlock}

${requirements ? `## Original Requirements\n${requirements}\n` : ''}
## Current Output
\`\`\`
${currentOutput}
\`\`\`

Revise the output to satisfy the failing criteria while preserving what already passes.`;
}
