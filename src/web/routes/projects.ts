/**
 * Project routes
 */

import type { AgentStackConfig } from '../../types.js';
import { PHASE_TRANSITIONS, type TaskPhase } from '../../types.js';
import type { Router } from '../router.js';
import { sendJson } from '../router.js';
import { badRequest, notFound } from '../middleware/error.js';
import { getMemoryManager } from '../../memory/index.js';
import { agentEvents } from '../websocket/event-bridge.js';
import type {
  CreateProjectRequest,
  UpdateProjectRequest,
  CreateProjectTaskRequest,
  UpdateProjectTaskRequest,
  TransitionPhaseRequest,
  AssignAgentsRequest,
} from '../types.js';

export function registerProjectRoutes(router: Router, config: AgentStackConfig): void {
  const getManager = () => getMemoryManager(config);

  // GET /api/v1/projects - List projects
  router.get('/api/v1/projects', (_req, res, params) => {
    const status = params.query.status as 'active' | 'archived' | undefined;
    const manager = getManager();
    const projects = manager.listProjects(status);

    sendJson(res, projects.map(project => ({
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    })));
  });

  // POST /api/v1/projects - Create project
  router.post('/api/v1/projects', (_req, res, params) => {
    const body = params.body as CreateProjectRequest | undefined;

    if (!body?.name) {
      throw badRequest('Project name is required');
    }
    if (!body?.path) {
      throw badRequest('Project path is required');
    }

    const manager = getManager();
    const project = manager.createProject(
      body.name,
      body.path,
      body.description,
      body.metadata
    );

    // Emit event for WebSocket clients
    agentEvents.emit('project:created', {
      id: project.id,
      name: project.name,
      path: project.path,
    });

    sendJson(res, {
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    }, 201);
  });

  // GET /api/v1/projects/:id - Get project by ID
  router.get('/api/v1/projects/:id', (_req, res, params) => {
    const projectId = params.path[0];
    if (!projectId) {
      throw badRequest('Project ID is required');
    }

    const manager = getManager();
    const project = manager.getProject(projectId);
    if (!project) {
      throw notFound('Project');
    }

    sendJson(res, {
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    });
  });

  // PUT /api/v1/projects/:id - Update project
  router.put('/api/v1/projects/:id', (_req, res, params) => {
    const projectId = params.path[0];
    if (!projectId) {
      throw badRequest('Project ID is required');
    }

    const body = params.body as UpdateProjectRequest | undefined;
    if (!body) {
      throw badRequest('Request body is required');
    }

    const manager = getManager();
    const project = manager.getProject(projectId);
    if (!project) {
      throw notFound('Project');
    }

    const success = manager.updateProject(projectId, body);
    if (!success) {
      throw notFound('Project');
    }

    const updated = manager.getProject(projectId);

    // Emit event for WebSocket clients
    agentEvents.emit('project:updated', {
      id: projectId,
      changes: body,
    });

    sendJson(res, {
      ...updated,
      createdAt: updated?.createdAt.toISOString(),
      updatedAt: updated?.updatedAt.toISOString(),
    });
  });

  // DELETE /api/v1/projects/:id - Delete project
  router.delete('/api/v1/projects/:id', (_req, res, params) => {
    const projectId = params.path[0];
    if (!projectId) {
      throw badRequest('Project ID is required');
    }

    const manager = getManager();
    const success = manager.deleteProject(projectId);
    if (!success) {
      throw notFound('Project');
    }

    sendJson(res, { deleted: true });
  });

  // GET /api/v1/projects/:id/tasks - List project tasks
  router.get('/api/v1/projects/:id/tasks', (_req, res, params) => {
    const projectId = params.path[0];
    if (!projectId) {
      throw badRequest('Project ID is required');
    }

    const phase = params.query.phase as TaskPhase | undefined;
    const manager = getManager();

    const project = manager.getProject(projectId);
    if (!project) {
      throw notFound('Project');
    }

    const tasks = manager.listProjectTasks(projectId, phase);

    sendJson(res, tasks.map(task => ({
      ...task,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      completedAt: task.completedAt?.toISOString(),
    })));
  });

  // POST /api/v1/projects/:id/tasks - Create project task
  router.post('/api/v1/projects/:id/tasks', (_req, res, params) => {
    const projectId = params.path[0];
    if (!projectId) {
      throw badRequest('Project ID is required');
    }

    const body = params.body as CreateProjectTaskRequest | undefined;
    if (!body?.title) {
      throw badRequest('Task title is required');
    }

    const manager = getManager();
    const project = manager.getProject(projectId);
    if (!project) {
      throw notFound('Project');
    }

    const task = manager.createProjectTask(projectId, body.title, {
      description: body.description,
      priority: body.priority,
      assignedAgents: body.assignedAgents,
    });

    // Emit event for WebSocket clients
    agentEvents.emit('project:task:created', {
      projectId,
      taskId: task.id,
      title: task.title,
    });

    sendJson(res, {
      ...task,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    }, 201);
  });

  // GET /api/v1/projects/:id/tasks/:taskId - Get project task
  router.get('/api/v1/projects/:id/tasks/:taskId', (_req, res, params) => {
    const projectId = params.path[0];
    const taskId = params.path[1];
    if (!projectId || !taskId) {
      throw badRequest('Project ID and Task ID are required');
    }

    const manager = getManager();
    const task = manager.getProjectTask(taskId);
    if (!task || task.projectId !== projectId) {
      throw notFound('Project task');
    }

    sendJson(res, {
      ...task,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      completedAt: task.completedAt?.toISOString(),
    });
  });

  // PUT /api/v1/projects/:id/tasks/:taskId - Update project task
  router.put('/api/v1/projects/:id/tasks/:taskId', (_req, res, params) => {
    const projectId = params.path[0];
    const taskId = params.path[1];
    if (!projectId || !taskId) {
      throw badRequest('Project ID and Task ID are required');
    }

    const body = params.body as UpdateProjectTaskRequest | undefined;
    if (!body) {
      throw badRequest('Request body is required');
    }

    const manager = getManager();
    const task = manager.getProjectTask(taskId);
    if (!task || task.projectId !== projectId) {
      throw notFound('Project task');
    }

    const success = manager.updateProjectTask(taskId, body);
    if (!success) {
      throw notFound('Project task');
    }

    const updated = manager.getProjectTask(taskId);

    sendJson(res, {
      ...updated,
      createdAt: updated?.createdAt.toISOString(),
      updatedAt: updated?.updatedAt.toISOString(),
      completedAt: updated?.completedAt?.toISOString(),
    });
  });

  // DELETE /api/v1/projects/:id/tasks/:taskId - Delete project task
  router.delete('/api/v1/projects/:id/tasks/:taskId', (_req, res, params) => {
    const projectId = params.path[0];
    const taskId = params.path[1];
    if (!projectId || !taskId) {
      throw badRequest('Project ID and Task ID are required');
    }

    const manager = getManager();
    const task = manager.getProjectTask(taskId);
    if (!task || task.projectId !== projectId) {
      throw notFound('Project task');
    }

    const success = manager.deleteProjectTask(taskId);
    if (!success) {
      throw notFound('Project task');
    }

    sendJson(res, { deleted: true });
  });

  // PUT /api/v1/projects/:id/tasks/:taskId/phase - Transition task phase
  router.put('/api/v1/projects/:id/tasks/:taskId/phase', (_req, res, params) => {
    const projectId = params.path[0];
    const taskId = params.path[1];
    if (!projectId || !taskId) {
      throw badRequest('Project ID and Task ID are required');
    }

    const body = params.body as TransitionPhaseRequest | undefined;
    if (!body?.phase) {
      throw badRequest('Phase is required');
    }

    const validPhases: TaskPhase[] = ['draft', 'specification', 'review', 'development', 'completed', 'cancelled'];
    if (!validPhases.includes(body.phase as TaskPhase)) {
      throw badRequest(`Invalid phase. Must be one of: ${validPhases.join(', ')}`);
    }

    const manager = getManager();
    const task = manager.getProjectTask(taskId);
    if (!task || task.projectId !== projectId) {
      throw notFound('Project task');
    }

    // Check if transition is valid
    const allowedTransitions = PHASE_TRANSITIONS[task.phase];
    if (!allowedTransitions.includes(body.phase as TaskPhase)) {
      throw badRequest(`Cannot transition from ${task.phase} to ${body.phase}. Allowed: ${allowedTransitions.join(', ')}`);
    }

    const success = manager.updateProjectTaskPhase(taskId, body.phase as TaskPhase);
    if (!success) {
      throw notFound('Project task');
    }

    const updated = manager.getProjectTask(taskId);

    // Emit event for WebSocket clients
    agentEvents.emit('project:task:phase', {
      projectId,
      taskId,
      fromPhase: task.phase,
      toPhase: body.phase,
    });

    sendJson(res, {
      ...updated,
      createdAt: updated?.createdAt.toISOString(),
      updatedAt: updated?.updatedAt.toISOString(),
      completedAt: updated?.completedAt?.toISOString(),
    });
  });

  // PUT /api/v1/projects/:id/tasks/:taskId/assign - Assign agents to task
  router.put('/api/v1/projects/:id/tasks/:taskId/assign', (_req, res, params) => {
    const projectId = params.path[0];
    const taskId = params.path[1];
    if (!projectId || !taskId) {
      throw badRequest('Project ID and Task ID are required');
    }

    const body = params.body as AssignAgentsRequest | undefined;
    if (!body?.agents || !Array.isArray(body.agents)) {
      throw badRequest('Agents array is required');
    }

    const manager = getManager();
    const task = manager.getProjectTask(taskId);
    if (!task || task.projectId !== projectId) {
      throw notFound('Project task');
    }

    const success = manager.updateProjectTask(taskId, { assignedAgents: body.agents });
    if (!success) {
      throw notFound('Project task');
    }

    const updated = manager.getProjectTask(taskId);

    sendJson(res, {
      ...updated,
      createdAt: updated?.createdAt.toISOString(),
      updatedAt: updated?.updatedAt.toISOString(),
      completedAt: updated?.completedAt?.toISOString(),
    });
  });
}
