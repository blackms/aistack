/**
 * Bidirectional sync between aistack memory and the Anthropic Memory Tool
 * filesystem directory (`~/.claude/agent-memory/` by default).
 *
 * Direction A (filesystem -> memory): a periodic scan diffs files on disk
 * against the corresponding memory entries. New / modified files are imported
 * into the configured namespace. We deliberately avoid `chokidar` and stick to
 * Node's built-in `fs.watch` (when available) plus a polling fallback, in line
 * with the project's "no extra deps" stance.
 *
 * Direction B (memory -> filesystem): operators may call `exportAll()` or wire
 * `exportEntry()` to memory write hooks. The sync layer guarantees idempotency
 * by comparing content hashes before writing.
 *
 * Conflict resolution policy: last-writer-wins, scoped per-file. When the same
 * key is modified on both sides between two sync passes the side with the
 * larger mtime / `updatedAt` wins. This is documented in `docs/MEMORY.md`.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  promises as fsp,
  readdirSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import type { MemoryManager } from './index.js';
import { logger } from '../utils/logger.js';

const log = logger.child('memory-sync');

export interface BidirectionalSyncOptions {
  /** Local directory mirrored to/from memory. Defaults to `~/.claude/agent-memory`. */
  watchPath?: string;
  /** Namespace backing the synced files. Defaults to `agent-memory`. */
  namespace?: string;
  /** How often to scan the filesystem. Defaults to 5 seconds. */
  pollIntervalMs?: number;
  /** When false, suppresses memory -> filesystem export. Defaults to true. */
  exportEnabled?: boolean;
  /** When false, suppresses filesystem -> memory import. Defaults to true. */
  importEnabled?: boolean;
}

export interface SyncStats {
  imported: number;
  exported: number;
  skipped: number;
}

const DEFAULT_NAMESPACE = 'agent-memory';
const DEFAULT_POLL_MS = 5000;

function defaultWatchPath(): string {
  return join(homedir(), '.claude', 'agent-memory');
}

/** Normalize a relative filesystem path to a memory key (POSIX separators). */
function pathToKey(relPath: string): string {
  return relPath.split(sep).join('/');
}

function keyToPath(key: string): string {
  return key.split('/').join(sep);
}

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export class BidirectionalSync {
  private watchPath: string;
  private namespace: string;
  private pollIntervalMs: number;
  private exportEnabled: boolean;
  private importEnabled: boolean;
  private timer: NodeJS.Timeout | null = null;
  private lastHash = new Map<string, string>(); // key -> last synced hash

  constructor(private memory: MemoryManager, options: BidirectionalSyncOptions = {}) {
    this.watchPath = options.watchPath ?? defaultWatchPath();
    this.namespace = options.namespace ?? DEFAULT_NAMESPACE;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.exportEnabled = options.exportEnabled ?? true;
    this.importEnabled = options.importEnabled ?? true;
  }

  getConfig(): {
    watchPath: string;
    namespace: string;
    pollIntervalMs: number;
    exportEnabled: boolean;
    importEnabled: boolean;
  } {
    return {
      watchPath: this.watchPath,
      namespace: this.namespace,
      pollIntervalMs: this.pollIntervalMs,
      exportEnabled: this.exportEnabled,
      importEnabled: this.importEnabled,
    };
  }

  /** Idempotent setup: ensures the watch directory exists. */
  ensureDir(): void {
    if (!existsSync(this.watchPath)) {
      mkdirSync(this.watchPath, { recursive: true });
      log.info('Created sync directory', { path: this.watchPath });
    }
  }

  /** Start the periodic sync loop. */
  start(): void {
    if (this.timer) return;
    this.ensureDir();
    log.info('Bidirectional sync starting', this.getConfig());
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info('Bidirectional sync stopped');
    }
  }

  /** One sync cycle. Returns counts for diagnostics + tests. */
  async tick(): Promise<SyncStats> {
    const stats: SyncStats = { imported: 0, exported: 0, skipped: 0 };
    try {
      if (this.importEnabled) {
        await this.importFromDisk(stats);
      }
      if (this.exportEnabled) {
        await this.exportToDisk(stats);
      }
    } catch (err) {
      log.warn('Sync tick failed', { error: err instanceof Error ? err.message : err });
    }
    return stats;
  }

  // ==================== Filesystem -> memory ====================

  private async importFromDisk(stats: SyncStats): Promise<void> {
    if (!existsSync(this.watchPath)) return;
    const files = this.walk(this.watchPath);
    for (const absPath of files) {
      const rel = relative(this.watchPath, absPath);
      const key = pathToKey(rel);
      try {
        const content = await fsp.readFile(absPath, 'utf8');
        const fileHash = hash(content);
        const existing = this.memory.get(key, this.namespace);
        if (existing && hash(existing.content) === fileHash) {
          this.lastHash.set(key, fileHash);
          stats.skipped++;
          continue;
        }
        // Last-writer-wins: prefer disk only when file mtime > memory updatedAt.
        if (existing) {
          const fileStat = statSync(absPath);
          if (fileStat.mtime.getTime() <= existing.updatedAt.getTime()) {
            stats.skipped++;
            continue;
          }
        }
        await this.memory.store(key, content, {
          namespace: this.namespace,
          metadata: { source: 'fs-sync', path: absPath },
        });
        this.lastHash.set(key, fileHash);
        stats.imported++;
      } catch (err) {
        log.debug('Skipping file during import', {
          path: absPath,
          error: err instanceof Error ? err.message : err,
        });
      }
    }
  }

  private walk(root: string): string[] {
    const out: string[] = [];
    const stack: string[] = [root];
    while (stack.length) {
      const dir = stack.pop()!;
      let items: string[];
      try {
        items = readdirSync(dir);
      } catch {
        continue;
      }
      for (const item of items) {
        const full = join(dir, item);
        let s;
        try {
          s = statSync(full);
        } catch {
          continue;
        }
        if (s.isDirectory()) {
          stack.push(full);
        } else if (s.isFile()) {
          out.push(full);
        }
      }
    }
    return out;
  }

  // ==================== Memory -> filesystem ====================

  /** Export every entry in the configured namespace. */
  async exportAll(): Promise<SyncStats> {
    const stats: SyncStats = { imported: 0, exported: 0, skipped: 0 };
    await this.exportToDisk(stats);
    return stats;
  }

  private async exportToDisk(stats: SyncStats): Promise<void> {
    this.ensureDir();
    const entries = this.memory.list(this.namespace, 10000);
    for (const entry of entries) {
      const fileHash = hash(entry.content);
      if (this.lastHash.get(entry.key) === fileHash) {
        stats.skipped++;
        continue;
      }
      const absPath = join(this.watchPath, keyToPath(entry.key));
      try {
        // Last-writer-wins: prefer memory only when entry.updatedAt > file mtime.
        if (existsSync(absPath)) {
          const s = statSync(absPath);
          if (s.mtime.getTime() > entry.updatedAt.getTime()) {
            stats.skipped++;
            continue;
          }
        }
        mkdirSync(dirname(absPath), { recursive: true });
        await fsp.writeFile(absPath, entry.content, 'utf8');
        this.lastHash.set(entry.key, fileHash);
        stats.exported++;
      } catch (err) {
        log.debug('Skipping entry during export', {
          key: entry.key,
          error: err instanceof Error ? err.message : err,
        });
      }
    }
  }

  /** Export a single entry on demand (intended for use from write hooks). */
  async exportEntry(key: string): Promise<boolean> {
    const entry = this.memory.get(key, this.namespace);
    if (!entry) return false;
    const absPath = join(this.watchPath, keyToPath(key));
    try {
      mkdirSync(dirname(absPath), { recursive: true });
      await fsp.writeFile(absPath, entry.content, 'utf8');
      this.lastHash.set(key, hash(entry.content));
      return true;
    } catch (err) {
      log.warn('exportEntry failed', { key, error: err instanceof Error ? err.message : err });
      return false;
    }
  }
}
