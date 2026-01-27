/**
 * Resource Exhaustion Service tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../../src/memory/sqlite-store.js';
import {
  ResourceExhaustionService,
  getResourceExhaustionService,
  resetResourceExhaustionService,
} from '../../src/monitoring/resource-exhaustion-service.js';
import type { ResourceExhaustionConfig } from '../../src/types.js';

// Helper to create test config
function createConfig(options: {
  enabled?: boolean;
  maxFilesAccessed?: number;
  maxApiCalls?: number;
  maxSubtasksSpawned?: number;
  maxTimeWithoutDeliverableMs?: number;
  maxTokensConsumed?: number;
  warningThresholdPercent?: number;
  checkIntervalMs?: number;
  autoTerminate?: boolean;
  pauseOnIntervention?: boolean;
}): ResourceExhaustionConfig {
  return {
    enabled: options.enabled ?? true,
    thresholds: {
      maxFilesAccessed: options.maxFilesAccessed ?? 50,
      maxApiCalls: options.maxApiCalls ?? 100,
      maxSubtasksSpawned: options.maxSubtasksSpawned ?? 20,
      maxTimeWithoutDeliverableMs: options.maxTimeWithoutDeliverableMs ?? 1800000,
      maxTokensConsumed: options.maxTokensConsumed ?? 500000,
    },
    warningThresholdPercent: options.warningThresholdPercent ?? 0.7,
    checkIntervalMs: options.checkIntervalMs ?? 10000,
    autoTerminate: options.autoTerminate ?? false,
    requireConfirmationOnIntervention: true,
    pauseOnIntervention: options.pauseOnIntervention ?? true,
  };
}

describe('ResourceExhaustionService', () => {
  let tmpDir: string;
  let store: SQLiteStore;

  beforeEach(() => {
    resetResourceExhaustionService();
    tmpDir = mkdtempSync(join(tmpdir(), 'resource-test-'));
    store = new SQLiteStore(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    if (store) {
      store.close();
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('isEnabled', () => {
    it('should return false when disabled', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ enabled: false })
      );
      expect(service.isEnabled()).toBe(false);
    });

    it('should return true when enabled', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ enabled: true })
      );
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('initializeAgent', () => {
    it('should create metrics for a new agent', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));

      const metrics = service.initializeAgent('agent-1', 'coder');

      expect(metrics.agentId).toBe('agent-1');
      expect(metrics.filesRead).toBe(0);
      expect(metrics.filesWritten).toBe(0);
      expect(metrics.apiCallsCount).toBe(0);
      expect(metrics.phase).toBe('normal');
      expect(metrics.pausedAt).toBeNull();
    });

    it('should persist metrics to database', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));

      service.initializeAgent('agent-1', 'coder');

      const dbMetrics = store.getAgentResourceMetrics('agent-1');
      expect(dbMetrics).not.toBeNull();
      expect(dbMetrics?.agentId).toBe('agent-1');
    });
  });

  describe('recordFileOperation', () => {
    it('should increment file read count', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      service.recordFileOperation('agent-1', 'read');
      service.recordFileOperation('agent-1', 'read');

      const metrics = service.getAgentMetrics('agent-1');
      expect(metrics?.filesRead).toBe(2);
    });

    it('should increment file write count', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      service.recordFileOperation('agent-1', 'write');

      const metrics = service.getAgentMetrics('agent-1');
      expect(metrics?.filesWritten).toBe(1);
    });

    it('should increment file modify count', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      service.recordFileOperation('agent-1', 'modify');

      const metrics = service.getAgentMetrics('agent-1');
      expect(metrics?.filesModified).toBe(1);
    });

    it('should not track operations when disabled', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ enabled: false })
      );
      // When disabled, initializeAgent still creates the entry but operations won't update it
      service.initializeAgent('agent-1', 'coder');

      // Record operations - these should be no-ops since service is disabled
      service.recordFileOperation('agent-1', 'read');
      service.recordFileOperation('agent-1', 'read');
      service.recordFileOperation('agent-1', 'read');

      // Metrics should still be at initial values (0) since operations weren't tracked
      const metrics = service.getAgentMetrics('agent-1');
      expect(metrics?.filesRead).toBe(0);
    });
  });

  describe('recordApiCall', () => {
    it('should increment API call count', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      service.recordApiCall('agent-1');
      service.recordApiCall('agent-1');
      service.recordApiCall('agent-1');

      const metrics = service.getAgentMetrics('agent-1');
      expect(metrics?.apiCallsCount).toBe(3);
    });

    it('should track token consumption', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      service.recordApiCall('agent-1', 1000);
      service.recordApiCall('agent-1', 2000);

      const metrics = service.getAgentMetrics('agent-1');
      expect(metrics?.tokensConsumed).toBe(3000);
    });
  });

  describe('recordSubtaskSpawn', () => {
    it('should increment subtask count', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      service.recordSubtaskSpawn('agent-1');
      service.recordSubtaskSpawn('agent-1');

      const metrics = service.getAgentMetrics('agent-1');
      expect(metrics?.subtasksSpawned).toBe(2);
    });
  });

  describe('recordDeliverable', () => {
    it('should create a checkpoint', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      const checkpoint = service.recordDeliverable(
        'agent-1',
        'task_completed',
        'Completed feature X'
      );

      expect(checkpoint.agentId).toBe('agent-1');
      expect(checkpoint.type).toBe('task_completed');
      expect(checkpoint.description).toBe('Completed feature X');
    });

    it('should update lastDeliverableAt in metrics', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      const beforeDeliverable = service.getAgentMetrics('agent-1')?.lastDeliverableAt;
      expect(beforeDeliverable).toBeNull();

      service.recordDeliverable('agent-1', 'code_committed');

      const afterDeliverable = service.getAgentMetrics('agent-1')?.lastDeliverableAt;
      expect(afterDeliverable).not.toBeNull();
    });

    it('should reset phase from warning to normal', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ maxApiCalls: 10, warningThresholdPercent: 0.5 })
      );
      service.initializeAgent('agent-1', 'coder');

      // Trigger warning by making 6 API calls (60% of 10)
      for (let i = 0; i < 6; i++) {
        service.recordApiCall('agent-1');
      }
      service.evaluateAgent('agent-1');

      expect(service.getAgentMetrics('agent-1')?.phase).toBe('warning');

      // Record deliverable should reset to normal
      service.recordDeliverable('agent-1', 'task_completed');

      expect(service.getAgentMetrics('agent-1')?.phase).toBe('normal');
    });
  });

  describe('evaluateAgent', () => {
    it('should return normal when disabled', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ enabled: false })
      );

      const phase = service.evaluateAgent('agent-1');

      expect(phase).toBe('normal');
    });

    it('should return normal for non-existent agent', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));

      const phase = service.evaluateAgent('non-existent');

      expect(phase).toBe('normal');
    });

    it('should return normal when under thresholds', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      const phase = service.evaluateAgent('agent-1');

      expect(phase).toBe('normal');
    });

    it('should return warning when approaching threshold', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ maxApiCalls: 10, warningThresholdPercent: 0.7 })
      );
      service.initializeAgent('agent-1', 'coder');

      // Make 8 API calls (80% of 10, above 70% warning)
      for (let i = 0; i < 8; i++) {
        service.recordApiCall('agent-1');
      }

      const phase = service.evaluateAgent('agent-1');

      expect(phase).toBe('warning');
    });

    it('should return intervention when threshold exceeded', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ maxApiCalls: 5, pauseOnIntervention: false })
      );
      service.initializeAgent('agent-1', 'coder');

      // Make 6 API calls (exceeds max of 5)
      for (let i = 0; i < 6; i++) {
        service.recordApiCall('agent-1');
      }

      const phase = service.evaluateAgent('agent-1');

      expect(phase).toBe('intervention');
    });

    it('should auto-pause when pauseOnIntervention is true', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ maxApiCalls: 5, pauseOnIntervention: true })
      );
      service.initializeAgent('agent-1', 'coder');

      // Exceed threshold
      for (let i = 0; i < 6; i++) {
        service.recordApiCall('agent-1');
      }

      service.evaluateAgent('agent-1');

      expect(service.isAgentPaused('agent-1')).toBe(true);
    });

    it('should detect file access threshold', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ maxFilesAccessed: 10, warningThresholdPercent: 0.5 })
      );
      service.initializeAgent('agent-1', 'coder');

      // Access 6 files (read + write = 60% of 10)
      for (let i = 0; i < 3; i++) {
        service.recordFileOperation('agent-1', 'read');
        service.recordFileOperation('agent-1', 'write');
      }

      const phase = service.evaluateAgent('agent-1');

      expect(phase).toBe('warning');
    });

    it('should detect subtask spawn threshold', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ maxSubtasksSpawned: 5, pauseOnIntervention: false })
      );
      service.initializeAgent('agent-1', 'coder');

      // Spawn 6 subtasks (exceeds max of 5)
      for (let i = 0; i < 6; i++) {
        service.recordSubtaskSpawn('agent-1');
      }

      const phase = service.evaluateAgent('agent-1');

      expect(phase).toBe('intervention');
    });

    it('should detect token consumption threshold', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ maxTokensConsumed: 1000, warningThresholdPercent: 0.7 })
      );
      service.initializeAgent('agent-1', 'coder');

      // Consume 800 tokens (80% of 1000, above warning)
      service.recordApiCall('agent-1', 800);

      const phase = service.evaluateAgent('agent-1');

      expect(phase).toBe('warning');
    });
  });

  describe('pauseAgent and resumeAgent', () => {
    it('should pause an agent', async () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      const success = await service.pauseAgent('agent-1', 'Test pause');

      expect(success).toBe(true);
      expect(service.isAgentPaused('agent-1')).toBe(true);

      const metrics = service.getAgentMetrics('agent-1');
      expect(metrics?.pauseReason).toBe('Test pause');
      expect(metrics?.pausedAt).not.toBeNull();
    });

    it('should resume a paused agent', async () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      await service.pauseAgent('agent-1', 'Test pause');
      const success = service.resumeAgent('agent-1');

      expect(success).toBe(true);
      expect(service.isAgentPaused('agent-1')).toBe(false);

      const metrics = service.getAgentMetrics('agent-1');
      expect(metrics?.pauseReason).toBeNull();
      expect(metrics?.pausedAt).toBeNull();
    });

    it('should return false when pausing non-existent agent', async () => {
      const service = new ResourceExhaustionService(store, createConfig({}));

      const success = await service.pauseAgent('non-existent', 'Test');

      expect(success).toBe(false);
    });

    it('should return false when resuming non-paused agent', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      const success = service.resumeAgent('agent-1');

      expect(success).toBe(false);
    });

    it('should reset phase to warning when resuming from intervention', async () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ maxApiCalls: 5, pauseOnIntervention: true })
      );
      service.initializeAgent('agent-1', 'coder');

      // Trigger intervention
      for (let i = 0; i < 6; i++) {
        service.recordApiCall('agent-1');
      }
      service.evaluateAgent('agent-1');

      // Should be paused at intervention
      expect(service.getAgentMetrics('agent-1')?.phase).toBe('intervention');
      expect(service.isAgentPaused('agent-1')).toBe(true);

      // Resume
      service.resumeAgent('agent-1');

      // Phase should reset to warning
      expect(service.getAgentMetrics('agent-1')?.phase).toBe('warning');
    });

    it('should resolve waitForResume callback when paused', async () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      // Start waiting for resume (this creates a pending promise)
      const waitPromise = service.waitForResume('agent-1');

      // Pause the agent - this should resolve the wait with false
      await service.pauseAgent('agent-1', 'Test');

      const result = await waitPromise;
      expect(result).toBe(false);
    });
  });

  describe('terminateAgent', () => {
    it('should terminate an agent', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      const success = service.terminateAgent('agent-1', 'Test termination');

      expect(success).toBe(true);

      const metrics = service.getAgentMetrics('agent-1');
      expect(metrics?.phase).toBe('termination');
    });

    it('should log termination event to database', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      service.terminateAgent('agent-1', 'Resource limits severely exceeded');

      const events = store.getResourceExhaustionEvents({ agentId: 'agent-1' });

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].phase).toBe('termination');
      expect(events[0].actionTaken).toBe('terminated');
    });

    it('should return false when terminating non-existent agent', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));

      const success = service.terminateAgent('non-existent', 'Test');

      expect(success).toBe(false);
    });

    it('should increment termination counter', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      service.terminateAgent('agent-1', 'Test termination');

      const summary = service.getResourceMetrics();
      expect(summary.totalTerminations).toBe(1);
    });
  });

  describe('cleanupAgent', () => {
    it('should remove agent from tracking', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      service.cleanupAgent('agent-1');

      expect(service.getAgentMetrics('agent-1')).toBeNull();
    });

    it('should remove metrics from database', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      service.cleanupAgent('agent-1');

      const dbMetrics = store.getAgentResourceMetrics('agent-1');
      expect(dbMetrics).toBeNull();
    });

    it('should remove deliverable checkpoints', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');
      service.recordDeliverable('agent-1', 'task_completed');

      service.cleanupAgent('agent-1');

      const checkpoints = store.getDeliverableCheckpoints('agent-1');
      expect(checkpoints).toHaveLength(0);
    });
  });

  describe('getResourceMetrics', () => {
    it('should return summary metrics', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');
      service.initializeAgent('agent-2', 'tester');

      const summary = service.getResourceMetrics();

      expect(summary.totalAgentsTracked).toBe(2);
      expect(summary.agentsByPhase.normal).toBe(2);
      expect(summary.pausedAgents).toBe(0);
    });

    it('should track paused agents', async () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');
      service.initializeAgent('agent-2', 'tester');

      await service.pauseAgent('agent-1', 'Test');

      const summary = service.getResourceMetrics();

      expect(summary.pausedAgents).toBe(1);
    });

    it('should filter by date', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ maxApiCalls: 5, pauseOnIntervention: false })
      );
      service.initializeAgent('agent-1', 'coder');

      // Trigger an event
      for (let i = 0; i < 6; i++) {
        service.recordApiCall('agent-1');
      }
      service.evaluateAgent('agent-1');

      // Get metrics from the future (should show 0 events)
      const futureDate = new Date(Date.now() + 10000000);
      const summary = service.getResourceMetrics(futureDate);

      expect(summary.totalInterventions).toBe(0);
    });
  });

  describe('checkAllAgents', () => {
    it('should evaluate all tracked agents', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ maxApiCalls: 10, warningThresholdPercent: 0.5 })
      );

      service.initializeAgent('agent-1', 'coder');
      service.initializeAgent('agent-2', 'tester');

      // Put agent-1 in warning state
      for (let i = 0; i < 6; i++) {
        service.recordApiCall('agent-1');
      }

      service.checkAllAgents();

      expect(service.getAgentMetrics('agent-1')?.phase).toBe('warning');
      expect(service.getAgentMetrics('agent-2')?.phase).toBe('normal');
    });

    it('should do nothing when disabled', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ enabled: false })
      );

      // Should not throw
      service.checkAllAgents();
    });
  });

  describe('time-based threshold', () => {
    it('should detect time without deliverable threshold', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({
          maxTimeWithoutDeliverableMs: 100, // Very short for testing
          warningThresholdPercent: 0.5,
          pauseOnIntervention: false,
        })
      );
      service.initializeAgent('agent-1', 'coder');

      // Wait for threshold to be exceeded
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const phase = service.evaluateAgent('agent-1');
          expect(phase).toBe('intervention');
          resolve();
        }, 150);
      });
    });

    it('should reset time tracking after deliverable', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({
          maxTimeWithoutDeliverableMs: 100,
          warningThresholdPercent: 0.5,
        })
      );
      service.initializeAgent('agent-1', 'coder');

      // Record a deliverable to reset timer
      service.recordDeliverable('agent-1', 'task_completed');

      // Immediately evaluate - should be normal since we just delivered
      const phase = service.evaluateAgent('agent-1');
      expect(phase).toBe('normal');
    });
  });

  describe('multiple threshold breaches', () => {
    it('should prioritize intervention over warning', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({
          maxApiCalls: 10,
          maxFilesAccessed: 5,
          warningThresholdPercent: 0.7,
          pauseOnIntervention: false,
        })
      );
      service.initializeAgent('agent-1', 'coder');

      // Trigger warning for API calls (8/10 = 80%)
      for (let i = 0; i < 8; i++) {
        service.recordApiCall('agent-1');
      }

      // Trigger intervention for files (6/5 = 120%)
      for (let i = 0; i < 6; i++) {
        service.recordFileOperation('agent-1', 'read');
      }

      const phase = service.evaluateAgent('agent-1');
      expect(phase).toBe('intervention');
    });

    it('should not upgrade when already at intervention', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({
          maxApiCalls: 5,
          maxFilesAccessed: 5,
          pauseOnIntervention: false,
        })
      );
      service.initializeAgent('agent-1', 'coder');

      // Trigger intervention for API calls
      for (let i = 0; i < 6; i++) {
        service.recordApiCall('agent-1');
      }

      // Also exceed file threshold
      for (let i = 0; i < 6; i++) {
        service.recordFileOperation('agent-1', 'read');
      }

      // Evaluate - should stay at intervention (not try to upgrade again)
      const phase = service.evaluateAgent('agent-1');
      expect(phase).toBe('intervention');
    });
  });

  describe('edge cases', () => {
    it('should handle missing agent type gracefully', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');

      // Manually clear the agent type to simulate edge case
      // @ts-expect-error - accessing private property for testing
      service.agentTypes.delete('agent-1');

      // Terminate should still work with 'unknown' type
      const success = service.terminateAgent('agent-1', 'Test');
      expect(success).toBe(true);

      // Event should be logged with 'unknown' type
      const events = store.getResourceExhaustionEvents({ agentId: 'agent-1' });
      expect(events[0].agentType).toBe('unknown');
    });

    it('should handle phase transition for non-existent agent', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ maxApiCalls: 5, pauseOnIntervention: false })
      );

      // Initialize and then clear the cache to simulate edge case
      service.initializeAgent('agent-1', 'coder');
      // @ts-expect-error - accessing private property for testing
      service.metricsCache.delete('agent-1');

      // Recording should handle missing metrics gracefully
      service.recordApiCall('agent-1');

      // No crash expected
      expect(true).toBe(true);
    });
  });

  describe('database persistence', () => {
    it('should persist events to database', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ maxApiCalls: 5, pauseOnIntervention: false })
      );
      service.initializeAgent('agent-1', 'coder');

      // Trigger intervention
      for (let i = 0; i < 6; i++) {
        service.recordApiCall('agent-1');
      }
      service.evaluateAgent('agent-1');

      const events = store.getResourceExhaustionEvents({ agentId: 'agent-1' });

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].phase).toBe('intervention');
      expect(events[0].triggeredBy).toBe('maxApiCalls');
    });

    it('should load metrics from database on startup', () => {
      // First service creates and persists metrics
      const service1 = new ResourceExhaustionService(store, createConfig({}));
      service1.initializeAgent('agent-1', 'coder');
      service1.recordApiCall('agent-1', 1000);

      // Create a new service (simulating restart)
      const service2 = new ResourceExhaustionService(store, createConfig({}));

      // Should load existing metrics
      const metrics = service2.getAgentMetrics('agent-1');
      expect(metrics?.apiCallsCount).toBe(1);
      expect(metrics?.tokensConsumed).toBe(1000);
    });

    it('should load metrics from database when not in cache', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));
      service.initializeAgent('agent-1', 'coder');
      service.recordApiCall('agent-1', 500);

      // Manually clear the in-memory cache to simulate cache miss
      // @ts-expect-error - accessing private property for testing
      service.metricsCache.clear();

      // Now record should load from DB first
      service.recordApiCall('agent-1', 500);

      const metrics = service.getAgentMetrics('agent-1');
      expect(metrics?.apiCallsCount).toBe(2);
      expect(metrics?.tokensConsumed).toBe(1000);
    });

    it('should handle getOrCreateMetrics for non-existent agent', () => {
      const service = new ResourceExhaustionService(store, createConfig({}));

      // Try to record for non-existent agent - should not throw
      service.recordApiCall('non-existent');

      // Metrics should be null since agent was never initialized
      const metrics = service.getAgentMetrics('non-existent');
      expect(metrics).toBeNull();
    });
  });

  describe('getRecentEvents', () => {
    it('should return recent events', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ maxApiCalls: 5, pauseOnIntervention: false })
      );

      service.initializeAgent('agent-1', 'coder');

      // Trigger multiple events
      for (let i = 0; i < 6; i++) {
        service.recordApiCall('agent-1');
      }
      service.evaluateAgent('agent-1');

      const events = service.getRecentEvents(10);

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('getConfig', () => {
    it('should return current configuration', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({
          enabled: true,
          maxApiCalls: 200,
          warningThresholdPercent: 0.8,
        })
      );

      const config = service.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.thresholds.maxApiCalls).toBe(200);
      expect(config.warningThresholdPercent).toBe(0.8);
    });
  });

  describe('getResourceExhaustionService (singleton)', () => {
    it('should return the same instance for same config', () => {
      const config = createConfig({ enabled: true });

      const service1 = getResourceExhaustionService(store, config);
      const service2 = getResourceExhaustionService(store, config);

      expect(service1).toBe(service2);
    });

    it('should create new instance when config changes', () => {
      const config1 = createConfig({ enabled: true, maxApiCalls: 100 });
      const config2 = createConfig({ enabled: true, maxApiCalls: 200 });

      const service1 = getResourceExhaustionService(store, config1);
      const service2 = getResourceExhaustionService(store, config2);

      expect(service1).not.toBe(service2);
      expect(service1.getConfig().thresholds.maxApiCalls).toBe(100);
      expect(service2.getConfig().thresholds.maxApiCalls).toBe(200);
    });

    it('should create new instance when forceNew is true', () => {
      const config = createConfig({ enabled: true });

      const service1 = getResourceExhaustionService(store, config);
      const service2 = getResourceExhaustionService(store, config, true);

      expect(service1).not.toBe(service2);
    });

    it('should detect enabled flag change', () => {
      const config1 = createConfig({ enabled: false });
      const config2 = createConfig({ enabled: true });

      const service1 = getResourceExhaustionService(store, config1);
      const service2 = getResourceExhaustionService(store, config2);

      expect(service1).not.toBe(service2);
      expect(service1.isEnabled()).toBe(false);
      expect(service2.isEnabled()).toBe(true);
    });
  });

  describe('start and stop', () => {
    it('should start background monitoring when enabled', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ enabled: true, checkIntervalMs: 1000 })
      );

      service.start();

      // Service should be running (we can't easily test the interval itself)
      expect(service.isEnabled()).toBe(true);

      service.stop();
    });

    it('should not start when disabled', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ enabled: false })
      );

      service.start();

      // Should not throw, just do nothing
      expect(service.isEnabled()).toBe(false);

      service.stop();
    });

    it('should not start twice', () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({ enabled: true, checkIntervalMs: 1000 })
      );

      service.start();
      service.start(); // Second start should be no-op

      expect(service.isEnabled()).toBe(true);

      service.stop();
    });

    it('should execute checkAllAgents on interval', async () => {
      const service = new ResourceExhaustionService(
        store,
        createConfig({
          enabled: true,
          checkIntervalMs: 50, // Very short for testing
          maxApiCalls: 10,
          warningThresholdPercent: 0.5,
        })
      );

      service.initializeAgent('agent-1', 'coder');

      // Put agent near warning threshold
      for (let i = 0; i < 6; i++) {
        service.recordApiCall('agent-1');
      }

      service.start();

      // Wait for interval to fire
      await new Promise(resolve => setTimeout(resolve, 100));

      service.stop();

      // The interval should have evaluated the agent
      expect(service.getAgentMetrics('agent-1')?.phase).toBe('warning');
    });
  });
});

describe('SQLiteStore Resource Exhaustion Operations', () => {
  let tmpDir: string;
  let store: SQLiteStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'resource-store-test-'));
    store = new SQLiteStore(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    if (store) {
      store.close();
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('saveAgentResourceMetrics', () => {
    it('should save new metrics', () => {
      const now = new Date();
      store.saveAgentResourceMetrics({
        agentId: 'agent-1',
        filesRead: 5,
        filesWritten: 3,
        filesModified: 2,
        apiCallsCount: 10,
        subtasksSpawned: 2,
        tokensConsumed: 5000,
        startedAt: now,
        lastDeliverableAt: null,
        lastActivityAt: now,
        phase: 'normal',
        pausedAt: null,
        pauseReason: null,
      });

      const metrics = store.getAgentResourceMetrics('agent-1');
      expect(metrics).not.toBeNull();
      expect(metrics?.filesRead).toBe(5);
      expect(metrics?.apiCallsCount).toBe(10);
    });

    it('should update existing metrics', () => {
      const now = new Date();
      store.saveAgentResourceMetrics({
        agentId: 'agent-1',
        filesRead: 5,
        filesWritten: 3,
        filesModified: 2,
        apiCallsCount: 10,
        subtasksSpawned: 2,
        tokensConsumed: 5000,
        startedAt: now,
        lastDeliverableAt: null,
        lastActivityAt: now,
        phase: 'normal',
        pausedAt: null,
        pauseReason: null,
      });

      store.saveAgentResourceMetrics({
        agentId: 'agent-1',
        filesRead: 10,
        filesWritten: 6,
        filesModified: 4,
        apiCallsCount: 20,
        subtasksSpawned: 4,
        tokensConsumed: 10000,
        startedAt: now,
        lastDeliverableAt: now,
        lastActivityAt: now,
        phase: 'warning',
        pausedAt: null,
        pauseReason: null,
      });

      const metrics = store.getAgentResourceMetrics('agent-1');
      expect(metrics?.filesRead).toBe(10);
      expect(metrics?.apiCallsCount).toBe(20);
      expect(metrics?.phase).toBe('warning');
    });
  });

  describe('listAgentResourceMetrics', () => {
    it('should list all metrics', () => {
      const now = new Date();
      const baseMetrics = {
        filesRead: 0,
        filesWritten: 0,
        filesModified: 0,
        apiCallsCount: 0,
        subtasksSpawned: 0,
        tokensConsumed: 0,
        startedAt: now,
        lastDeliverableAt: null,
        lastActivityAt: now,
        phase: 'normal' as const,
        pausedAt: null,
        pauseReason: null,
      };

      store.saveAgentResourceMetrics({ agentId: 'agent-1', ...baseMetrics });
      store.saveAgentResourceMetrics({ agentId: 'agent-2', ...baseMetrics });

      const metrics = store.listAgentResourceMetrics();
      expect(metrics).toHaveLength(2);
    });

    it('should filter by phase', () => {
      const now = new Date();
      const baseMetrics = {
        filesRead: 0,
        filesWritten: 0,
        filesModified: 0,
        apiCallsCount: 0,
        subtasksSpawned: 0,
        tokensConsumed: 0,
        startedAt: now,
        lastDeliverableAt: null,
        lastActivityAt: now,
        pausedAt: null,
        pauseReason: null,
      };

      store.saveAgentResourceMetrics({ agentId: 'agent-1', ...baseMetrics, phase: 'normal' });
      store.saveAgentResourceMetrics({ agentId: 'agent-2', ...baseMetrics, phase: 'warning' });

      const warningMetrics = store.listAgentResourceMetrics('warning');
      expect(warningMetrics).toHaveLength(1);
      expect(warningMetrics[0].agentId).toBe('agent-2');
    });
  });

  describe('createDeliverableCheckpoint', () => {
    it('should create a checkpoint', () => {
      const checkpoint = store.createDeliverableCheckpoint({
        id: 'checkpoint-1',
        agentId: 'agent-1',
        type: 'task_completed',
        description: 'Test description',
        artifacts: ['file1.ts', 'file2.ts'],
      });

      expect(checkpoint.id).toBe('checkpoint-1');
      expect(checkpoint.agentId).toBe('agent-1');
      expect(checkpoint.type).toBe('task_completed');
      expect(checkpoint.artifacts).toEqual(['file1.ts', 'file2.ts']);
    });
  });

  describe('getDeliverableCheckpoints', () => {
    it('should return checkpoints for an agent', () => {
      store.createDeliverableCheckpoint({
        id: 'checkpoint-1',
        agentId: 'agent-1',
        type: 'task_completed',
      });
      store.createDeliverableCheckpoint({
        id: 'checkpoint-2',
        agentId: 'agent-1',
        type: 'code_committed',
      });
      store.createDeliverableCheckpoint({
        id: 'checkpoint-3',
        agentId: 'agent-2',
        type: 'task_completed',
      });

      const checkpoints = store.getDeliverableCheckpoints('agent-1');

      expect(checkpoints).toHaveLength(2);
    });
  });

  describe('getLastDeliverableCheckpoint', () => {
    it('should return most recent checkpoint', async () => {
      store.createDeliverableCheckpoint({
        id: 'checkpoint-1',
        agentId: 'agent-1',
        type: 'task_completed',
      });

      // Delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      store.createDeliverableCheckpoint({
        id: 'checkpoint-2',
        agentId: 'agent-1',
        type: 'code_committed',
      });

      const checkpoint = store.getLastDeliverableCheckpoint('agent-1');

      expect(checkpoint?.id).toBe('checkpoint-2');
    });

    it('should return null when no checkpoints exist', () => {
      const checkpoint = store.getLastDeliverableCheckpoint('non-existent');
      expect(checkpoint).toBeNull();
    });
  });

  describe('getResourceExhaustionMetrics', () => {
    it('should return summary metrics', () => {
      const now = new Date();

      store.saveResourceExhaustionEvent({
        id: 'event-1',
        agentId: 'agent-1',
        agentType: 'coder',
        phase: 'warning',
        actionTaken: 'warned',
        metrics: {
          agentId: 'agent-1',
          filesRead: 0,
          filesWritten: 0,
          filesModified: 0,
          apiCallsCount: 75,
          subtasksSpawned: 0,
          tokensConsumed: 0,
          startedAt: now,
          lastDeliverableAt: null,
          lastActivityAt: now,
          phase: 'warning',
          pausedAt: null,
          pauseReason: null,
        },
        thresholds: {
          maxFilesAccessed: 50,
          maxApiCalls: 100,
          maxSubtasksSpawned: 20,
          maxTimeWithoutDeliverableMs: 1800000,
          maxTokensConsumed: 500000,
        },
        triggeredBy: 'maxApiCalls',
        createdAt: now,
      });

      store.saveResourceExhaustionEvent({
        id: 'event-2',
        agentId: 'agent-1',
        agentType: 'coder',
        phase: 'intervention',
        actionTaken: 'paused',
        metrics: {
          agentId: 'agent-1',
          filesRead: 0,
          filesWritten: 0,
          filesModified: 0,
          apiCallsCount: 105,
          subtasksSpawned: 0,
          tokensConsumed: 0,
          startedAt: now,
          lastDeliverableAt: null,
          lastActivityAt: now,
          phase: 'intervention',
          pausedAt: now,
          pauseReason: 'API calls exceeded',
        },
        thresholds: {
          maxFilesAccessed: 50,
          maxApiCalls: 100,
          maxSubtasksSpawned: 20,
          maxTimeWithoutDeliverableMs: 1800000,
          maxTokensConsumed: 500000,
        },
        triggeredBy: 'maxApiCalls',
        createdAt: now,
      });

      const metrics = store.getResourceExhaustionMetrics();

      expect(metrics.totalEvents).toBe(2);
      expect(metrics.warningCount).toBe(1);
      expect(metrics.interventionCount).toBe(1);
      expect(metrics.byAgent['agent-1']).toBe(2);
    });
  });
});
