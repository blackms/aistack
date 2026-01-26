/**
 * SQLite-based memory store with FTS5 full-text search
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  MemoryEntry,
  MemoryStoreOptions,
  Session,
  Task,
  Project,
  ProjectTask,
  Specification,
  TaskPhase,
  SpecificationType,
  SpecificationStatus,
  ReviewComment,
  SpawnedAgent,
  AgentStatus,
  ReviewLoopState,
} from '../types.js';
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

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);

-- Project Tasks table
CREATE TABLE IF NOT EXISTS project_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  phase TEXT NOT NULL DEFAULT 'draft',
  priority INTEGER DEFAULT 5,
  assigned_agents TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_phase ON project_tasks(phase);
CREATE INDEX IF NOT EXISTS idx_project_tasks_updated ON project_tasks(updated_at DESC);

-- Specifications table
CREATE TABLE IF NOT EXISTS specifications (
  id TEXT PRIMARY KEY,
  project_task_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT NOT NULL,
  reviewed_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  approved_at INTEGER,
  comments TEXT,
  FOREIGN KEY (project_task_id) REFERENCES project_tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_specifications_task ON specifications(project_task_id);
CREATE INDEX IF NOT EXISTS idx_specifications_status ON specifications(status);

-- Active Agents table for state persistence
CREATE TABLE IF NOT EXISTS active_agents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  session_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_active_agents_status ON active_agents(status);
CREATE INDEX IF NOT EXISTS idx_active_agents_session ON active_agents(session_id);
CREATE INDEX IF NOT EXISTS idx_active_agents_name ON active_agents(name);

-- Review Loops table for state persistence
CREATE TABLE IF NOT EXISTS review_loops (
  id TEXT PRIMARY KEY,
  coder_id TEXT NOT NULL,
  adversarial_id TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL,
  iteration INTEGER DEFAULT 0,
  max_iterations INTEGER DEFAULT 3,
  code_input TEXT NOT NULL,
  current_code TEXT,
  reviews TEXT,
  final_verdict TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_review_loops_status ON review_loops(status);
CREATE INDEX IF NOT EXISTS idx_review_loops_session ON review_loops(session_id);
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

  // ==================== Project Operations ====================

  createProject(
    name: string,
    path: string,
    description?: string,
    metadata?: Record<string, unknown>
  ): Project {
    const id = randomUUID();
    const now = Date.now();
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    this.db
      .prepare(`
        INSERT INTO projects (id, name, description, path, status, created_at, updated_at, metadata)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
      `)
      .run(id, name, description ?? null, path, now, now, metadataJson);

    return {
      id,
      name,
      description,
      path,
      status: 'active',
      createdAt: new Date(now),
      updatedAt: new Date(now),
      metadata,
    };
  }

  getProject(id: string): Project | null {
    const row = this.db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id) as ProjectRow | undefined;

    return row ? this.rowToProject(row) : null;
  }

  updateProject(
    id: string,
    updates: Partial<Pick<Project, 'name' | 'description' | 'status' | 'metadata'>>
  ): boolean {
    const project = this.getProject(id);
    if (!project) return false;

    const now = Date.now();
    const fields: string[] = ['updated_at = ?'];
    const params: (string | number | null)[] = [now];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      params.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      params.push(updates.description ?? null);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      params.push(updates.status);
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      params.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
    }

    params.push(id);

    const result = this.db
      .prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`)
      .run(...params);

    return result.changes > 0;
  }

  listProjects(status?: Project['status']): Project[] {
    let query = 'SELECT * FROM projects';
    const params: string[] = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY updated_at DESC';

    const rows = this.db.prepare(query).all(...params) as ProjectRow[];
    return rows.map(row => this.rowToProject(row));
  }

  deleteProject(id: string): boolean {
    // Use transaction to ensure atomic deletion of project and related data
    return this.transaction((db) => {
      // First delete related project tasks
      const tasks = this.listProjectTasks(id);
      for (const task of tasks) {
        db.prepare('DELETE FROM project_tasks WHERE id = ?').run(task.id);
      }

      // Delete project specifications
      db.prepare('DELETE FROM specifications WHERE project_id = ?').run(id);

      // Delete the project itself
      const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);

      return result.changes > 0;
    });
  }

  private rowToProject(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      path: row.path,
      status: row.status as Project['status'],
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined,
    };
  }

  // ==================== Project Task Operations ====================

  createProjectTask(
    projectId: string,
    title: string,
    options?: {
      description?: string;
      priority?: number;
      assignedAgents?: string[];
      sessionId?: string;
    }
  ): ProjectTask {
    const id = randomUUID();
    const now = Date.now();

    this.db
      .prepare(`
        INSERT INTO project_tasks (id, project_id, session_id, title, description, phase, priority, assigned_agents, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
      `)
      .run(
        id,
        projectId,
        options?.sessionId ?? null,
        title,
        options?.description ?? null,
        options?.priority ?? 5,
        options?.assignedAgents ? JSON.stringify(options.assignedAgents) : null,
        now,
        now
      );

    return {
      id,
      projectId,
      sessionId: options?.sessionId,
      title,
      description: options?.description,
      phase: 'draft',
      priority: options?.priority ?? 5,
      assignedAgents: options?.assignedAgents ?? [],
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  getProjectTask(id: string): ProjectTask | null {
    const row = this.db
      .prepare('SELECT * FROM project_tasks WHERE id = ?')
      .get(id) as ProjectTaskRow | undefined;

    return row ? this.rowToProjectTask(row) : null;
  }

  updateProjectTask(
    id: string,
    updates: Partial<Pick<ProjectTask, 'title' | 'description' | 'priority' | 'assignedAgents' | 'sessionId'>>
  ): boolean {
    const task = this.getProjectTask(id);
    if (!task) return false;

    const now = Date.now();
    const fields: string[] = ['updated_at = ?'];
    const params: (string | number | null)[] = [now];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      params.push(updates.title);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      params.push(updates.description ?? null);
    }
    if (updates.priority !== undefined) {
      fields.push('priority = ?');
      params.push(updates.priority);
    }
    if (updates.assignedAgents !== undefined) {
      fields.push('assigned_agents = ?');
      params.push(updates.assignedAgents.length > 0 ? JSON.stringify(updates.assignedAgents) : null);
    }
    if (updates.sessionId !== undefined) {
      fields.push('session_id = ?');
      params.push(updates.sessionId ?? null);
    }

    params.push(id);

    const result = this.db
      .prepare(`UPDATE project_tasks SET ${fields.join(', ')} WHERE id = ?`)
      .run(...params);

    return result.changes > 0;
  }

  updateProjectTaskPhase(id: string, phase: TaskPhase): boolean {
    const now = Date.now();
    const completedAt = phase === 'completed' || phase === 'cancelled' ? now : null;

    const result = this.db
      .prepare(`
        UPDATE project_tasks
        SET phase = ?, updated_at = ?, completed_at = ?
        WHERE id = ?
      `)
      .run(phase, now, completedAt, id);

    return result.changes > 0;
  }

  listProjectTasks(projectId: string, phase?: TaskPhase): ProjectTask[] {
    let query = 'SELECT * FROM project_tasks WHERE project_id = ?';
    const params: string[] = [projectId];

    if (phase) {
      query += ' AND phase = ?';
      params.push(phase);
    }

    query += ' ORDER BY priority ASC, updated_at DESC';

    const rows = this.db.prepare(query).all(...params) as ProjectTaskRow[];
    return rows.map(row => this.rowToProjectTask(row));
  }

  deleteProjectTask(id: string): boolean {
    // Use transaction to ensure atomic deletion
    return this.transaction((db) => {
      // First delete related specifications
      db.prepare('DELETE FROM specifications WHERE project_task_id = ?').run(id);

      // Delete the task itself
      const result = db.prepare('DELETE FROM project_tasks WHERE id = ?').run(id);

      return result.changes > 0;
    });
  }

  private rowToProjectTask(row: ProjectTaskRow): ProjectTask {
    return {
      id: row.id,
      projectId: row.project_id,
      sessionId: row.session_id ?? undefined,
      title: row.title,
      description: row.description ?? undefined,
      phase: row.phase as TaskPhase,
      priority: row.priority,
      assignedAgents: row.assigned_agents ? JSON.parse(row.assigned_agents) as string[] : [],
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    };
  }

  // ==================== Specification Operations ====================

  createSpecification(
    projectTaskId: string,
    type: SpecificationType,
    title: string,
    content: string,
    createdBy: string
  ): Specification {
    const id = randomUUID();
    const now = Date.now();

    this.db
      .prepare(`
        INSERT INTO specifications (id, project_task_id, type, title, content, version, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 'draft', ?, ?, ?)
      `)
      .run(id, projectTaskId, type, title, content, createdBy, now, now);

    return {
      id,
      projectTaskId,
      type,
      title,
      content,
      version: 1,
      status: 'draft',
      createdBy,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  getSpecification(id: string): Specification | null {
    const row = this.db
      .prepare('SELECT * FROM specifications WHERE id = ?')
      .get(id) as SpecificationRow | undefined;

    return row ? this.rowToSpecification(row) : null;
  }

  updateSpecification(
    id: string,
    updates: Partial<Pick<Specification, 'title' | 'content' | 'type'>>
  ): boolean {
    const spec = this.getSpecification(id);
    if (!spec) return false;

    const now = Date.now();
    const fields: string[] = ['updated_at = ?', 'version = version + 1'];
    const params: (string | number | null)[] = [now];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      params.push(updates.title);
    }
    if (updates.content !== undefined) {
      fields.push('content = ?');
      params.push(updates.content);
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      params.push(updates.type);
    }

    params.push(id);

    const result = this.db
      .prepare(`UPDATE specifications SET ${fields.join(', ')} WHERE id = ?`)
      .run(...params);

    return result.changes > 0;
  }

  updateSpecificationStatus(
    id: string,
    status: SpecificationStatus,
    reviewedBy?: string,
    comments?: ReviewComment[]
  ): boolean {
    const now = Date.now();
    const approvedAt = status === 'approved' ? now : null;
    const commentsJson = comments ? JSON.stringify(comments) : null;

    const result = this.db
      .prepare(`
        UPDATE specifications
        SET status = ?, reviewed_by = ?, approved_at = ?, comments = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(status, reviewedBy ?? null, approvedAt, commentsJson, now, id);

    return result.changes > 0;
  }

  listSpecifications(projectTaskId: string, status?: SpecificationStatus): Specification[] {
    let query = 'SELECT * FROM specifications WHERE project_task_id = ?';
    const params: string[] = [projectTaskId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(query).all(...params) as SpecificationRow[];
    return rows.map(row => this.rowToSpecification(row));
  }

  deleteSpecification(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM specifications WHERE id = ?')
      .run(id);

    return result.changes > 0;
  }

  private rowToSpecification(row: SpecificationRow): Specification {
    return {
      id: row.id,
      projectTaskId: row.project_task_id,
      type: row.type as SpecificationType,
      title: row.title,
      content: row.content,
      version: row.version,
      status: row.status as SpecificationStatus,
      createdBy: row.created_by,
      reviewedBy: row.reviewed_by ?? undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      approvedAt: row.approved_at ? new Date(row.approved_at) : undefined,
      comments: row.comments ? JSON.parse(row.comments) as ReviewComment[] : undefined,
    };
  }

  // ==================== Active Agents Persistence ====================

  /**
   * Save active agent state
   */
  saveActiveAgent(agent: SpawnedAgent): void {
    const now = Date.now();
    const metadataJson = agent.metadata ? JSON.stringify(agent.metadata) : null;

    const existing = this.db
      .prepare('SELECT id FROM active_agents WHERE id = ?')
      .get(agent.id);

    if (existing) {
      this.db
        .prepare(`
          UPDATE active_agents
          SET type = ?, name = ?, status = ?, session_id = ?, updated_at = ?, metadata = ?
          WHERE id = ?
        `)
        .run(
          agent.type,
          agent.name,
          agent.status,
          agent.sessionId ?? null,
          now,
          metadataJson,
          agent.id
        );
    } else {
      this.db
        .prepare(`
          INSERT INTO active_agents (id, type, name, status, session_id, created_at, updated_at, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          agent.id,
          agent.type,
          agent.name,
          agent.status,
          agent.sessionId ?? null,
          agent.createdAt.getTime(),
          now,
          metadataJson
        );
    }
  }

  /**
   * Load active agents
   */
  loadActiveAgents(): SpawnedAgent[] {
    const rows = this.db
      .prepare('SELECT * FROM active_agents WHERE status IN (?, ?, ?)')
      .all('idle', 'running', 'stopped') as any[];

    return rows.map(row => ({
      id: row.id,
      type: row.type,
      name: row.name,
      status: row.status as AgentStatus,
      sessionId: row.session_id ?? undefined,
      createdAt: new Date(row.created_at),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  /**
   * Delete active agent
   */
  deleteActiveAgent(agentId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM active_agents WHERE id = ?')
      .run(agentId);

    return result.changes > 0;
  }

  /**
   * Update agent status
   */
  updateAgentStatus(agentId: string, status: AgentStatus): boolean {
    const now = Date.now();
    const result = this.db
      .prepare('UPDATE active_agents SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, agentId);

    return result.changes > 0;
  }

  /**
   * Clear completed/failed agents
   */
  clearInactiveAgents(): void {
    this.db
      .prepare('DELETE FROM active_agents WHERE status IN (?, ?)')
      .run('completed', 'failed');
  }

  // ==================== Review Loops Persistence ====================

  /**
   * Save review loop state
   */
  saveReviewLoop(loopId: string, state: ReviewLoopState): void {
    const now = Date.now();
    const reviewsJson = JSON.stringify(state.reviews);
    const finalVerdictJson = state.finalVerdict ? JSON.stringify(state.finalVerdict) : null;

    const existing = this.db
      .prepare('SELECT id FROM review_loops WHERE id = ?')
      .get(loopId);

    if (existing) {
      this.db
        .prepare(`
          UPDATE review_loops
          SET status = ?, iteration = ?, current_code = ?, reviews = ?,
              final_verdict = ?, updated_at = ?, completed_at = ?
          WHERE id = ?
        `)
        .run(
          state.status,
          state.iteration,
          state.currentCode ?? null,
          reviewsJson,
          finalVerdictJson,
          now,
          state.completedAt?.getTime() ?? null,
          loopId
        );
    } else {
      this.db
        .prepare(`
          INSERT INTO review_loops (
            id, coder_id, adversarial_id, session_id, status,
            iteration, max_iterations, code_input, current_code,
            reviews, final_verdict, created_at, updated_at, completed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          loopId,
          state.coderId,
          state.adversarialId,
          state.sessionId ?? null,
          state.status,
          state.iteration,
          state.maxIterations,
          state.codeInput,
          state.currentCode ?? null,
          reviewsJson,
          finalVerdictJson,
          state.startedAt.getTime(),
          now,
          state.completedAt?.getTime() ?? null
        );
    }
  }

  /**
   * Load review loop state
   */
  loadReviewLoop(loopId: string): ReviewLoopState | null {
    const row = this.db
      .prepare('SELECT * FROM review_loops WHERE id = ?')
      .get(loopId) as any;

    if (!row) return null;

    return {
      id: row.id,
      coderId: row.coder_id,
      adversarialId: row.adversarial_id,
      sessionId: row.session_id ?? undefined,
      status: row.status,
      iteration: row.iteration,
      maxIterations: row.max_iterations,
      codeInput: row.code_input,
      currentCode: row.current_code ?? undefined,
      reviews: JSON.parse(row.reviews),
      finalVerdict: row.final_verdict ? JSON.parse(row.final_verdict) : undefined,
      startedAt: new Date(row.created_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    };
  }

  /**
   * Load active review loops
   */
  loadActiveReviewLoops(): ReviewLoopState[] {
    const rows = this.db
      .prepare('SELECT * FROM review_loops WHERE status IN (?, ?, ?, ?)')
      .all('pending', 'coding', 'reviewing', 'fixing') as any[];

    return rows.map(row => ({
      id: row.id,
      coderId: row.coder_id,
      adversarialId: row.adversarial_id,
      sessionId: row.session_id ?? undefined,
      status: row.status,
      iteration: row.iteration,
      maxIterations: row.max_iterations,
      codeInput: row.code_input,
      currentCode: row.current_code ?? undefined,
      reviews: JSON.parse(row.reviews),
      finalVerdict: row.final_verdict ? JSON.parse(row.final_verdict) : undefined,
      startedAt: new Date(row.created_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    }));
  }

  /**
   * Delete review loop
   */
  deleteReviewLoop(loopId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM review_loops WHERE id = ?')
      .run(loopId);

    return result.changes > 0;
  }

  /**
   * Clear completed review loops
   */
  clearCompletedReviewLoops(): void {
    this.db
      .prepare('DELETE FROM review_loops WHERE status IN (?, ?)')
      .run('approved', 'failed');
  }

  // ==================== Cleanup ====================

  /**
   * Get the underlying database instance
   * Used for authentication and other features that need direct DB access
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  /**
   * Execute a function within a transaction
   * Automatically commits on success and rolls back on error
   */
  transaction<T>(fn: (db: Database.Database) => T): T {
    const transaction = this.db.transaction(fn);
    return transaction(this.db);
  }

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

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  path: string;
  status: string;
  created_at: number;
  updated_at: number;
  metadata: string | null;
}

interface ProjectTaskRow {
  id: string;
  project_id: string;
  session_id: string | null;
  title: string;
  description: string | null;
  phase: string;
  priority: number;
  assigned_agents: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface SpecificationRow {
  id: string;
  project_task_id: string;
  type: string;
  title: string;
  content: string;
  version: number;
  status: string;
  created_by: string;
  reviewed_by: string | null;
  created_at: number;
  updated_at: number;
  approved_at: number | null;
  comments: string | null;
}
