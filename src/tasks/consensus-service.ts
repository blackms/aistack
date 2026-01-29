/**
 * Consensus Service
 * Manages consensus checkpoints for high-stakes tasks, preventing self-reinforcing agent cycles
 */

import { randomUUID } from 'node:crypto';
import type { SQLiteStore } from '../memory/sqlite-store.js';
import type {
  AgentStackConfig,
  ConsensusConfig,
  ConsensusCheckpoint,
  ConsensusDecision,
  ConsensusStatus,
  ProposedSubtask,
  TaskRiskLevel,
  ReviewerStrategy,
  Task,
} from '../types.js';
import { logger } from '../utils/logger.js';

const log = logger.child('consensus');

const DEFAULT_CONFIG: ConsensusConfig = {
  enabled: false,
  requireForRiskLevels: ['high', 'medium'],
  reviewerStrategy: 'adversarial',
  timeout: 300000, // 5 minutes
  maxDepth: 5,
  autoReject: false,
};

export interface ConsensusCheckResult {
  requiresConsensus: boolean;
  reason?: string;
  riskLevel?: TaskRiskLevel;
  depth?: number;
}

export interface CreateCheckpointOptions {
  taskId: string;
  parentTaskId?: string;
  proposedSubtasks: ProposedSubtask[];
  riskLevel: TaskRiskLevel;
}

export class ConsensusService {
  private store: SQLiteStore;
  private config: ConsensusConfig;
  private expirationInterval: NodeJS.Timeout | null = null;

  constructor(store: SQLiteStore, appConfig: AgentStackConfig) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...appConfig.consensus };

    log.debug('Consensus service initialized', {
      enabled: this.config.enabled,
      requireForRiskLevels: this.config.requireForRiskLevels,
      reviewerStrategy: this.config.reviewerStrategy,
      timeout: this.config.timeout,
      maxDepth: this.config.maxDepth,
    });

    // Start expiration check if enabled
    if (this.config.enabled) {
      this.startExpirationCheck();
    }
  }

  /**
   * Check if consensus is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the current configuration
   */
  getConfig(): ConsensusConfig {
    return { ...this.config };
  }

  /**
   * Check if a task requires consensus before creating subtasks
   */
  requiresConsensus(
    riskLevel: TaskRiskLevel,
    depth: number,
    parentTaskId?: string
  ): ConsensusCheckResult {
    // Disabled - no consensus required
    if (!this.config.enabled) {
      return { requiresConsensus: false };
    }

    // Check if risk level requires consensus
    if (!this.config.requireForRiskLevels.includes(riskLevel)) {
      return {
        requiresConsensus: false,
        reason: `Risk level '${riskLevel}' does not require consensus`,
        riskLevel,
        depth,
      };
    }

    // Check depth limit
    if (depth > this.config.maxDepth) {
      return {
        requiresConsensus: true,
        reason: `Task depth ${depth} exceeds maximum allowed depth ${this.config.maxDepth}`,
        riskLevel,
        depth,
      };
    }

    // Root tasks (no parent) don't require consensus
    if (!parentTaskId) {
      return {
        requiresConsensus: false,
        reason: 'Root tasks do not require consensus',
        riskLevel,
        depth,
      };
    }

    return {
      requiresConsensus: true,
      reason: `Risk level '${riskLevel}' at depth ${depth} requires consensus`,
      riskLevel,
      depth,
    };
  }

  /**
   * Create a consensus checkpoint
   */
  createCheckpoint(options: CreateCheckpointOptions): ConsensusCheckpoint {
    const checkpointId = randomUUID();

    log.info('Creating consensus checkpoint', {
      checkpointId,
      taskId: options.taskId,
      riskLevel: options.riskLevel,
      subtaskCount: options.proposedSubtasks.length,
    });

    const checkpoint = this.store.createConsensusCheckpoint({
      id: checkpointId,
      taskId: options.taskId,
      parentTaskId: options.parentTaskId,
      proposedSubtasks: options.proposedSubtasks,
      riskLevel: options.riskLevel,
      reviewerStrategy: this.config.reviewerStrategy,
      timeout: this.config.timeout,
    });

    return checkpoint;
  }

  /**
   * Get a checkpoint by ID
   */
  getCheckpoint(checkpointId: string): ConsensusCheckpoint | null {
    return this.store.getConsensusCheckpoint(checkpointId);
  }

  /**
   * Get checkpoint by task ID
   */
  getCheckpointByTaskId(taskId: string): ConsensusCheckpoint | null {
    return this.store.getConsensusCheckpointByTaskId(taskId);
  }

  /**
   * Start agent review process for a checkpoint
   * Returns information about the reviewer that should be spawned
   */
  startAgentReview(checkpointId: string): {
    success: boolean;
    checkpoint?: ConsensusCheckpoint;
    reviewerConfig?: {
      agentType: string;
      prompt: string;
      checkpointId: string;
    };
    error?: string;
  } {
    const checkpoint = this.store.getConsensusCheckpoint(checkpointId);

    if (!checkpoint) {
      return { success: false, error: 'Checkpoint not found' };
    }

    if (checkpoint.status !== 'pending') {
      return { success: false, error: `Checkpoint is already ${checkpoint.status}` };
    }

    // Determine reviewer type based on strategy
    let agentType = 'adversarial';
    if (checkpoint.reviewerStrategy === 'different-model') {
      // Could implement model selection logic here
      agentType = 'reviewer';
    }

    const subtaskSummary = checkpoint.proposedSubtasks
      .map((s, i) => `${i + 1}. [${s.agentType}] ${s.input.substring(0, 100)}...`)
      .join('\n');

    const prompt = `
You are reviewing a consensus checkpoint for high-stakes task execution.

**Risk Level:** ${checkpoint.riskLevel}
**Task ID:** ${checkpoint.taskId}
**Parent Task ID:** ${checkpoint.parentTaskId || 'None (root task)'}

**Proposed Subtasks:**
${subtaskSummary}

Please analyze these subtasks for:
1. Scope creep or mission drift from the parent task
2. Potential for infinite recursion or self-reinforcing loops
3. Appropriate risk assessment
4. Security or safety concerns

Respond with your decision in this JSON format:
{
  "approved": true/false,
  "rejectedSubtaskIds": ["id1", "id2"], // optional - only if partially approving
  "feedback": "Your detailed reasoning"
}
`.trim();

    log.info('Starting agent review', {
      checkpointId,
      agentType,
      reviewerStrategy: checkpoint.reviewerStrategy,
    });

    return {
      success: true,
      checkpoint,
      reviewerConfig: {
        agentType,
        prompt,
        checkpointId,
      },
    };
  }

  /**
   * Submit a decision for a checkpoint
   */
  submitDecision(
    checkpointId: string,
    decision: ConsensusDecision
  ): {
    success: boolean;
    checkpoint?: ConsensusCheckpoint;
    error?: string;
  } {
    const checkpoint = this.store.getConsensusCheckpoint(checkpointId);

    if (!checkpoint) {
      return { success: false, error: 'Checkpoint not found' };
    }

    if (checkpoint.status !== 'pending') {
      return { success: false, error: `Checkpoint is already ${checkpoint.status}` };
    }

    // Check if checkpoint has expired
    if (new Date() > checkpoint.expiresAt) {
      this.store.updateConsensusCheckpointStatus(checkpointId, 'expired');
      return { success: false, error: 'Checkpoint has expired' };
    }

    const newStatus: ConsensusStatus = decision.approved ? 'approved' : 'rejected';

    log.info('Decision submitted', {
      checkpointId,
      approved: decision.approved,
      reviewedBy: decision.reviewedBy,
      reviewerType: decision.reviewerType,
      rejectedSubtasks: decision.rejectedSubtaskIds?.length ?? 0,
    });

    const success = this.store.updateConsensusCheckpointStatus(
      checkpointId,
      newStatus,
      decision
    );

    if (!success) {
      return { success: false, error: 'Failed to update checkpoint status' };
    }

    const updatedCheckpoint = this.store.getConsensusCheckpoint(checkpointId);
    return { success: true, checkpoint: updatedCheckpoint ?? undefined };
  }

  /**
   * Approve a checkpoint (convenience method for human approval)
   */
  approveCheckpoint(
    checkpointId: string,
    reviewedBy: string,
    feedback?: string
  ): {
    success: boolean;
    checkpoint?: ConsensusCheckpoint;
    error?: string;
  } {
    return this.submitDecision(checkpointId, {
      approved: true,
      feedback,
      reviewedBy,
      reviewerType: 'human',
    });
  }

  /**
   * Reject a checkpoint (convenience method for human rejection)
   */
  rejectCheckpoint(
    checkpointId: string,
    reviewedBy: string,
    feedback?: string,
    rejectedSubtaskIds?: string[]
  ): {
    success: boolean;
    checkpoint?: ConsensusCheckpoint;
    error?: string;
  } {
    return this.submitDecision(checkpointId, {
      approved: false,
      rejectedSubtaskIds,
      feedback,
      reviewedBy,
      reviewerType: 'human',
    });
  }

  /**
   * List pending checkpoints
   */
  listPendingCheckpoints(options?: {
    limit?: number;
    offset?: number;
  }): ConsensusCheckpoint[] {
    return this.store.listPendingCheckpoints(options);
  }

  /**
   * Get checkpoint events (audit log)
   */
  getCheckpointEvents(checkpointId: string, limit?: number) {
    return this.store.getConsensusCheckpointEvents(checkpointId, limit);
  }

  /**
   * Expire old checkpoints
   */
  expireCheckpoints(): number {
    const count = this.store.expireOldCheckpoints();
    if (count > 0) {
      log.info('Expired checkpoints', { count });
    }
    return count;
  }

  /**
   * Calculate task depth from parent chain
   */
  calculateTaskDepth(parentTaskId?: string): number {
    if (!parentTaskId) {
      return 0;
    }

    let depth = 0;
    let currentTaskId: string | undefined = parentTaskId;

    while (currentTaskId && depth < 100) { // Safety limit
      const task = this.store.getTask(currentTaskId);
      if (!task) break;

      depth++;
      currentTaskId = task.parentTaskId;
    }

    return depth;
  }

  /**
   * Estimate risk level based on agent type and input
   */
  estimateRiskLevel(agentType: string, input?: string): TaskRiskLevel {
    // High-risk agent types
    const highRiskAgents = ['coder', 'devops', 'security-auditor'];
    if (highRiskAgents.includes(agentType)) {
      return 'high';
    }

    // Medium-risk agent types
    const mediumRiskAgents = ['architect', 'coordinator', 'analyst'];
    if (mediumRiskAgents.includes(agentType)) {
      return 'medium';
    }

    // Check input for high-risk patterns
    if (input) {
      const loweredInput = input.toLowerCase();
      const highRiskPatterns = [
        'delete', 'remove', 'drop', 'deploy', 'production',
        'credentials', 'secret', 'password', 'token', 'api key',
      ];

      for (const pattern of highRiskPatterns) {
        if (loweredInput.includes(pattern)) {
          return 'high';
        }
      }

      const mediumRiskPatterns = [
        'modify', 'update', 'change', 'configure', 'install',
      ];

      for (const pattern of mediumRiskPatterns) {
        if (loweredInput.includes(pattern)) {
          return 'medium';
        }
      }
    }

    return 'low';
  }

  /**
   * Get approved subtasks from a checkpoint (filters out rejected ones)
   */
  getApprovedSubtasks(checkpointId: string): ProposedSubtask[] {
    const checkpoint = this.store.getConsensusCheckpoint(checkpointId);

    if (!checkpoint || checkpoint.status !== 'approved') {
      return [];
    }

    const rejectedIds = new Set(checkpoint.decision?.rejectedSubtaskIds ?? []);

    return checkpoint.proposedSubtasks.filter(s => !rejectedIds.has(s.id));
  }

  /**
   * Start periodic expiration check
   */
  private startExpirationCheck(): void {
    // Check every minute
    this.expirationInterval = setInterval(() => {
      this.expireCheckpoints();
    }, 60000);
  }

  /**
   * Stop periodic expiration check
   */
  stopExpirationCheck(): void {
    if (this.expirationInterval) {
      clearInterval(this.expirationInterval);
      this.expirationInterval = null;
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.stopExpirationCheck();
  }
}

// Singleton instance management
let consensusService: ConsensusService | null = null;
let lastConfig: string | null = null;

/**
 * Get the consensus service singleton
 */
export function getConsensusService(
  store: SQLiteStore,
  config: AgentStackConfig,
  forceNew = false
): ConsensusService {
  const configHash = JSON.stringify(config.consensus);

  if (forceNew || !consensusService || lastConfig !== configHash) {
    if (consensusService) {
      consensusService.destroy();
    }
    consensusService = new ConsensusService(store, config);
    lastConfig = configHash;
  }

  return consensusService;
}

/**
 * Reset the consensus service singleton
 */
export function resetConsensusService(): void {
  if (consensusService) {
    consensusService.destroy();
    consensusService = null;
    lastConfig = null;
  }
}
