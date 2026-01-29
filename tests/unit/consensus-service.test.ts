/**
 * Consensus Service tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../../src/memory/sqlite-store.js';
import {
  ConsensusService,
  getConsensusService,
  resetConsensusService,
} from '../../src/tasks/consensus-service.js';
import type { AgentStackConfig, TaskRiskLevel } from '../../src/types.js';

// Helper to create test config
function createConfig(options: {
  consensusEnabled?: boolean;
  requireForRiskLevels?: TaskRiskLevel[];
  reviewerStrategy?: 'adversarial' | 'different-model' | 'human';
  timeout?: number;
  maxDepth?: number;
  autoReject?: boolean;
  highRiskAgentTypes?: string[];
  mediumRiskAgentTypes?: string[];
  highRiskPatterns?: string[];
  mediumRiskPatterns?: string[];
}): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: './data/memory.db',
      defaultNamespace: 'default',
      vectorSearch: { enabled: false },
    },
    providers: { default: 'anthropic' },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: false },
    plugins: { enabled: true, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
    consensus: {
      enabled: options.consensusEnabled ?? false,
      requireForRiskLevels: options.requireForRiskLevels ?? ['high', 'medium'],
      reviewerStrategy: options.reviewerStrategy ?? 'adversarial',
      timeout: options.timeout ?? 300000,
      maxDepth: options.maxDepth ?? 5,
      autoReject: options.autoReject ?? false,
      highRiskAgentTypes: options.highRiskAgentTypes,
      mediumRiskAgentTypes: options.mediumRiskAgentTypes,
      highRiskPatterns: options.highRiskPatterns,
      mediumRiskPatterns: options.mediumRiskPatterns,
    },
  };
}

describe('ConsensusService', () => {
  let tmpDir: string;
  let store: SQLiteStore;

  beforeEach(() => {
    resetConsensusService();
    tmpDir = mkdtempSync(join(tmpdir(), 'consensus-test-'));
  });

  afterEach(() => {
    if (store) {
      store.close();
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('isEnabled', () => {
    it('should return false when consensus is disabled', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: false })
      );

      expect(service.isEnabled()).toBe(false);
    });

    it('should return true when consensus is enabled', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('requiresConsensus', () => {
    it('should return false when disabled', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: false })
      );

      const result = service.requiresConsensus('high', 1, 'parent-id');

      expect(result.requiresConsensus).toBe(false);
    });

    it('should return false for low risk when not in requireForRiskLevels', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({
          consensusEnabled: true,
          requireForRiskLevels: ['high', 'medium'],
        })
      );

      const result = service.requiresConsensus('low', 1, 'parent-id');

      expect(result.requiresConsensus).toBe(false);
      expect(result.reason).toContain("'low' does not require consensus");
    });

    it('should return true for high risk with parent', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({
          consensusEnabled: true,
          requireForRiskLevels: ['high', 'medium'],
        })
      );

      const result = service.requiresConsensus('high', 1, 'parent-id');

      expect(result.requiresConsensus).toBe(true);
      expect(result.riskLevel).toBe('high');
      expect(result.depth).toBe(1);
    });

    it('should return true for medium risk with parent', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({
          consensusEnabled: true,
          requireForRiskLevels: ['high', 'medium'],
        })
      );

      const result = service.requiresConsensus('medium', 2, 'parent-id');

      expect(result.requiresConsensus).toBe(true);
    });

    it('should return false for root tasks (no parent)', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({
          consensusEnabled: true,
          requireForRiskLevels: ['high'],
        })
      );

      const result = service.requiresConsensus('high', 0);

      expect(result.requiresConsensus).toBe(false);
      expect(result.reason).toContain('Root tasks do not require consensus');
    });

    it('should return true when depth exceeds maxDepth', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({
          consensusEnabled: true,
          requireForRiskLevels: ['high'],
          maxDepth: 3,
        })
      );

      const result = service.requiresConsensus('high', 4, 'parent-id');

      expect(result.requiresConsensus).toBe(true);
      expect(result.reason).toContain('exceeds maximum allowed depth');
    });
  });

  describe('createCheckpoint', () => {
    it('should create a checkpoint', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true, timeout: 60000 })
      );

      const checkpoint = service.createCheckpoint({
        taskId: 'task-1',
        parentTaskId: 'parent-1',
        proposedSubtasks: [
          {
            id: 'subtask-1',
            agentType: 'coder',
            input: 'Write code',
            estimatedRiskLevel: 'high',
            parentTaskId: 'task-1',
          },
        ],
        riskLevel: 'high',
      });

      expect(checkpoint.id).toBeDefined();
      expect(checkpoint.taskId).toBe('task-1');
      expect(checkpoint.parentTaskId).toBe('parent-1');
      expect(checkpoint.riskLevel).toBe('high');
      expect(checkpoint.status).toBe('pending');
      expect(checkpoint.proposedSubtasks).toHaveLength(1);
      expect(checkpoint.expiresAt.getTime()).toBeGreaterThan(checkpoint.createdAt.getTime());
    });

    it('should store checkpoint in database', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const checkpoint = service.createCheckpoint({
        taskId: 'task-2',
        proposedSubtasks: [],
        riskLevel: 'medium',
      });

      const retrieved = service.getCheckpoint(checkpoint.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.taskId).toBe('task-2');
      expect(retrieved?.riskLevel).toBe('medium');
    });
  });

  describe('getCheckpoint', () => {
    it('should return null for non-existent checkpoint', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const result = service.getCheckpoint('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('approveCheckpoint', () => {
    it('should approve a pending checkpoint', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const checkpoint = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [],
        riskLevel: 'high',
      });

      const result = service.approveCheckpoint(checkpoint.id, 'reviewer-1', 'LGTM');

      expect(result.success).toBe(true);
      expect(result.checkpoint?.status).toBe('approved');
      expect(result.checkpoint?.decidedAt).toBeDefined();
    });

    it('should fail for non-existent checkpoint', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const result = service.approveCheckpoint('non-existent', 'reviewer-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Checkpoint not found');
    });

    it('should fail for already approved checkpoint', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const checkpoint = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [],
        riskLevel: 'high',
      });

      service.approveCheckpoint(checkpoint.id, 'reviewer-1');
      const result = service.approveCheckpoint(checkpoint.id, 'reviewer-2');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Checkpoint is already approved');
    });
  });

  describe('rejectCheckpoint', () => {
    it('should reject a pending checkpoint', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const checkpoint = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [
          {
            id: 'subtask-1',
            agentType: 'coder',
            input: 'Risky operation',
            estimatedRiskLevel: 'high',
            parentTaskId: 'task-1',
          },
        ],
        riskLevel: 'high',
      });

      const result = service.rejectCheckpoint(
        checkpoint.id,
        'reviewer-1',
        'Too risky',
        ['subtask-1']
      );

      expect(result.success).toBe(true);
      expect(result.checkpoint?.status).toBe('rejected');
    });
  });

  describe('listPendingCheckpoints', () => {
    it('should return only pending checkpoints', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      // Create multiple checkpoints
      const cp1 = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [],
        riskLevel: 'high',
      });

      service.createCheckpoint({
        taskId: 'task-2',
        proposedSubtasks: [],
        riskLevel: 'medium',
      });

      // Approve one
      service.approveCheckpoint(cp1.id, 'reviewer-1');

      const pending = service.listPendingCheckpoints();

      expect(pending).toHaveLength(1);
      expect(pending[0].taskId).toBe('task-2');
    });

    it('should respect limit and offset', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      // Create multiple checkpoints
      for (let i = 0; i < 5; i++) {
        service.createCheckpoint({
          taskId: `task-${i}`,
          proposedSubtasks: [],
          riskLevel: 'high',
        });
      }

      const page1 = service.listPendingCheckpoints({ limit: 2, offset: 0 });
      const page2 = service.listPendingCheckpoints({ limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
    });
  });

  describe('expireCheckpoints', () => {
    it('should expire old checkpoints', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({
          consensusEnabled: true,
          timeout: 1, // 1ms timeout
        })
      );

      // Create checkpoint that will expire immediately
      const checkpoint = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [],
        riskLevel: 'high',
      });

      // Wait a bit for expiration
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      return delay(10).then(() => {
        const expired = service.expireCheckpoints();

        expect(expired).toBe(1);

        const retrieved = service.getCheckpoint(checkpoint.id);
        expect(retrieved?.status).toBe('expired');
      });
    });

    it('should not expire non-pending checkpoints', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({
          consensusEnabled: true,
          timeout: 1,
        })
      );

      const checkpoint = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [],
        riskLevel: 'high',
      });

      // Approve before expiration
      service.approveCheckpoint(checkpoint.id, 'reviewer-1');

      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      return delay(10).then(() => {
        const expired = service.expireCheckpoints();

        expect(expired).toBe(0);

        const retrieved = service.getCheckpoint(checkpoint.id);
        expect(retrieved?.status).toBe('approved');
      });
    });
  });

  describe('estimateRiskLevel', () => {
    it('should return high for coder agent type', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const result = service.estimateRiskLevel('coder');

      expect(result).toBe('high');
    });

    it('should return high for devops agent type', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const result = service.estimateRiskLevel('devops');

      expect(result).toBe('high');
    });

    it('should return medium for architect agent type', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const result = service.estimateRiskLevel('architect');

      expect(result).toBe('medium');
    });

    it('should return low for researcher agent type', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const result = service.estimateRiskLevel('researcher');

      expect(result).toBe('low');
    });

    it('should detect high risk from input patterns', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const result = service.estimateRiskLevel('researcher', 'Delete all files in production');

      expect(result).toBe('high');
    });

    it('should detect medium risk from input patterns', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const result = service.estimateRiskLevel('researcher', 'Modify the configuration');

      expect(result).toBe('medium');
    });

    it('should use custom high risk agent types when configured', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({
          consensusEnabled: true,
          highRiskAgentTypes: ['custom-risky-agent'],
          mediumRiskAgentTypes: [],
        })
      );

      expect(service.estimateRiskLevel('custom-risky-agent')).toBe('high');
      expect(service.estimateRiskLevel('coder')).toBe('low'); // Not in custom list
    });

    it('should use custom medium risk agent types when configured', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({
          consensusEnabled: true,
          highRiskAgentTypes: [],
          mediumRiskAgentTypes: ['custom-medium-agent'],
        })
      );

      expect(service.estimateRiskLevel('custom-medium-agent')).toBe('medium');
      expect(service.estimateRiskLevel('architect')).toBe('low'); // Not in custom list
    });

    it('should use custom high risk patterns when configured', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({
          consensusEnabled: true,
          highRiskAgentTypes: [],
          highRiskPatterns: ['dangerous-keyword'],
          mediumRiskPatterns: [],
        })
      );

      expect(service.estimateRiskLevel('researcher', 'This is a dangerous-keyword test')).toBe('high');
      expect(service.estimateRiskLevel('researcher', 'Delete everything')).toBe('low'); // Not in custom list
    });

    it('should use custom medium risk patterns when configured', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({
          consensusEnabled: true,
          highRiskAgentTypes: [],
          highRiskPatterns: [],
          mediumRiskPatterns: ['slightly-risky'],
        })
      );

      expect(service.estimateRiskLevel('researcher', 'This is slightly-risky')).toBe('medium');
      expect(service.estimateRiskLevel('researcher', 'Modify something')).toBe('low'); // Not in custom list
    });
  });

  describe('countPendingCheckpoints', () => {
    it('should return 0 when no checkpoints exist', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      expect(service.countPendingCheckpoints()).toBe(0);
    });

    it('should return correct count of pending checkpoints', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      // Create 3 checkpoints
      service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [{ id: 's1', agentType: 'coder', input: 'Test', estimatedRiskLevel: 'high', parentTaskId: 'task-1' }],
        riskLevel: 'high',
      });
      service.createCheckpoint({
        taskId: 'task-2',
        proposedSubtasks: [{ id: 's2', agentType: 'coder', input: 'Test', estimatedRiskLevel: 'high', parentTaskId: 'task-2' }],
        riskLevel: 'high',
      });
      service.createCheckpoint({
        taskId: 'task-3',
        proposedSubtasks: [{ id: 's3', agentType: 'coder', input: 'Test', estimatedRiskLevel: 'high', parentTaskId: 'task-3' }],
        riskLevel: 'high',
      });

      expect(service.countPendingCheckpoints()).toBe(3);
    });

    it('should not count approved checkpoints', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const checkpoint1 = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [{ id: 's1', agentType: 'coder', input: 'Test', estimatedRiskLevel: 'high', parentTaskId: 'task-1' }],
        riskLevel: 'high',
      });
      service.createCheckpoint({
        taskId: 'task-2',
        proposedSubtasks: [{ id: 's2', agentType: 'coder', input: 'Test', estimatedRiskLevel: 'high', parentTaskId: 'task-2' }],
        riskLevel: 'high',
      });

      // Approve first checkpoint
      service.approveCheckpoint(checkpoint1.id, 'user-1');

      expect(service.countPendingCheckpoints()).toBe(1);
    });
  });

  describe('calculateTaskDepth', () => {
    it('should return 0 for no parent', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const depth = service.calculateTaskDepth();

      expect(depth).toBe(0);
    });

    it('should return correct depth for task chain', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      // Create task chain
      const grandparent = store.createTask('coder', 'Grandparent');
      const parent = store.createTask('coder', 'Parent', undefined, {
        parentTaskId: grandparent.id,
      });
      const child = store.createTask('coder', 'Child', undefined, {
        parentTaskId: parent.id,
      });

      const depth = service.calculateTaskDepth(child.id);

      // If creating a new task with child as parent:
      // grandparent (depth 0) -> parent (depth 1) -> child (depth 2) -> new task (depth 3)
      // So passing child.id returns 3 (the depth of a new task with child as parent)
      expect(depth).toBe(3);
    });
  });

  describe('startAgentReview', () => {
    it('should return reviewer config for pending checkpoint', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const checkpoint = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [
          {
            id: 'subtask-1',
            agentType: 'coder',
            input: 'Write some code',
            estimatedRiskLevel: 'high',
            parentTaskId: 'task-1',
          },
        ],
        riskLevel: 'high',
      });

      const result = service.startAgentReview(checkpoint.id);

      expect(result.success).toBe(true);
      expect(result.reviewerConfig).toBeDefined();
      expect(result.reviewerConfig?.agentType).toBe('adversarial');
      expect(result.reviewerConfig?.prompt).toContain('Risk Level');
      expect(result.reviewerConfig?.checkpointId).toBe(checkpoint.id);
    });

    it('should fail for non-existent checkpoint', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const result = service.startAgentReview('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Checkpoint not found');
    });

    it('should fail for already decided checkpoint', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const checkpoint = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [],
        riskLevel: 'high',
      });

      service.approveCheckpoint(checkpoint.id, 'reviewer-1');

      const result = service.startAgentReview(checkpoint.id);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Checkpoint is already approved');
    });
  });

  describe('getApprovedSubtasks', () => {
    it('should return all subtasks for fully approved checkpoint', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const checkpoint = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [
          {
            id: 'subtask-1',
            agentType: 'coder',
            input: 'Task 1',
            estimatedRiskLevel: 'high',
            parentTaskId: 'task-1',
          },
          {
            id: 'subtask-2',
            agentType: 'tester',
            input: 'Task 2',
            estimatedRiskLevel: 'low',
            parentTaskId: 'task-1',
          },
        ],
        riskLevel: 'high',
      });

      service.approveCheckpoint(checkpoint.id, 'reviewer-1');

      const approved = service.getApprovedSubtasks(checkpoint.id);

      expect(approved).toHaveLength(2);
    });

    it('should filter out rejected subtasks', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const checkpoint = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [
          {
            id: 'subtask-1',
            agentType: 'coder',
            input: 'Task 1',
            estimatedRiskLevel: 'high',
            parentTaskId: 'task-1',
          },
          {
            id: 'subtask-2',
            agentType: 'tester',
            input: 'Task 2',
            estimatedRiskLevel: 'low',
            parentTaskId: 'task-1',
          },
        ],
        riskLevel: 'high',
      });

      // Reject with one subtask rejected
      service.submitDecision(checkpoint.id, {
        approved: true,
        rejectedSubtaskIds: ['subtask-1'],
        reviewedBy: 'reviewer-1',
        reviewerType: 'human',
      });

      const approved = service.getApprovedSubtasks(checkpoint.id);

      expect(approved).toHaveLength(1);
      expect(approved[0].id).toBe('subtask-2');
    });

    it('should return empty for rejected checkpoint', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const checkpoint = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [
          {
            id: 'subtask-1',
            agentType: 'coder',
            input: 'Task 1',
            estimatedRiskLevel: 'high',
            parentTaskId: 'task-1',
          },
        ],
        riskLevel: 'high',
      });

      service.rejectCheckpoint(checkpoint.id, 'reviewer-1', 'Not allowed');

      const approved = service.getApprovedSubtasks(checkpoint.id);

      expect(approved).toHaveLength(0);
    });
  });

  describe('getCheckpointEvents', () => {
    it('should return audit events for a checkpoint', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new ConsensusService(
        store,
        createConfig({ consensusEnabled: true })
      );

      const checkpoint = service.createCheckpoint({
        taskId: 'task-1',
        proposedSubtasks: [],
        riskLevel: 'high',
      });

      service.approveCheckpoint(checkpoint.id, 'reviewer-1', 'LGTM');

      const events = service.getCheckpointEvents(checkpoint.id);

      expect(events.length).toBeGreaterThanOrEqual(2); // created + approved
      expect(events.some(e => e.eventType === 'created')).toBe(true);
      expect(events.some(e => e.eventType === 'approved')).toBe(true);
    });
  });

  describe('getConsensusService (singleton)', () => {
    it('should return the same instance for same config', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const config = createConfig({ consensusEnabled: true });

      const service1 = getConsensusService(store, config);
      const service2 = getConsensusService(store, config);

      expect(service1).toBe(service2);
    });

    it('should create new instance when config changes', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const config1 = createConfig({ consensusEnabled: true, maxDepth: 5 });
      const config2 = createConfig({ consensusEnabled: true, maxDepth: 10 });

      const service1 = getConsensusService(store, config1);
      const service2 = getConsensusService(store, config2);

      expect(service1).not.toBe(service2);
      expect(service1.getConfig().maxDepth).toBe(5);
      expect(service2.getConfig().maxDepth).toBe(10);
    });

    it('should create new instance when forceNew is true', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const config = createConfig({ consensusEnabled: true });

      const service1 = getConsensusService(store, config);
      const service2 = getConsensusService(store, config, true);

      expect(service1).not.toBe(service2);
    });
  });
});
