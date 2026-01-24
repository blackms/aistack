/**
 * SQLite-based memory store with FTS5 full-text search
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MemoryEntry, MemoryStoreOptions, Session, Task } from '../types.js';
import { logger } from '../utils/logger.js';

const log = logger.child('sqlite');

const SCHEMA = `
-- Core memory table
CREATE TABLE IF NOT EXISTS memory (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  namespace TEXT DEFAULT 'default',
  content TEXT NOT NULL,
  embedding BLOB,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(namespace, key)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_memory_namespace ON memory(namespace);
CREATE INDEX IF NOT EXISTS idx_memory_key ON memory(key);
CREATE INDEX IF NOT EXISTS idx_memory_updated ON memory(updated_at DESC);

-- Full-text search table
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  key, content, namespace,
  content=memory, content_rowid=rowid,
  tokenize='porter unicode61'
);

-- FTS triggers for automatic sync
CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
  INSERT INTO memory_fts(rowid, key, content, namespace)
  VALUES (NEW.rowid, NEW.key, NEW.content, NEW.namespace);
END;

CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, key, content, namespace)
  VALUES('delete', OLD.rowid, OLD.key, OLD.content, OLD.namespace);
END;

CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, key, content, namespace)
  VALUES('delete', OLD.rowid, OLD.key, OLD.content, OLD.namespace);
  INSERT INTO memory_fts(rowid, key, content, namespace)
  VALUES (NEW.rowid, NEW.key, NEW.content, NEW.namespace);
END;

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  agent_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  input TEXT,
  output TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- Plugins table
CREATE TABLE IF NOT EXISTS plugins (
  name TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  config TEXT,
  installed_at INTEGER NOT NULL
);
`;

export class SQLiteStore {
  private db: Database.Database;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;

    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.initSchema();
    log.debug('SQLite store initialized', { path: dbPath });
  }

  private initSchema(): void {
    this.db.exec(SCHEMA);
  }

  // ==================== Memory Operations ====================

  store(
    key: string,
    content: string,
    options: MemoryStoreOptions = {}
  ): MemoryEntry {
    const namespace = options.namespace ?? 'default';
    const now = Date.now();

    // Check if entry exists
    const existing = this.db
      .prepare('SELECT id FROM memory WHERE namespace = ? AND key = ?')
      .get(namespace, key) as { id: string } | undefined;

    const id = existing?.id ?? randomUUID();
    const metadataJson = options.metadata ? JSON.stringify(options.metadata) : null;

    if (existing) {
      // Update existing entry
      this.db
        .prepare(`
          UPDATE memory
          SET content = ?, metadata = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(content, metadataJson, now, id);
    } else {
      // Insert new entry
      this.db
        .prepare(`
          INSERT INTO memory (id, key, namespace, content, metadata, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(id, key, namespace, content, metadataJson, now, now);
    }

    return {
      id,
      key,
      namespace,
      content,
      metadata: options.metadata,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  get(key: string, namespace: string = 'default'): MemoryEntry | null {
    const row = this.db
      .prepare(`
        SELECT id, key, namespace, content, embedding, metadata, created_at, updated_at
        FROM memory
        WHERE namespace = ? AND key = ?
      `)
      .get(namespace, key) as MemoryRow | undefined;

    return row ? this.rowToEntry(row) : null;
  }

  getById(id: string): MemoryEntry | null {
    const row = this.db
      .prepare(`
        SELECT id, key, namespace, content, embedding, metadata, created_at, updated_at
        FROM memory
        WHERE id = ?
      `)
      .get(id) as MemoryRow | undefined;

    return row ? this.rowToEntry(row) : null;
  }

  delete(key: string, namespace: string = 'default'): boolean {
    const result = this.db
      .prepare('DELETE FROM memory WHERE namespace = ? AND key = ?')
      .run(namespace, key);

    return result.changes > 0;
  }

  deleteById(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM memory WHERE id = ?')
      .run(id);

    return result.changes > 0;
  }

  list(
    namespace?: string,
    limit: number = 100,
    offset: number = 0
  ): MemoryEntry[] {
    let query = `
      SELECT id, key, namespace, content, embedding, metadata, created_at, updated_at
      FROM memory
    `;
    const params: (string | number)[] = [];

    if (namespace) {
      query += ' WHERE namespace = ?';
      params.push(namespace);
    }

    query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(query).all(...params) as MemoryRow[];
    return rows.map(row => this.rowToEntry(row));
  }

  count(namespace?: string): number {
    let query = 'SELECT COUNT(*) as count FROM memory';
    const params: string[] = [];

    if (namespace) {
      query += ' WHERE namespace = ?';
      params.push(namespace);
    }

    const result = this.db.prepare(query).get(...params) as { count: number };
    return result.count;
  }

  // Store embedding for a memory entry
  storeEmbedding(id: string, embedding: number[]): void {
    const buffer = Buffer.from(new Float32Array(embedding).buffer);
    this.db
      .prepare('UPDATE memory SET embedding = ?, updated_at = ? WHERE id = ?')
      .run(buffer, Date.now(), id);
  }

  // Get all entries with embeddings for vector search
  getEntriesWithEmbeddings(namespace?: string): Array<{ id: string; embedding: number[] }> {
    let query = `
      SELECT id, embedding
      FROM memory
      WHERE embedding IS NOT NULL
    `;
    const params: string[] = [];

    if (namespace) {
      query += ' AND namespace = ?';
      params.push(namespace);
    }

    const rows = this.db.prepare(query).all(...params) as Array<{ id: string; embedding: Buffer }>;

    return rows.map(row => ({
      id: row.id,
      embedding: Array.from(new Float32Array(row.embedding.buffer)),
    }));
  }

  private rowToEntry(row: MemoryRow): MemoryEntry {
    return {
      id: row.id,
      key: row.key,
      namespace: row.namespace,
      content: row.content,
      embedding: row.embedding
        ? new Float32Array(row.embedding.buffer)
        : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  // ==================== Session Operations ====================

  createSession(metadata?: Record<string, unknown>): Session {
    const id = randomUUID();
    const now = Date.now();
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    this.db
      .prepare(`
        INSERT INTO sessions (id, status, started_at, metadata)
        VALUES (?, 'active', ?, ?)
      `)
      .run(id, now, metadataJson);

    return {
      id,
      status: 'active',
      startedAt: new Date(now),
      metadata,
    };
  }

  getSession(id: string): Session | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as SessionRow | undefined;

    return row ? this.rowToSession(row) : null;
  }

  endSession(id: string): boolean {
    const result = this.db
      .prepare(`
        UPDATE sessions
        SET status = 'ended', ended_at = ?
        WHERE id = ? AND status = 'active'
      `)
      .run(Date.now(), id);

    return result.changes > 0;
  }

  getActiveSession(): Session | null {
    const row = this.db
      .prepare(`
        SELECT * FROM sessions
        WHERE status = 'active'
        ORDER BY started_at DESC
        LIMIT 1
      `)
      .get() as SessionRow | undefined;

    return row ? this.rowToSession(row) : null;
  }

  private rowToSession(row: SessionRow): Session {
    return {
      id: row.id,
      status: row.status as Session['status'],
      startedAt: new Date(row.started_at),
      endedAt: row.ended_at ? new Date(row.ended_at) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined,
    };
  }

  // ==================== Task Operations ====================

  createTask(
    agentType: string,
    input?: string,
    sessionId?: string
  ): Task {
    const id = randomUUID();
    const now = Date.now();

    this.db
      .prepare(`
        INSERT INTO tasks (id, session_id, agent_type, status, input, created_at)
        VALUES (?, ?, ?, 'pending', ?, ?)
      `)
      .run(id, sessionId ?? null, agentType, input ?? null, now);

    return {
      id,
      sessionId,
      agentType,
      status: 'pending',
      input,
      createdAt: new Date(now),
    };
  }

  getTask(id: string): Task | null {
    const row = this.db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(id) as TaskRow | undefined;

    return row ? this.rowToTask(row) : null;
  }

  updateTaskStatus(
    id: string,
    status: Task['status'],
    output?: string
  ): boolean {
    const completedAt = status === 'completed' || status === 'failed' ? Date.now() : null;

    const result = this.db
      .prepare(`
        UPDATE tasks
        SET status = ?, output = ?, completed_at = ?
        WHERE id = ?
      `)
      .run(status, output ?? null, completedAt, id);

    return result.changes > 0;
  }

  listTasks(sessionId?: string, status?: Task['status']): Task[] {
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params: string[] = [];

    if (sessionId) {
      query += ' AND session_id = ?';
      params.push(sessionId);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(query).all(...params) as TaskRow[];
    return rows.map(row => this.rowToTask(row));
  }

  private rowToTask(row: TaskRow): Task {
    return {
      id: row.id,
      sessionId: row.session_id ?? undefined,
      agentType: row.agent_type,
      status: row.status as Task['status'],
      input: row.input ?? undefined,
      output: row.output ?? undefined,
      createdAt: new Date(row.created_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    };
  }

  // ==================== Cleanup ====================

  close(): void {
    this.db.close();
    log.debug('SQLite store closed');
  }

  vacuum(): void {
    this.db.exec('VACUUM');
    log.debug('Database vacuumed');
  }
}

// Row types for SQLite results
interface MemoryRow {
  id: string;
  key: string;
  namespace: string;
  content: string;
  embedding: Buffer | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

interface SessionRow {
  id: string;
  status: string;
  started_at: number;
  ended_at: number | null;
  metadata: string | null;
}

interface TaskRow {
  id: string;
  session_id: string | null;
  agent_type: string;
  status: string;
  input: string | null;
  output: string | null;
  created_at: number;
  completed_at: number | null;
}
