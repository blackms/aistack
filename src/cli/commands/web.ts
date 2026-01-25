/**
 * Web command - Start the web server
 */

import { Command } from 'commander';
import { loadConfig } from '../../utils/config.js';
import { startWebServer, stopWebServer, type WebConfig } from '../../web/index.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('cli:web');

export function createWebCommand(): Command {
  const command = new Command('web')
    .description('Start the web interface server');

  // Start web server
  command
    .command('start')
    .description('Start the web server')
    .option('-p, --port <port>', 'Port to listen on', '3001')
    .option('-h, --host <host>', 'Host to bind to', 'localhost')
    .option('--cors <origins>', 'Comma-separated list of allowed CORS origins', 'http://localhost:5173,http://localhost:3000')
    .option('--no-static', 'Disable serving static files')
    .action(async (options) => {
      try {
        const config = await loadConfig();

        const webConfig: Partial<WebConfig> = {
          port: parseInt(options.port, 10),
          host: options.host,
          cors: {
            origins: options.cors.split(',').map((o: string) => o.trim()),
          },
        };

        console.log('Starting AgentStack Web Server...');
        console.log(`  Host: ${webConfig.host}`);
        console.log(`  Port: ${webConfig.port}`);
        console.log(`  CORS Origins: ${webConfig.cors?.origins?.join(', ')}`);
        console.log('');

        const server = await startWebServer(config, webConfig);
        const status = server.getStatus();

        console.log(`Web server running at http://${status.host}:${status.port}`);
        console.log(`WebSocket endpoint: ws://${status.host}:${status.port}/ws`);
        console.log('');
        console.log('API Endpoints:');
        console.log('  GET  /api/v1                  - API info');
        console.log('  GET  /api/v1/agents           - List agents');
        console.log('  POST /api/v1/agents           - Spawn agent');
        console.log('  GET  /api/v1/memory           - List memory entries');
        console.log('  GET  /api/v1/tasks            - List tasks');
        console.log('  GET  /api/v1/sessions/active  - Get active session');
        console.log('  GET  /api/v1/workflows        - List workflows');
        console.log('  GET  /api/v1/system/status    - System status');
        console.log('  GET  /api/v1/system/health    - Health check');
        console.log('');
        console.log('Press Ctrl+C to stop the server');

        // Handle shutdown
        const shutdown = async () => {
          console.log('\nShutting down...');
          await stopWebServer();
          process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        // Keep the process running
        await new Promise(() => {});
      } catch (error) {
        log.error('Failed to start web server', {
          error: error instanceof Error ? error.message : String(error),
        });
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Alias for start (default behavior)
  command
    .action(async () => {
      // If no subcommand, run start
      await command.commands.find(c => c.name() === 'start')?.parseAsync([]);
    });

  return command;
}
