/**
 * Drift Detection Service tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../../src/memory/sqlite-store.js';
import {
  DriftDetectionService,
  getDriftDetectionService,
  resetDriftDetectionService,
} from '../../src/tasks/drift-detection-service.js';
import type { AgentStackConfig } from '../../src/types.js';

// Mock fetch for embedding API calls
const mockFetch = vi.fn();
const originalFetch = global.fetch;

// Helper to create test config
function createConfig(options: {
  driftEnabled?: boolean;
  threshold?: number;
  warningThreshold?: number;
  ancestorDepth?: number;
  behavior?: 'warn' | 'prevent';
  asyncEmbedding?: boolean;
  vectorEnabled?: boolean;
  openaiKey?: string;
}): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: './data/memory.db',
      defaultNamespace: 'default',
      vectorSearch: {
        enabled: options.vectorEnabled ?? true,
        provider: 'openai',
      },
    },
    providers: {
      default: 'anthropic',
      openai: options.openaiKey ? { apiKey: options.openaiKey } : undefined,
    },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: false },
    plugins: { enabled: true, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
    driftDetection: {
      enabled: options.driftEnabled ?? false,
      threshold: options.threshold ?? 0.95,
      warningThreshold: options.warningThreshold,
      ancestorDepth: options.ancestorDepth ?? 3,
      behavior: options.behavior ?? 'warn',
      asyncEmbedding: options.asyncEmbedding ?? false, // Use sync for tests
    },
  };
}

// Helper to create a mock embedding
function createMockEmbedding(seed: number): number[] {
  const embedding = [];
  for (let i = 0; i < 1536; i++) {
    embedding.push(Math.sin(seed * i * 0.01) * 0.5);
  }
  return embedding;
}

describe('DriftDetectionService', () => {
  let tmpDir: string;
  let store: SQLiteStore;

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch;
    resetDriftDetectionService();

    // Create temp directory for test database
    tmpDir = mkdtempSync(join(tmpdir(), 'drift-test-'));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (store) {
      store.close();
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('isEnabled', () => {
    it('should return false when drift detection is disabled', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: false })
      );

      expect(service.isEnabled()).toBe(false);
    });

    it('should return false when no embedding provider is available', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: true, openaiKey: undefined })
      );

      expect(service.isEnabled()).toBe(false);
    });

    it('should return true when enabled with valid embedding provider', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: true, openaiKey: 'sk-test' })
      );

      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('checkDrift', () => {
    it('should return early when disabled', async () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: false })
      );

      const result = await service.checkDrift('Test task', 'coder', 'parent-id');

      expect(result.isDrift).toBe(false);
      expect(result.action).toBe('allowed');
      expect(result.checkedAncestors).toBe(0);
    });

    it('should return early when no parent task ID', async () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: true, openaiKey: 'sk-test' })
      );

      const result = await service.checkDrift('Test task', 'coder');

      expect(result.isDrift).toBe(false);
      expect(result.action).toBe('allowed');
      expect(result.checkedAncestors).toBe(0);
    });

    it('should return allowed when no ancestors exist', async () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: true, openaiKey: 'sk-test' })
      );

      // Create a task without any relationships
      const task = store.createTask('coder', 'Original task');

      const result = await service.checkDrift('New task', 'coder', task.id);

      expect(result.isDrift).toBe(false);
      expect(result.action).toBe('allowed');
      expect(result.checkedAncestors).toBe(0);
    });

    it('should detect drift when similarity exceeds threshold', async () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({
          driftEnabled: true,
          openaiKey: 'sk-test',
          threshold: 0.9,
          behavior: 'warn',
        })
      );

      // Create parent and child tasks
      const parentTask = store.createTask('coder', 'Fix authentication bug');
      const childTask = store.createTask('coder', 'Work on auth');

      // Create relationship
      service.createTaskRelationship(parentTask.id, childTask.id, 'parent_of');

      // Mock embedding for parent task (store it directly)
      const parentEmbedding = createMockEmbedding(1);
      const db = store.getDatabase();
      const buffer = Buffer.from(new Float32Array(parentEmbedding).buffer);
      db.prepare(`
        INSERT INTO task_embeddings (task_id, embedding, model, dimensions, created_at)
        VALUES (?, ?, 'openai', 1536, ?)
      `).run(parentTask.id, buffer, Date.now());

      // Mock the embedding API call to return a very similar embedding
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: createMockEmbedding(1) }], // Same seed = identical embedding
        }),
      });

      const result = await service.checkDrift('Fix the authentication bug', 'coder', childTask.id);

      expect(result.isDrift).toBe(true);
      expect(result.highestSimilarity).toBeGreaterThan(0.9);
      expect(result.action).toBe('warned');
      expect(result.mostSimilarTaskId).toBe(parentTask.id);
    });

    it('should prevent task creation when behavior is "prevent"', async () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({
          driftEnabled: true,
          openaiKey: 'sk-test',
          threshold: 0.9,
          behavior: 'prevent',
        })
      );

      // Create parent and child tasks
      const parentTask = store.createTask('coder', 'Fix authentication bug');
      const childTask = store.createTask('coder', 'Work on auth');

      // Create relationship
      service.createTaskRelationship(parentTask.id, childTask.id, 'parent_of');

      // Store parent embedding
      const parentEmbedding = createMockEmbedding(1);
      const db = store.getDatabase();
      const buffer = Buffer.from(new Float32Array(parentEmbedding).buffer);
      db.prepare(`
        INSERT INTO task_embeddings (task_id, embedding, model, dimensions, created_at)
        VALUES (?, ?, 'openai', 1536, ?)
      `).run(parentTask.id, buffer, Date.now());

      // Mock the embedding API call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: createMockEmbedding(1) }],
        }),
      });

      const result = await service.checkDrift('Fix the authentication bug', 'coder', childTask.id);

      expect(result.isDrift).toBe(true);
      expect(result.action).toBe('prevented');
    });

    it('should warn when similarity is between warning and block thresholds', async () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({
          driftEnabled: true,
          openaiKey: 'sk-test',
          threshold: 0.98,
          warningThreshold: 0.8,
          behavior: 'warn',
        })
      );

      // Create parent and child tasks
      const parentTask = store.createTask('coder', 'Fix authentication bug');
      const childTask = store.createTask('coder', 'Work on auth');

      // Create relationship
      service.createTaskRelationship(parentTask.id, childTask.id, 'parent_of');

      // Store parent embedding - use a simple test vector
      const parentEmbedding = new Array(1536).fill(0).map((_, i) => Math.sin(i * 0.1));
      const db = store.getDatabase();
      const buffer = Buffer.from(new Float32Array(parentEmbedding).buffer);
      db.prepare(`
        INSERT INTO task_embeddings (task_id, embedding, model, dimensions, created_at)
        VALUES (?, ?, 'openai', 1536, ?)
      `).run(parentTask.id, buffer, Date.now());

      // Create a moderately similar embedding (similarity ~0.85)
      // By shifting the sine wave phase, we get moderate similarity
      const childEmbedding = new Array(1536).fill(0).map((_, i) => Math.sin(i * 0.1 + 0.5));

      // Mock the embedding API call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: childEmbedding }],
        }),
      });

      const result = await service.checkDrift('Different task', 'coder', childTask.id);

      // Should warn since similarity is above 0.8 but below 0.98
      expect(result.action).toBe('warned');
      expect(result.isDrift).toBe(false); // Below main threshold
      expect(result.highestSimilarity).toBeGreaterThan(0.8);
      expect(result.highestSimilarity).toBeLessThan(0.98);
    });

    it('should handle embedding API errors gracefully', async () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({
          driftEnabled: true,
          openaiKey: 'sk-test',
          threshold: 0.9,
        })
      );

      // Create parent and child tasks
      const parentTask = store.createTask('coder', 'Fix bug');
      const childTask = store.createTask('coder', 'Work');

      // Create relationship
      service.createTaskRelationship(parentTask.id, childTask.id, 'parent_of');

      // Mock API error
      mockFetch.mockRejectedValueOnce(new Error('API error'));

      const result = await service.checkDrift('Test', 'coder', childTask.id);

      // Should fail open
      expect(result.isDrift).toBe(false);
      expect(result.action).toBe('allowed');
    });
  });

  describe('indexTask', () => {
    it('should not index when disabled', async () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: false })
      );

      const task = store.createTask('coder', 'Test task');

      await service.indexTask(task.id, 'Test task');

      const embedding = service.getTaskEmbedding(task.id);
      expect(embedding).toBeNull();
    });

    it('should index task when enabled', async () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({
          driftEnabled: true,
          openaiKey: 'sk-test',
          asyncEmbedding: false,
        })
      );

      const task = store.createTask('coder', 'Test task');

      // Mock the embedding API call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: createMockEmbedding(1) }],
        }),
      });

      await service.indexTask(task.id, 'Test task');

      const embedding = service.getTaskEmbedding(task.id);
      expect(embedding).not.toBeNull();
      expect(embedding?.taskId).toBe(task.id);
      expect(embedding?.embedding.length).toBe(1536);
    });

    it('should not index empty input', async () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({
          driftEnabled: true,
          openaiKey: 'sk-test',
        })
      );

      const task = store.createTask('coder');

      await service.indexTask(task.id, '');

      const embedding = service.getTaskEmbedding(task.id);
      expect(embedding).toBeNull();
    });
  });

  describe('createTaskRelationship', () => {
    it('should create a relationship between tasks', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: false })
      );

      const task1 = store.createTask('coder', 'Parent task');
      const task2 = store.createTask('coder', 'Child task');

      const relationshipId = service.createTaskRelationship(task1.id, task2.id, 'parent_of');

      expect(relationshipId).toBeDefined();

      const relationships = service.getTaskRelationships(task1.id, 'outgoing');
      expect(relationships).toHaveLength(1);
      expect(relationships[0].fromTaskId).toBe(task1.id);
      expect(relationships[0].toTaskId).toBe(task2.id);
      expect(relationships[0].relationshipType).toBe('parent_of');
    });

    it('should handle duplicate relationships', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: false })
      );

      const task1 = store.createTask('coder', 'Parent task');
      const task2 = store.createTask('coder', 'Child task');

      const id1 = service.createTaskRelationship(task1.id, task2.id, 'parent_of');
      const id2 = service.createTaskRelationship(task1.id, task2.id, 'parent_of');

      // Should return the same ID or handle gracefully
      expect(id1).toBe(id2);
    });
  });

  describe('getTaskAncestors', () => {
    it('should return ancestors up to specified depth', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: false })
      );

      // Create a chain: grandparent -> parent -> child
      const grandparent = store.createTask('coder', 'Grandparent');
      const parent = store.createTask('coder', 'Parent');
      const child = store.createTask('coder', 'Child');

      service.createTaskRelationship(grandparent.id, parent.id, 'parent_of');
      service.createTaskRelationship(parent.id, child.id, 'parent_of');

      const ancestors = service.getTaskAncestors(child.id, 3);

      expect(ancestors).toHaveLength(2);
      expect(ancestors.map(a => a.taskId)).toContain(parent.id);
      expect(ancestors.map(a => a.taskId)).toContain(grandparent.id);
    });

    it('should respect depth limit', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: false })
      );

      // Create a chain: grandparent -> parent -> child
      const grandparent = store.createTask('coder', 'Grandparent');
      const parent = store.createTask('coder', 'Parent');
      const child = store.createTask('coder', 'Child');

      service.createTaskRelationship(grandparent.id, parent.id, 'parent_of');
      service.createTaskRelationship(parent.id, child.id, 'parent_of');

      // Only get depth 1
      const ancestors = service.getTaskAncestors(child.id, 1);

      expect(ancestors).toHaveLength(1);
      expect(ancestors[0].taskId).toBe(parent.id);
    });

    it('should handle tasks with no ancestors', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: false })
      );

      const task = store.createTask('coder', 'Standalone task');

      const ancestors = service.getTaskAncestors(task.id, 3);

      expect(ancestors).toHaveLength(0);
    });

    it('should handle cyclic relationships gracefully', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: false })
      );

      const task1 = store.createTask('coder', 'Task 1');
      const task2 = store.createTask('coder', 'Task 2');

      // Create a cycle (shouldn't happen in practice, but test for safety)
      service.createTaskRelationship(task1.id, task2.id, 'parent_of');
      service.createTaskRelationship(task2.id, task1.id, 'parent_of');

      const ancestors = service.getTaskAncestors(task2.id, 5);

      // Should not infinite loop
      expect(ancestors.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getTaskRelationships', () => {
    it('should get outgoing relationships', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: false })
      );

      const parent = store.createTask('coder', 'Parent');
      const child1 = store.createTask('coder', 'Child 1');
      const child2 = store.createTask('coder', 'Child 2');

      service.createTaskRelationship(parent.id, child1.id, 'parent_of');
      service.createTaskRelationship(parent.id, child2.id, 'parent_of');

      const outgoing = service.getTaskRelationships(parent.id, 'outgoing');

      expect(outgoing).toHaveLength(2);
    });

    it('should get incoming relationships', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: false })
      );

      const parent = store.createTask('coder', 'Parent');
      const child = store.createTask('coder', 'Child');

      service.createTaskRelationship(parent.id, child.id, 'parent_of');

      const incoming = service.getTaskRelationships(child.id, 'incoming');

      expect(incoming).toHaveLength(1);
      expect(incoming[0].fromTaskId).toBe(parent.id);
    });

    it('should get both directions', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: false })
      );

      const task1 = store.createTask('coder', 'Task 1');
      const task2 = store.createTask('coder', 'Task 2');
      const task3 = store.createTask('coder', 'Task 3');

      service.createTaskRelationship(task1.id, task2.id, 'parent_of');
      service.createTaskRelationship(task2.id, task3.id, 'parent_of');

      const both = service.getTaskRelationships(task2.id, 'both');

      expect(both).toHaveLength(2);
    });
  });

  describe('logDriftEvent and getDriftDetectionMetrics', () => {
    it('should log drift events and retrieve metrics', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: false })
      );

      // Log some events
      service.logDriftEvent({
        id: 'event-1',
        taskType: 'coder',
        ancestorTaskId: 'ancestor-1',
        similarityScore: 0.96,
        threshold: 0.95,
        actionTaken: 'warned',
        taskInput: 'Test task 1',
        createdAt: new Date(),
      });

      service.logDriftEvent({
        id: 'event-2',
        taskType: 'coder',
        ancestorTaskId: 'ancestor-2',
        similarityScore: 0.98,
        threshold: 0.95,
        actionTaken: 'prevented',
        taskInput: 'Test task 2',
        createdAt: new Date(),
      });

      const metrics = service.getDriftDetectionMetrics();

      expect(metrics.totalEvents).toBe(2);
      expect(metrics.warnedCount).toBe(1);
      expect(metrics.preventedCount).toBe(1);
      expect(metrics.averageSimilarity).toBeCloseTo(0.97, 2);
    });

    it('should filter metrics by date', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: false })
      );

      // Log an event
      service.logDriftEvent({
        id: 'event-1',
        taskType: 'coder',
        ancestorTaskId: 'ancestor-1',
        similarityScore: 0.96,
        threshold: 0.95,
        actionTaken: 'warned',
        createdAt: new Date(),
      });

      // Get metrics from the future (should be 0)
      const futureDate = new Date(Date.now() + 10000000);
      const metrics = service.getDriftDetectionMetrics(futureDate);

      expect(metrics.totalEvents).toBe(0);
    });
  });

  describe('getRecentDriftEvents', () => {
    it('should return recent events', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({ driftEnabled: false })
      );

      // Log some events
      for (let i = 0; i < 5; i++) {
        service.logDriftEvent({
          id: `event-${i}`,
          taskType: 'coder',
          ancestorTaskId: `ancestor-${i}`,
          similarityScore: 0.95 + i * 0.01,
          threshold: 0.95,
          actionTaken: 'warned',
          createdAt: new Date(Date.now() + i * 1000),
        });
      }

      const events = service.getRecentDriftEvents(3);

      expect(events).toHaveLength(3);
      // Most recent should be first
      expect(events[0].id).toBe('event-4');
    });
  });

  describe('getConfig', () => {
    it('should return current configuration', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({
          driftEnabled: true,
          threshold: 0.85,
          warningThreshold: 0.7,
          ancestorDepth: 5,
          behavior: 'prevent',
        })
      );

      const config = service.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.threshold).toBe(0.85);
      expect(config.warningThreshold).toBe(0.7);
      expect(config.ancestorDepth).toBe(5);
      expect(config.behavior).toBe('prevent');
    });
  });

  describe('getDriftDetectionService (singleton)', () => {
    it('should return the same instance for same config', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const config = createConfig({ driftEnabled: true, threshold: 0.9 });

      const service1 = getDriftDetectionService(store, config);
      const service2 = getDriftDetectionService(store, config);

      expect(service1).toBe(service2);
    });

    it('should create new instance when config changes', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const config1 = createConfig({ driftEnabled: true, threshold: 0.9 });
      const config2 = createConfig({ driftEnabled: true, threshold: 0.85 });

      const service1 = getDriftDetectionService(store, config1);
      const service2 = getDriftDetectionService(store, config2);

      expect(service1).not.toBe(service2);
      expect(service1.getConfig().threshold).toBe(0.9);
      expect(service2.getConfig().threshold).toBe(0.85);
    });

    it('should create new instance when forceNew is true', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const config = createConfig({ driftEnabled: true, threshold: 0.9 });

      const service1 = getDriftDetectionService(store, config);
      const service2 = getDriftDetectionService(store, config, true);

      expect(service1).not.toBe(service2);
    });

    it('should detect enabled flag change', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const config1 = createConfig({ driftEnabled: false });
      const config2 = createConfig({ driftEnabled: true, openaiKey: 'sk-test' });

      const service1 = getDriftDetectionService(store, config1);
      const service2 = getDriftDetectionService(store, config2);

      expect(service1).not.toBe(service2);
      expect(service1.isEnabled()).toBe(false);
      expect(service2.isEnabled()).toBe(true);
    });

    it('should detect behavior change', () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const config1 = createConfig({ driftEnabled: true, behavior: 'warn' });
      const config2 = createConfig({ driftEnabled: true, behavior: 'prevent' });

      const service1 = getDriftDetectionService(store, config1);
      const service2 = getDriftDetectionService(store, config2);

      expect(service1).not.toBe(service2);
      expect(service1.getConfig().behavior).toBe('warn');
      expect(service2.getConfig().behavior).toBe('prevent');
    });
  });

  describe('embedding model name', () => {
    it('should store embedding with correct model name', async () => {
      store = new SQLiteStore(join(tmpDir, 'test.db'));
      const service = new DriftDetectionService(
        store,
        createConfig({
          driftEnabled: true,
          openaiKey: 'sk-test',
          asyncEmbedding: false,
        })
      );

      const task = store.createTask('coder', 'Test task');

      // Mock the embedding API call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: createMockEmbedding(1) }],
        }),
      });

      await service.indexTask(task.id, 'Test task');

      const embedding = service.getTaskEmbedding(task.id);
      expect(embedding).not.toBeNull();
      // Model should be from the provider (text-embedding-3-small for OpenAI)
      expect(embedding?.model).toBe('text-embedding-3-small');
    });
  });
});
