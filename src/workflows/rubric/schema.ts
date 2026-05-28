/**
 * Rubric grading schema definitions
 *
 * Provides zod validators for declarative rubric documents used by the
 * Outcomes-style grading loop. A rubric is a weighted list of criteria;
 * the grader scores each criterion in [0, 1] and the overall pass/fail
 * verdict is computed against per-criterion thresholds plus an overall
 * weighted average threshold.
 *
 * Parallel to (and intentionally separate from) the adversarial ReviewLoop
 * APPROVE/REJECT binary verdict: rubrics measure adherence, adversarial
 * looks for holes.
 */

import { z } from 'zod';

/**
 * A single criterion in a rubric. Weight is normalised across the
 * rubric when computing the overall score, so authors can use absolute
 * weights (0.4) or relative weights (4) interchangeably.
 */
export const CriterionSchema = z.object({
  /** Stable identifier — slug-ish, used in reports and prompts */
  criterion: z.string().min(1, 'criterion name is required'),
  /** Human description shown to the grader agent; falls back to criterion */
  description: z.string().optional(),
  /** Relative weight; values <= 0 are rejected. Defaults to 1.0 */
  weight: z.number().positive().default(1.0),
  /**
   * Minimum per-criterion score in [0,1] for the rubric to pass.
   * If omitted, only the overall weighted threshold applies for this criterion.
   */
  pass_threshold: z.number().min(0).max(1).optional(),
  /**
   * Optional list of explicit checks the grader must consider. Surfaced
   * verbatim in the grader prompt to focus the model.
   */
  checks: z.array(z.string()).optional(),
});

export type Criterion = z.infer<typeof CriterionSchema>;

/**
 * A rubric document. `overall_threshold` controls the pass/fail decision
 * on the weighted average; defaults to 0.8.
 */
export const RubricDocSchema = z.object({
  /** Schema version for forward compatibility */
  version: z.literal(1).default(1),
  /** Short rubric name (e.g. "code-quality") */
  name: z.string().min(1),
  /** Optional longer description shown in reports */
  description: z.string().optional(),
  /** Weighted criteria; must contain at least one entry */
  rubric: z.array(CriterionSchema).min(1, 'rubric must have at least one criterion'),
  /** Weighted-average threshold for overall PASS (default 0.8) */
  overall_threshold: z.number().min(0).max(1).default(0.8),
  /** Max grade->fix iterations (default 3) */
  max_iterations: z.number().int().positive().default(3),
});

export type RubricDoc = z.infer<typeof RubricDocSchema>;

/**
 * Per-criterion grading output produced by the grader agent.
 */
export const CriterionScoreSchema = z.object({
  criterion: z.string(),
  /** Raw model score, [0,1] */
  score: z.number().min(0).max(1),
  /** Justification surfaced in the rubric report */
  justification: z.string(),
  /** Did this criterion meet its pass_threshold (if any)? */
  passed: z.boolean(),
  /** Effective weight used in the overall computation */
  weight: z.number().positive(),
});

export type CriterionScore = z.infer<typeof CriterionScoreSchema>;

/**
 * Aggregated rubric outcome for one grading pass.
 */
export const RubricResultSchema = z.object({
  rubricName: z.string(),
  scores: z.array(CriterionScoreSchema),
  /** Weighted average of all criterion scores, [0,1] */
  overallScore: z.number().min(0).max(1),
  /** True iff overallScore >= overall_threshold AND every criterion
   *  with a pass_threshold met it. */
  passed: z.boolean(),
  /** Human-readable summary suitable for logs / fix prompts */
  summary: z.string(),
  timestamp: z.date(),
});

export type RubricResult = z.infer<typeof RubricResultSchema>;
