/**
 * `aistack daemon` - manage the background runner.
 *
 * Sub-commands:
 *   start  — start the daemon (optional --detach for background)
 *   stop   — signal a running daemon (via pid file) to terminate
 *   status — report PID + queue depth from disk
 */

import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';
import { DaemonRuntime, defaultDaemonDataDir, readDaemonPid } from '../../daemon/index.js';
import { WebhookServer } from '../../transport/webhook.js';

const log = logger.child('cli:daemon');

export function createDaemonCommand(): Command {
  const command = new Command('daemon').description('Run aistack as a background headless agent runner');

  // --- start ---
  command
    .command('start')
    .description('Start the daemon')
    .option('--data-dir <dir>', 'Daemon data directory (queue + logs)', defaultDaemonDataDir())
    .option('--port <port>', 'Webhook port (set 0 to disable)', '8787')
    .option('--host <host>', 'Webhook bind host', '127.0.0.1')
    .option('--hmac-secret <secret>', 'HMAC secret for webhook signature (or set AISTACK_DAEMON_HMAC_SECRET)')
    .option('--max-concurrent <n>', 'Max concurrent in-flight tasks', '4')
    .option('--detach', 'Detach and run in the background')
    .action(async (opts) => {
      const port = parseInt(opts.port, 10);
      const maxConcurrent = parseInt(opts.maxConcurrent, 10);
      const hmacSecret: string | undefined = opts.hmacSecret ?? process.env.AISTACK_DAEMON_HMAC_SECRET;

      if (opts.detach) {
        // Respawn ourselves without --detach, detached + unref'd
        const args = process.argv.slice(2).filter(a => a !== '--detach');
        const child = spawn(process.execPath, [process.argv[1] ?? '', ...args], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        console.log(`Daemon detached (pid ${child.pid}). Data dir: ${opts.dataDir as string}`);
        return;
      }

      // Load aistack config (may surface daemon section in the future)
      try {
        loadConfig();
      } catch (err) {
        log.warn('loadConfig failed; continuing with defaults', { error: (err as Error).message });
      }

      const runtime = new DaemonRuntime({
        dataDir: opts.dataDir as string,
        maxConcurrent,
      });
      await runtime.start();

      let webhook: WebhookServer | null = null;
      if (port > 0) {
        webhook = new WebhookServer(runtime, {
          port,
          host: opts.host as string,
          hmacSecret,
        });
        try {
          await webhook.start();
        } catch (err) {
          log.error('Webhook server failed to start', { error: (err as Error).message });
          await runtime.stop();
          process.exit(1);
        }
      }

      console.log(`aistack daemon running (pid ${process.pid})`);
      console.log(`  data dir : ${opts.dataDir as string}`);
      if (webhook) {
        console.log(`  webhook  : http://${opts.host as string}:${webhook.getPort()}/v1/tasks`);
        console.log(`  hmac     : ${hmacSecret ? 'enabled' : 'disabled (set --hmac-secret to enable)'}`);
      } else {
        console.log('  webhook  : disabled');
      }

      const shutdown = async (signal: string): Promise<void> => {
        console.log(`\nReceived ${signal}, draining...`);
        if (webhook) await webhook.stop();
        await runtime.stop();
        process.exit(0);
      };
      process.on('SIGINT', () => void shutdown('SIGINT'));
      process.on('SIGTERM', () => void shutdown('SIGTERM'));

      // Keep the process alive
      await new Promise(() => { /* never resolves */ });
    });

  // --- stop ---
  command
    .command('stop')
    .description('Stop a running daemon')
    .option('--data-dir <dir>', 'Daemon data directory', defaultDaemonDataDir())
    .action((opts) => {
      const pid = readDaemonPid(opts.dataDir as string);
      if (!pid) {
        console.error(`No daemon pid file found in ${opts.dataDir as string}`);
        process.exit(1);
      }
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`Sent SIGTERM to daemon pid ${pid}`);
      } catch (err) {
        console.error(`Failed to signal pid ${pid}: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  // --- status ---
  command
    .command('status')
    .description('Report daemon status (from on-disk state)')
    .option('--data-dir <dir>', 'Daemon data directory', defaultDaemonDataDir())
    .action((opts) => {
      const dataDir = opts.dataDir as string;
      const pid = readDaemonPid(dataDir);
      const queueDir = join(dataDir, 'queue', 'pending');
      let pending = 0;
      let inflight = 0;
      if (existsSync(queueDir)) {
        try {
          pending = readdirSync(queueDir).filter(f => f.endsWith('.json')).length;
          const inflightDir = join(dataDir, 'queue', 'inflight');
          if (existsSync(inflightDir)) {
            inflight = readdirSync(inflightDir).filter(f => f.endsWith('.json')).length;
          }
        } catch { /* ignore */ }
      }
      const pidAlive = pid ? isPidAlive(pid) : false;
      console.log(JSON.stringify({
        dataDir,
        pid,
        running: pidAlive,
        queue: { pending, inflight },
      }, null, 2));
    });

  return command;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

