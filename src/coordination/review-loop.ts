/**
 * Review Loop Coordinator - iterative coder-adversarial review pattern
 *
 * Workflow: Coder produces code → Adversarial reviews → If REJECT: Coder fixes → Repeat
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  AgentStackConfig,
  ReviewLoopState,
  ReviewResult,
  ReviewIssue,
  ReviewVerdict,
  IssueSeverity,
} from '../types.js';
import { spawnAgent, executeAgent, stopAgent, updateAgentStatus } from '../agents/spawner.js';
import { logger } from '../utils/logger.js';
import { getMemoryManager } from '../memory/index.js';
import { Semaphore } from '../utils/semaphore.js';

const log = logger.child('review-loop');

// Concurrency control for review loops
// Max 5 concurrent review loops (each loop spawns 2 agents = 10 agents max)
const reviewLoopSemaphore = new Semaphore('review-loops', 5);

export interface ReviewLoopOptions {
  maxIterations?: number;
  sessionId?: string;
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
    return reviewLoopSemaphore.execute(async () => {
      try {
        this.emit('loop:start', this.state);
        log.info('Starting review loop', { id: this.state.id });

        // Initial code generation
        await this.generateInitialCode();

        // Run review iterations
        await this.runLoop();

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
    });
  }

  /**
   * Generate initial code from input
   */
  private async generateInitialCode(): Promise<void> {
    this.state.status = 'coding';
    this.persistState();
    updateAgentStatus(this.state.coderId, 'running');

    const task = `Generate code for the following requirements:\n\n${this.state.codeInput}\n\nProvide clean, well-structured code that addresses all requirements.`;

    const result = await executeAgent(this.state.coderId, task, this.config);
    this.state.currentCode = result.response;
    this.persistState();

    updateAgentStatus(this.state.coderId, 'idle');
    log.debug('Initial code generated', { id: this.state.id });
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
    this.state.status = 'reviewing';
    this.persistState();
    updateAgentStatus(this.state.adversarialId, 'running');

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

    const result = await executeAgent(this.state.adversarialId, task, this.config);
    updateAgentStatus(this.state.adversarialId, 'idle');

    return this.parseReviewResult(result.response);
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
    this.state.status = 'fixing';
    this.persistState();
    updateAgentStatus(this.state.coderId, 'running');

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

    const result = await executeAgent(this.state.coderId, task, this.config);
    this.state.currentCode = result.response;
    this.persistState();

    updateAgentStatus(this.state.coderId, 'idle');
    log.debug('Code fixed', { id: this.state.id, issueCount: issues.length });
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
 * Create and start a review loop
 */
export async function createReviewLoop(
  codeInput: string,
  config: AgentStackConfig,
  options: ReviewLoopOptions = {}
): Promise<ReviewLoopState> {
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
