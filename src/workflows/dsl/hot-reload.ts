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

/**
 * Callback signature for `watchWorkflowFile`. Receives the parsed document
 * plus an `AbortSignal` that fires when the file changes again — the callback
 * SHOULD pass this signal through to its executor so the in-flight run is
 * cancelled before the new one starts.
 */
export type WorkflowReloadHandler = (
  doc: WorkflowDoc,
  signal: AbortSignal
) => void | Promise<void>;

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
 *
 * Reload semantics: when a change is detected while a previous run is still
 * in flight, the previous run's AbortController is aborted and the new run
 * starts immediately. This matches user intent ("I just edited the file,
 * please re-run with my new logic") far better than queueing the new run
 * behind a stale one that may take minutes to finish.
 */
export async function watchWorkflowFile(
  path: string,
  onChange: WorkflowReloadHandler,
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
  let currentController: AbortController | null = null;
  let currentRun: Promise<void> | null = null;
  let closed = false;

  const trigger = async (): Promise<void> => {
    // Abort any in-flight run and wait for it to settle so we don't interleave
    // record() writes from two overlapping executors on the same context.
    if (currentController) {
      currentController.abort();
    }
    if (currentRun) {
      try {
        await currentRun;
      } catch {
        /* swallow — handler already routed errors via onError */
      }
    }
    if (closed) return;

    const controller = new AbortController();
    currentController = controller;

    const run = (async () => {
      try {
        const doc = await readAndParse(path);
        await onChange(doc, controller.signal);
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (currentController === controller) {
          currentController = null;
          currentRun = null;
        }
      }
    })();
    currentRun = run;
    await run;
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
      closed = true;
      if (timer) clearTimeout(timer);
      if (currentController) {
        currentController.abort();
      }
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
