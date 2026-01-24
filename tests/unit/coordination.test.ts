/**
 * Coordination tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskQueue } from '../../src/coordination/task-queue.js';
import { MessageBus, resetMessageBus } from '../../src/coordination/message-bus.js';
import type { Task } from '../../src/types.js';

function createTask(id: string, agentType: string): Task {
  return {
    id,
    agentType,
    status: 'pending',
    createdAt: new Date(),
  };
}

describe('TaskQueue', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue();
  });

  it('should enqueue and dequeue tasks', () => {
    const task = createTask('task-1', 'coder');
    queue.enqueue(task, 5);

    expect(queue.length).toBe(1);

    const dequeued = queue.dequeue();
    expect(dequeued).not.toBeNull();
    expect(dequeued?.task.id).toBe('task-1');
    expect(queue.length).toBe(0);
  });

  it('should respect priority order', () => {
    queue.enqueue(createTask('low', 'coder'), 1);
    queue.enqueue(createTask('high', 'coder'), 10);
    queue.enqueue(createTask('medium', 'coder'), 5);

    expect(queue.dequeue()?.task.id).toBe('high');
    expect(queue.dequeue()?.task.id).toBe('medium');
    expect(queue.dequeue()?.task.id).toBe('low');
  });

  it('should dequeue by agent type', () => {
    queue.enqueue(createTask('coder-task', 'coder'), 5);
    queue.enqueue(createTask('tester-task', 'tester'), 5);

    const task = queue.dequeue('tester');
    expect(task?.task.id).toBe('tester-task');
    expect(queue.length).toBe(1);
  });

  it('should track processing tasks', () => {
    queue.enqueue(createTask('task-1', 'coder'), 5);
    const task = queue.dequeue();

    expect(task).not.toBeNull();
    expect(queue.getProcessing().length).toBe(1);

    queue.complete(task!.task.id);
    expect(queue.getProcessing().length).toBe(0);
  });

  it('should requeue failed tasks', () => {
    queue.enqueue(createTask('task-1', 'coder'), 5);
    const task = queue.dequeue();

    expect(task).not.toBeNull();
    queue.requeue(task!.task.id);

    expect(queue.length).toBe(1);
    expect(queue.getProcessing().length).toBe(0);
  });

  it('should report status correctly', () => {
    queue.enqueue(createTask('task-1', 'coder'), 5);
    queue.enqueue(createTask('task-2', 'coder'), 5);
    queue.dequeue();

    const status = queue.getStatus();
    expect(status.queued).toBe(1);
    expect(status.processing).toBe(1);
    expect(status.total).toBe(2);
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

  it('should send direct messages', () => {
    const received: string[] = [];
    bus.subscribe('agent-1', (msg) => received.push(msg.type));

    bus.send('coordinator', 'agent-1', 'task:assign', { task: 'test' });

    expect(received).toContain('task:assign');
  });

  it('should broadcast messages', () => {
    const agent1Received: string[] = [];
    const agent2Received: string[] = [];

    bus.subscribe('agent-1', (msg) => agent1Received.push(msg.type));
    bus.subscribe('agent-2', (msg) => agent2Received.push(msg.type));

    bus.broadcast('coordinator', 'status:update', { status: 'ready' });

    expect(agent1Received).toContain('status:update');
    expect(agent2Received).toContain('status:update');
  });

  it('should unsubscribe correctly', () => {
    const received: string[] = [];
    const unsub = bus.subscribe('agent-1', (msg) => received.push(msg.type));

    bus.send('coordinator', 'agent-1', 'msg-1', {});
    expect(received.length).toBe(1);

    unsub();
    bus.send('coordinator', 'agent-1', 'msg-2', {});
    expect(received.length).toBe(1);
  });

  it('should track message count', () => {
    expect(bus.getMessageCount()).toBe(0);

    bus.send('a', 'b', 'type-1', {});
    bus.send('a', 'b', 'type-2', {});
    bus.broadcast('a', 'type-3', {});

    expect(bus.getMessageCount()).toBe(3);
  });

  it('should track subscribers', () => {
    expect(bus.getSubscriberCount()).toBe(0);

    bus.subscribe('agent-1', () => {});
    bus.subscribe('agent-2', () => {});

    expect(bus.getSubscriberCount()).toBe(2);

    bus.unsubscribe('agent-1');
    expect(bus.getSubscriberCount()).toBe(1);
  });
});
