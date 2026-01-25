/**
 * Review Loop MCP tools - control iterative code review workflows
 */

import { z } from 'zod';
import {
  ReviewLoopCoordinator,
  createReviewLoop,
  getReviewLoop,
  listReviewLoops,
  abortReviewLoop,
} from '../../coordination/review-loop.js';
import type { AgentStackConfig, ReviewLoopState } from '../../types.js';

// Input schemas
const StartInputSchema = z.object({
  code: z.string().min(1).describe('Code or task description to review'),
  maxIterations: z.number().int().min(1).max(10).optional().describe('Maximum review iterations (default: 3)'),
  sessionId: z.string().uuid().optional().describe('Session ID to associate with'),
});

const LoopIdSchema = z.object({
  loopId: z.string().uuid().describe('Review loop ID'),
});

/**
 * Format review loop state for API response
 */
function formatLoopState(state: ReviewLoopState) {
  return {
    id: state.id,
    sessionId: state.sessionId,
    status: state.status,
    iteration: state.iteration,
    maxIterations: state.maxIterations,
    coderId: state.coderId,
    adversarialId: state.adversarialId,
    reviewCount: state.reviews.length,
    finalVerdict: state.finalVerdict,
    startedAt: state.startedAt.toISOString(),
    completedAt: state.completedAt?.toISOString(),
  };
}

export function createReviewLoopTools(config: AgentStackConfig) {
  return {
    review_loop_start: {
      name: 'review_loop_start',
      description: 'Start a new adversarial review loop. The coder generates code, adversarial reviews it, and they iterate until approval or max iterations.',
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Code or task description to review' },
          maxIterations: { type: 'number', description: 'Maximum review iterations (default: 3, max: 10)' },
          sessionId: { type: 'string', description: 'Session ID to associate with' },
        },
        required: ['code'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = StartInputSchema.parse(params);

        try {
          const state = await createReviewLoop(input.code, config, {
            maxIterations: input.maxIterations,
            sessionId: input.sessionId,
          });

          return {
            success: true,
            loop: formatLoopState(state),
            finalCode: state.currentCode,
            message: state.status === 'approved'
              ? `Code approved after ${state.iteration} iteration(s)`
              : `Review loop completed with status: ${state.status}`,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },

    review_loop_status: {
      name: 'review_loop_status',
      description: 'Get the current status and details of a review loop',
      inputSchema: {
        type: 'object',
        properties: {
          loopId: { type: 'string', description: 'Review loop ID' },
        },
        required: ['loopId'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = LoopIdSchema.parse(params);
        const loop = getReviewLoop(input.loopId);

        if (!loop) {
          return {
            found: false,
            message: 'Review loop not found',
          };
        }

        const state = loop.getState();

        return {
          found: true,
          loop: formatLoopState(state),
          latestReview: state.reviews.length > 0
            ? {
                verdict: state.reviews[state.reviews.length - 1].verdict,
                issueCount: state.reviews[state.reviews.length - 1].issues.length,
                timestamp: state.reviews[state.reviews.length - 1].timestamp.toISOString(),
              }
            : null,
        };
      },
    },

    review_loop_abort: {
      name: 'review_loop_abort',
      description: 'Stop a running review loop',
      inputSchema: {
        type: 'object',
        properties: {
          loopId: { type: 'string', description: 'Review loop ID to abort' },
        },
        required: ['loopId'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = LoopIdSchema.parse(params);
        const aborted = abortReviewLoop(input.loopId);

        return {
          success: aborted,
          message: aborted ? 'Review loop aborted' : 'Review loop not found',
        };
      },
    },

    review_loop_issues: {
      name: 'review_loop_issues',
      description: 'Get detailed issues from all reviews in a loop',
      inputSchema: {
        type: 'object',
        properties: {
          loopId: { type: 'string', description: 'Review loop ID' },
        },
        required: ['loopId'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = LoopIdSchema.parse(params);
        const loop = getReviewLoop(input.loopId);

        if (!loop) {
          return {
            found: false,
            message: 'Review loop not found',
          };
        }

        const state = loop.getState();

        return {
          found: true,
          loopId: state.id,
          reviews: state.reviews.map((review, index) => ({
            iteration: index + 1,
            reviewId: review.reviewId,
            verdict: review.verdict,
            issueCount: review.issues.length,
            issues: review.issues.map(issue => ({
              id: issue.id,
              severity: issue.severity,
              title: issue.title,
              location: issue.location,
              attackVector: issue.attackVector,
              impact: issue.impact,
              requiredFix: issue.requiredFix,
            })),
            timestamp: review.timestamp.toISOString(),
          })),
        };
      },
    },

    review_loop_list: {
      name: 'review_loop_list',
      description: 'List all active review loops',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        const loops = listReviewLoops();

        return {
          count: loops.length,
          loops: loops.map(formatLoopState),
        };
      },
    },

    review_loop_get_code: {
      name: 'review_loop_get_code',
      description: 'Get the current code from a review loop',
      inputSchema: {
        type: 'object',
        properties: {
          loopId: { type: 'string', description: 'Review loop ID' },
        },
        required: ['loopId'],
      },
      handler: async (params: Record<string, unknown>) => {
        const input = LoopIdSchema.parse(params);
        const loop = getReviewLoop(input.loopId);

        if (!loop) {
          return {
            found: false,
            message: 'Review loop not found',
          };
        }

        const state = loop.getState();

        return {
          found: true,
          loopId: state.id,
          status: state.status,
          iteration: state.iteration,
          originalInput: state.codeInput,
          currentCode: state.currentCode,
          finalVerdict: state.finalVerdict,
        };
      },
    },
  };
}
