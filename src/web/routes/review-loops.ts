/**
 * Review Loop routes
 */

import type { AgentStackConfig } from '../../types.js';
import type { Router } from '../router.js';
import { sendJson } from '../router.js';
import { badRequest, notFound } from '../middleware/error.js';
import {
  createReviewLoop,
  getReviewLoop,
  listReviewLoops,
  abortReviewLoop,
  type ReviewLoopOptions,
} from '../../coordination/review-loop.js';
import { agentEvents } from '../websocket/event-bridge.js';
import type { ReviewLoopState, ReviewResult, ReviewIssue } from '../../types.js';

export interface LaunchReviewLoopRequest {
  codeInput: string;
  maxIterations?: number;
  sessionId?: string;
}

export function registerReviewLoopRoutes(router: Router, config: AgentStackConfig): void {
  // GET /api/v1/review-loops - List active review loops
  router.get('/api/v1/review-loops', (_req, res) => {
    const loops = listReviewLoops();

    const formatted = loops.map(loop => ({
      id: loop.id,
      coderId: loop.coderId,
      adversarialId: loop.adversarialId,
      sessionId: loop.sessionId,
      iteration: loop.iteration,
      maxIterations: loop.maxIterations,
      status: loop.status,
      finalVerdict: loop.finalVerdict,
      startedAt: loop.startedAt.toISOString(),
      completedAt: loop.completedAt?.toISOString(),
      reviewCount: loop.reviews.length,
    }));

    sendJson(res, formatted);
  });

  // POST /api/v1/review-loops - Start a new review loop
  router.post('/api/v1/review-loops', async (_req, res, params) => {
    const body = params.body as LaunchReviewLoopRequest | undefined;

    if (!body?.codeInput) {
      throw badRequest('Code input is required');
    }

    const options: ReviewLoopOptions = {
      maxIterations: body.maxIterations,
      sessionId: body.sessionId,
    };

    // Start the review loop asynchronously
    const loopPromise = createReviewLoop(body.codeInput, config, options);

    // Get the initial state (loop is created synchronously, execution is async)
    const loop = await loopPromise.catch(() => null);

    if (!loop) {
      throw badRequest('Failed to create review loop');
    }

    // Wire up event handlers for WebSocket notifications
    const coordinator = getReviewLoop(loop.id);
    if (coordinator) {
      coordinator.on('loop:start', (state: ReviewLoopState) => {
        agentEvents.emit('review-loop:start', {
          loopId: state.id,
          state,
        });
      });

      coordinator.on('loop:iteration', (iteration: number, state: ReviewLoopState) => {
        agentEvents.emit('review-loop:iteration', {
          loopId: state.id,
          iteration,
          state,
        });
      });

      coordinator.on('loop:review', (result: ReviewResult, state: ReviewLoopState) => {
        agentEvents.emit('review-loop:review', {
          loopId: state.id,
          result,
          state,
        });
      });

      coordinator.on('loop:fix', (iteration: number, issues: ReviewIssue[], state: ReviewLoopState) => {
        agentEvents.emit('review-loop:fix', {
          loopId: state.id,
          iteration,
          issues,
          state,
        });
      });

      coordinator.on('loop:approved', (state: ReviewLoopState) => {
        agentEvents.emit('review-loop:approved', {
          loopId: state.id,
          state,
        });
      });

      coordinator.on('loop:complete', (state: ReviewLoopState) => {
        agentEvents.emit('review-loop:complete', {
          loopId: state.id,
          state,
        });
      });

      coordinator.on('loop:error', (error: Error, state: ReviewLoopState) => {
        agentEvents.emit('review-loop:error', {
          loopId: state.id,
          error: error.message,
          state,
        });
      });
    }

    sendJson(res, {
      id: loop.id,
      coderId: loop.coderId,
      adversarialId: loop.adversarialId,
      status: loop.status,
      iteration: loop.iteration,
      maxIterations: loop.maxIterations,
      startedAt: loop.startedAt.toISOString(),
    }, 202);
  });

  // GET /api/v1/review-loops/:id - Get review loop details
  router.get('/api/v1/review-loops/:id', (_req, res, params) => {
    const loopId = params.path[0];
    if (!loopId) {
      throw badRequest('Review loop ID is required');
    }

    const coordinator = getReviewLoop(loopId);
    if (!coordinator) {
      throw notFound('Review loop');
    }

    const state = coordinator.getState();

    sendJson(res, {
      id: state.id,
      coderId: state.coderId,
      adversarialId: state.adversarialId,
      sessionId: state.sessionId,
      iteration: state.iteration,
      maxIterations: state.maxIterations,
      status: state.status,
      codeInput: state.codeInput,
      currentCode: state.currentCode,
      reviews: state.reviews.map(review => ({
        reviewId: review.reviewId,
        verdict: review.verdict,
        issues: review.issues,
        summary: review.summary,
        timestamp: review.timestamp.toISOString(),
      })),
      finalVerdict: state.finalVerdict,
      startedAt: state.startedAt.toISOString(),
      completedAt: state.completedAt?.toISOString(),
    });
  });

  // POST /api/v1/review-loops/:id/abort - Abort a review loop
  router.post('/api/v1/review-loops/:id/abort', (_req, res, params) => {
    const loopId = params.path[0];
    if (!loopId) {
      throw badRequest('Review loop ID is required');
    }

    const aborted = abortReviewLoop(loopId);
    if (!aborted) {
      throw notFound('Review loop');
    }

    agentEvents.emit('review-loop:aborted', {
      loopId,
    });

    sendJson(res, {
      loopId,
      status: 'aborted',
    });
  });
}
