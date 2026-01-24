/**
 * Topology - hierarchical coordinator pattern
 */

import type { SpawnedAgent, Task } from '../types.js';
import { spawnAgent, listAgents, updateAgentStatus, stopAgent } from '../agents/spawner.js';
import { TaskQueue } from './task-queue.js';
import { getMessageBus, Message } from './message-bus.js';
import { logger } from '../utils/logger.js';

const log = logger.child('topology');

export interface CoordinatorOptions {
  maxWorkers?: number;
  sessionId?: string;
}

/**
 * Hierarchical coordinator - one coordinator managing multiple workers
 */
export class HierarchicalCoordinator {
  private coordinator: SpawnedAgent | null = null;
  private workers: Map<string, SpawnedAgent> = new Map();
  private taskQueue: TaskQueue;
  private maxWorkers: number;
  private sessionId?: string;
  private unsubscribe?: () => void;

  constructor(options: CoordinatorOptions = {}) {
    this.maxWorkers = options.maxWorkers ?? 5;
    this.sessionId = options.sessionId;
    this.taskQueue = new TaskQueue();
  }

  /**
   * Initialize the coordinator
   */
  async initialize(): Promise<void> {
    // Spawn coordinator agent
    this.coordinator = spawnAgent('coordinator', {
      name: 'main-coordinator',
      sessionId: this.sessionId,
    });

    updateAgentStatus(this.coordinator.id, 'running');

    // Subscribe to messages
    const bus = getMessageBus();
    this.unsubscribe = bus.subscribe(this.coordinator.id, this.handleMessage.bind(this));

    // Set up task queue events
    this.taskQueue.on('task:added', () => this.assignPendingTasks());

    log.info('Coordinator initialized', { id: this.coordinator.id });
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(message: Message): void {
    log.debug('Coordinator received message', {
      type: message.type,
      from: message.from,
    });

    switch (message.type) {
      case 'task:completed':
        this.handleTaskCompleted(message);
        break;
      case 'task:failed':
        this.handleTaskFailed(message);
        break;
      case 'worker:ready':
        this.handleWorkerReady(message);
        break;
    }
  }

  /**
   * Submit a task for coordination
   */
  async submitTask(task: Task, priority: number = 5): Promise<void> {
    this.taskQueue.enqueue(task, priority);
    log.debug('Task submitted', { taskId: task.id, priority });
  }

  /**
   * Try to assign pending tasks to available workers
   */
  private async assignPendingTasks(): Promise<void> {
    while (!this.taskQueue.isEmpty) {
      // Find available worker or spawn new one
      const worker = await this.getAvailableWorker();
      if (!worker) {
        log.debug('No available workers, waiting');
        break;
      }

      // Get next task
      const queuedTask = this.taskQueue.dequeue(worker.type);
      if (!queuedTask) {
        break;
      }

      // Assign task to worker
      this.taskQueue.assign(queuedTask.task.id, worker.id);
      updateAgentStatus(worker.id, 'running');

      // Send task to worker via message bus
      const bus = getMessageBus();
      bus.send(this.coordinator!.id, worker.id, 'task:assign', {
        task: queuedTask.task,
      });

      log.debug('Task assigned to worker', {
        taskId: queuedTask.task.id,
        workerId: worker.id,
      });
    }
  }

  /**
   * Get an available worker or spawn a new one
   */
  private async getAvailableWorker(): Promise<SpawnedAgent | null> {
    // Find idle worker
    for (const worker of this.workers.values()) {
      if (worker.status === 'idle') {
        return worker;
      }
    }

    // Spawn new worker if under limit
    if (this.workers.size < this.maxWorkers) {
      // Get next task type from queue to spawn appropriate worker
      const nextTask = this.taskQueue.peek(1)[0];
      if (!nextTask) return null;

      const worker = spawnAgent(nextTask.task.agentType, {
        sessionId: this.sessionId,
      });

      this.workers.set(worker.id, worker);
      log.info('Spawned new worker', { id: worker.id, type: worker.type });

      return worker;
    }

    return null;
  }

  /**
   * Handle task completion
   */
  private handleTaskCompleted(message: Message): void {
    const { taskId } = message.payload as { taskId: string };
    this.taskQueue.complete(taskId);

    // Mark worker as idle
    const worker = this.workers.get(message.from);
    if (worker) {
      updateAgentStatus(worker.id, 'idle');
    }

    // Try to assign more tasks
    void this.assignPendingTasks();
  }

  /**
   * Handle task failure
   */
  private handleTaskFailed(message: Message): void {
    const { taskId } = message.payload as { taskId: string };

    // Requeue the task
    this.taskQueue.requeue(taskId);

    // Mark worker as idle (or failed if repeated failures)
    const worker = this.workers.get(message.from);
    if (worker) {
      updateAgentStatus(worker.id, 'idle');
    }

    // Try to assign more tasks
    void this.assignPendingTasks();
  }

  /**
   * Handle worker ready notification
   */
  private handleWorkerReady(message: Message): void {
    const worker = this.workers.get(message.from);
    if (worker) {
      updateAgentStatus(worker.id, 'idle');
      void this.assignPendingTasks();
    }
  }

  /**
   * Get status of the coordination
   */
  getStatus(): {
    coordinator: SpawnedAgent | null;
    workers: SpawnedAgent[];
    queue: { queued: number; processing: number };
  } {
    return {
      coordinator: this.coordinator,
      workers: Array.from(this.workers.values()),
      queue: this.taskQueue.getStatus(),
    };
  }

  /**
   * Shutdown the coordinator
   */
  async shutdown(): Promise<void> {
    // Unsubscribe from messages
    if (this.unsubscribe) {
      this.unsubscribe();
    }

    // Stop all workers
    for (const worker of this.workers.values()) {
      stopAgent(worker.id);
    }
    this.workers.clear();

    // Stop coordinator
    if (this.coordinator) {
      stopAgent(this.coordinator.id);
      this.coordinator = null;
    }

    // Clear queue
    this.taskQueue.clear();

    log.info('Coordinator shutdown');
  }
}
