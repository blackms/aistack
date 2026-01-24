/**
 * Coordination tests - TaskQueue and MessageBus
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskQueue } from '../../src/coordination/task-queue.js';
import {
  MessageBus,
  getMessageBus,
  resetMessageBus,
} from '../../src/coordination/message-bus.js';
import type { Task } from '../../src/types.js';

function createTask(id: string, agentType: string = 'coder'): Task {
  return {
    id,
    agentType: agentType as Task['agentType'],
    input: `Task ${id}`,
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
    it('should add task to queue', () => {
      const task = createTask('task-1');
      queue.enqueue(task);

      expect(queue.length).toBe(1);
      expect(queue.isEmpty).toBe(false);
    });

    it('should add task with default priority 5', () => {
      const task = createTask('task-1');
      queue.enqueue(task);

      const peeked = queue.peek();
      expect(peeked[0].priority).toBe(5);
    });

    it('should add task with custom priority', () => {
      const task = createTask('task-1');
      queue.enqueue(task, 10);

      const peeked = queue.peek();
      expect(peeked[0].priority).toBe(10);
    });

    it('should order by priority (higher first)', () => {
      queue.enqueue(createTask('low'), 1);
      queue.enqueue(createTask('high'), 10);
      queue.enqueue(createTask('mid'), 5);

      const peeked = queue.peek(3);
      expect(peeked[0].task.id).toBe('high');
      expect(peeked[1].task.id).toBe('mid');
      expect(peeked[2].task.id).toBe('low');
    });

    it('should emit task:added event', () => {
      const handler = vi.fn();
      queue.on('task:added', handler);

      const task = createTask('task-1');
      queue.enqueue(task);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task,
          priority: 5,
        })
      );
    });
  });

  describe('dequeue', () => {
    it('should return null for empty queue', () => {
      expect(queue.dequeue()).toBeNull();
    });

    it('should return highest priority task', () => {
      queue.enqueue(createTask('low'), 1);
      queue.enqueue(createTask('high'), 10);

      const dequeued = queue.dequeue();
      expect(dequeued?.task.id).toBe('high');
    });

    it('should remove task from queue', () => {
      queue.enqueue(createTask('task-1'));
      expect(queue.length).toBe(1);

      queue.dequeue();
      expect(queue.length).toBe(0);
    });

    it('should filter by agent type', () => {
      queue.enqueue(createTask('coder-task', 'coder'), 10);
      queue.enqueue(createTask('tester-task', 'tester'), 5);

      const dequeued = queue.dequeue('tester');
      expect(dequeued?.task.id).toBe('tester-task');
    });

    it('should return null if no matching agent type', () => {
      queue.enqueue(createTask('coder-task', 'coder'));

      const dequeued = queue.dequeue('reviewer');
      expect(dequeued).toBeNull();
    });

    it('should move task to processing', () => {
      queue.enqueue(createTask('task-1'));
      queue.dequeue();

      const status = queue.getStatus();
      expect(status.queued).toBe(0);
      expect(status.processing).toBe(1);
    });
  });

  describe('assign', () => {
    it('should assign task to agent', () => {
      queue.enqueue(createTask('task-1'));
      const dequeued = queue.dequeue();

      const assigned = queue.assign(dequeued!.task.id, 'agent-1');
      expect(assigned).toBe(true);
    });

    it('should return false for non-existent task', () => {
      const assigned = queue.assign('non-existent', 'agent-1');
      expect(assigned).toBe(false);
    });

    it('should emit task:assigned event', () => {
      const handler = vi.fn();
      queue.on('task:assigned', handler);

      queue.enqueue(createTask('task-1'));
      const dequeued = queue.dequeue();
      queue.assign(dequeued!.task.id, 'agent-1');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ assignedTo: 'agent-1' }),
        'agent-1'
      );
    });
  });

  describe('complete', () => {
    it('should mark task as completed', () => {
      queue.enqueue(createTask('task-1'));
      const dequeued = queue.dequeue();

      const completed = queue.complete(dequeued!.task.id);
      expect(completed).toBe(true);

      const status = queue.getStatus();
      expect(status.processing).toBe(0);
    });

    it('should return false for non-existent task', () => {
      const completed = queue.complete('non-existent');
      expect(completed).toBe(false);
    });

    it('should emit task:completed event', () => {
      const handler = vi.fn();
      queue.on('task:completed', handler);

      queue.enqueue(createTask('task-1'));
      const dequeued = queue.dequeue();
      queue.complete(dequeued!.task.id);

      expect(handler).toHaveBeenCalled();
    });

    it('should emit queue:empty when all done', () => {
      const handler = vi.fn();
      queue.on('queue:empty', handler);

      queue.enqueue(createTask('task-1'));
      const dequeued = queue.dequeue();
      queue.complete(dequeued!.task.id);

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('requeue', () => {
    it('should return task to queue', () => {
      queue.enqueue(createTask('task-1'), 5);
      const dequeued = queue.dequeue();

      const requeued = queue.requeue(dequeued!.task.id);
      expect(requeued).toBe(true);

      expect(queue.length).toBe(1);
      const status = queue.getStatus();
      expect(status.processing).toBe(0);
    });

    it('should lower priority on requeue', () => {
      queue.enqueue(createTask('task-1'), 5);
      const dequeued = queue.dequeue();
      queue.requeue(dequeued!.task.id);

      const peeked = queue.peek();
      expect(peeked[0].priority).toBe(4);
    });

    it('should return false for non-existent task', () => {
      const requeued = queue.requeue('non-existent');
      expect(requeued).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return correct counts', () => {
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
    it('should return tasks without removing', () => {
      queue.enqueue(createTask('task-1'));
      queue.enqueue(createTask('task-2'));

      const peeked = queue.peek();
      expect(peeked.length).toBe(2);
      expect(queue.length).toBe(2);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 20; i++) {
        queue.enqueue(createTask(`task-${i}`));
      }

      const peeked = queue.peek(5);
      expect(peeked.length).toBe(5);
    });
  });

  describe('getProcessing', () => {
    it('should return processing tasks', () => {
      queue.enqueue(createTask('task-1'));
      queue.enqueue(createTask('task-2'));
      queue.dequeue();

      const processing = queue.getProcessing();
      expect(processing.length).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all tasks', () => {
      queue.enqueue(createTask('task-1'));
      queue.enqueue(createTask('task-2'));
      queue.dequeue();

      queue.clear();

      expect(queue.length).toBe(0);
      expect(queue.isEmpty).toBe(true);
      expect(queue.getProcessing().length).toBe(0);
    });
  });

  describe('isEmpty', () => {
    it('should be true when no tasks', () => {
      expect(queue.isEmpty).toBe(true);
    });

    it('should be false when queued tasks exist', () => {
      queue.enqueue(createTask('task-1'));
      expect(queue.isEmpty).toBe(false);
    });

    it('should be false when processing tasks exist', () => {
      queue.enqueue(createTask('task-1'));
      queue.dequeue();
      expect(queue.isEmpty).toBe(false);
    });
  });
});

describe('MessageBus', () => {
  let bus: MessageBus;

  beforeEach(() => {
    resetMessageBus();
    bus = new MessageBus();
  });

  afterEach(() => {
    bus.clear();
  });

  describe('send', () => {
    it('should send message to specific agent', () => {
      const received: unknown[] = [];
      bus.subscribe('agent-2', (msg) => received.push(msg));

      bus.send('agent-1', 'agent-2', 'greeting', { text: 'hello' });

      expect(received.length).toBe(1);
      expect(received[0]).toMatchObject({
        from: 'agent-1',
        to: 'agent-2',
        type: 'greeting',
        payload: { text: 'hello' },
      });
    });

    it('should return message with id', () => {
      const msg = bus.send('agent-1', 'agent-2', 'test', {});

      expect(msg.id).toBeDefined();
      expect(msg.id).toMatch(/^msg-\d+$/);
    });

    it('should emit direct and message events', () => {
      const directHandler = vi.fn();
      const messageHandler = vi.fn();

      bus.on('direct', directHandler);
      bus.on('message', messageHandler);

      bus.send('agent-1', 'agent-2', 'test', {});

      expect(directHandler).toHaveBeenCalled();
      expect(messageHandler).toHaveBeenCalled();
    });

    it('should handle subscriber errors', () => {
      const errorHandler = vi.fn();
      bus.on('error', errorHandler);

      bus.subscribe('agent-2', () => {
        throw new Error('Subscriber error');
      });

      bus.send('agent-1', 'agent-2', 'test', {});

      expect(errorHandler).toHaveBeenCalled();
    });

    it('should handle non-Error thrown objects', () => {
      const errorHandler = vi.fn();
      bus.on('error', errorHandler);

      bus.subscribe('agent-2', () => {
        throw 'string error';
      });

      bus.send('agent-1', 'agent-2', 'test', {});

      expect(errorHandler).toHaveBeenCalledWith(
        expect.any(Error),
        expect.any(Object)
      );
    });
  });

  describe('broadcast', () => {
    it('should send to all subscribers', () => {
      const received1: unknown[] = [];
      const received2: unknown[] = [];

      bus.subscribe('agent-1', (msg) => received1.push(msg));
      bus.subscribe('agent-2', (msg) => received2.push(msg));

      bus.broadcast('sender', 'announcement', { news: 'big news' });

      expect(received1.length).toBe(1);
      expect(received2.length).toBe(1);
    });

    it('should not have "to" field', () => {
      const msg = bus.broadcast('sender', 'test', {});
      expect(msg.to).toBeUndefined();
    });

    it('should emit broadcast and message events', () => {
      const broadcastHandler = vi.fn();
      const messageHandler = vi.fn();

      bus.on('broadcast', broadcastHandler);
      bus.on('message', messageHandler);

      bus.broadcast('sender', 'test', {});

      expect(broadcastHandler).toHaveBeenCalled();
      expect(messageHandler).toHaveBeenCalled();
    });

    it('should handle subscriber errors', () => {
      const errorHandler = vi.fn();
      bus.on('error', errorHandler);

      bus.subscribe('agent-1', () => {
        throw new Error('Broadcast error');
      });

      bus.broadcast('sender', 'test', {});

      expect(errorHandler).toHaveBeenCalled();
    });

    it('should handle non-Error thrown objects in broadcast', () => {
      const errorHandler = vi.fn();
      bus.on('error', errorHandler);

      bus.subscribe('agent-1', () => {
        throw 'string error';
      });

      bus.broadcast('sender', 'test', {});

      expect(errorHandler).toHaveBeenCalledWith(
        expect.any(Error),
        expect.any(Object)
      );
    });
  });

  describe('subscribe', () => {
    it('should return unsubscribe function', () => {
      const received: unknown[] = [];
      const unsubscribe = bus.subscribe('agent-1', (msg) => received.push(msg));

      bus.send('sender', 'agent-1', 'test', {});
      expect(received.length).toBe(1);

      unsubscribe();

      bus.send('sender', 'agent-1', 'test', {});
      expect(received.length).toBe(1);
    });

    it('should allow multiple subscriptions per agent', () => {
      let count = 0;
      bus.subscribe('agent-1', () => count++);
      bus.subscribe('agent-1', () => count++);

      bus.send('sender', 'agent-1', 'test', {});

      expect(count).toBe(2);
    });

    it('should clean up empty subscriber sets', () => {
      const unsub = bus.subscribe('agent-1', () => {});
      expect(bus.getSubscriberCount()).toBe(1);

      unsub();
      expect(bus.getSubscriberCount()).toBe(0);
    });
  });

  describe('subscribeAll', () => {
    it('should receive all messages', () => {
      const received: unknown[] = [];
      bus.subscribeAll((msg) => received.push(msg));

      bus.send('agent-1', 'agent-2', 'direct', {});
      bus.broadcast('agent-1', 'broadcast', {});

      expect(received.length).toBe(2);
    });

    it('should return unsubscribe function', () => {
      const received: unknown[] = [];
      const unsubscribe = bus.subscribeAll((msg) => received.push(msg));

      bus.send('agent-1', 'agent-2', 'test', {});
      expect(received.length).toBe(1);

      unsubscribe();

      bus.send('agent-1', 'agent-2', 'test', {});
      expect(received.length).toBe(1);
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe agent', () => {
      const received: unknown[] = [];
      bus.subscribe('agent-1', (msg) => received.push(msg));

      bus.unsubscribe('agent-1');
      bus.send('sender', 'agent-1', 'test', {});

      expect(received.length).toBe(0);
    });

    it('should return true when unsubscribed', () => {
      bus.subscribe('agent-1', () => {});
      expect(bus.unsubscribe('agent-1')).toBe(true);
    });

    it('should return false for non-existent agent', () => {
      expect(bus.unsubscribe('non-existent')).toBe(false);
    });
  });

  describe('getSubscriberCount', () => {
    it('should return number of subscribed agents', () => {
      bus.subscribe('agent-1', () => {});
      bus.subscribe('agent-2', () => {});

      expect(bus.getSubscriberCount()).toBe(2);
    });

    it('should count unique agents', () => {
      bus.subscribe('agent-1', () => {});
      bus.subscribe('agent-1', () => {});

      expect(bus.getSubscriberCount()).toBe(1);
    });
  });

  describe('getMessageCount', () => {
    it('should track total messages', () => {
      bus.send('a', 'b', 'test', {});
      bus.broadcast('a', 'test', {});
      bus.send('a', 'c', 'test', {});

      expect(bus.getMessageCount()).toBe(3);
    });
  });

  describe('clear', () => {
    it('should remove all subscriptions', () => {
      bus.subscribe('agent-1', () => {});
      bus.subscribe('agent-2', () => {});

      bus.clear();

      expect(bus.getSubscriberCount()).toBe(0);
    });
  });
});

describe('MessageBus singleton', () => {
  beforeEach(() => {
    resetMessageBus();
  });

  afterEach(() => {
    resetMessageBus();
  });

  it('should return same instance', () => {
    const bus1 = getMessageBus();
    const bus2 = getMessageBus();

    expect(bus1).toBe(bus2);
  });

  it('should reset instance', () => {
    const bus1 = getMessageBus();
    bus1.subscribe('agent-1', () => {});

    resetMessageBus();

    const bus2 = getMessageBus();
    expect(bus2).not.toBe(bus1);
    expect(bus2.getSubscriberCount()).toBe(0);
  });
});
