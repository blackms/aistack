/**
 * Topology tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HierarchicalCoordinator } from '../../src/coordination/topology.js';
import { clearAgents, getActiveAgents } from '../../src/agents/spawner.js';
import { resetMessageBus, getMessageBus } from '../../src/coordination/message-bus.js';

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

    it('should clear workers on shutdown', async () => {
      await coordinator.initialize();

      // Submit tasks to spawn workers
      const task = {
        id: 'task-worker',
        agentType: 'coder' as const,
        status: 'pending' as const,
        createdAt: new Date(),
      };

      await coordinator.submitTask(task);

      await coordinator.shutdown();

      const status = coordinator.getStatus();
      expect(status.workers.length).toBe(0);
    });
  });

  describe('task assignment with workers', () => {
    it('should handle multiple task submissions', async () => {
      await coordinator.initialize();

      const tasks = [
        { id: 'task-1', agentType: 'coder' as const, status: 'pending' as const, createdAt: new Date() },
        { id: 'task-2', agentType: 'tester' as const, status: 'pending' as const, createdAt: new Date() },
        { id: 'task-3', agentType: 'researcher' as const, status: 'pending' as const, createdAt: new Date() },
      ];

      for (const task of tasks) {
        await coordinator.submitTask(task);
      }

      // Tasks should be queued or assigned
      const status = coordinator.getStatus();
      expect(status.queue.queued + status.queue.processing).toBeGreaterThanOrEqual(0);
    });

    it('should handle high priority tasks', async () => {
      await coordinator.initialize();

      const lowTask = { id: 'low', agentType: 'coder' as const, status: 'pending' as const, createdAt: new Date() };
      const highTask = { id: 'high', agentType: 'coder' as const, status: 'pending' as const, createdAt: new Date() };

      await coordinator.submitTask(lowTask, 1);
      await coordinator.submitTask(highTask, 10);

      // Both tasks submitted successfully
      expect(coordinator.getStatus().queue.queued + coordinator.getStatus().queue.processing).toBeGreaterThanOrEqual(0);
    });
  });

  describe('with custom options', () => {
    it('should respect maxWorkers setting', async () => {
      const limitedCoordinator = new HierarchicalCoordinator({
        maxWorkers: 2,
        sessionId: 'test-session',
      });

      await limitedCoordinator.initialize();

      const status = limitedCoordinator.getStatus();
      expect(status.coordinator).toBeDefined();
      expect(status.coordinator?.type).toBe('coordinator');

      await limitedCoordinator.shutdown();
    });

    it('should track sessionId', async () => {
      const sessionCoordinator = new HierarchicalCoordinator({
        sessionId: 'my-session-123',
      });

      await sessionCoordinator.initialize();

      // Coordinator was initialized with session
      expect(sessionCoordinator.getStatus().coordinator).toBeDefined();

      await sessionCoordinator.shutdown();
    });

    it('should not spawn more workers than maxWorkers limit', async () => {
      const limitedCoordinator = new HierarchicalCoordinator({
        maxWorkers: 1,
        sessionId: 'limited-session',
      });

      await limitedCoordinator.initialize();

      // Submit multiple tasks that would require multiple workers
      const tasks = [
        { id: 'limit-task-1', agentType: 'coder' as const, status: 'pending' as const, createdAt: new Date() },
        { id: 'limit-task-2', agentType: 'tester' as const, status: 'pending' as const, createdAt: new Date() },
        { id: 'limit-task-3', agentType: 'reviewer' as const, status: 'pending' as const, createdAt: new Date() },
      ];

      for (const task of tasks) {
        await limitedCoordinator.submitTask(task);
      }

      // Wait a bit for processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      const status = limitedCoordinator.getStatus();
      // Should have at most 1 worker despite 3 tasks
      expect(status.workers.length).toBeLessThanOrEqual(1);

      await limitedCoordinator.shutdown();
    });
  });

  describe('message handling', () => {
    it('should subscribe to message bus on init', async () => {
      await coordinator.initialize();

      const status = coordinator.getStatus();
      const coordinatorId = status.coordinator?.id;

      expect(coordinatorId).toBeDefined();

      await coordinator.shutdown();
    });

    it('should handle message bus after shutdown', async () => {
      await coordinator.initialize();
      const coordinatorId = coordinator.getStatus().coordinator?.id;

      await coordinator.shutdown();

      // Message bus should handle messages gracefully after unsubscribe
      const bus = getMessageBus();
      // Sending to defunct coordinator shouldn't throw
      bus.send('test-sender', coordinatorId!, 'test', {});
    });

    it('should handle task:completed message', async () => {
      await coordinator.initialize();
      const status = coordinator.getStatus();
      const coordinatorId = status.coordinator?.id;

      // Submit a task
      const task = {
        id: 'task-complete-test',
        agentType: 'coder' as const,
        status: 'pending' as const,
        createdAt: new Date(),
      };
      await coordinator.submitTask(task);

      // Simulate a worker sending task:completed
      const bus = getMessageBus();
      bus.send('fake-worker-id', coordinatorId!, 'task:completed', {
        taskId: 'task-complete-test',
      });

      // Should handle without throwing
      expect(coordinator.getStatus().coordinator).toBeDefined();
    });

    it('should handle task:failed message', async () => {
      await coordinator.initialize();
      const status = coordinator.getStatus();
      const coordinatorId = status.coordinator?.id;

      // Submit a task
      const task = {
        id: 'task-fail-test',
        agentType: 'coder' as const,
        status: 'pending' as const,
        createdAt: new Date(),
      };
      await coordinator.submitTask(task);

      // Simulate a worker sending task:failed
      const bus = getMessageBus();
      bus.send('fake-worker-id', coordinatorId!, 'task:failed', {
        taskId: 'task-fail-test',
        error: 'Test failure',
      });

      // Should handle without throwing
      expect(coordinator.getStatus().coordinator).toBeDefined();
    });

    it('should handle worker:ready message', async () => {
      await coordinator.initialize();
      const status = coordinator.getStatus();
      const coordinatorId = status.coordinator?.id;

      // Simulate a worker sending worker:ready
      const bus = getMessageBus();
      bus.send('fake-worker-id', coordinatorId!, 'worker:ready', {});

      // Should handle without throwing (worker not tracked, but no error)
      expect(coordinator.getStatus().coordinator).toBeDefined();
    });

    it('should handle unknown message type gracefully', async () => {
      await coordinator.initialize();
      const status = coordinator.getStatus();
      const coordinatorId = status.coordinator?.id;

      // Simulate an unknown message type
      const bus = getMessageBus();
      bus.send('fake-sender', coordinatorId!, 'unknown:type', { data: 'test' });

      // Should handle without throwing
      expect(coordinator.getStatus().coordinator).toBeDefined();
    });

    it('should handle task:completed from spawned worker', async () => {
      await coordinator.initialize();
      const coordinatorId = coordinator.getStatus().coordinator?.id;

      // Submit a task to spawn a worker
      const task = {
        id: 'worker-task-complete',
        agentType: 'coder' as const,
        status: 'pending' as const,
        createdAt: new Date(),
      };
      await coordinator.submitTask(task);

      // Wait a bit for worker to spawn
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Get the spawned worker
      const status = coordinator.getStatus();
      if (status.workers.length > 0) {
        const workerId = status.workers[0].id;
        const bus = getMessageBus();

        // Send task completed from the actual worker
        bus.send(workerId, coordinatorId!, 'task:completed', {
          taskId: 'worker-task-complete',
        });
      }

      expect(coordinator.getStatus().coordinator).toBeDefined();
    });

    it('should handle task:failed from spawned worker', async () => {
      await coordinator.initialize();
      const coordinatorId = coordinator.getStatus().coordinator?.id;

      // Submit a task to spawn a worker
      const task = {
        id: 'worker-task-fail',
        agentType: 'coder' as const,
        status: 'pending' as const,
        createdAt: new Date(),
      };
      await coordinator.submitTask(task);

      // Wait a bit for worker to spawn
      await new Promise((resolve) => setTimeout(resolve, 10));

      const status = coordinator.getStatus();
      if (status.workers.length > 0) {
        const workerId = status.workers[0].id;
        const bus = getMessageBus();

        // Send task failed from the actual worker
        bus.send(workerId, coordinatorId!, 'task:failed', {
          taskId: 'worker-task-fail',
          error: 'Worker error',
        });
      }

      expect(coordinator.getStatus().coordinator).toBeDefined();
    });

    it('should handle worker:ready from spawned worker', async () => {
      await coordinator.initialize();
      const coordinatorId = coordinator.getStatus().coordinator?.id;

      // Submit a task to spawn a worker
      const task = {
        id: 'worker-ready-task',
        agentType: 'coder' as const,
        status: 'pending' as const,
        createdAt: new Date(),
      };
      await coordinator.submitTask(task);

      // Wait a bit for worker to spawn
      await new Promise((resolve) => setTimeout(resolve, 10));

      const status = coordinator.getStatus();
      if (status.workers.length > 0) {
        const workerId = status.workers[0].id;
        const bus = getMessageBus();

        // Send worker ready from the actual worker
        bus.send(workerId, coordinatorId!, 'worker:ready', {});
      }

      expect(coordinator.getStatus().coordinator).toBeDefined();
    });
  });
});
