/**
 * Drift Detection Service
 * Detects semantic drift when creating tasks by comparing against ancestor tasks
 */

import { randomUUID } from 'node:crypto';
import type { SQLiteStore } from '../memory/sqlite-store.js';
import type {
  AgentStackConfig,
  DriftDetectionResult,
  DriftDetectionConfig,
  DriftDetectionAction,
  TaskEmbedding,
  TaskRelationship,
  DriftDetectionEvent,
} from '../types.js';
import { createEmbeddingProvider, cosineSimilarity, type EmbeddingProvider } from '../utils/embeddings.js';
import { logger } from '../utils/logger.js';

const log = logger.child('drift-detection');

const DEFAULT_CONFIG: DriftDetectionConfig = {
  enabled: false,
  threshold: 0.95,
  ancestorDepth: 3,
  behavior: 'warn',
  asyncEmbedding: true,
};

export class DriftDetectionService {
  private store: SQLiteStore;
  private config: DriftDetectionConfig;
  private embeddingProvider: EmbeddingProvider | null;

  constructor(store: SQLiteStore, appConfig: AgentStackConfig) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...appConfig.driftDetection };
    this.embeddingProvider = createEmbeddingProvider(appConfig);

    log.debug('Drift detection service initialized', {
      enabled: this.config.enabled,
      threshold: this.config.threshold,
      ancestorDepth: this.config.ancestorDepth,
    });
  }

  /**
   * Check if drift detection is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled && this.embeddingProvider !== null;
  }

  /**
   * Get the current configuration
   */
  getConfig(): DriftDetectionConfig {
    return { ...this.config };
  }

  /**
   * Check for semantic drift against ancestor tasks
   */
  async checkDrift(
    taskInput: string,
    taskType: string,
    parentTaskId?: string
  ): Promise<DriftDetectionResult> {
    // Return early if disabled
    if (!this.isEnabled()) {
      return {
        isDrift: false,
        highestSimilarity: 0,
        action: 'allowed',
        checkedAncestors: 0,
      };
    }

    // No ancestors to check
    if (!parentTaskId) {
      return {
        isDrift: false,
        highestSimilarity: 0,
        action: 'allowed',
        checkedAncestors: 0,
      };
    }

    try {
      // Get ancestor task embeddings
      const ancestors = this.getTaskAncestors(parentTaskId, this.config.ancestorDepth);

      if (ancestors.length === 0) {
        return {
          isDrift: false,
          highestSimilarity: 0,
          action: 'allowed',
          checkedAncestors: 0,
        };
      }

      // Generate embedding for the new task input
      const newEmbedding = await this.embeddingProvider!.embed(taskInput);

      // Compare against each ancestor
      let highestSimilarity = 0;
      let mostSimilarTaskId: string | undefined;
      let mostSimilarTaskInput: string | undefined;

      for (const ancestor of ancestors) {
        const ancestorEmbedding = this.getTaskEmbedding(ancestor.taskId);
        if (!ancestorEmbedding) continue;

        const similarity = cosineSimilarity(newEmbedding, ancestorEmbedding.embedding);

        if (similarity > highestSimilarity) {
          highestSimilarity = similarity;
          mostSimilarTaskId = ancestor.taskId;
          // Get the task input for reporting
          const task = this.store.getTask(ancestor.taskId);
          mostSimilarTaskInput = task?.input;
        }
      }

      // Determine action based on similarity and thresholds
      let isDrift = false;
      let action: DriftDetectionAction = 'allowed';

      if (highestSimilarity >= this.config.threshold) {
        isDrift = true;
        action = this.config.behavior === 'prevent' ? 'prevented' : 'warned';
      } else if (
        this.config.warningThreshold &&
        highestSimilarity >= this.config.warningThreshold
      ) {
        action = 'warned';
      }

      // Log the drift event if drift was detected
      if (isDrift && mostSimilarTaskId) {
        this.logDriftEvent({
          id: randomUUID(),
          taskType,
          ancestorTaskId: mostSimilarTaskId,
          similarityScore: highestSimilarity,
          threshold: this.config.threshold,
          actionTaken: action,
          taskInput,
          createdAt: new Date(),
        });
      }

      log.debug('Drift check completed', {
        highestSimilarity,
        isDrift,
        action,
        checkedAncestors: ancestors.length,
      });

      return {
        isDrift,
        highestSimilarity,
        mostSimilarTaskId,
        mostSimilarTaskInput,
        action,
        checkedAncestors: ancestors.length,
      };
    } catch (error) {
      log.error('Error during drift check', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Fail open - allow task creation on errors
      return {
        isDrift: false,
        highestSimilarity: 0,
        action: 'allowed',
        checkedAncestors: 0,
      };
    }
  }

  /**
   * Index a task for future drift detection
   */
  async indexTask(taskId: string, taskInput: string): Promise<void> {
    if (!this.isEnabled() || !taskInput) {
      return;
    }

    try {
      const indexFn = async () => {
        const embedding = await this.embeddingProvider!.embed(taskInput);
        this.storeTaskEmbedding(taskId, embedding, this.embeddingProvider!.dimensions);
        log.debug('Task indexed for drift detection', { taskId });
      };

      if (this.config.asyncEmbedding) {
        // Index asynchronously without blocking
        indexFn().catch(err => {
          log.error('Failed to index task', {
            taskId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      } else {
        await indexFn();
      }
    } catch (error) {
      log.error('Error indexing task', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Create a relationship between tasks
   */
  createTaskRelationship(
    fromTaskId: string,
    toTaskId: string,
    relationshipType: TaskRelationship['relationshipType'],
    metadata?: Record<string, unknown>
  ): string {
    const id = randomUUID();
    const now = Date.now();
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    const db = this.store.getDatabase();

    try {
      db.prepare(`
        INSERT INTO task_relationships (id, from_task_id, to_task_id, relationship_type, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, fromTaskId, toTaskId, relationshipType, metadataJson, now);

      log.debug('Task relationship created', { id, fromTaskId, toTaskId, relationshipType });
      return id;
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        log.debug('Task relationship already exists', { fromTaskId, toTaskId, relationshipType });
        // Return existing relationship id
        const existing = db.prepare(`
          SELECT id FROM task_relationships
          WHERE from_task_id = ? AND to_task_id = ? AND relationship_type = ?
        `).get(fromTaskId, toTaskId, relationshipType) as { id: string } | undefined;
        return existing?.id ?? id;
      }
      throw error;
    }
  }

  /**
   * Get task ancestors up to a specified depth
   */
  getTaskAncestors(
    taskId: string,
    maxDepth: number = 3
  ): Array<{ taskId: string; depth: number }> {
    const db = this.store.getDatabase();
    const ancestors: Array<{ taskId: string; depth: number }> = [];
    const visited = new Set<string>();
    const queue: Array<{ taskId: string; depth: number }> = [{ taskId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.depth >= maxDepth) continue;
      if (visited.has(current.taskId)) continue;

      visited.add(current.taskId);

      // Find parent tasks (where current task is the "to" in a parent_of or derived_from relationship)
      const parentRows = db.prepare(`
        SELECT from_task_id as parent_id
        FROM task_relationships
        WHERE to_task_id = ? AND relationship_type IN ('parent_of', 'derived_from')
      `).all(current.taskId) as Array<{ parent_id: string }>;

      for (const row of parentRows) {
        if (!visited.has(row.parent_id)) {
          const nextDepth = current.depth + 1;
          ancestors.push({ taskId: row.parent_id, depth: nextDepth });
          queue.push({ taskId: row.parent_id, depth: nextDepth });
        }
      }
    }

    return ancestors;
  }

  /**
   * Get task relationships
   */
  getTaskRelationships(
    taskId: string,
    direction: 'outgoing' | 'incoming' | 'both' = 'both'
  ): TaskRelationship[] {
    const db = this.store.getDatabase();

    let query = 'SELECT * FROM task_relationships WHERE ';
    const params: string[] = [];

    if (direction === 'outgoing') {
      query += 'from_task_id = ?';
      params.push(taskId);
    } else if (direction === 'incoming') {
      query += 'to_task_id = ?';
      params.push(taskId);
    } else {
      query += '(from_task_id = ? OR to_task_id = ?)';
      params.push(taskId, taskId);
    }

    query += ' ORDER BY created_at DESC';

    const rows = db.prepare(query).all(...params) as Array<{
      id: string;
      from_task_id: string;
      to_task_id: string;
      relationship_type: string;
      metadata: string | null;
      created_at: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      fromTaskId: row.from_task_id,
      toTaskId: row.to_task_id,
      relationshipType: row.relationship_type as TaskRelationship['relationshipType'],
      metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined,
      createdAt: new Date(row.created_at),
    }));
  }

  /**
   * Store a task embedding
   */
  private storeTaskEmbedding(taskId: string, embedding: number[], dimensions: number): void {
    const db = this.store.getDatabase();
    const buffer = Buffer.from(new Float32Array(embedding).buffer);
    const now = Date.now();
    const model = 'openai'; // TODO: Get from config

    db.prepare(`
      INSERT OR REPLACE INTO task_embeddings (task_id, embedding, model, dimensions, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(taskId, buffer, model, dimensions, now);
  }

  /**
   * Get a task embedding
   */
  getTaskEmbedding(taskId: string): TaskEmbedding | null {
    const db = this.store.getDatabase();

    const row = db.prepare(`
      SELECT task_id, embedding, model, dimensions, created_at
      FROM task_embeddings
      WHERE task_id = ?
    `).get(taskId) as {
      task_id: string;
      embedding: Buffer;
      model: string;
      dimensions: number;
      created_at: number;
    } | undefined;

    if (!row) return null;

    return {
      taskId: row.task_id,
      embedding: Array.from(new Float32Array(row.embedding.buffer)),
      model: row.model,
      dimensions: row.dimensions,
      createdAt: new Date(row.created_at),
    };
  }

  /**
   * Log a drift detection event
   */
  logDriftEvent(event: DriftDetectionEvent): void {
    const db = this.store.getDatabase();

    db.prepare(`
      INSERT INTO drift_detection_events (id, task_id, task_type, ancestor_task_id, similarity_score, threshold, action_taken, task_input, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.taskId ?? null,
      event.taskType,
      event.ancestorTaskId,
      event.similarityScore,
      event.threshold,
      event.actionTaken,
      event.taskInput ?? null,
      event.createdAt.getTime()
    );

    log.debug('Drift event logged', { id: event.id, actionTaken: event.actionTaken });
  }

  /**
   * Get drift detection metrics
   */
  getDriftDetectionMetrics(since?: Date): {
    totalEvents: number;
    allowedCount: number;
    warnedCount: number;
    preventedCount: number;
    averageSimilarity: number;
  } {
    const db = this.store.getDatabase();
    const sinceTimestamp = since?.getTime() ?? 0;

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN action_taken = 'allowed' THEN 1 ELSE 0 END) as allowed,
        SUM(CASE WHEN action_taken = 'warned' THEN 1 ELSE 0 END) as warned,
        SUM(CASE WHEN action_taken = 'prevented' THEN 1 ELSE 0 END) as prevented,
        AVG(similarity_score) as avg_similarity
      FROM drift_detection_events
      WHERE created_at >= ?
    `).get(sinceTimestamp) as {
      total: number;
      allowed: number;
      warned: number;
      prevented: number;
      avg_similarity: number | null;
    };

    return {
      totalEvents: stats.total,
      allowedCount: stats.allowed,
      warnedCount: stats.warned,
      preventedCount: stats.prevented,
      averageSimilarity: stats.avg_similarity ?? 0,
    };
  }

  /**
   * Get recent drift events
   */
  getRecentDriftEvents(limit: number = 50): DriftDetectionEvent[] {
    const db = this.store.getDatabase();

    const rows = db.prepare(`
      SELECT id, task_id, task_type, ancestor_task_id, similarity_score, threshold, action_taken, task_input, created_at
      FROM drift_detection_events
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as Array<{
      id: string;
      task_id: string | null;
      task_type: string;
      ancestor_task_id: string;
      similarity_score: number;
      threshold: number;
      action_taken: string;
      task_input: string | null;
      created_at: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      taskId: row.task_id ?? undefined,
      taskType: row.task_type,
      ancestorTaskId: row.ancestor_task_id,
      similarityScore: row.similarity_score,
      threshold: row.threshold,
      actionTaken: row.action_taken as DriftDetectionAction,
      taskInput: row.task_input ?? undefined,
      createdAt: new Date(row.created_at),
    }));
  }
}

// Singleton instance
let instance: DriftDetectionService | null = null;

/**
 * Get or create the drift detection service instance
 */
export function getDriftDetectionService(
  store: SQLiteStore,
  config: AgentStackConfig
): DriftDetectionService {
  if (!instance) {
    instance = new DriftDetectionService(store, config);
  }
  return instance;
}

/**
 * Reset the drift detection service instance
 */
export function resetDriftDetectionService(): void {
  instance = null;
}
