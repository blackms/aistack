/**
 * a2a command — expose aistack agents over the A2A protocol and call
 * remote A2A endpoints from the CLI.
 *
 * Server: `aistack a2a serve --port 8787`
 * Client: `aistack a2a call <url> <message>`
 */

import { Command } from 'commander';
import { A2ARouter } from '../../transport/a2a-router.js';
import { registerA2ARoutes } from '../../a2a/server.js';
import { a2aCall, fetchAgentCard, A2AClientError } from '../../a2a/client.js';
import { responseText, textMessage } from '../../a2a/types.js';
import { getConfig } from '../../utils/config.js';
import { randomUUID } from 'node:crypto';

const DEFAULT_A2A_PORT = 8787;
const DEFAULT_A2A_TIMEOUT_MS = 30_000;
const MAX_A2A_TIMEOUT_MS = 120_000;

export function createA2aCommand(): Command {
  const command = new Command('a2a').description('Agent-to-Agent (A2A) protocol server + client');

  command
    .command('serve')
    .description('Expose aistack agents over A2A on a local HTTP server')
    .option('-p, --port <port>', 'Port to listen on (default 8787)')
    .option('-H, --host <host>', 'Host to bind (default 127.0.0.1)')
    .option('-u, --url <url>', 'Public URL advertised in the agent card')
    .option('--no-auth', 'Disable bearer auth (NOT recommended outside loopback)')
    .action(async (options) => {
      const opts = options as {
        port?: string;
        host?: string;
        url?: string;
        auth?: boolean;
      };

      const config = getConfig();
      const a2aConfig = config.a2a ?? { enabled: true };

      try {
        const port = parsePort(opts.port ?? a2aConfig.port ?? DEFAULT_A2A_PORT);
        const host = opts.host ?? a2aConfig.host ?? '127.0.0.1';
        const configuredPublicUrl = opts.url ?? a2aConfig.publicUrl;

        // Bearer token: CLI flag --no-auth disables, otherwise read env var.
        const bearerToken =
          opts.auth === false
            ? undefined
            : a2aConfig.bearerToken ?? process.env.AISTACK_A2A_TOKEN;

        if (opts.auth !== false && !bearerToken) {
          console.warn(
            'Warning: no AISTACK_A2A_TOKEN env var set — bearer auth is disabled. ' +
              'Bind to loopback only or pass --no-auth explicitly.',
          );
        }

        const server = new A2ARouter({ port, host });
        const bound = await server.start();
        const listenUrl = buildHttpUrl(bound.host, bound.port);
        const publicUrl = stripTrailingSlash(configuredPublicUrl ?? listenUrl);
        registerA2ARoutes(server, {
          config,
          a2a: {
            url: publicUrl,
            name: 'aistack',
            version: '1.0.0',
            exposedAgents: a2aConfig.exposedAgents,
            bearerToken,
          },
        });

        console.log(`A2A server listening on ${listenUrl}`);
        console.log(`  agent card: ${publicUrl}/.well-known/a2a-agent-card.json`);
        console.log(`  endpoint:   ${publicUrl}/v1/a2a/message`);

        const shutdown = async (): Promise<void> => {
          console.log('\nShutting down...');
          await server.stop();
          process.exit(0);
        };
        process.on('SIGINT', () => void shutdown());
        process.on('SIGTERM', () => void shutdown());

        // Block forever
        await new Promise<void>(() => {});
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  command
    .command('call')
    .description('Call a remote A2A agent')
    .argument('<url>', 'Remote agent base URL or /v1/a2a/message endpoint')
    .argument('<message>', 'Plain-text message to send')
    .option('-s, --skill <id>', 'Target skill id (default: remote agent default)')
    .option('-t, --timeout <ms>', 'Request timeout in milliseconds', '30000')
    .option('--token <token>', 'Bearer token (default: env AISTACK_A2A_CLIENT_TOKEN)')
    .action(async (url: string, msg: string, options) => {
      const opts = options as { skill?: string; timeout: string; token?: string };
      const token = opts.token ?? process.env.AISTACK_A2A_CLIENT_TOKEN;

      try {
        const timeoutMs = parsePositiveInt(
          opts.timeout,
          DEFAULT_A2A_TIMEOUT_MS,
          MAX_A2A_TIMEOUT_MS,
        );
        const message = textMessage(randomUUID(), msg, opts.skill);
        const response = await a2aCall(url, message, {
          bearerToken: token,
          timeoutMs,
        });
        console.log(JSON.stringify(response, null, 2));
        if (response.status === 'failed') {
          process.exitCode = 2;
        } else {
          const text = responseText(response);
          if (text) {
            console.error('---');
            console.error(text);
          }
        }
      } catch (error) {
        if (error instanceof A2AClientError) {
          console.error(`A2A call error (status=${error.status ?? 'n/a'}): ${error.message}`);
          if (error.body) console.error(JSON.stringify(error.body, null, 2));
        } else {
          console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
        process.exit(1);
      }
    });

  command
    .command('card')
    .description('Fetch and print a remote agent card')
    .argument('<url>', 'Remote agent base URL')
    .action(async (url: string) => {
      try {
        const card = await fetchAgentCard(url);
        console.log(JSON.stringify(card, null, 2));
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  return command;
}

function parsePort(raw: string | number): number {
  const port = typeof raw === 'number' ? raw : Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid A2A port: ${raw}`);
  }
  return port;
}

function parsePositiveInt(raw: string, fallback: number, max: number): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return Math.min(value, max);
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function buildHttpUrl(host: string, port: number): string {
  return `http://${hostForUrl(host)}:${port}`;
}

function hostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}
