/**
 * Specification routes
 */

import type { AgentStackConfig, SpecificationStatus, SpecificationType, ReviewComment } from '../../types.js';
import type { Router } from '../router.js';
import { sendJson } from '../router.js';
import { badRequest, notFound } from '../middleware/error.js';
import { getMemoryManager } from '../../memory/index.js';
import { agentEvents } from '../websocket/event-bridge.js';
import type {
  CreateSpecificationRequest,
  UpdateSpecificationRequest,
  ApproveSpecificationRequest,
  RejectSpecificationRequest,
} from '../types.js';

export function registerSpecificationRoutes(router: Router, config: AgentStackConfig): void {
  const getManager = () => getMemoryManager(config);

  // GET /api/v1/tasks/:taskId/specs - List specifications for a task
  router.get('/api/v1/tasks/:taskId/specs', (_req, res, params) => {
    const taskId = params.path[0];
    if (!taskId) {
      throw badRequest('Task ID is required');
    }

    const status = params.query.status as SpecificationStatus | undefined;
    const manager = getManager();

    const task = manager.getProjectTask(taskId);
    if (!task) {
      throw notFound('Project task');
    }

    const specs = manager.listSpecifications(taskId, status);

    sendJson(res, specs.map(spec => ({
      ...spec,
      createdAt: spec.createdAt.toISOString(),
      updatedAt: spec.updatedAt.toISOString(),
      approvedAt: spec.approvedAt?.toISOString(),
    })));
  });

  // POST /api/v1/tasks/:taskId/specs - Create specification
  router.post('/api/v1/tasks/:taskId/specs', (_req, res, params) => {
    const taskId = params.path[0];
    if (!taskId) {
      throw badRequest('Task ID is required');
    }

    const body = params.body as CreateSpecificationRequest | undefined;
    if (!body?.type) {
      throw badRequest('Specification type is required');
    }
    if (!body?.title) {
      throw badRequest('Specification title is required');
    }
    if (!body?.content) {
      throw badRequest('Specification content is required');
    }
    if (!body?.createdBy) {
      throw badRequest('CreatedBy is required');
    }

    const validTypes: SpecificationType[] = ['architecture', 'requirements', 'design', 'api', 'other'];
    if (!validTypes.includes(body.type)) {
      throw badRequest(`Invalid type. Must be one of: ${validTypes.join(', ')}`);
    }

    const manager = getManager();
    const task = manager.getProjectTask(taskId);
    if (!task) {
      throw notFound('Project task');
    }

    const spec = manager.createSpecification(
      taskId,
      body.type,
      body.title,
      body.content,
      body.createdBy
    );

    // Emit event for WebSocket clients
    agentEvents.emit('spec:created', {
      id: spec.id,
      taskId,
      type: spec.type,
      title: spec.title,
    });

    sendJson(res, {
      ...spec,
      createdAt: spec.createdAt.toISOString(),
      updatedAt: spec.updatedAt.toISOString(),
    }, 201);
  });

  // GET /api/v1/specs/:specId - Get specification by ID
  router.get('/api/v1/specs/:specId', (_req, res, params) => {
    const specId = params.path[0];
    if (!specId) {
      throw badRequest('Specification ID is required');
    }

    const manager = getManager();
    const spec = manager.getSpecification(specId);
    if (!spec) {
      throw notFound('Specification');
    }

    sendJson(res, {
      ...spec,
      createdAt: spec.createdAt.toISOString(),
      updatedAt: spec.updatedAt.toISOString(),
      approvedAt: spec.approvedAt?.toISOString(),
    });
  });

  // PUT /api/v1/specs/:specId - Update specification
  router.put('/api/v1/specs/:specId', (_req, res, params) => {
    const specId = params.path[0];
    if (!specId) {
      throw badRequest('Specification ID is required');
    }

    const body = params.body as UpdateSpecificationRequest | undefined;
    if (!body) {
      throw badRequest('Request body is required');
    }

    if (body.type) {
      const validTypes: SpecificationType[] = ['architecture', 'requirements', 'design', 'api', 'other'];
      if (!validTypes.includes(body.type)) {
        throw badRequest(`Invalid type. Must be one of: ${validTypes.join(', ')}`);
      }
    }

    const manager = getManager();
    const spec = manager.getSpecification(specId);
    if (!spec) {
      throw notFound('Specification');
    }

    // Can only update draft or pending_review specs
    if (spec.status === 'approved') {
      throw badRequest('Cannot update an approved specification');
    }

    const success = manager.updateSpecification(specId, body);
    if (!success) {
      throw notFound('Specification');
    }

    const updated = manager.getSpecification(specId);

    sendJson(res, {
      ...updated,
      createdAt: updated?.createdAt.toISOString(),
      updatedAt: updated?.updatedAt.toISOString(),
      approvedAt: updated?.approvedAt?.toISOString(),
    });
  });

  // DELETE /api/v1/specs/:specId - Delete specification
  router.delete('/api/v1/specs/:specId', (_req, res, params) => {
    const specId = params.path[0];
    if (!specId) {
      throw badRequest('Specification ID is required');
    }

    const manager = getManager();
    const spec = manager.getSpecification(specId);
    if (!spec) {
      throw notFound('Specification');
    }

    const success = manager.deleteSpecification(specId);
    if (!success) {
      throw notFound('Specification');
    }

    sendJson(res, { deleted: true });
  });

  // PUT /api/v1/specs/:specId/submit - Submit specification for review
  router.put('/api/v1/specs/:specId/submit', (_req, res, params) => {
    const specId = params.path[0];
    if (!specId) {
      throw badRequest('Specification ID is required');
    }

    const manager = getManager();
    const spec = manager.getSpecification(specId);
    if (!spec) {
      throw notFound('Specification');
    }

    if (spec.status !== 'draft') {
      throw badRequest('Only draft specifications can be submitted for review');
    }

    const success = manager.updateSpecificationStatus(specId, 'pending_review');
    if (!success) {
      throw notFound('Specification');
    }

    const updated = manager.getSpecification(specId);

    // Emit event for WebSocket clients
    agentEvents.emit('spec:status', {
      id: specId,
      status: 'pending_review',
    });

    sendJson(res, {
      ...updated,
      createdAt: updated?.createdAt.toISOString(),
      updatedAt: updated?.updatedAt.toISOString(),
      approvedAt: updated?.approvedAt?.toISOString(),
    });
  });

  // PUT /api/v1/specs/:specId/approve - Approve specification
  router.put('/api/v1/specs/:specId/approve', (_req, res, params) => {
    const specId = params.path[0];
    if (!specId) {
      throw badRequest('Specification ID is required');
    }

    const body = params.body as ApproveSpecificationRequest | undefined;
    if (!body?.reviewedBy) {
      throw badRequest('ReviewedBy is required');
    }

    const manager = getManager();
    const spec = manager.getSpecification(specId);
    if (!spec) {
      throw notFound('Specification');
    }

    if (spec.status !== 'pending_review') {
      throw badRequest('Only pending_review specifications can be approved');
    }

    // Convert comments from request to ReviewComment[]
    const comments: ReviewComment[] | undefined = body.comments?.map(c => ({
      id: c.id,
      author: c.author,
      content: c.content,
      createdAt: new Date(c.createdAt),
      resolved: c.resolved,
    }));

    const success = manager.updateSpecificationStatus(specId, 'approved', body.reviewedBy, comments);
    if (!success) {
      throw notFound('Specification');
    }

    const updated = manager.getSpecification(specId);

    // Emit event for WebSocket clients
    agentEvents.emit('spec:status', {
      id: specId,
      status: 'approved',
      reviewedBy: body.reviewedBy,
    });

    sendJson(res, {
      ...updated,
      createdAt: updated?.createdAt.toISOString(),
      updatedAt: updated?.updatedAt.toISOString(),
      approvedAt: updated?.approvedAt?.toISOString(),
    });
  });

  // PUT /api/v1/specs/:specId/reject - Reject specification
  router.put('/api/v1/specs/:specId/reject', (_req, res, params) => {
    const specId = params.path[0];
    if (!specId) {
      throw badRequest('Specification ID is required');
    }

    const body = params.body as RejectSpecificationRequest | undefined;
    if (!body?.reviewedBy) {
      throw badRequest('ReviewedBy is required');
    }
    if (!body?.comments || body.comments.length === 0) {
      throw badRequest('At least one comment is required when rejecting');
    }

    const manager = getManager();
    const spec = manager.getSpecification(specId);
    if (!spec) {
      throw notFound('Specification');
    }

    if (spec.status !== 'pending_review') {
      throw badRequest('Only pending_review specifications can be rejected');
    }

    // Convert comments from request to ReviewComment[]
    const comments: ReviewComment[] = body.comments.map(c => ({
      id: c.id,
      author: c.author,
      content: c.content,
      createdAt: new Date(c.createdAt),
      resolved: c.resolved,
    }));

    const success = manager.updateSpecificationStatus(specId, 'rejected', body.reviewedBy, comments);
    if (!success) {
      throw notFound('Specification');
    }

    const updated = manager.getSpecification(specId);

    // Emit event for WebSocket clients
    agentEvents.emit('spec:status', {
      id: specId,
      status: 'rejected',
      reviewedBy: body.reviewedBy,
    });

    sendJson(res, {
      ...updated,
      createdAt: updated?.createdAt.toISOString(),
      updatedAt: updated?.updatedAt.toISOString(),
      approvedAt: updated?.approvedAt?.toISOString(),
    });
  });
}
