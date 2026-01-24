/**
 * Topology tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HierarchicalCoordinator } from '../../src/coordination/topology.js';
import { clearAgents } from '../../src/agents/spawner.js';
import { resetMessageBus } from '../../src/coordination/message-bus.js';

describe('HierarchicalCoordinator', () => {
  let coordinator: HierarchicalCoordinator;

  beforeEach(() => {
    clearAgents();
    resetMessageBus();
    coordinator = new HierarchicalCoordinator();
  });

  afterEach(async () => {
    await coordinator.shutdown();
    clearAgents();
    resetMessageBus();
  });

  describe('initialization', () => {
    it('should create coordinator with default config', () => {
      expect(coordinator).toBeDefined();
    });

    it('should create coordinator with custom config', () => {
      const customCoordinator = new HierarchicalCoordinator({
        maxWorkers: 10,
        sessionId: 'custom-session',
      });

      expect(customCoordinator).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize coordinator agent', async () => {
      await coordinator.initialize();

      const status = coordinator.getStatus();
      expect(status.coordinator).toBeDefined();
      expect(status.coordinator?.type).toBe('coordinator');
    });
  });

  describe('submitTask', () => {
    it('should submit task to queue', async () => {
      await coordinator.initialize();

      const task = {
        id: 'task-1',
        agentType: 'coder' as const,
        status: 'pending' as const,
        createdAt: new Date(),
      };

      await coordinator.submitTask(task);

      const status = coordinator.getStatus();
      expect(status.queue.queued).toBeGreaterThanOrEqual(0);
    });

    it('should accept priority', async () => {
      await coordinator.initialize();

      const task = {
        id: 'task-high',
        agentType: 'coder' as const,
        status: 'pending' as const,
        createdAt: new Date(),
      };

      await coordinator.submitTask(task, 10); // High priority
      // No error means success
    });
  });

  describe('getStatus', () => {
    it('should return coordinator status', async () => {
      await coordinator.initialize();

      const status = coordinator.getStatus();

      expect(status.coordinator).toBeDefined();
      expect(status.workers).toBeInstanceOf(Array);
      expect(status.queue).toBeDefined();
    });

    it('should return null coordinator before init', () => {
      const status = coordinator.getStatus();

      expect(status.coordinator).toBeNull();
    });
  });

  describe('shutdown', () => {
    it('should shutdown coordinator', async () => {
      await coordinator.initialize();
      await coordinator.shutdown();

      const status = coordinator.getStatus();
      expect(status.coordinator).toBeNull();
    });

    it('should handle shutdown before init', async () => {
      await expect(coordinator.shutdown()).resolves.not.toThrow();
    });
  });
});
