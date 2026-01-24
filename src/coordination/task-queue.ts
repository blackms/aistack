/**
 * Task queue - priority-based task scheduling
 */

import { EventEmitter } from 'node:events';
import type { Task, AgentType } from '../types.js';
import { logger } from '../utils/logger.js';

const log = logger.child('queue');

export interface QueuedTask {
  task: Task;
  priority: number;
  addedAt: Date;
  assignedTo?: string;
}

export interface TaskQueueEvents {
  'task:added': (task: QueuedTask) => void;
  'task:assigned': (task: QueuedTask, agentId: string) => void;
  'task:completed': (task: QueuedTask) => void;
  'queue:empty': () => void;
}

export class TaskQueue extends EventEmitter {
  private queue: QueuedTask[] = [];
  private processing: Map<string, QueuedTask> = new Map();

  constructor() {
    super();
  }

  /**
   * Add a task to the queue
   */
  enqueue(task: Task, priority: number = 5): void {
    const queuedTask: QueuedTask = {
      task,
      priority,
      addedAt: new Date(),
    };

    // Insert by priority (higher priority = earlier in queue)
    const insertIndex = this.queue.findIndex(t => t.priority < priority);
    if (insertIndex === -1) {
      this.queue.push(queuedTask);
    } else {
      this.queue.splice(insertIndex, 0, queuedTask);
    }

    this.emit('task:added', queuedTask);
    log.debug('Task enqueued', { taskId: task.id, priority, queueSize: this.queue.length });
  }

  /**
   * Get the next task for a specific agent type
   */
  dequeue(agentType?: AgentType | string): QueuedTask | null {
    let index = -1;

    if (agentType) {
      // Find first task matching agent type
      index = this.queue.findIndex(t => t.task.agentType === agentType);
    } else {
      // Get highest priority task
      index = 0;
    }

    if (index === -1 || this.queue.length === 0) {
      return null;
    }

    const [queuedTask] = this.queue.splice(index, 1);
    if (!queuedTask) return null;

    this.processing.set(queuedTask.task.id, queuedTask);
    log.debug('Task dequeued', { taskId: queuedTask.task.id });

    return queuedTask;
  }

  /**
   * Assign a task to an agent
   */
  assign(taskId: string, agentId: string): boolean {
    const queuedTask = this.processing.get(taskId);
    if (!queuedTask) return false;

    queuedTask.assignedTo = agentId;
    this.emit('task:assigned', queuedTask, agentId);
    log.debug('Task assigned', { taskId, agentId });

    return true;
  }

  /**
   * Mark a task as completed
   */
  complete(taskId: string): boolean {
    const queuedTask = this.processing.get(taskId);
    if (!queuedTask) return false;

    this.processing.delete(taskId);
    this.emit('task:completed', queuedTask);
    log.debug('Task completed', { taskId });

    if (this.queue.length === 0 && this.processing.size === 0) {
      this.emit('queue:empty');
    }

    return true;
  }

  /**
   * Return a task to the queue (e.g., on failure)
   */
  requeue(taskId: string): boolean {
    const queuedTask = this.processing.get(taskId);
    if (!queuedTask) return false;

    this.processing.delete(taskId);
    queuedTask.assignedTo = undefined;

    // Re-add with slightly lower priority
    this.enqueue(queuedTask.task, queuedTask.priority - 1);
    log.debug('Task requeued', { taskId });

    return true;
  }

  /**
   * Get queue status
   */
  getStatus(): { queued: number; processing: number; total: number } {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      total: this.queue.length + this.processing.size,
    };
  }

  /**
   * Peek at tasks in queue
   */
  peek(limit: number = 10): QueuedTask[] {
    return this.queue.slice(0, limit);
  }

  /**
   * Get processing tasks
   */
  getProcessing(): QueuedTask[] {
    return Array.from(this.processing.values());
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.queue = [];
    this.processing.clear();
    log.debug('Queue cleared');
  }

  /**
   * Get queue length
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is empty
   */
  get isEmpty(): boolean {
    return this.queue.length === 0 && this.processing.size === 0;
  }
}
