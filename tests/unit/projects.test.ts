/**
 * Project, ProjectTask, and Specification tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStore } from '../../src/memory/sqlite-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('SQLiteStore Projects', () => {
  let store: SQLiteStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentstack-test-'));
    store = new SQLiteStore(join(tempDir, 'test.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true });
  });

  describe('createProject', () => {
    it('should create a project', () => {
      const project = store.createProject('Test Project', '/path/to/project');

      expect(project).toBeDefined();
      expect(project.id).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.path).toBe('/path/to/project');
      expect(project.status).toBe('active');
      expect(project.createdAt).toBeInstanceOf(Date);
      expect(project.updatedAt).toBeInstanceOf(Date);
    });

    it('should create a project with description and metadata', () => {
      const project = store.createProject(
        'Test Project',
        '/path/to/project',
        'A test project',
        { key: 'value' }
      );

      expect(project.description).toBe('A test project');
      expect(project.metadata).toEqual({ key: 'value' });
    });
  });

  describe('getProject', () => {
    it('should get a project by ID', () => {
      const created = store.createProject('Test', '/path');
      const found = store.getProject(created.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe('Test');
    });

    it('should return null for non-existent project', () => {
      const found = store.getProject('non-existent');
      expect(found).toBeNull();
    });
  });

  describe('updateProject', () => {
    it('should update project name', () => {
      const project = store.createProject('Original', '/path');
      const success = store.updateProject(project.id, { name: 'Updated' });

      expect(success).toBe(true);

      const updated = store.getProject(project.id);
      expect(updated?.name).toBe('Updated');
    });

    it('should update project status', () => {
      const project = store.createProject('Test', '/path');
      store.updateProject(project.id, { status: 'archived' });

      const updated = store.getProject(project.id);
      expect(updated?.status).toBe('archived');
    });

    it('should return false for non-existent project', () => {
      const success = store.updateProject('non-existent', { name: 'Updated' });
      expect(success).toBe(false);
    });
  });

  describe('listProjects', () => {
    it('should list all projects', () => {
      store.createProject('Project 1', '/path1');
      store.createProject('Project 2', '/path2');
      store.createProject('Project 3', '/path3');

      const projects = store.listProjects();
      expect(projects.length).toBe(3);
    });

    it('should filter projects by status', () => {
      store.createProject('Active', '/path1');
      const archived = store.createProject('Archived', '/path2');
      store.updateProject(archived.id, { status: 'archived' });

      const activeProjects = store.listProjects('active');
      expect(activeProjects.length).toBe(1);
      expect(activeProjects[0]?.name).toBe('Active');

      const archivedProjects = store.listProjects('archived');
      expect(archivedProjects.length).toBe(1);
      expect(archivedProjects[0]?.name).toBe('Archived');
    });
  });

  describe('deleteProject', () => {
    it('should delete a project', () => {
      const project = store.createProject('Test', '/path');
      const success = store.deleteProject(project.id);

      expect(success).toBe(true);
      expect(store.getProject(project.id)).toBeNull();
    });

    it('should cascade delete project tasks', () => {
      const project = store.createProject('Test', '/path');
      const task = store.createProjectTask(project.id, 'Task 1');

      store.deleteProject(project.id);

      expect(store.getProjectTask(task.id)).toBeNull();
    });
  });
});

describe('SQLiteStore ProjectTasks', () => {
  let store: SQLiteStore;
  let tempDir: string;
  let projectId: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentstack-test-'));
    store = new SQLiteStore(join(tempDir, 'test.db'));

    const project = store.createProject('Test Project', '/path');
    projectId = project.id;
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true });
  });

  describe('createProjectTask', () => {
    it('should create a project task', () => {
      const task = store.createProjectTask(projectId, 'Task Title');

      expect(task).toBeDefined();
      expect(task.id).toBeDefined();
      expect(task.projectId).toBe(projectId);
      expect(task.title).toBe('Task Title');
      expect(task.phase).toBe('draft');
      expect(task.priority).toBe(5);
      expect(task.assignedAgents).toEqual([]);
    });

    it('should create a task with options', () => {
      const task = store.createProjectTask(projectId, 'Task', {
        description: 'Description',
        priority: 1,
        assignedAgents: ['coder', 'tester'],
      });

      expect(task.description).toBe('Description');
      expect(task.priority).toBe(1);
      expect(task.assignedAgents).toEqual(['coder', 'tester']);
    });
  });

  describe('updateProjectTaskPhase', () => {
    it('should update task phase', () => {
      const task = store.createProjectTask(projectId, 'Task');
      store.updateProjectTaskPhase(task.id, 'specification');

      const updated = store.getProjectTask(task.id);
      expect(updated?.phase).toBe('specification');
    });

    it('should set completedAt for completed phase', () => {
      const task = store.createProjectTask(projectId, 'Task');
      store.updateProjectTaskPhase(task.id, 'specification');
      store.updateProjectTaskPhase(task.id, 'review');
      store.updateProjectTaskPhase(task.id, 'development');
      store.updateProjectTaskPhase(task.id, 'completed');

      const updated = store.getProjectTask(task.id);
      expect(updated?.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('listProjectTasks', () => {
    it('should list tasks by project', () => {
      store.createProjectTask(projectId, 'Task 1');
      store.createProjectTask(projectId, 'Task 2');

      const tasks = store.listProjectTasks(projectId);
      expect(tasks.length).toBe(2);
    });

    it('should filter tasks by phase', () => {
      const task1 = store.createProjectTask(projectId, 'Draft Task');
      const task2 = store.createProjectTask(projectId, 'Spec Task');
      store.updateProjectTaskPhase(task2.id, 'specification');

      const draftTasks = store.listProjectTasks(projectId, 'draft');
      expect(draftTasks.length).toBe(1);
      expect(draftTasks[0]?.title).toBe('Draft Task');

      const specTasks = store.listProjectTasks(projectId, 'specification');
      expect(specTasks.length).toBe(1);
      expect(specTasks[0]?.title).toBe('Spec Task');
    });
  });
});

describe('SQLiteStore Specifications', () => {
  let store: SQLiteStore;
  let tempDir: string;
  let taskId: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentstack-test-'));
    store = new SQLiteStore(join(tempDir, 'test.db'));

    const project = store.createProject('Test Project', '/path');
    const task = store.createProjectTask(project.id, 'Task');
    taskId = task.id;
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true });
  });

  describe('createSpecification', () => {
    it('should create a specification', () => {
      const spec = store.createSpecification(
        taskId,
        'architecture',
        'System Architecture',
        '# Architecture\n\nSystem design...',
        'architect'
      );

      expect(spec).toBeDefined();
      expect(spec.id).toBeDefined();
      expect(spec.projectTaskId).toBe(taskId);
      expect(spec.type).toBe('architecture');
      expect(spec.title).toBe('System Architecture');
      expect(spec.content).toBe('# Architecture\n\nSystem design...');
      expect(spec.version).toBe(1);
      expect(spec.status).toBe('draft');
      expect(spec.createdBy).toBe('architect');
    });
  });

  describe('updateSpecification', () => {
    it('should update specification content', () => {
      const spec = store.createSpecification(taskId, 'requirements', 'Title', 'Old content', 'user');
      store.updateSpecification(spec.id, { content: 'New content' });

      const updated = store.getSpecification(spec.id);
      expect(updated?.content).toBe('New content');
      expect(updated?.version).toBe(2);
    });
  });

  describe('updateSpecificationStatus', () => {
    it('should update status to pending_review', () => {
      const spec = store.createSpecification(taskId, 'design', 'Design', 'Content', 'designer');
      store.updateSpecificationStatus(spec.id, 'pending_review');

      const updated = store.getSpecification(spec.id);
      expect(updated?.status).toBe('pending_review');
    });

    it('should update status to approved with reviewer', () => {
      const spec = store.createSpecification(taskId, 'api', 'API', 'Content', 'developer');
      store.updateSpecificationStatus(spec.id, 'pending_review');
      store.updateSpecificationStatus(spec.id, 'approved', 'reviewer');

      const updated = store.getSpecification(spec.id);
      expect(updated?.status).toBe('approved');
      expect(updated?.reviewedBy).toBe('reviewer');
      expect(updated?.approvedAt).toBeInstanceOf(Date);
    });

    it('should update status to rejected with comments', () => {
      const spec = store.createSpecification(taskId, 'other', 'Spec', 'Content', 'author');
      store.updateSpecificationStatus(spec.id, 'pending_review');

      const comments = [
        {
          id: 'comment-1',
          author: 'reviewer',
          content: 'Need more details',
          createdAt: new Date(),
          resolved: false,
        },
      ];

      store.updateSpecificationStatus(spec.id, 'rejected', 'reviewer', comments);

      const updated = store.getSpecification(spec.id);
      expect(updated?.status).toBe('rejected');
      expect(updated?.comments).toHaveLength(1);
      expect(updated?.comments?.[0]?.content).toBe('Need more details');
    });
  });

  describe('listSpecifications', () => {
    it('should list specifications by task', () => {
      store.createSpecification(taskId, 'architecture', 'Arch', 'Content', 'user');
      store.createSpecification(taskId, 'requirements', 'Req', 'Content', 'user');

      const specs = store.listSpecifications(taskId);
      expect(specs.length).toBe(2);
    });

    it('should filter by status', () => {
      const spec1 = store.createSpecification(taskId, 'architecture', 'Draft', 'Content', 'user');
      const spec2 = store.createSpecification(taskId, 'requirements', 'Pending', 'Content', 'user');
      store.updateSpecificationStatus(spec2.id, 'pending_review');

      const draftSpecs = store.listSpecifications(taskId, 'draft');
      expect(draftSpecs.length).toBe(1);
      expect(draftSpecs[0]?.title).toBe('Draft');

      const pendingSpecs = store.listSpecifications(taskId, 'pending_review');
      expect(pendingSpecs.length).toBe(1);
      expect(pendingSpecs[0]?.title).toBe('Pending');
    });
  });

  describe('deleteSpecification', () => {
    it('should delete a specification', () => {
      const spec = store.createSpecification(taskId, 'design', 'Title', 'Content', 'user');
      const success = store.deleteSpecification(spec.id);

      expect(success).toBe(true);
      expect(store.getSpecification(spec.id)).toBeNull();
    });
  });
});

describe('Phase Transitions', () => {
  it('should define correct transitions', async () => {
    const { PHASE_TRANSITIONS } = await import('../../src/types.js');

    expect(PHASE_TRANSITIONS.draft).toEqual(['specification', 'cancelled']);
    expect(PHASE_TRANSITIONS.specification).toEqual(['review', 'cancelled']);
    expect(PHASE_TRANSITIONS.review).toEqual(['specification', 'development', 'cancelled']);
    expect(PHASE_TRANSITIONS.development).toEqual(['completed', 'cancelled']);
    expect(PHASE_TRANSITIONS.completed).toEqual([]);
    expect(PHASE_TRANSITIONS.cancelled).toEqual([]);
  });
});
