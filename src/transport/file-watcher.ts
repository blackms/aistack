/**
 * File watcher transport - watches a directory and enqueues tasks when files
 * matching a glob-like pattern are added.
 *
 * Uses Node's built-in `fs.watch` (recursive on Windows & macOS, falls back to
 * polling on Linux when recursive isn't supported). Avoids adding chokidar as
 * a runtime dep to keep the package light; users with complex needs can build
 * their own transport on top of DaemonRuntime.enqueue().
 */

import { watch, existsSync, readFileSync, statSync, readdirSync, type FSWatcher } from 'node:fs';
import { join, basename, extname, resolve } from 'node:path';
import { logger } from '../utils/logger.js';
import type { DaemonRuntime } from '../daemon/index.js';

const log = logger.child('transport:file-watcher');

export interface FileWatcherRule {
  /** Glob-like pattern matched against the basename. Supports '*' and '?' wildcards. */
  pattern: string;
  /** Agent type to dispatch when a file matches. */
  agentType: string;
  /** When true, file contents become task input. When false, the absolute path is the input. */
  readFile?: boolean;
}

export interface FileWatcherConfig {
  /** Absolute directory to watch. */
  dir: string;
  rules: FileWatcherRule[];
  /** Watch subdirectories recursively (default true). */
  recursive?: boolean;
  /** Debounce window in ms before enqueuing a freshly-seen file (default 250). */
  debounceMs?: number;
}

/**
 * Convert a glob-like pattern (supporting * and ?) to a RegExp anchored on the
 * basename. Intentionally simple — no brace expansion, no extglob.
 */
export function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (const ch of pattern) {
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else if (/[.+^${}()|[\]\\]/.test(ch)) re += '\\' + ch;
    else re += ch;
  }
  return new RegExp(`^${re}$`);
}

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private readonly seen = new Map<string, NodeJS.Timeout>();
  private readonly compiledRules: Array<FileWatcherRule & { re: RegExp }>;
  private readonly debounceMs: number;
  private readonly recursive: boolean;

  constructor(
    private readonly runtime: DaemonRuntime,
    private readonly config: FileWatcherConfig,
  ) {
    if (!config.dir || !existsSync(config.dir)) {
      throw new Error(`watch directory does not exist: ${config.dir}`);
    }
    this.compiledRules = config.rules.map(r => ({ ...r, re: globToRegExp(r.pattern) }));
    this.debounceMs = config.debounceMs ?? 250;
    this.recursive = config.recursive ?? true;
  }

  start(): void {
    const dir = resolve(this.config.dir);
    try {
      this.watcher = watch(dir, { recursive: this.recursive }, (_event, filename) => {
        if (!filename) return;
        this.handleChange(join(dir, filename.toString()));
      });
    } catch (err) {
      // Recursive watch unsupported on some Linux kernels — fall back to polling
      log.warn('fs.watch failed (likely no recursive support); falling back to interval poll', {
        error: (err as Error).message,
      });
      this.startPollingFallback(dir);
      return;
    }
    log.info('File watcher started', { dir, rules: this.compiledRules.length });
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.seen.values()) clearTimeout(timer);
    this.seen.clear();
  }

  private handleChange(absPath: string): void {
    // Skip if file vanished between event and inspection
    if (!existsSync(absPath)) return;
    try {
      if (!statSync(absPath).isFile()) return;
    } catch {
      return;
    }

    const name = basename(absPath);
    const rule = this.compiledRules.find(r => r.re.test(name));
    if (!rule) return;

    // Debounce: collapse rapid duplicate events for the same path
    const existing = this.seen.get(absPath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.seen.delete(absPath);
      void this.dispatch(absPath, rule);
    }, this.debounceMs);
    this.seen.set(absPath, timer);
  }

  private async dispatch(absPath: string, rule: FileWatcherRule & { re: RegExp }): Promise<void> {
    let input: string;
    if (rule.readFile) {
      try {
        input = readFileSync(absPath, 'utf-8');
      } catch (err) {
        log.warn('Failed to read watched file', { absPath, error: (err as Error).message });
        return;
      }
    } else {
      input = absPath;
    }
    try {
      await this.runtime.enqueue({
        agentType: rule.agentType,
        input,
        source: 'file-watcher',
        metadata: { path: absPath, pattern: rule.pattern, ext: extname(absPath) },
      });
      log.debug('Enqueued task from file watcher', { absPath, pattern: rule.pattern });
    } catch (err) {
      log.error('Enqueue from file watcher failed', { absPath, error: (err as Error).message });
    }
  }

  private startPollingFallback(dir: string): void {
    const knownFiles = new Set<string>();
    const seed = (d: string): void => {
      try {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
          const full = join(d, entry.name);
          if (entry.isDirectory() && this.recursive) seed(full);
          else if (entry.isFile()) knownFiles.add(full);
        }
      } catch { /* ignore */ }
    };
    seed(dir);

    const interval = setInterval(() => {
      const scan = (d: string): void => {
        try {
          for (const entry of readdirSync(d, { withFileTypes: true })) {
            const full = join(d, entry.name);
            if (entry.isDirectory() && this.recursive) scan(full);
            else if (entry.isFile() && !knownFiles.has(full)) {
              knownFiles.add(full);
              this.handleChange(full);
            }
          }
        } catch { /* ignore */ }
      };
      scan(dir);
    }, Math.max(this.debounceMs * 2, 500));

    // Stash interval on watcher so stop() can clean up
    this.watcher = { close: () => clearInterval(interval) } as unknown as FSWatcher;
  }
}
