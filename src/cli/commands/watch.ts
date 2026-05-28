/**
 * `aistack watch <dir>` - watch a directory and enqueue tasks on file matches.
 *
 * Designed to be run alongside (or instead of) the daemon. When no daemon is
 * running, this command spins up an in-process DaemonRuntime so tasks are still
 * persisted to the file queue.
 */

import { Command } from 'commander';
import { resolve } from 'node:path';
import { logger } from '../../utils/logger.js';
import { DaemonRuntime, defaultDaemonDataDir } from '../../daemon/index.js';
import { FileWatcher } from '../../transport/file-watcher.js';

const log = logger.child('cli:watch');

export function createWatchCommand(): Command {
  return new Command('watch')
    .description('Watch a directory and trigger an agent for each matching file')
    .argument('<dir>', 'Directory to watch')
    .option('--pattern <glob>', 'Filename glob (supports * and ?)', '*.task.json')
    .option('--agent <type>', 'Agent type to dispatch', 'coder')
    .option('--data-dir <dir>', 'Daemon data directory', defaultDaemonDataDir())
    .option('--read-file', 'Pass file contents as task input (default: pass absolute path)', false)
    .option('--no-recursive', 'Do not watch subdirectories')
    .action(async (dir: string, opts) => {
      const absDir = resolve(dir);
      const runtime = new DaemonRuntime({ dataDir: opts.dataDir as string });
      await runtime.start();

      const watcher = new FileWatcher(runtime, {
        dir: absDir,
        recursive: opts.recursive !== false,
        rules: [{
          pattern: opts.pattern as string,
          agentType: opts.agent as string,
          readFile: Boolean(opts.readFile),
        }],
      });
      watcher.start();

      console.log(`Watching ${absDir} for ${String(opts.pattern)} -> ${String(opts.agent)}`);
      console.log('Tasks are persisted to the daemon queue at:', opts.dataDir as string);
      console.log('Press Ctrl+C to stop.');

      const shutdown = async (): Promise<void> => {
        console.log('\nStopping watcher...');
        watcher.stop();
        await runtime.stop();
        process.exit(0);
      };
      process.on('SIGINT', () => void shutdown());
      process.on('SIGTERM', () => void shutdown());

      await new Promise(() => { /* keep alive */ });
      log.debug('watch command exited');
    });
}
