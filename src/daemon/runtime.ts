/**
 * Daemon Runtime - background/headless agent runner
 *
 * Provides a long-running daemon process that listens for tasks from multiple
 * transports (webhook, file watcher, CLI async) and dispatches them to agents.
 *
 * Design notes:
 * - No UI dependency: pure Node, only built-in modules at runtime
 * - File-based queue is the default (works without external services)
 * - Graceful shutdown drains in-flight tasks before exiting
 * - All types co-located here to keep daemon module self-contained and avoid
 *   churn on src/types.ts (sibling agents are editing it)
 */

import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, appendFileSync, statSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

const log = logger.child('daemon:runtime');

// ============================================================================
// Types (kept local to avoid sibling-agent merge conflicts in src/types.ts)
// ============================================================================

export type QueueTaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface QueueTask {
  id: string;
  agentType: string;
  input: string;
  source: 'webhook' | 'file-watcher' | 'cli';
  status: QueueTaskStatus;
  createdAt: string; // ISO-8601 string for JSON portability
  startedAt?: string;
  completedAt?: string;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export type QueueBackend = 'file' | 'redis';

export interface DaemonRuntimeConfig {
  /** Directory for queue + log files; defaults to ~/.aistack/daemon */
  dataDir?: string;
  /** Backend identifier; only 'file' implemented natively. */
  queueBackend?: QueueBackend;
  /** Polling interval (ms) for the file queue */
  pollIntervalMs?: number;
  /** Max concurrent in-flight tasks */
  maxConcurrent?: number;
  /** Rotate log file when size exceeds this many bytes (default 5 MiB) */
  logRotationBytes?: number;
  /** Custom task executor; defaults to a no-op that records inputs (real spawn lives in src/agents) */
  executor?: (task: QueueTask) => Promise<string>;
}

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  uptimeMs: number;
  inFlight: number;
  queueDepth: number;
  dataDir: string;
}

// ============================================================================
// File-based queue (default backend)
// ============================================================================

/**
 * Minimal Queue contract. Implementations must be safe under crash/restart
 * (tasks not yet marked completed must remain visible after restart).
 */
export interface Queue {
  enqueue(task: QueueTask): Promise<void>;
  /** Atomically claim the oldest pending task, or return null if empty. */
  claimNext(): Promise<QueueTask | null>;
  /** Mark a previously-claimed task as terminal (completed/failed). */
  complete(task: QueueTask): Promise<void>;
  /** Return current depth of pending tasks. */
  depth(): Promise<number>;
}

export class FileQueue implements Queue {
  private readonly pendingDir: string;
  private readonly inflightDir: string;
  private readonly doneDir: string;

  constructor(rootDir: string) {
    this.pendingDir = join(rootDir, 'pending');
    this.inflightDir = join(rootDir, 'inflight');
    this.doneDir = join(rootDir, 'done');
    for (const d of [this.pendingDir, this.inflightDir, this.doneDir]) {
      if (!existsSync(d)) mkdirSync(d, { recursive: true });
    }
  }

  async enqueue(task: QueueTask): Promise<void> {
    const filename = `${task.createdAt.replace(/[:.]/g, '-')}_${task.id}.json`;
    const tmpPath = join(this.pendingDir, `.${filename}.tmp`);
    const finalPath = join(this.pendingDir, filename);
    // Write-then-rename for atomicity on POSIX + reasonable atomicity on Windows
    writeFileSync(tmpPath, JSON.stringify(task, null, 2), 'utf-8');
    renameSync(tmpPath, finalPath);
  }

  async claimNext(): Promise<QueueTask | null> {
    const files = readdirSync(this.pendingDir)
      .filter(f => f.endsWith('.json') && !f.startsWith('.'))
      .sort(); // lexicographic == chronological because of ISO timestamp prefix

    for (const file of files) {
      const src = join(this.pendingDir, file);
      const dst = join(this.inflightDir, file);
      try {
        renameSync(src, dst); // atomic claim — first writer wins
      } catch {
        continue; // someone else claimed it
      }
      try {
        const raw = readFileSync(dst, 'utf-8');
        const task = JSON.parse(raw) as QueueTask;
        task.status = 'running';
        task.startedAt = new Date().toISOString();
        writeFileSync(dst, JSON.stringify(task, null, 2), 'utf-8');
        return task;
      } catch (err) {
        log.warn('Failed to load claimed task', { file, error: (err as Error).message });
        // Move corrupt file to done with .corrupt suffix so we don't loop on it
        try { renameSync(dst, join(this.doneDir, `${file}.corrupt`)); } catch { /* ignore */ }
      }
    }
    return null;
  }

  async complete(task: QueueTask): Promise<void> {
    const filename = `${task.createdAt.replace(/[:.]/g, '-')}_${task.id}.json`;
    const src = join(this.inflightDir, filename);
    const dst = join(this.doneDir, filename);
    task.completedAt = new Date().toISOString();
    if (existsSync(src)) {
      writeFileSync(src, JSON.stringify(task, null, 2), 'utf-8');
      try { renameSync(src, dst); } catch { /* leave in inflight if rename fails */ }
    } else {
      // Defensive: just write the final state to done/
      writeFileSync(dst, JSON.stringify(task, null, 2), 'utf-8');
    }
  }

  async depth(): Promise<number> {
    if (!existsSync(this.pendingDir)) return 0;
    return readdirSync(this.pendingDir).filter(f => f.endsWith('.json') && !f.startsWith('.')).length;
  }

  /** Recover tasks that were in-flight at shutdown by moving them back to pending. */
  async recoverInflight(): Promise<number> {
    if (!existsSync(this.inflightDir)) return 0;
    let recovered = 0;
    for (const file of readdirSync(this.inflightDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        renameSync(join(this.inflightDir, file), join(this.pendingDir, file));
        recovered++;
      } catch (err) {
        log.warn('Failed to recover inflight task', { file, error: (err as Error).message });
      }
    }
    return recovered;
  }
}

/**
 * Stub for Redis-backed queue. Real implementation would require ioredis
 * as an optionalDependency. Throws so misconfigured users get a clear error.
 */
export class RedisQueueStub implements Queue {
  constructor(_url: string) {
    throw new Error(
      'Redis queue backend is not yet implemented. Install ioredis and configure ' +
      'daemon.redisUrl, then provide your own Queue impl. See docs/DAEMON.md.'
    );
  }
  async enqueue(): Promise<void> { throw new Error('not implemented'); }
  async claimNext(): Promise<QueueTask | null> { throw new Error('not implemented'); }
  async complete(): Promise<void> { throw new Error('not implemented'); }
  async depth(): Promise<number> { throw new Error('not implemented'); }
}

// ============================================================================
// Rotating log writer (zero deps, inlined to keep file count down)
// ============================================================================

export class RotatingLogWriter {
  private currentSize = 0;

  constructor(
    private readonly filePath: string,
    private readonly maxBytes: number,
  ) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (existsSync(filePath)) {
      try { this.currentSize = statSync(filePath).size; } catch { this.currentSize = 0; }
    }
  }

  write(line: string): void {
    const buf = Buffer.from(line.endsWith('\n') ? line : line + '\n', 'utf-8');
    if (this.currentSize + buf.length > this.maxBytes) {
      this.rotate();
    }
    appendFileSync(this.filePath, buf);
    this.currentSize += buf.length;
  }

  private rotate(): void {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedPath = `${this.filePath}.${ts}`;
    try {
      renameSync(this.filePath, rotatedPath);
      this.currentSize = 0;
    } catch (err) {
      log.warn('Log rotation failed', { error: (err as Error).message });
    }
  }
}

// ============================================================================
// DaemonRuntime
// ============================================================================

export class DaemonRuntime extends EventEmitter {
  private readonly dataDir: string;
  private readonly queue: Queue;
  private readonly pollIntervalMs: number;
  private readonly maxConcurrent: number;
  private readonly executor: (task: QueueTask) => Promise<string>;
  private readonly taskLog: RotatingLogWriter;

  private running = false;
  private startedAt = 0;
  private pollTimer: NodeJS.Timeout | null = null;
  private inFlight = new Set<string>();
  private drainPromise: Promise<void> | null = null;

  constructor(config: DaemonRuntimeConfig = {}) {
    super();
    this.dataDir = config.dataDir ?? join(homedir(), '.aistack', 'daemon');
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });

    const backend: QueueBackend = config.queueBackend ?? 'file';
    if (backend === 'redis') {
      this.queue = new RedisQueueStub(''); // throws — informative error
    } else {
      this.queue = new FileQueue(join(this.dataDir, 'queue'));
    }

    this.pollIntervalMs = config.pollIntervalMs ?? 500;
    this.maxConcurrent = config.maxConcurrent ?? 4;
    this.executor = config.executor ?? defaultExecutor;
    this.taskLog = new RotatingLogWriter(
      join(this.dataDir, 'logs', 'tasks.log'),
      config.logRotationBytes ?? 5 * 1024 * 1024,
    );
  }

  /** Start the daemon: recover orphaned inflight tasks, begin polling. */
  async start(): Promise<void> {
    if (this.running) {
      log.warn('Daemon already running');
      return;
    }
    this.running = true;
    this.startedAt = Date.now();

    // Recover tasks that were in-flight when we last shut down (or crashed)
    if (this.queue instanceof FileQueue) {
      const recovered = await this.queue.recoverInflight();
      if (recovered > 0) {
        log.info('Recovered orphaned inflight tasks', { count: recovered });
        this.logTask({ event: 'recover', count: recovered });
      }
    }

    this.writePidFile();
    this.scheduleNextPoll();
    log.info('Daemon started', { dataDir: this.dataDir, maxConcurrent: this.maxConcurrent });
    this.emit('started');
  }

  /** Stop the daemon: drain in-flight tasks, then exit polling loop. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    await this.drain();
    this.removePidFile();
    log.info('Daemon stopped');
    this.emit('stopped');
  }

  /** Wait for all in-flight tasks to complete. Safe to call multiple times. */
  async drain(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = (async () => {
      while (this.inFlight.size > 0) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    })();
    try {
      await this.drainPromise;
    } finally {
      this.drainPromise = null;
    }
  }

  /** Enqueue a task created externally (used by webhook, file-watcher, CLI). */
  async enqueue(partial: Omit<QueueTask, 'id' | 'status' | 'createdAt'> & { id?: string }): Promise<QueueTask> {
    const task: QueueTask = {
      id: partial.id ?? randomUUID(),
      agentType: partial.agentType,
      input: partial.input,
      source: partial.source,
      status: 'pending',
      createdAt: new Date().toISOString(),
      metadata: partial.metadata,
    };
    await this.queue.enqueue(task);
    this.logTask({ event: 'enqueue', taskId: task.id, source: task.source, agentType: task.agentType });
    this.emit('task:enqueued', task);
    return task;
  }

  async status(): Promise<DaemonStatus> {
    return {
      running: this.running,
      pid: this.running ? process.pid : null,
      uptimeMs: this.running ? Date.now() - this.startedAt : 0,
      inFlight: this.inFlight.size,
      queueDepth: await this.queue.depth(),
      dataDir: this.dataDir,
    };
  }

  /** Expose underlying queue for tests / advanced integrations. */
  getQueue(): Queue {
    return this.queue;
  }

  // --- internal -------------------------------------------------------------

  private scheduleNextPoll(): void {
    if (!this.running) return;
    this.pollTimer = setTimeout(() => {
      void this.poll().finally(() => this.scheduleNextPoll());
    }, this.pollIntervalMs);
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    while (this.inFlight.size < this.maxConcurrent) {
      const task = await this.queue.claimNext();
      if (!task) return;
      this.inFlight.add(task.id);
      this.logTask({ event: 'start', taskId: task.id, agentType: task.agentType });
      this.emit('task:started', task);
      // Fire-and-track; do not await — concurrency handled by inFlight set
      void this.runTask(task);
    }
  }

  private async runTask(task: QueueTask): Promise<void> {
    try {
      const output = await this.executor(task);
      task.status = 'completed';
      task.output = output;
      await this.queue.complete(task);
      this.logTask({ event: 'complete', taskId: task.id });
      this.emit('task:completed', task);
    } catch (err) {
      task.status = 'failed';
      task.error = err instanceof Error ? err.message : String(err);
      await this.queue.complete(task);
      this.logTask({ event: 'failed', taskId: task.id, error: task.error });
      this.emit('task:failed', task);
    } finally {
      this.inFlight.delete(task.id);
    }
  }

  private logTask(payload: Record<string, unknown>): void {
    try {
      this.taskLog.write(JSON.stringify({ ts: new Date().toISOString(), ...payload }));
    } catch (err) {
      log.warn('Task log write failed', { error: (err as Error).message });
    }
  }

  private pidFilePath(): string {
    return join(this.dataDir, 'daemon.pid');
  }

  private writePidFile(): void {
    try {
      writeFileSync(this.pidFilePath(), String(process.pid), 'utf-8');
    } catch (err) {
      log.warn('PID file write failed', { error: (err as Error).message });
    }
  }

  private removePidFile(): void {
    try {
      if (existsSync(this.pidFilePath())) unlinkSync(this.pidFilePath());
    } catch { /* best-effort */ }
  }
}

/**
 * Default executor used when no custom executor is provided.
 * Intentionally minimal: it records receipt and echoes the input. Real agent
 * dispatch (spawnAgent + executeAgent) is wired by the CLI command, which
 * passes a richer executor at construction time.
 */
async function defaultExecutor(task: QueueTask): Promise<string> {
  log.debug('Default executor invoked', { taskId: task.id, agentType: task.agentType });
  return JSON.stringify({
    note: 'default-executor: no real agent dispatch wired',
    taskId: task.id,
    agentType: task.agentType,
    inputPreview: task.input.slice(0, 200),
  });
}

/** Read the pid file for a given data dir (used by `daemon status/stop` CLI). */
export function readDaemonPid(dataDir: string): number | null {
  const pidFile = join(dataDir, 'daemon.pid');
  if (!existsSync(pidFile)) return null;
  try {
    const raw = readFileSync(pidFile, 'utf-8').trim();
    const pid = parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Default data directory for the daemon, used across CLI and tests. */
export function defaultDaemonDataDir(): string {
  return join(homedir(), '.aistack', 'daemon');
}
