/**
 * Hot-reload watcher for workflow YAML/JSON files.
 *
 * Uses native `fs.watch` (no external `chokidar` dep) with a small debounce
 * window so editors that write-via-rename don't trigger spurious double-runs.
 *
 * Usage:
 *   const w = watchWorkflowFile('./flow.yaml', async (doc) => { ... });
 *   ...
 *   w.close();
 */

import { watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parseWorkflow, WorkflowParseError } from './parser.js';
import type { WorkflowDoc } from './schema.js';

export interface HotReloadOptions {
  debounceMs?: number;
  onError?: (err: Error) => void;
}

export interface HotReloadHandle {
  close(): void;
}

export async function readAndParse(path: string): Promise<WorkflowDoc> {
  const content = await readFile(path, 'utf-8');
  return parseWorkflow(content);
}

/**
 * Watch a workflow file. The callback is invoked once on startup with the
 * initial parse, then again on every change (debounced). Parse errors are
 * surfaced via `onError` (or rethrown if not supplied) without tearing down
 * the watcher — so users can fix typos in place.
 */
export async function watchWorkflowFile(
  path: string,
  onChange: (doc: WorkflowDoc) => void | Promise<void>,
  opts: HotReloadOptions = {}
): Promise<HotReloadHandle> {
  const debounceMs = opts.debounceMs ?? 200;
  const onError =
    opts.onError ??
    ((err: Error) => {
      // Default: log + swallow so the watcher keeps running.
      // eslint-disable-next-line no-console
      console.error('[workflow:hot-reload]', err.message);
    });

  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let pendingRerun = false;

  const trigger = async (): Promise<void> => {
    if (running) {
      pendingRerun = true;
      return;
    }
    running = true;
    try {
      const doc = await readAndParse(path);
      await onChange(doc);
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      running = false;
      if (pendingRerun) {
        pendingRerun = false;
        void trigger();
      }
    }
  };

  // Initial load
  await trigger();

  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(path, { persistent: true }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void trigger();
      }, debounceMs);
    });
  } catch (err) {
    onError(
      err instanceof Error
        ? new Error(`Failed to watch ${path}: ${err.message}`)
        : new Error(String(err))
    );
  }

  return {
    close: () => {
      if (timer) clearTimeout(timer);
      if (watcher) {
        try {
          watcher.close();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

export { WorkflowParseError };
