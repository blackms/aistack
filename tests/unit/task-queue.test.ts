/**
 * Task queue tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskQueue, type QueuedTask } from '../../src/coordination/task-queue.js';
import type { Task } from '../../src/types.js';

// Helper to create a test task
function createTask(id: string, agentType: string = 'coder'): Task {
  return {
    id,
    agentType: agentType as 'coder' | 'researcher' | 'tester' | 'reviewer' | 'architect' | 'coordinator' | 'analyst',
    status: 'pending',
    createdAt: new Date(),
  };
}

describe('TaskQueue', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue();
  });

  describe('enqueue', () => {
    it('should add a task to the queue', () => {
      queue.enqueue(createTask('task-1'));

      expect(queue.length).toBe(1);
    });

    it('should add tasks with default priority 5', () => {
      queue.enqueue(createTask('task-1'));

      const tasks = queue.peek(1);
      expect(tasks[0].priority).toBe(5);
    });

    it('should add tasks with custom priority', () => {
      queue.enqueue(createTask('task-1'), 10);

      const tasks = queue.peek(1);
      expect(tasks[0].priority).toBe(10);
    });

    it('should order tasks by priority (higher first)', () => {
      queue.enqueue(createTask('low'), 1);
      queue.enqueue(createTask('high'), 10);
      queue.enqueue(createTask('medium'), 5);

      const tasks = queue.peek(3);
      expect(tasks[0].task.id).toBe('high');
      expect(tasks[1].task.id).toBe('medium');
      expect(tasks[2].task.id).toBe('low');
    });

    it('should emit task:added event', () => {
      const handler = vi.fn();
      queue.on('task:added', handler);

      queue.enqueue(createTask('task-1'));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ id: 'task-1' }),
        })
      );
    });

    it('should set addedAt timestamp', () => {
      const before = new Date();
      queue.enqueue(createTask('task-1'));
      const after = new Date();

      const tasks = queue.peek(1);
      expect(tasks[0].addedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(tasks[0].addedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('dequeue', () => {
    it('should return null from empty queue', () => {
      const task = queue.dequeue();
      expect(task).toBeNull();
    });

    it('should return highest priority task', () => {
      queue.enqueue(createTask('low'), 1);
      queue.enqueue(createTask('high'), 10);

      const task = queue.dequeue();
      expect(task?.task.id).toBe('high');
    });

    it('should remove task from queue', () => {
      queue.enqueue(createTask('task-1'));
      expect(queue.length).toBe(1);

      queue.dequeue();
      expect(queue.length).toBe(0);
    });

    it('should move task to processing', () => {
      queue.enqueue(createTask('task-1'));
      queue.dequeue();

      const status = queue.getStatus();
      expect(status.queued).toBe(0);
      expect(status.processing).toBe(1);
    });

    it('should filter by agent type', () => {
      queue.enqueue(createTask('coder-task', 'coder'));
      queue.enqueue(createTask('tester-task', 'tester'));

      const task = queue.dequeue('tester');
      expect(task?.task.id).toBe('tester-task');
    });

    it('should return null if no matching agent type', () => {
      queue.enqueue(createTask('coder-task', 'coder'));

      const task = queue.dequeue('reviewer');
      expect(task).toBeNull();
    });
  });

  describe('assign', () => {
    it('should assign agent to processing task', () => {
      queue.enqueue(createTask('task-1'));
      queue.dequeue();

      const result = queue.assign('task-1', 'agent-1');
      expect(result).toBe(true);
    });

    it('should return false for non-processing task', () => {
      const result = queue.assign('non-existent', 'agent-1');
      expect(result).toBe(false);
    });

    it('should emit task:assigned event', () => {
      const handler = vi.fn();
      queue.on('task:assigned', handler);

      queue.enqueue(createTask('task-1'));
      queue.dequeue();
      queue.assign('task-1', 'agent-1');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ id: 'task-1' }),
          assignedTo: 'agent-1',
        }),
        'agent-1'
      );
    });
  });

  describe('complete', () => {
    it('should complete a processing task', () => {
      queue.enqueue(createTask('task-1'));
      queue.dequeue();

      const result = queue.complete('task-1');
      expect(result).toBe(true);
    });

    it('should remove task from processing', () => {
      queue.enqueue(createTask('task-1'));
      queue.dequeue();
      queue.complete('task-1');

      expect(queue.getProcessing()).toEqual([]);
    });

    it('should return false for non-processing task', () => {
      const result = queue.complete('non-existent');
      expect(result).toBe(false);
    });

    it('should emit task:completed event', () => {
      const handler = vi.fn();
      queue.on('task:completed', handler);

      queue.enqueue(createTask('task-1'));
      queue.dequeue();
      queue.complete('task-1');

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should emit queue:empty when all done', () => {
      const handler = vi.fn();
      queue.on('queue:empty', handler);

      queue.enqueue(createTask('task-1'));
      queue.dequeue();
      queue.complete('task-1');

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('requeue', () => {
    it('should return task to queue', () => {
      queue.enqueue(createTask('task-1'), 5);
      queue.dequeue();
      queue.requeue('task-1');

      expect(queue.length).toBe(1);
      expect(queue.getProcessing().length).toBe(0);
    });

    it('should lower priority on requeue', () => {
      queue.enqueue(createTask('task-1'), 5);
      queue.dequeue();
      queue.requeue('task-1');

      const tasks = queue.peek(1);
      expect(tasks[0].priority).toBe(4);
    });

    it('should return false for non-processing task', () => {
      const result = queue.requeue('non-existent');
      expect(result).toBe(false);
    });

    it('should clear assignedTo', () => {
      queue.enqueue(createTask('task-1'));
      queue.dequeue();
      queue.assign('task-1', 'agent-1');
      queue.requeue('task-1');

      const tasks = queue.peek(1);
      expect(tasks[0].assignedTo).toBeUndefined();
    });
  });

  describe('getStatus', () => {
    it('should return zero counts for empty queue', () => {
      const status = queue.getStatus();

      expect(status.queued).toBe(0);
      expect(status.processing).toBe(0);
      expect(status.total).toBe(0);
    });

    it('should count queued and processing separately', () => {
      queue.enqueue(createTask('task-1'));
      queue.enqueue(createTask('task-2'));
      queue.dequeue();

      const status = queue.getStatus();

      expect(status.queued).toBe(1);
      expect(status.processing).toBe(1);
      expect(status.total).toBe(2);
    });
  });

  describe('peek', () => {
    it('should return empty array for empty queue', () => {
      expect(queue.peek()).toEqual([]);
    });

    it('should return tasks without removing', () => {
      queue.enqueue(createTask('task-1'));
      queue.enqueue(createTask('task-2'));

      const peeked = queue.peek(2);
      expect(peeked.length).toBe(2);
      expect(queue.length).toBe(2);
    });

    it('should respect limit', () => {
      queue.enqueue(createTask('task-1'));
      queue.enqueue(createTask('task-2'));
      queue.enqueue(createTask('task-3'));

      expect(queue.peek(2).length).toBe(2);
    });
  });

  describe('getProcessing', () => {
    it('should return empty array when none processing', () => {
      expect(queue.getProcessing()).toEqual([]);
    });

    it('should return all processing tasks', () => {
      queue.enqueue(createTask('task-1'));
      queue.enqueue(createTask('task-2'));
      queue.dequeue();
      queue.dequeue();

      expect(queue.getProcessing().length).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all tasks', () => {
      queue.enqueue(createTask('task-1'));
      queue.enqueue(createTask('task-2'));
      queue.dequeue();

      queue.clear();

      expect(queue.length).toBe(0);
      expect(queue.getProcessing()).toEqual([]);
    });
  });

  describe('length', () => {
    it('should return queue length', () => {
      expect(queue.length).toBe(0);

      queue.enqueue(createTask('task-1'));
      expect(queue.length).toBe(1);

      queue.enqueue(createTask('task-2'));
      expect(queue.length).toBe(2);
    });
  });

  describe('isEmpty', () => {
    it('should return true for empty queue', () => {
      expect(queue.isEmpty).toBe(true);
    });

    it('should return false with queued tasks', () => {
      queue.enqueue(createTask('task-1'));
      expect(queue.isEmpty).toBe(false);
    });

    it('should return false with processing tasks', () => {
      queue.enqueue(createTask('task-1'));
      queue.dequeue();
      expect(queue.isEmpty).toBe(false);
    });

    it('should return true when all completed', () => {
      queue.enqueue(createTask('task-1'));
      queue.dequeue();
      queue.complete('task-1');
      expect(queue.isEmpty).toBe(true);
    });
  });
});
