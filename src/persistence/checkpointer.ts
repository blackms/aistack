/**
 * Checkpointer — durable execution for agent workflows.
 *
 * Persists agent state after each step so workflows can be resumed
 * after a crash. State is stored in the `agent_checkpoints` table
 * (see migrations/004_add_checkpoints.sql).
 *
 * Design:
 *  - Per-step granularity by default. Each `save()` writes a new row.
 *  - State is serialized as JSON. Payloads >= `gzipThresholdBytes` (default
 *    2 KiB) are gzipped to keep the DB small for large agent contexts.
 *  - Retention: callers can `prune(sessionId, keepLastN)` to bound growth.
 *    The CLI `aistack workflow resume` always loads the LATEST checkpoint
 *    per session, so older rows are only useful for forensics / replay.
 *  - Deterministic replay: identical (sessionId, agentId, stepId) inputs +
 *    identical loaded state produce identical downstream behavior. Callers
 *    must use `loadByStep` (not `loadLatest`) for replay.
 *
 * Issue: AIG-633
 */

import { randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import type Database from 'better-sqlite3';
import type { AgentStackConfig } from '../types.js';
import { getMemoryManager } from '../memory/index.js';
import { logger } from '../utils/logger.js';

const log = logger.child('checkpointer');

/** Serialization format stored alongside the blob. */
export type CheckpointFormat = 'json' | 'json+gzip';

/** A single persisted checkpoint row. */
export interface Checkpoint<TState = unknown> {
  id: string;
  sessionId: string;
  agentId: string;
  stepId: string;
  state: TState;
  format: CheckpointFormat;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

/** Options for the Checkpointer constructor. */
export interface CheckpointerOptions {
  /** Payloads at or above this many bytes are gzipped. Default 2048. */
  gzipThresholdBytes?: number;
  /** Disable gzip entirely (useful for tests / determinism). Default false. */
  disableGzip?: boolean;
}

interface CheckpointRow {
  id: string;
  session_id: string;
  agent_id: string;
  step_id: string;
  state_blob: string;
  format: CheckpointFormat;
  metadata: string | null;
  created_at: number;
}

const DEFAULT_GZIP_THRESHOLD_BYTES = 2048;

/**
 * Checkpointer — writes/reads `agent_checkpoints` rows.
 *
 * Instances are cheap; reuse a single instance per process via
 * {@link getCheckpointer}.
 */
export class Checkpointer {
  private readonly db: Database.Database;
  private readonly gzipThresholdBytes: number;
  private readonly disableGzip: boolean;

  constructor(db: Database.Database, options: CheckpointerOptions = {}) {
    this.db = db;
    this.gzipThresholdBytes = options.gzipThresholdBytes ?? DEFAULT_GZIP_THRESHOLD_BYTES;
    this.disableGzip = options.disableGzip ?? false;
  }

  /**
   * Persist agent state for (sessionId, agentId, stepId).
   *
   * Each call writes a new row — callers should pick a `stepId` that
   * is unique within the session if they want to look up checkpoints
   * by step for deterministic replay.
   *
   * @returns The persisted Checkpoint (with generated id + createdAt).
   */
  save<TState>(
    sessionId: string,
    agentId: string,
    stepId: string,
    state: TState,
    metadata?: Record<string, unknown>
  ): Checkpoint<TState> {
    if (!sessionId) throw new Error('sessionId is required');
    if (!agentId) throw new Error('agentId is required');
    if (!stepId) throw new Error('stepId is required');

    const id = randomUUID();
    const now = Date.now();
    const json = JSON.stringify(state);

    let format: CheckpointFormat = 'json';
    let blob: string = json;

    if (!this.disableGzip && Buffer.byteLength(json, 'utf8') >= this.gzipThresholdBytes) {
      // Gzip + base64 so the column stays TEXT (no schema migration needed).
      blob = gzipSync(Buffer.from(json, 'utf8')).toString('base64');
      format = 'json+gzip';
    }

    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    this.db
      .prepare(
        `INSERT INTO agent_checkpoints
         (id, session_id, agent_id, step_id, state_blob, format, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, sessionId, agentId, stepId, blob, format, metadataJson, now);

    log.debug('Checkpoint saved', { id, sessionId, agentId, stepId, format, bytes: blob.length });

    return {
      id,
      sessionId,
      agentId,
      stepId,
      state,
      format,
      metadata,
      createdAt: new Date(now),
    };
  }

  /**
   * Load the most recent checkpoint for a session (across all agents).
   * Returns null if no checkpoints exist for the session.
   */
  loadLatest<TState = unknown>(sessionId: string): Checkpoint<TState> | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id, agent_id, step_id, state_blob, format, metadata, created_at
         FROM agent_checkpoints
         WHERE session_id = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(sessionId) as CheckpointRow | undefined;

    return row ? this.rowToCheckpoint<TState>(row) : null;
  }

  /**
   * Load the most recent checkpoint for a specific agent within a session.
   */
  loadLatestForAgent<TState = unknown>(
    sessionId: string,
    agentId: string
  ): Checkpoint<TState> | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id, agent_id, step_id, state_blob, format, metadata, created_at
         FROM agent_checkpoints
         WHERE session_id = ? AND agent_id = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(sessionId, agentId) as CheckpointRow | undefined;

    return row ? this.rowToCheckpoint<TState>(row) : null;
  }

  /**
   * Load the most recent checkpoint for a specific (sessionId, stepId).
   * Used for deterministic replay — feed the same step's state back in.
   */
  loadByStep<TState = unknown>(
    sessionId: string,
    stepId: string
  ): Checkpoint<TState> | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id, agent_id, step_id, state_blob, format, metadata, created_at
         FROM agent_checkpoints
         WHERE session_id = ? AND step_id = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(sessionId, stepId) as CheckpointRow | undefined;

    return row ? this.rowToCheckpoint<TState>(row) : null;
  }

  /**
   * List checkpoints for a session (newest first).
   */
  list<TState = unknown>(sessionId: string, limit = 100): Checkpoint<TState>[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, agent_id, step_id, state_blob, format, metadata, created_at
         FROM agent_checkpoints
         WHERE session_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(sessionId, limit) as CheckpointRow[];

    return rows.map((row) => this.rowToCheckpoint<TState>(row));
  }

  /**
   * Delete all but the most recent `keepLastN` checkpoints for a session.
   * Returns the number of rows deleted.
   */
  prune(sessionId: string, keepLastN: number): number {
    if (keepLastN < 0) throw new Error('keepLastN must be >= 0');

    const result = this.db
      .prepare(
        `DELETE FROM agent_checkpoints
         WHERE session_id = ?
           AND id NOT IN (
             SELECT id FROM agent_checkpoints
             WHERE session_id = ?
             ORDER BY created_at DESC
             LIMIT ?
           )`
      )
      .run(sessionId, sessionId, keepLastN);

    if (result.changes > 0) {
      log.debug('Pruned checkpoints', { sessionId, deleted: result.changes, keepLastN });
    }
    return result.changes;
  }

  /**
   * Delete every checkpoint for a session (used when a session is purged).
   */
  deleteSession(sessionId: string): number {
    const result = this.db
      .prepare('DELETE FROM agent_checkpoints WHERE session_id = ?')
      .run(sessionId);
    return result.changes;
  }

  /** Count checkpoints for a session. */
  count(sessionId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM agent_checkpoints WHERE session_id = ?')
      .get(sessionId) as { n: number };
    return row.n;
  }

  private rowToCheckpoint<TState>(row: CheckpointRow): Checkpoint<TState> {
    let json: string;
    if (row.format === 'json+gzip') {
      json = gunzipSync(Buffer.from(row.state_blob, 'base64')).toString('utf8');
    } else {
      json = row.state_blob;
    }

    return {
      id: row.id,
      sessionId: row.session_id,
      agentId: row.agent_id,
      stepId: row.step_id,
      state: JSON.parse(json) as TState,
      format: row.format,
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined,
      createdAt: new Date(row.created_at),
    };
  }
}

// ==================== Singleton ====================

let instance: Checkpointer | null = null;

/**
 * Get or create the process-wide Checkpointer instance.
 * Reuses the existing memory-manager's SQLite connection so we don't
 * open a second handle to the same DB file.
 */
export function getCheckpointer(
  config?: AgentStackConfig,
  options?: CheckpointerOptions
): Checkpointer {
  if (!instance) {
    if (!config) {
      throw new Error('Configuration required to initialize checkpointer');
    }
    const memoryManager = getMemoryManager(config);
    // Accessing the underlying better-sqlite3 handle. The SQLiteStore wraps
    // it as a private field — we deliberately keep the SQLiteStore API free
    // of checkpoint-specific methods to keep this module decoupled.
    const store = memoryManager.getStore();
    // @ts-expect-error — intentionally reading the private `db` field.
    const db: Database.Database = store.db;
    instance = new Checkpointer(db, options);
  }
  return instance;
}

/** Reset the singleton (used by tests). */
export function resetCheckpointer(): void {
  instance = null;
}

/**
 * Configurable wrapper used by the agent runtime. Reads the
 * `checkpointing` block from the loaded config and no-ops when disabled.
 * Safe to call from any agent step — failures are logged, not thrown,
 * so checkpointing never breaks the primary workflow.
 */
export function saveCheckpointIfEnabled<TState>(
  config: AgentStackConfig,
  sessionId: string | undefined,
  agentId: string,
  stepId: string,
  state: TState,
  metadata?: Record<string, unknown>
): void {
  if (!sessionId) return; // no session → nothing to resume
  const cfg = config.checkpointing;
  if (!cfg?.enabled) return;

  try {
    const checkpointer = getCheckpointer(config);
    checkpointer.save(sessionId, agentId, stepId, state, metadata);

    // Best-effort retention enforcement.
    const keep = cfg.retentionPerSession;
    if (typeof keep === 'number' && keep > 0) {
      checkpointer.prune(sessionId, keep);
    }
  } catch (error) {
    log.warn('Failed to save checkpoint', {
      sessionId,
      agentId,
      stepId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
