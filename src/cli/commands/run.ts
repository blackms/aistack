/**
 * `aistack run` - enqueue a one-shot task into the daemon queue (async)
 * or execute it inline (sync). Returns the task ID on stdout.
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '../../utils/logger.js';
import { DaemonRuntime, defaultDaemonDataDir } from '../../daemon/index.js';

const log = logger.child('cli:run');

export function createRunCommand(): Command {
  return new Command('run')
    .description('Enqueue a task for an agent (async via daemon queue) or run inline')
    .requiredOption('--agent <type>', 'Agent type (e.g. coder, researcher)')
    .option('--input <text>', 'Inline task input string')
    .option('--input-file <path>', 'Read task input from a file')
    .option('--async', 'Enqueue and return immediately (default: wait inline)', false)
    .option('--data-dir <dir>', 'Daemon data directory', defaultDaemonDataDir())
    .action(async (opts) => {
      let input: string;
      if (opts.inputFile) {
        input = readFileSync(resolve(opts.inputFile as string), 'utf-8');
      } else if (opts.input) {
        input = opts.input as string;
      } else {
        console.error('Either --input or --input-file is required');
        process.exit(2);
      }

      const runtime = new DaemonRuntime({ dataDir: opts.dataDir as string });

      if (opts.async) {
        // Async: just enqueue and exit. Daemon must be running separately to pick up.
        // We do NOT start the runtime polling loop here.
        const task = await runtime.enqueue({
          agentType: opts.agent as string,
          input,
          source: 'cli',
        });
        console.log(JSON.stringify({ taskId: task.id, status: 'pending', mode: 'async' }));
        return;
      }

      // Sync: start runtime, enqueue, wait for completion
      await runtime.start();
      const enqueued = await runtime.enqueue({
        agentType: opts.agent as string,
        input,
        source: 'cli',
      });

      const result = await new Promise<{ status: string; output?: string; error?: string }>(resolveTask => {
        const onDone = (task: { id: string; status: string; output?: string; error?: string }): void => {
          if (task.id !== enqueued.id) return;
          runtime.off('task:completed', onDone);
          runtime.off('task:failed', onDone);
          resolveTask({ status: task.status, output: task.output, error: task.error });
        };
        runtime.on('task:completed', onDone);
        runtime.on('task:failed', onDone);
      });

      await runtime.stop();
      console.log(JSON.stringify({ taskId: enqueued.id, ...result }, null, 2));
      if (result.status === 'failed') process.exit(1);
      log.debug('run command finished');
    });
}
