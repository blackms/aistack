/**
 * Task routes
 */

import type { AgentStackConfig } from '../../types.js';
import type { Router } from '../router.js';
import { sendJson, sendPaginated } from '../router.js';
import { badRequest, notFound } from '../middleware/error.js';
import { getMemoryManager } from '../../memory/index.js';
import { TaskQueue } from '../../coordination/task-queue.js';
import { agentEvents } from '../websocket/event-bridge.js';
import type { CreateTaskRequest, AssignTaskRequest, CompleteTaskRequest } from '../types.js';

// Global task queue instance
let taskQueue: TaskQueue | null = null;

function getTaskQueue(): TaskQueue {
  if (!taskQueue) {
    taskQueue = new TaskQueue();

    // Wire up events to WebSocket
    taskQueue.on('task:added', (queuedTask) => {
      agentEvents.emit('task:created', { task: queuedTask.task });
    });

    taskQueue.on('task:assigned', (queuedTask, agentId) => {
      agentEvents.emit('task:assigned', {
        taskId: queuedTask.task.id,
        agentId,
      });
    });

    taskQueue.on('task:completed', (queuedTask) => {
      agentEvents.emit('task:completed', {
        taskId: queuedTask.task.id,
      });
    });
  }
  return taskQueue;
}

export function registerTaskRoutes(router: Router, config: AgentStackConfig): void {
  const getManager = () => getMemoryManager(config);

  // GET /api/v1/tasks - List tasks
  router.get('/api/v1/tasks', (_req, res, params) => {
    const sessionId = params.query.sessionId;
    const status = params.query.status as 'pending' | 'running' | 'completed' | 'failed' | undefined;
    const limit = parseInt(params.query.limit || '50', 10);
    const offset = parseInt(params.query.offset || '0', 10);

    const manager = getManager();
    const allTasks = manager.listTasks(sessionId, status);
    const tasks = allTasks.slice(offset, offset + limit);

    sendPaginated(
      res,
      tasks.map(task => ({
        ...task,
        createdAt: task.createdAt.toISOString(),
        completedAt: task.completedAt?.toISOString(),
      })),
      { limit, offset, total: allTasks.length }
    );
  });

  // POST /api/v1/tasks - Create task
  router.post('/api/v1/tasks', (_req, res, params) => {
    const body = params.body as CreateTaskRequest | undefined;

    if (!body?.agentType) {
      throw badRequest('Agent type is required');
    }

    const manager = getManager();
    const task = manager.createTask(body.agentType, body.input, body.sessionId);

    // Add to queue if priority is specified
    if (body.priority !== undefined) {
      const queue = getTaskQueue();
      queue.enqueue(task, body.priority);
    }

    sendJson(res, {
      ...task,
      createdAt: task.createdAt.toISOString(),
      completedAt: task.completedAt?.toISOString(),
    }, 201);
  });

  // GET /api/v1/tasks/queue - Get queue status
  router.get('/api/v1/tasks/queue', (_req, res) => {
    const queue = getTaskQueue();
    const status = queue.getStatus();
    const pending = queue.peek(10);
    const processing = queue.getProcessing();

    sendJson(res, {
      status,
      pending: pending.map(qt => ({
        task: {
          ...qt.task,
          createdAt: qt.task.createdAt.toISOString(),
          completedAt: qt.task.completedAt?.toISOString(),
        },
        priority: qt.priority,
        addedAt: qt.addedAt.toISOString(),
        assignedTo: qt.assignedTo,
      })),
      processing: processing.map(qt => ({
        task: {
          ...qt.task,
          createdAt: qt.task.createdAt.toISOString(),
          completedAt: qt.task.completedAt?.toISOString(),
        },
        priority: qt.priority,
        addedAt: qt.addedAt.toISOString(),
        assignedTo: qt.assignedTo,
      })),
    });
  });

  // GET /api/v1/tasks/:id - Get task by ID
  router.get('/api/v1/tasks/:id', (_req, res, params) => {
    const taskId = params.path[0];
    if (!taskId) {
      throw badRequest('Task ID is required');
    }

    const manager = getManager();
    const task = manager.getTask(taskId);

    if (!task) {
      throw notFound('Task');
    }

    sendJson(res, {
      ...task,
      createdAt: task.createdAt.toISOString(),
      completedAt: task.completedAt?.toISOString(),
    });
  });

  // PUT /api/v1/tasks/:id/assign - Assign task to agent
  router.put('/api/v1/tasks/:id/assign', (_req, res, params) => {
    const taskId = params.path[0];
    if (!taskId) {
      throw badRequest('Task ID is required');
    }

    const body = params.body as AssignTaskRequest | undefined;
    if (!body?.agentId) {
      throw badRequest('Agent ID is required');
    }

    const queue = getTaskQueue();
    const success = queue.assign(taskId, body.agentId);

    if (!success) {
      throw notFound('Task in queue');
    }

    const manager = getManager();
    manager.updateTaskStatus(taskId, 'running');

    const task = manager.getTask(taskId);
    sendJson(res, {
      ...task,
      createdAt: task?.createdAt.toISOString(),
      completedAt: task?.completedAt?.toISOString(),
      assignedTo: body.agentId,
    });
  });

  // PUT /api/v1/tasks/:id/complete - Complete task
  router.put('/api/v1/tasks/:id/complete', (_req, res, params) => {
    const taskId = params.path[0];
    if (!taskId) {
      throw badRequest('Task ID is required');
    }

    const body = params.body as CompleteTaskRequest | undefined;

    const manager = getManager();
    const success = manager.updateTaskStatus(taskId, 'completed', body?.output);

    if (!success) {
      throw notFound('Task');
    }

    // Remove from queue
    const queue = getTaskQueue();
    queue.complete(taskId);

    const task = manager.getTask(taskId);
    sendJson(res, {
      ...task,
      createdAt: task?.createdAt.toISOString(),
      completedAt: task?.completedAt?.toISOString(),
    });
  });

  // PUT /api/v1/tasks/:id/fail - Mark task as failed
  router.put('/api/v1/tasks/:id/fail', (_req, res, params) => {
    const taskId = params.path[0];
    if (!taskId) {
      throw badRequest('Task ID is required');
    }

    const body = params.body as { error?: string } | undefined;

    const manager = getManager();
    const success = manager.updateTaskStatus(taskId, 'failed', body?.error);

    if (!success) {
      throw notFound('Task');
    }

    // Requeue if desired
    const requeue = params.query.requeue === 'true';
    if (requeue) {
      const queue = getTaskQueue();
      queue.requeue(taskId);
    }

    const task = manager.getTask(taskId);
    sendJson(res, {
      ...task,
      createdAt: task?.createdAt.toISOString(),
      completedAt: task?.completedAt?.toISOString(),
    });
  });
}
