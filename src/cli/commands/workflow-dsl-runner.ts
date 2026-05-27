/**
 * CLI bridge for the DSL executor.
 *
 * Wires the workflow-DSL runtime to the production agent spawner so
 * `aistack workflow run <file.yaml>` actually invokes agents.
 *
 * Kept in its own file so the legacy `workflow run` named-workflow path
 * stays untouched and the heavy imports (agent spawner, memory, etc.) are
 * loaded lazily only when DSL mode is used.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  parseWorkflow,
  runWorkflow,
  WorkflowContext,
  watchWorkflowFile,
  type RunStepHook,
  type WorkflowDoc,
  type StepResult,
} from '../../workflows/dsl/index.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('workflow-dsl');

export interface RunDslOptions {
  input?: string;
  watch?: boolean;
  verbose?: boolean;
}

/**
 * Default runStep — spawns an agent and executes the input.
 *
 * If the agent registry / spawner is unavailable (e.g. running without a
 * configured AgentStackConfig), fails gracefully with an error string so the
 * workflow surfaces a clear message instead of crashing.
 */
async function defaultRunStep(): Promise<RunStepHook> {
  let spawnerMod: typeof import('../../agents/spawner.js') | null = null;
  let configMod: typeof import('../../utils/config.js') | null = null;

  try {
    spawnerMod = await import('../../agents/spawner.js');
    configMod = await import('../../utils/config.js');
  } catch (err) {
    log.warn('Agent spawner not available, using stub', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return async ({ agent, input }) => {
    if (!spawnerMod || !configMod) {
      return {
        output: `[stub] agent=${agent} input=${input.slice(0, 80)}`,
      };
    }
    const config = configMod.loadConfig();
    const spawned = spawnerMod.spawnAgent(agent, {}, config);
    try {
      const result = await spawnerMod.executeAgent(spawned.id, input, config);
      const response = result.response ?? '';
      const verdictMatch = response.match(/\*\*VERDICT:\s*(APPROVE|REJECT)\*\*/i);
      return {
        output: response,
        verdict: verdictMatch ? verdictMatch[1].toUpperCase() : undefined,
      };
    } finally {
      try {
        spawnerMod.stopAgent(spawned.id);
      } catch {
        /* ignore */
      }
    }
  };
}

function parseInput(jsonStr: string | undefined): Record<string, unknown> {
  if (!jsonStr) return {};
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    // Wrap primitives in { input: ... } for consistency with $task.input
    return { input: parsed };
  } catch (err) {
    throw new Error(`--input must be valid JSON: ${(err as Error).message}`);
  }
}

function formatStep(result: StepResult, verbose: boolean): string {
  const label = result.id ?? result.agent ?? `step-${result.index}`;
  if (result.skipped) return `  [SKIP]    ${label}`;
  if (result.error) return `  [ERROR]   ${label}: ${result.error}`;
  const verdict = result.verdict ? ` verdict=${result.verdict}` : '';
  const duration = `${result.durationMs}ms`;
  const head = `  [OK]      ${label} (${duration})${verdict}`;
  if (!verbose) return head;
  const preview = result.output.length > 200 ? result.output.slice(0, 200) + '…' : result.output;
  return `${head}\n${preview}`;
}

async function runOnce(
  doc: WorkflowDoc,
  task: Record<string, unknown>,
  runStep: RunStepHook,
  verbose: boolean
): Promise<{ success: boolean; results: StepResult[] }> {
  console.log(`\nWorkflow: ${doc.name}${doc.description ? ' — ' + doc.description : ''}`);
  console.log(`Steps: ${doc.steps.length}\n`);

  const ctx = new WorkflowContext({ task, runStep });
  const results: StepResult[] = [];
  let success = true;

  for await (const result of runWorkflow(doc, ctx)) {
    results.push(result);
    console.log(formatStep(result, verbose));
    if (result.error) success = false;
  }

  console.log(`\nDone — ${results.length} step(s), ${success ? 'OK' : 'FAILED'}`);
  return { success, results };
}

/**
 * Public entrypoint: load a DSL file, optionally watch it, and execute via
 * the agent spawner.
 */
export async function runDslWorkflowFile(
  path: string,
  opts: RunDslOptions = {}
): Promise<void> {
  const absPath = resolve(path);
  const task = parseInput(opts.input);
  const runStep = await defaultRunStep();
  const verbose = opts.verbose ?? false;

  if (opts.watch) {
    console.log(`Watching workflow: ${absPath}`);
    console.log('Press Ctrl+C to exit.\n');
    const handle = await watchWorkflowFile(absPath, async (doc) => {
      try {
        await runOnce(doc, task, runStep, verbose);
      } catch (err) {
        console.error('Workflow run failed:', err instanceof Error ? err.message : String(err));
      }
    });
    // Keep the process alive until SIGINT.
    process.on('SIGINT', () => {
      handle.close();
      process.exit(0);
    });
    // Block forever
    await new Promise<void>(() => {
      /* never resolves */
    });
    return;
  }

  const content = await readFile(absPath, 'utf-8');
  const doc = await parseWorkflow(content);
  const { success } = await runOnce(doc, task, runStep, verbose);
  if (!success) process.exitCode = 1;
}
