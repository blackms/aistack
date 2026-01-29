/**
 * SQLite Store tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStore } from '../../src/memory/sqlite-store.js';
import { existsSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('SQLiteStore', () => {
  let store: SQLiteStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `aistack-test-${Date.now()}.db`);
    store = new SQLiteStore(dbPath);
  });

  afterEach(() => {
    store.close();
    // Clean up test database files
    if (existsSync(dbPath)) unlinkSync(dbPath);
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  });

  describe('Memory Operations', () => {
    it('should store and retrieve a memory entry', () => {
      const entry = store.store('test-key', 'test content');

      expect(entry.key).toBe('test-key');
      expect(entry.content).toBe('test content');
      expect(entry.namespace).toBe('default');
      expect(entry.id).toBeDefined();

      const retrieved = store.get('test-key');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.content).toBe('test content');
    });

    it('should store with custom namespace', () => {
      const entry = store.store('key1', 'content1', { namespace: 'custom' });

      expect(entry.namespace).toBe('custom');

      const retrieved = store.get('key1', 'custom');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.namespace).toBe('custom');

      // Should not find in default namespace
      const notFound = store.get('key1', 'default');
      expect(notFound).toBeNull();
    });

    it('should store with metadata', () => {
      const metadata = { type: 'note', priority: 1 };
      const entry = store.store('key-meta', 'content', { metadata });

      expect(entry.metadata).toEqual(metadata);

      const retrieved = store.get('key-meta');
      expect(retrieved?.metadata).toEqual(metadata);
    });

    it('should update existing entry', () => {
      store.store('update-key', 'original content');
      const updated = store.store('update-key', 'updated content');

      expect(updated.content).toBe('updated content');

      const retrieved = store.get('update-key');
      expect(retrieved?.content).toBe('updated content');
    });

    it('should get entry by ID', () => {
      const entry = store.store('id-key', 'id content');
      const retrieved = store.getById(entry.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.content).toBe('id content');
    });

    it('should return null for non-existent entry', () => {
      const result = store.get('non-existent-key');
      expect(result).toBeNull();
    });

    it('should delete entry by key', () => {
      store.store('delete-key', 'to delete');
      const deleted = store.delete('delete-key');

      expect(deleted).toBe(true);
      expect(store.get('delete-key')).toBeNull();
    });

    it('should delete entry by ID', () => {
      const entry = store.store('delete-id-key', 'to delete');
      const deleted = store.deleteById(entry.id);

      expect(deleted).toBe(true);
      expect(store.getById(entry.id)).toBeNull();
    });

    it('should return false when deleting non-existent entry', () => {
      const deleted = store.delete('non-existent');
      expect(deleted).toBe(false);
    });

    it('should list entries', () => {
      store.store('list-key-1', 'content 1');
      store.store('list-key-2', 'content 2');
      store.store('list-key-3', 'content 3');

      const entries = store.list();
      expect(entries.length).toBe(3);
    });

    it('should list entries with namespace filter', () => {
      store.store('ns-key-1', 'content 1', { namespace: 'ns1' });
      store.store('ns-key-2', 'content 2', { namespace: 'ns1' });
      store.store('ns-key-3', 'content 3', { namespace: 'ns2' });

      const ns1Entries = store.list('ns1');
      expect(ns1Entries.length).toBe(2);

      const ns2Entries = store.list('ns2');
      expect(ns2Entries.length).toBe(1);
    });

    it('should list entries with limit and offset', () => {
      for (let i = 0; i < 10; i++) {
        store.store(`page-key-${i}`, `content ${i}`);
      }

      const page1 = store.list(undefined, 3, 0);
      expect(page1.length).toBe(3);

      const page2 = store.list(undefined, 3, 3);
      expect(page2.length).toBe(3);

      const page4 = store.list(undefined, 3, 9);
      expect(page4.length).toBe(1);
    });

    it('should count entries', () => {
      store.store('count-1', 'c1');
      store.store('count-2', 'c2');
      store.store('count-3', 'c3', { namespace: 'other' });

      expect(store.count()).toBe(3);
      expect(store.count('default')).toBe(2);
      expect(store.count('other')).toBe(1);
    });

    it('should store and retrieve embeddings', () => {
      const entry = store.store('embed-key', 'embed content');
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];

      store.storeEmbedding(entry.id, embedding);

      const entriesWithEmbeddings = store.getEntriesWithEmbeddings();
      expect(entriesWithEmbeddings.length).toBe(1);
      expect(entriesWithEmbeddings[0].id).toBe(entry.id);
      expect(entriesWithEmbeddings[0].embedding.length).toBe(5);
    });
  });

  describe('Session Operations', () => {
    it('should create a session', () => {
      const session = store.createSession();

      expect(session.id).toBeDefined();
      expect(session.status).toBe('active');
      expect(session.startedAt).toBeInstanceOf(Date);
    });

    it('should create session with metadata', () => {
      const metadata = { user: 'test', project: 'demo' };
      const session = store.createSession(metadata);

      expect(session.metadata).toEqual(metadata);
    });

    it('should get session by ID', () => {
      const session = store.createSession();
      const retrieved = store.getSession(session.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(session.id);
    });

    it('should end a session', () => {
      const session = store.createSession();
      const ended = store.endSession(session.id);

      expect(ended).toBe(true);

      const retrieved = store.getSession(session.id);
      expect(retrieved?.status).toBe('ended');
      expect(retrieved?.endedAt).toBeInstanceOf(Date);
    });

    it('should get active session', () => {
      const session1 = store.createSession({ name: 'session1' });
      const session2 = store.createSession({ name: 'session2' });

      const active = store.getActiveSession();
      expect(active).not.toBeNull();
      expect(active?.status).toBe('active');
      // Should return one of the active sessions (order may vary due to same-millisecond timestamps)
      expect([session1.id, session2.id]).toContain(active?.id);
    });

    it('should return null when no active session', () => {
      const session = store.createSession();
      store.endSession(session.id);

      const active = store.getActiveSession();
      expect(active).toBeNull();
    });
  });

  describe('Task Operations', () => {
    it('should create a task', () => {
      const task = store.createTask('coder', 'implement feature');

      expect(task.id).toBeDefined();
      expect(task.agentType).toBe('coder');
      expect(task.status).toBe('pending');
      expect(task.input).toBe('implement feature');
    });

    it('should create task with session ID', () => {
      const session = store.createSession();
      const task = store.createTask('tester', 'write tests', session.id);

      expect(task.sessionId).toBe(session.id);
    });

    it('should get task by ID', () => {
      const task = store.createTask('researcher', 'research topic');
      const retrieved = store.getTask(task.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.agentType).toBe('researcher');
    });

    it('should update task status', () => {
      const task = store.createTask('coder', 'task');

      store.updateTaskStatus(task.id, 'running');
      let updated = store.getTask(task.id);
      expect(updated?.status).toBe('running');

      store.updateTaskStatus(task.id, 'completed', 'done successfully');
      updated = store.getTask(task.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.output).toBe('done successfully');
      expect(updated?.completedAt).toBeInstanceOf(Date);
    });

    it('should list tasks', () => {
      store.createTask('coder', 'task 1');
      store.createTask('tester', 'task 2');
      store.createTask('reviewer', 'task 3');

      const tasks = store.listTasks();
      expect(tasks.length).toBe(3);
    });

    it('should list tasks by session', () => {
      const session1 = store.createSession();
      const session2 = store.createSession();

      store.createTask('coder', 't1', session1.id);
      store.createTask('coder', 't2', session1.id);
      store.createTask('coder', 't3', session2.id);

      const s1Tasks = store.listTasks(session1.id);
      expect(s1Tasks.length).toBe(2);

      const s2Tasks = store.listTasks(session2.id);
      expect(s2Tasks.length).toBe(1);
    });

    it('should list tasks by status', () => {
      const task1 = store.createTask('coder', 't1');
      store.createTask('coder', 't2');
      store.createTask('coder', 't3');

      store.updateTaskStatus(task1.id, 'completed');

      const pending = store.listTasks(undefined, 'pending');
      expect(pending.length).toBe(2);

      const completed = store.listTasks(undefined, 'completed');
      expect(completed.length).toBe(1);
    });

    it('should delete a task', () => {
      const task = store.createTask('coder', 'task to delete');

      const deleted = store.deleteTask(task.id);

      expect(deleted).toBe(true);
      expect(store.getTask(task.id)).toBeNull();
    });

    it('should return false when deleting non-existent task', () => {
      const deleted = store.deleteTask('non-existent-task-id');
      expect(deleted).toBe(false);
    });

    it('should not affect other tasks when deleting one', () => {
      const task1 = store.createTask('coder', 'task 1');
      const task2 = store.createTask('coder', 'task 2');

      store.deleteTask(task1.id);

      expect(store.getTask(task1.id)).toBeNull();
      expect(store.getTask(task2.id)).not.toBeNull();
    });
  });

  describe('Database Maintenance', () => {
    it('should vacuum database', () => {
      store.store('key1', 'content1');
      store.delete('key1');

      // Should not throw
      expect(() => store.vacuum()).not.toThrow();
    });

    it('should get database instance', () => {
      const db = store.getDatabase();
      expect(db).toBeDefined();
    });

    it('should execute transactions', () => {
      const result = store.transaction((db) => {
        db.prepare('INSERT INTO memory (id, key, namespace, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run('tx-id', 'tx-key', 'default', 'tx-content', Date.now(), Date.now());
        return 'success';
      });
      expect(result).toBe('success');
      expect(store.get('tx-key')).not.toBeNull();
    });
  });

  describe('Namespace Operations', () => {
    it('should delete all entries by namespace', () => {
      store.store('ns-del-1', 'content 1', { namespace: 'to-delete' });
      store.store('ns-del-2', 'content 2', { namespace: 'to-delete' });
      store.store('ns-keep', 'content 3', { namespace: 'keep' });

      const deleted = store.deleteByNamespace('to-delete');

      expect(deleted).toBe(2);
      expect(store.get('ns-del-1', 'to-delete')).toBeNull();
      expect(store.get('ns-del-2', 'to-delete')).toBeNull();
      expect(store.get('ns-keep', 'keep')).not.toBeNull();
    });

    it('should return 0 when namespace is empty', () => {
      const deleted = store.deleteByNamespace('non-existent-namespace');
      expect(deleted).toBe(0);
    });

    it('should throw when namespace is empty string', () => {
      expect(() => store.deleteByNamespace('')).toThrow('Namespace is required');
    });
  });

  describe('Tag Operations', () => {
    it('should add and get tags for an entry', () => {
      const entry = store.store('tag-key', 'content');
      store.addTag(entry.id, 'important');
      store.addTag(entry.id, 'work');

      const tags = store.getEntryTags(entry.id);
      expect(tags).toContain('important');
      expect(tags).toContain('work');
    });

    it('should normalize tag names to lowercase', () => {
      const entry = store.store('tag-key2', 'content');
      store.addTag(entry.id, 'UPPERCASE');

      const tags = store.getEntryTags(entry.id);
      expect(tags).toContain('uppercase');
    });

    it('should throw on invalid tag names', () => {
      const entry = store.store('tag-key3', 'content');
      expect(() => store.addTag(entry.id, '')).toThrow('empty');
      expect(() => store.addTag(entry.id, 'a'.repeat(51))).toThrow('50 characters');
      expect(() => store.addTag(entry.id, 'invalid tag!')).toThrow('lowercase letters');
    });

    it('should throw when adding tag to non-existent entry', () => {
      expect(() => store.addTag('non-existent-id', 'tag')).toThrow('not found');
    });

    it('should remove tags', () => {
      const entry = store.store('tag-remove', 'content');
      store.addTag(entry.id, 'to-remove');

      const removed = store.removeTag(entry.id, 'to-remove');
      expect(removed).toBe(true);
      expect(store.getEntryTags(entry.id)).not.toContain('to-remove');
    });

    it('should return false when removing non-existent tag', () => {
      const entry = store.store('tag-remove2', 'content');
      const removed = store.removeTag(entry.id, 'non-existent');
      expect(removed).toBe(false);
    });

    it('should get all tags with counts', () => {
      const entry1 = store.store('all-tags-1', 'content1');
      const entry2 = store.store('all-tags-2', 'content2');
      store.addTag(entry1.id, 'shared-tag');
      store.addTag(entry2.id, 'shared-tag');
      store.addTag(entry1.id, 'unique-tag');

      const allTags = store.getAllTags();
      const sharedTag = allTags.find(t => t.name === 'shared-tag');
      expect(sharedTag?.count).toBe(2);
    });

    it('should search by tags', () => {
      const entry1 = store.store('search-tag-1', 'content1');
      const entry2 = store.store('search-tag-2', 'content2');
      store.addTag(entry1.id, 'alpha');
      store.addTag(entry1.id, 'beta');
      store.addTag(entry2.id, 'alpha');

      const results = store.searchByTags(['alpha', 'beta']);
      expect(results.length).toBe(1);
      expect(results[0].key).toBe('search-tag-1');
    });

    it('should return empty array for empty tags search', () => {
      const results = store.searchByTags([]);
      expect(results).toEqual([]);
    });
  });

  describe('Relationship Operations', () => {
    it('should create and get relationships', () => {
      const entry1 = store.store('rel-from', 'content1');
      const entry2 = store.store('rel-to', 'content2');

      const relId = store.createRelationship(entry1.id, entry2.id, 'related_to');
      expect(relId).toBeDefined();

      const relationships = store.getRelationships(entry1.id, 'outgoing');
      expect(relationships.length).toBe(1);
      expect(relationships[0].toId).toBe(entry2.id);
    });

    it('should create relationship with metadata', () => {
      const entry1 = store.store('rel-meta-from', 'content1');
      const entry2 = store.store('rel-meta-to', 'content2');

      store.createRelationship(entry1.id, entry2.id, 'references', { note: 'test' });

      const relationships = store.getRelationships(entry1.id);
      expect(relationships[0].metadata).toEqual({ note: 'test' });
    });

    it('should throw on invalid relationship type', () => {
      const entry1 = store.store('rel-invalid-from', 'content1');
      const entry2 = store.store('rel-invalid-to', 'content2');

      expect(() => store.createRelationship(entry1.id, entry2.id, 'invalid_type')).toThrow('Invalid relationship type');
    });

    it('should throw when creating self-relationship', () => {
      const entry = store.store('self-rel', 'content');
      expect(() => store.createRelationship(entry.id, entry.id, 'related_to')).toThrow('Cannot create relationship to self');
    });

    it('should throw when entry not found', () => {
      const entry = store.store('rel-exists', 'content');
      expect(() => store.createRelationship('non-existent', entry.id, 'related_to')).toThrow('Source entry not found');
      expect(() => store.createRelationship(entry.id, 'non-existent', 'related_to')).toThrow('Target entry not found');
    });

    it('should get relationships in different directions', () => {
      const entry1 = store.store('dir-1', 'c1');
      const entry2 = store.store('dir-2', 'c2');
      store.createRelationship(entry1.id, entry2.id, 'depends_on');

      expect(store.getRelationships(entry1.id, 'outgoing').length).toBe(1);
      expect(store.getRelationships(entry2.id, 'incoming').length).toBe(1);
      expect(store.getRelationships(entry1.id, 'both').length).toBe(1);
    });

    it('should get related entries', () => {
      const entry1 = store.store('related-1', 'c1');
      const entry2 = store.store('related-2', 'c2');
      store.createRelationship(entry1.id, entry2.id, 'derived_from');

      const related = store.getRelatedEntries(entry1.id);
      expect(related.length).toBe(1);
      expect(related[0].entry.key).toBe('related-2');
      expect(related[0].relationship.direction).toBe('outgoing');
    });

    it('should delete relationship', () => {
      const entry1 = store.store('del-rel-1', 'c1');
      const entry2 = store.store('del-rel-2', 'c2');
      const relId = store.createRelationship(entry1.id, entry2.id, 'related_to');

      const deleted = store.deleteRelationship(relId);
      expect(deleted).toBe(true);
      expect(store.getRelationships(entry1.id).length).toBe(0);
    });

    it('should delete all relationships for entry', () => {
      const entry1 = store.store('del-all-1', 'c1');
      const entry2 = store.store('del-all-2', 'c2');
      const entry3 = store.store('del-all-3', 'c3');
      store.createRelationship(entry1.id, entry2.id, 'related_to');
      store.createRelationship(entry1.id, entry3.id, 'references');

      const count = store.deleteAllRelationships(entry1.id);
      expect(count).toBe(2);
    });
  });

  describe('Version Operations', () => {
    it('should save versions when updating', () => {
      store.store('version-key', 'v1 content');
      store.store('version-key', 'v2 content');
      store.store('version-key', 'v3 content');

      const entry = store.get('version-key');
      const history = store.getVersionHistory(entry!.id);
      expect(history.length).toBe(2); // Versions created on updates
    });

    it('should get specific version', () => {
      store.store('ver-get', 'original');
      store.store('ver-get', 'updated');

      const entry = store.get('ver-get');
      const version = store.getVersion(entry!.id, 1);
      expect(version?.content).toBe('original');
    });

    it('should get current version number', () => {
      store.store('ver-num', 'v1');
      store.store('ver-num', 'v2');

      const entry = store.get('ver-num');
      const currentVersion = store.getCurrentVersion(entry!.id);
      expect(currentVersion).toBe(1);
    });

    it('should restore version', () => {
      store.store('ver-restore', 'original content');
      store.store('ver-restore', 'changed content');

      const entry = store.get('ver-restore');
      const restored = store.restoreVersion(entry!.id, 1);
      expect(restored).toBe(true);

      const restoredEntry = store.get('ver-restore');
      expect(restoredEntry?.content).toBe('original content');
    });
  });

  describe('Session Operations - Extended', () => {
    it('should list sessions with status filter', () => {
      const session1 = store.createSession();
      store.createSession();
      store.endSession(session1.id);

      const activeSessions = store.listSessions('active');
      const endedSessions = store.listSessions('ended');

      expect(activeSessions.length).toBe(1);
      expect(endedSessions.length).toBe(1);
    });

    it('should list sessions with pagination', () => {
      for (let i = 0; i < 5; i++) {
        store.createSession({ index: i });
      }

      const page1 = store.listSessions(undefined, 2, 0);
      const page2 = store.listSessions(undefined, 2, 2);

      expect(page1.length).toBe(2);
      expect(page2.length).toBe(2);
    });
  });

  describe('Project Operations', () => {
    it('should create and get project', () => {
      const project = store.createProject('Test Project', '/path/to/project', 'A test project');

      expect(project.name).toBe('Test Project');
      expect(project.path).toBe('/path/to/project');
      expect(project.description).toBe('A test project');
      expect(project.status).toBe('active');

      const retrieved = store.getProject(project.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Test Project');
    });

    it('should create project with metadata', () => {
      const project = store.createProject('Meta Project', '/path', undefined, { key: 'value' });
      expect(project.metadata).toEqual({ key: 'value' });
    });

    it('should update project', () => {
      const project = store.createProject('Original', '/path');

      const updated = store.updateProject(project.id, {
        name: 'Updated',
        description: 'New description',
        status: 'archived',
        metadata: { updated: true },
      });

      expect(updated).toBe(true);
      const retrieved = store.getProject(project.id);
      expect(retrieved?.name).toBe('Updated');
      expect(retrieved?.description).toBe('New description');
      expect(retrieved?.status).toBe('archived');
    });

    it('should return false when updating non-existent project', () => {
      const result = store.updateProject('non-existent', { name: 'test' });
      expect(result).toBe(false);
    });

    it('should list projects', () => {
      store.createProject('Project 1', '/path1');
      store.createProject('Project 2', '/path2');

      const projects = store.listProjects();
      expect(projects.length).toBe(2);
    });

    it('should list projects by status', () => {
      const p1 = store.createProject('Active', '/path1');
      store.createProject('Also Active', '/path2');
      store.updateProject(p1.id, { status: 'archived' });

      const activeProjects = store.listProjects('active');
      expect(activeProjects.length).toBe(1);
    });

    it('should delete project', () => {
      const project = store.createProject('To Delete', '/path');
      const deleted = store.deleteProject(project.id);

      expect(deleted).toBe(true);
      expect(store.getProject(project.id)).toBeNull();
    });
  });

  describe('Project Task Operations', () => {
    it('should create and get project task', () => {
      const project = store.createProject('Task Project', '/path');
      const task = store.createProjectTask(project.id, 'Test Task', {
        description: 'Task description',
        priority: 1,
        assignedAgents: ['agent-1'],
      });

      expect(task.title).toBe('Test Task');
      expect(task.phase).toBe('draft');
      expect(task.priority).toBe(1);
      expect(task.assignedAgents).toContain('agent-1');

      const retrieved = store.getProjectTask(task.id);
      expect(retrieved).not.toBeNull();
    });

    it('should update project task', () => {
      const project = store.createProject('Update Task Project', '/path');
      const task = store.createProjectTask(project.id, 'Original Title');

      const updated = store.updateProjectTask(task.id, {
        title: 'Updated Title',
        description: 'New desc',
        priority: 2,
        assignedAgents: ['new-agent'],
      });

      expect(updated).toBe(true);
      const retrieved = store.getProjectTask(task.id);
      expect(retrieved?.title).toBe('Updated Title');
    });

    it('should update project task phase', () => {
      const project = store.createProject('Phase Project', '/path');
      const task = store.createProjectTask(project.id, 'Phase Task');

      store.updateProjectTaskPhase(task.id, 'in_progress');
      expect(store.getProjectTask(task.id)?.phase).toBe('in_progress');

      store.updateProjectTaskPhase(task.id, 'completed');
      const completed = store.getProjectTask(task.id);
      expect(completed?.phase).toBe('completed');
      expect(completed?.completedAt).toBeDefined();
    });

    it('should list project tasks', () => {
      const project = store.createProject('List Tasks Project', '/path');
      store.createProjectTask(project.id, 'Task 1');
      store.createProjectTask(project.id, 'Task 2');

      const tasks = store.listProjectTasks(project.id);
      expect(tasks.length).toBe(2);
    });

    it('should list project tasks by phase', () => {
      const project = store.createProject('Phase Filter Project', '/path');
      const task1 = store.createProjectTask(project.id, 'Task 1');
      store.createProjectTask(project.id, 'Task 2');
      store.updateProjectTaskPhase(task1.id, 'completed');

      const draftTasks = store.listProjectTasks(project.id, 'draft');
      expect(draftTasks.length).toBe(1);
    });

    it('should delete project task', () => {
      const project = store.createProject('Delete Task Project', '/path');
      const task = store.createProjectTask(project.id, 'To Delete');

      const deleted = store.deleteProjectTask(task.id);
      expect(deleted).toBe(true);
      expect(store.getProjectTask(task.id)).toBeNull();
    });
  });

  describe('Specification Operations', () => {
    it('should create and get specification', () => {
      const project = store.createProject('Spec Project', '/path');
      const task = store.createProjectTask(project.id, 'Spec Task');
      const spec = store.createSpecification(task.id, 'functional', 'Test Spec', 'Spec content', 'agent-1');

      expect(spec.type).toBe('functional');
      expect(spec.title).toBe('Test Spec');
      expect(spec.status).toBe('draft');
      expect(spec.version).toBe(1);

      const retrieved = store.getSpecification(spec.id);
      expect(retrieved).not.toBeNull();
    });

    it('should update specification', () => {
      const project = store.createProject('Update Spec Project', '/path');
      const task = store.createProjectTask(project.id, 'Update Spec Task');
      const spec = store.createSpecification(task.id, 'technical', 'Original', 'Content', 'agent-1');

      const updated = store.updateSpecification(spec.id, {
        title: 'Updated',
        content: 'New content',
        type: 'functional',
      });

      expect(updated).toBe(true);
      const retrieved = store.getSpecification(spec.id);
      expect(retrieved?.title).toBe('Updated');
      expect(retrieved?.version).toBe(2);
    });

    it('should update specification status', () => {
      const project = store.createProject('Status Spec Project', '/path');
      const task = store.createProjectTask(project.id, 'Status Spec Task');
      const spec = store.createSpecification(task.id, 'functional', 'Status Test', 'Content', 'agent-1');

      store.updateSpecificationStatus(spec.id, 'approved', 'reviewer-1', [{ author: 'reviewer', content: 'LGTM' }]);

      const retrieved = store.getSpecification(spec.id);
      expect(retrieved?.status).toBe('approved');
      expect(retrieved?.reviewedBy).toBe('reviewer-1');
      expect(retrieved?.approvedAt).toBeDefined();
    });

    it('should list specifications', () => {
      const project = store.createProject('List Spec Project', '/path');
      const task = store.createProjectTask(project.id, 'List Spec Task');
      store.createSpecification(task.id, 'functional', 'Spec 1', 'Content', 'agent-1');
      store.createSpecification(task.id, 'technical', 'Spec 2', 'Content', 'agent-1');

      const specs = store.listSpecifications(task.id);
      expect(specs.length).toBe(2);
    });

    it('should delete specification', () => {
      const project = store.createProject('Delete Spec Project', '/path');
      const task = store.createProjectTask(project.id, 'Delete Spec Task');
      const spec = store.createSpecification(task.id, 'functional', 'To Delete', 'Content', 'agent-1');

      const deleted = store.deleteSpecification(spec.id);
      expect(deleted).toBe(true);
      expect(store.getSpecification(spec.id)).toBeNull();
    });
  });

  describe('Active Agent Operations', () => {
    it('should save and load active agents', () => {
      const agent = {
        id: 'agent-1',
        type: 'coder',
        name: 'test-agent',
        status: 'idle' as const,
        createdAt: new Date(),
        metadata: { key: 'value' },
      };

      store.saveActiveAgent(agent);
      const loaded = store.loadActiveAgents();

      expect(loaded.length).toBe(1);
      expect(loaded[0].name).toBe('test-agent');
    });

    it('should update existing agent', () => {
      const agent = {
        id: 'agent-update',
        type: 'coder',
        name: 'update-agent',
        status: 'idle' as const,
        createdAt: new Date(),
      };

      store.saveActiveAgent(agent);
      store.saveActiveAgent({ ...agent, status: 'running' as const });

      const loaded = store.loadActiveAgents();
      expect(loaded.find(a => a.id === 'agent-update')?.status).toBe('running');
    });

    it('should delete active agent', () => {
      const agent = {
        id: 'agent-delete',
        type: 'coder',
        name: 'delete-agent',
        status: 'idle' as const,
        createdAt: new Date(),
      };

      store.saveActiveAgent(agent);
      const deleted = store.deleteActiveAgent('agent-delete');
      expect(deleted).toBe(true);
    });

    it('should update agent status', () => {
      const agent = {
        id: 'agent-status',
        type: 'coder',
        name: 'status-agent',
        status: 'idle' as const,
        createdAt: new Date(),
      };

      store.saveActiveAgent(agent);
      store.updateAgentStatus('agent-status', 'running');

      const loaded = store.loadActiveAgents();
      expect(loaded.find(a => a.id === 'agent-status')?.status).toBe('running');
    });

    it('should clear inactive agents', () => {
      store.saveActiveAgent({ id: 'agent-active', type: 'coder', name: 'active', status: 'idle' as const, createdAt: new Date() });
      store.saveActiveAgent({ id: 'agent-completed', type: 'coder', name: 'completed', status: 'completed' as const, createdAt: new Date() });

      store.clearInactiveAgents();

      const loaded = store.loadActiveAgents();
      expect(loaded.find(a => a.id === 'agent-completed')).toBeUndefined();
      expect(loaded.find(a => a.id === 'agent-active')).toBeDefined();
    });
  });

  describe('Review Loop Operations', () => {
    it('should save and load review loop', () => {
      const state = {
        id: 'loop-1',
        coderId: 'coder-1',
        adversarialId: 'adversarial-1',
        status: 'pending' as const,
        iteration: 0,
        maxIterations: 3,
        codeInput: 'code',
        reviews: [],
        startedAt: new Date(),
      };

      store.saveReviewLoop('loop-1', state);
      const loaded = store.loadReviewLoop('loop-1');

      expect(loaded).not.toBeNull();
      expect(loaded?.coderId).toBe('coder-1');
    });

    it('should update existing review loop', () => {
      const state = {
        id: 'loop-update',
        coderId: 'coder-1',
        adversarialId: 'adversarial-1',
        status: 'pending' as const,
        iteration: 0,
        maxIterations: 3,
        codeInput: 'code',
        reviews: [],
        startedAt: new Date(),
      };

      store.saveReviewLoop('loop-update', state);
      store.saveReviewLoop('loop-update', { ...state, iteration: 1 });

      const loaded = store.loadReviewLoop('loop-update');
      expect(loaded?.iteration).toBe(1);
    });

    it('should load active review loops', () => {
      store.saveReviewLoop('active-loop', {
        id: 'active-loop',
        coderId: 'coder',
        adversarialId: 'adversarial',
        status: 'coding' as const,
        iteration: 0,
        maxIterations: 3,
        codeInput: 'code',
        reviews: [],
        startedAt: new Date(),
      });

      const active = store.loadActiveReviewLoops();
      expect(active.length).toBeGreaterThanOrEqual(1);
    });

    it('should delete review loop', () => {
      store.saveReviewLoop('delete-loop', {
        id: 'delete-loop',
        coderId: 'coder',
        adversarialId: 'adversarial',
        status: 'pending' as const,
        iteration: 0,
        maxIterations: 3,
        codeInput: 'code',
        reviews: [],
        startedAt: new Date(),
      });

      const deleted = store.deleteReviewLoop('delete-loop');
      expect(deleted).toBe(true);
      expect(store.loadReviewLoop('delete-loop')).toBeNull();
    });

    it('should clear completed review loops', () => {
      store.saveReviewLoop('completed-loop', {
        id: 'completed-loop',
        coderId: 'coder',
        adversarialId: 'adversarial',
        status: 'approved' as const,
        iteration: 3,
        maxIterations: 3,
        codeInput: 'code',
        reviews: [],
        startedAt: new Date(),
      });

      store.clearCompletedReviewLoops();
      expect(store.loadReviewLoop('completed-loop')).toBeNull();
    });
  });

  describe('Agent Identity Operations', () => {
    it('should create and get agent identity', () => {
      const identity = store.createAgentIdentity({
        agentId: 'identity-1',
        agentType: 'coder',
        displayName: 'Test Agent',
        description: 'A test agent',
        capabilities: [{ name: 'code', level: 'expert' }],
      });

      expect(identity.displayName).toBe('Test Agent');
      expect(identity.status).toBe('created');

      const retrieved = store.getAgentIdentity('identity-1');
      expect(retrieved).not.toBeNull();
    });

    it('should get agent identity by name', () => {
      store.createAgentIdentity({
        agentId: 'identity-byname',
        agentType: 'coder',
        displayName: 'Unique Name',
      });

      const identity = store.getAgentIdentityByName('Unique Name');
      expect(identity?.agentId).toBe('identity-byname');
    });

    it('should update agent identity', () => {
      store.createAgentIdentity({
        agentId: 'identity-update',
        agentType: 'coder',
      });

      const updated = store.updateAgentIdentity('identity-update', {
        displayName: 'Updated Name',
        status: 'active',
        lastActiveAt: new Date(),
      });

      expect(updated).toBe(true);
      const identity = store.getAgentIdentity('identity-update');
      expect(identity?.displayName).toBe('Updated Name');
      expect(identity?.status).toBe('active');
    });

    it('should list agent identities', () => {
      store.createAgentIdentity({ agentId: 'list-id-1', agentType: 'coder', status: 'active' });
      store.createAgentIdentity({ agentId: 'list-id-2', agentType: 'tester', status: 'dormant' });

      const all = store.listAgentIdentities();
      expect(all.length).toBeGreaterThanOrEqual(2);

      const coders = store.listAgentIdentities({ agentType: 'coder' });
      expect(coders.some(i => i.agentId === 'list-id-1')).toBe(true);
    });

    it('should create and get audit history', () => {
      store.createAgentIdentity({ agentId: 'audit-agent', agentType: 'coder' });
      store.createAgentIdentityAudit({
        id: 'audit-1',
        agentId: 'audit-agent',
        action: 'activated',
        previousStatus: 'created',
        newStatus: 'active',
        reason: 'Test activation',
      });

      const history = store.getAgentIdentityAuditHistory('audit-agent');
      expect(history.length).toBe(1);
      expect(history[0].action).toBe('activated');
    });
  });

  describe('Resource Metrics Operations', () => {
    it('should save and get agent resource metrics', () => {
      const metrics = {
        agentId: 'metrics-agent',
        filesRead: 10,
        filesWritten: 5,
        filesModified: 3,
        apiCallsCount: 100,
        subtasksSpawned: 2,
        tokensConsumed: 5000,
        startedAt: new Date(),
        lastActivityAt: new Date(),
        phase: 'normal' as const,
        lastDeliverableAt: null,
        pausedAt: null,
        pauseReason: null,
      };

      store.saveAgentResourceMetrics(metrics);
      const retrieved = store.getAgentResourceMetrics('metrics-agent');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.filesRead).toBe(10);
    });

    it('should update existing metrics', () => {
      const metrics = {
        agentId: 'metrics-update',
        filesRead: 5,
        filesWritten: 0,
        filesModified: 0,
        apiCallsCount: 10,
        subtasksSpawned: 0,
        tokensConsumed: 1000,
        startedAt: new Date(),
        lastActivityAt: new Date(),
        phase: 'normal' as const,
        lastDeliverableAt: null,
        pausedAt: null,
        pauseReason: null,
      };

      store.saveAgentResourceMetrics(metrics);
      store.saveAgentResourceMetrics({ ...metrics, filesRead: 15 });

      const retrieved = store.getAgentResourceMetrics('metrics-update');
      expect(retrieved?.filesRead).toBe(15);
    });

    it('should list agent resource metrics', () => {
      store.saveAgentResourceMetrics({
        agentId: 'list-metrics-1',
        filesRead: 0, filesWritten: 0, filesModified: 0,
        apiCallsCount: 0, subtasksSpawned: 0, tokensConsumed: 0,
        startedAt: new Date(), lastActivityAt: new Date(),
        phase: 'warning' as const,
        lastDeliverableAt: null, pausedAt: null, pauseReason: null,
      });

      const warningPhase = store.listAgentResourceMetrics('warning');
      expect(warningPhase.some(m => m.agentId === 'list-metrics-1')).toBe(true);
    });

    it('should delete agent resource metrics', () => {
      store.saveAgentResourceMetrics({
        agentId: 'delete-metrics',
        filesRead: 0, filesWritten: 0, filesModified: 0,
        apiCallsCount: 0, subtasksSpawned: 0, tokensConsumed: 0,
        startedAt: new Date(), lastActivityAt: new Date(),
        phase: 'normal' as const,
        lastDeliverableAt: null, pausedAt: null, pauseReason: null,
      });

      const deleted = store.deleteAgentResourceMetrics('delete-metrics');
      expect(deleted).toBe(true);
    });
  });

  describe('Deliverable Checkpoint Operations', () => {
    it('should create and get deliverable checkpoints', () => {
      const checkpoint = store.createDeliverableCheckpoint({
        id: 'checkpoint-1',
        agentId: 'agent-1',
        type: 'code',
        description: 'Initial code',
        artifacts: ['file1.ts', 'file2.ts'],
      });

      expect(checkpoint.type).toBe('code');

      const checkpoints = store.getDeliverableCheckpoints('agent-1');
      expect(checkpoints.length).toBe(1);
    });

    it('should get last deliverable checkpoint', () => {
      store.createDeliverableCheckpoint({ id: 'cp-1', agentId: 'agent-last', type: 'code' });
      store.createDeliverableCheckpoint({ id: 'cp-2', agentId: 'agent-last', type: 'test' });

      const last = store.getLastDeliverableCheckpoint('agent-last');
      // The most recent checkpoint should be returned (either cp-1 or cp-2 depending on timestamp)
      expect(['cp-1', 'cp-2']).toContain(last?.id);
    });

    it('should delete deliverable checkpoints', () => {
      store.createDeliverableCheckpoint({ id: 'cp-del', agentId: 'agent-del', type: 'code' });

      const deleted = store.deleteDeliverableCheckpoints('agent-del');
      expect(deleted).toBe(1);
    });
  });

  describe('Resource Exhaustion Events', () => {
    it('should save and get resource exhaustion events', () => {
      const metrics = {
        agentId: 'exhaust-agent',
        filesRead: 100, filesWritten: 50, filesModified: 25,
        apiCallsCount: 1000, subtasksSpawned: 10, tokensConsumed: 50000,
        startedAt: new Date(), lastActivityAt: new Date(),
        phase: 'warning' as const,
        lastDeliverableAt: null, pausedAt: null, pauseReason: null,
      };

      store.saveResourceExhaustionEvent({
        id: 'exhaust-event-1',
        agentId: 'exhaust-agent',
        agentType: 'coder',
        phase: 'warning',
        actionTaken: 'warned',
        metrics,
        thresholds: { maxFilesRead: 100, maxApiCalls: 1000 },
        triggeredBy: 'maxFilesRead',
        createdAt: new Date(),
      });

      const events = store.getResourceExhaustionEvents({ agentId: 'exhaust-agent' });
      expect(events.length).toBe(1);
    });

    it('should get resource exhaustion metrics', () => {
      const metrics = {
        agentId: 'metrics-agent',
        filesRead: 0, filesWritten: 0, filesModified: 0,
        apiCallsCount: 0, subtasksSpawned: 0, tokensConsumed: 0,
        startedAt: new Date(), lastActivityAt: new Date(),
        phase: 'normal' as const,
        lastDeliverableAt: null, pausedAt: null, pauseReason: null,
      };

      store.saveResourceExhaustionEvent({
        id: 'exhaust-metrics-1',
        agentId: 'agent-a',
        agentType: 'coder',
        phase: 'warning',
        actionTaken: 'warned',
        metrics,
        thresholds: {},
        triggeredBy: 'maxApiCalls',
        createdAt: new Date(),
      });

      const exhaustMetrics = store.getResourceExhaustionMetrics();
      expect(exhaustMetrics.totalEvents).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Consensus Checkpoint Operations', () => {
    it('should create and get consensus checkpoint', () => {
      const task = store.createTask('coder', 'task for consensus');
      const checkpoint = store.createConsensusCheckpoint({
        id: 'consensus-1',
        taskId: task.id,
        proposedSubtasks: [{ description: 'subtask 1', riskLevel: 'low' }],
        riskLevel: 'medium',
        reviewerStrategy: 'adversarial',
        timeout: 60000,
      });

      expect(checkpoint.status).toBe('pending');
      expect(checkpoint.riskLevel).toBe('medium');

      const retrieved = store.getConsensusCheckpoint('consensus-1');
      expect(retrieved).not.toBeNull();
    });

    it('should get consensus checkpoint by task id', () => {
      const task = store.createTask('coder', 'task for consensus by id');
      store.createConsensusCheckpoint({
        id: 'consensus-bytask',
        taskId: task.id,
        proposedSubtasks: [],
        riskLevel: 'low',
        reviewerStrategy: 'adversarial',
        timeout: 60000,
      });

      const checkpoint = store.getConsensusCheckpointByTaskId(task.id);
      expect(checkpoint?.id).toBe('consensus-bytask');
    });

    it('should update consensus checkpoint status', () => {
      const task = store.createTask('coder', 'task for status update');
      store.createConsensusCheckpoint({
        id: 'consensus-status',
        taskId: task.id,
        proposedSubtasks: [],
        riskLevel: 'low',
        reviewerStrategy: 'adversarial',
        timeout: 60000,
      });

      const updated = store.updateConsensusCheckpointStatus('consensus-status', 'approved', {
        approved: true,
        reviewedBy: 'reviewer-1',
        reviewerType: 'agent',
        feedback: 'Looks good',
      });

      expect(updated).toBe(true);
      const checkpoint = store.getConsensusCheckpoint('consensus-status');
      expect(checkpoint?.status).toBe('approved');
    });

    it('should list pending checkpoints', () => {
      const task = store.createTask('coder', 'pending task');
      store.createConsensusCheckpoint({
        id: 'pending-checkpoint',
        taskId: task.id,
        proposedSubtasks: [],
        riskLevel: 'low',
        reviewerStrategy: 'adversarial',
        timeout: 60000,
      });

      const pending = store.listPendingCheckpoints();
      expect(pending.some(c => c.id === 'pending-checkpoint')).toBe(true);
    });

    it('should count pending checkpoints', () => {
      const count = store.countPendingCheckpoints();
      expect(typeof count).toBe('number');
    });

    it('should expire old checkpoints', () => {
      const task = store.createTask('coder', 'expire task');
      store.createConsensusCheckpoint({
        id: 'expire-checkpoint',
        taskId: task.id,
        proposedSubtasks: [],
        riskLevel: 'low',
        reviewerStrategy: 'adversarial',
        timeout: -1000, // Already expired
      });

      const expired = store.expireOldCheckpoints();
      expect(expired).toBeGreaterThanOrEqual(1);
    });

    it('should get checkpoint events', () => {
      const task = store.createTask('coder', 'events task');
      store.createConsensusCheckpoint({
        id: 'events-checkpoint',
        taskId: task.id,
        proposedSubtasks: [],
        riskLevel: 'low',
        reviewerStrategy: 'adversarial',
        timeout: 60000,
      });

      const events = store.getConsensusCheckpointEvents('events-checkpoint');
      expect(events.length).toBeGreaterThanOrEqual(1); // At least 'created' event
    });
  });

  describe('Memory with Agent Filtering', () => {
    it('should store with agent ID', () => {
      const entry = store.store('agent-key', 'content', { agentId: 'agent-123' });
      expect(entry).toBeDefined();
    });

    it('should list with agent filter', () => {
      store.store('agent-filter-1', 'c1', { agentId: 'filter-agent', namespace: 'agent-ns' });
      store.store('agent-filter-2', 'c2', { namespace: 'agent-ns' }); // No agent ID (shared)

      const agentOnly = store.list('agent-ns', 100, 0, { agentId: 'filter-agent', includeShared: false });
      const withShared = store.list('agent-ns', 100, 0, { agentId: 'filter-agent', includeShared: true });

      expect(agentOnly.length).toBe(1);
      expect(withShared.length).toBe(2);
    });

    it('should get embeddings with agent filter', () => {
      const entry = store.store('embed-agent', 'content', { agentId: 'embed-agent-id' });
      store.storeEmbedding(entry.id, [0.1, 0.2, 0.3]);

      const embeddings = store.getEntriesWithEmbeddings(undefined, { agentId: 'embed-agent-id' });
      expect(embeddings.length).toBeGreaterThanOrEqual(1);
    });
  });

});

describe('SQLiteStore directory creation', () => {
  it('should create parent directory if it does not exist', () => {
    const nestedDir = join(tmpdir(), `aistack-nested-${Date.now()}`, 'level1', 'level2');
    const nestedPath = join(nestedDir, 'test.db');

    // Directory should not exist
    expect(existsSync(nestedDir)).toBe(false);

    const nestedStore = new SQLiteStore(nestedPath);

    // Store should be created and directory should exist now
    expect(existsSync(nestedDir)).toBe(true);

    nestedStore.close();

    // Clean up
    rmSync(join(tmpdir(), `aistack-nested-${Date.now().toString().slice(0, -3)}`), {
      recursive: true,
      force: true,
    });
  });
});
