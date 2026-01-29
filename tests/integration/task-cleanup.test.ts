/**
 * Task Cleanup Integration Tests
 *
 * Tests for GitHub Issue #14: Verify embedding cleanup on task deletion
 *
 * Tests verify:
 * - CASCADE deletion of task_embeddings when a task is deleted
 * - CASCADE deletion of task_relationships when either from_task or to_task is deleted
 * - Intentional persistence of drift_detection_events after task deletion (for metrics)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SQLiteStore } from '../../src/memory/sqlite-store.js';
import { setupTestEnv, cleanupTestEnv, TEST_DB_PATH } from './setup.js';

describe('Task Cleanup Integration', () => {
  let store: SQLiteStore;

  beforeEach(() => {
    setupTestEnv();
    store = new SQLiteStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
    cleanupTestEnv();
  });

  describe('Task Embeddings CASCADE Delete', () => {
    it('should CASCADE delete task_embeddings when task is deleted', () => {
      // Create a task
      const task = store.createTask('coder', 'implement feature');

      // Store an embedding for the task (simulate drift detection indexing)
      const db = store.getDatabase();
      const embedding = Buffer.from(new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]).buffer);
      db.prepare(`
        INSERT INTO task_embeddings (task_id, embedding, model, dimensions, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(task.id, embedding, 'test-model', 5, Date.now());

      // Verify embedding exists
      const embeddingBefore = db.prepare(
        'SELECT * FROM task_embeddings WHERE task_id = ?'
      ).get(task.id);
      expect(embeddingBefore).toBeDefined();

      // Delete the task
      const deleted = store.deleteTask(task.id);
      expect(deleted).toBe(true);

      // Verify embedding was CASCADE deleted
      const embeddingAfter = db.prepare(
        'SELECT * FROM task_embeddings WHERE task_id = ?'
      ).get(task.id);
      expect(embeddingAfter).toBeUndefined();
    });
  });

  describe('Task Relationships CASCADE Delete', () => {
    it('should CASCADE delete task_relationships when from_task is deleted', () => {
      // Create two tasks
      const parentTask = store.createTask('coder', 'parent task');
      const childTask = store.createTask('coder', 'child task');

      // Create a relationship (parent -> child)
      const db = store.getDatabase();
      const relationshipId = randomUUID();
      db.prepare(`
        INSERT INTO task_relationships (id, from_task_id, to_task_id, relationship_type, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(relationshipId, parentTask.id, childTask.id, 'parent_of', Date.now());

      // Verify relationship exists
      const relationshipBefore = db.prepare(
        'SELECT * FROM task_relationships WHERE id = ?'
      ).get(relationshipId);
      expect(relationshipBefore).toBeDefined();

      // Delete the parent task (from_task)
      store.deleteTask(parentTask.id);

      // Verify relationship was CASCADE deleted
      const relationshipAfter = db.prepare(
        'SELECT * FROM task_relationships WHERE id = ?'
      ).get(relationshipId);
      expect(relationshipAfter).toBeUndefined();

      // Child task should still exist
      expect(store.getTask(childTask.id)).not.toBeNull();
    });

    it('should CASCADE delete task_relationships when to_task is deleted', () => {
      // Create two tasks
      const parentTask = store.createTask('coder', 'parent task');
      const childTask = store.createTask('coder', 'child task');

      // Create a relationship (parent -> child)
      const db = store.getDatabase();
      const relationshipId = randomUUID();
      db.prepare(`
        INSERT INTO task_relationships (id, from_task_id, to_task_id, relationship_type, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(relationshipId, parentTask.id, childTask.id, 'parent_of', Date.now());

      // Verify relationship exists
      const relationshipBefore = db.prepare(
        'SELECT * FROM task_relationships WHERE id = ?'
      ).get(relationshipId);
      expect(relationshipBefore).toBeDefined();

      // Delete the child task (to_task)
      store.deleteTask(childTask.id);

      // Verify relationship was CASCADE deleted
      const relationshipAfter = db.prepare(
        'SELECT * FROM task_relationships WHERE id = ?'
      ).get(relationshipId);
      expect(relationshipAfter).toBeUndefined();

      // Parent task should still exist
      expect(store.getTask(parentTask.id)).not.toBeNull();
    });

    it('should CASCADE delete all relationships involving a task', () => {
      // Create three tasks with multiple relationships
      const taskA = store.createTask('coder', 'task A');
      const taskB = store.createTask('coder', 'task B');
      const taskC = store.createTask('coder', 'task C');

      const db = store.getDatabase();

      // A -> B (A is parent of B)
      db.prepare(`
        INSERT INTO task_relationships (id, from_task_id, to_task_id, relationship_type, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(randomUUID(), taskA.id, taskB.id, 'parent_of', Date.now());

      // B -> C (B is parent of C)
      db.prepare(`
        INSERT INTO task_relationships (id, from_task_id, to_task_id, relationship_type, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(randomUUID(), taskB.id, taskC.id, 'parent_of', Date.now());

      // Verify relationships exist
      const relationshipsBefore = db.prepare(
        'SELECT COUNT(*) as count FROM task_relationships WHERE from_task_id = ? OR to_task_id = ?'
      ).get(taskB.id, taskB.id) as { count: number };
      expect(relationshipsBefore.count).toBe(2);

      // Delete task B (middle task)
      store.deleteTask(taskB.id);

      // Verify both relationships involving B were deleted
      const relationshipsAfter = db.prepare(
        'SELECT COUNT(*) as count FROM task_relationships WHERE from_task_id = ? OR to_task_id = ?'
      ).get(taskB.id, taskB.id) as { count: number };
      expect(relationshipsAfter.count).toBe(0);

      // Tasks A and C should still exist
      expect(store.getTask(taskA.id)).not.toBeNull();
      expect(store.getTask(taskC.id)).not.toBeNull();
    });
  });

  describe('Drift Detection Events Persistence', () => {
    /**
     * drift_detection_events intentionally do NOT cascade delete.
     * This is by design to preserve metrics history even after tasks are removed.
     * The task_id in drift_detection_events is nullable and serves as a reference
     * for metrics/analytics purposes.
     */
    it('should preserve drift_detection_events after task deletion (by design)', () => {
      // Create a task
      const task = store.createTask('coder', 'implement feature');

      // Log a drift detection event for this task
      const db = store.getDatabase();
      const eventId = randomUUID();
      db.prepare(`
        INSERT INTO drift_detection_events (
          id, task_id, task_type, ancestor_task_id, similarity_score,
          threshold, action_taken, task_input, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        eventId,
        task.id,
        'coder',
        randomUUID(), // some ancestor task
        0.85,
        0.8,
        'warned',
        'implement feature',
        Date.now()
      );

      // Verify event exists
      const eventBefore = db.prepare(
        'SELECT * FROM drift_detection_events WHERE id = ?'
      ).get(eventId);
      expect(eventBefore).toBeDefined();

      // Delete the task
      store.deleteTask(task.id);

      // Verify drift event still exists (intentionally preserved for metrics)
      const eventAfter = db.prepare(
        'SELECT * FROM drift_detection_events WHERE id = ?'
      ).get(eventId);
      expect(eventAfter).toBeDefined();
    });
  });

  describe('Delete Task Edge Cases', () => {
    it('should return false when deleting non-existent task', () => {
      const deleted = store.deleteTask('non-existent-task-id');
      expect(deleted).toBe(false);
    });

    it('should handle deleting task with no embeddings or relationships', () => {
      // Create a task with no associated data
      const task = store.createTask('coder', 'standalone task');

      // Delete should succeed
      const deleted = store.deleteTask(task.id);
      expect(deleted).toBe(true);
      expect(store.getTask(task.id)).toBeNull();
    });

    it('should handle multiple tasks with independent embeddings', () => {
      // Create two tasks with embeddings
      const task1 = store.createTask('coder', 'task 1');
      const task2 = store.createTask('coder', 'task 2');

      const db = store.getDatabase();
      const embedding = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);

      db.prepare(`
        INSERT INTO task_embeddings (task_id, embedding, model, dimensions, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(task1.id, embedding, 'test-model', 3, Date.now());

      db.prepare(`
        INSERT INTO task_embeddings (task_id, embedding, model, dimensions, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(task2.id, embedding, 'test-model', 3, Date.now());

      // Delete first task
      store.deleteTask(task1.id);

      // First task's embedding should be deleted
      const embedding1 = db.prepare(
        'SELECT * FROM task_embeddings WHERE task_id = ?'
      ).get(task1.id);
      expect(embedding1).toBeUndefined();

      // Second task's embedding should still exist
      const embedding2 = db.prepare(
        'SELECT * FROM task_embeddings WHERE task_id = ?'
      ).get(task2.id);
      expect(embedding2).toBeDefined();
    });
  });
});
