/**
 * mcp command - Start MCP server
 */

import { Command } from 'commander';
import { startMCPServer } from '../../mcp/server.js';
import { getConfig } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('mcp');

export function createMcpCommand(): Command {
  const command = new Command('mcp')
    .description('MCP server operations');

  command
    .command('start')
    .description('Start the MCP server')
    .option('--transport <type>', 'Transport type (stdio)', 'stdio')
    .action(async (options) => {
      const { transport } = options as { transport: string };

      if (transport !== 'stdio') {
        console.error('Only stdio transport is currently supported');
        process.exit(1);
      }

      try {
        const config = getConfig();
        const server = await startMCPServer(config);

        log.info('MCP server running', { tools: server.getToolCount() });

        // Handle graceful shutdown
        const shutdown = async (): Promise<void> => {
          log.info('Shutting down MCP server...');
          await server.stop();
          process.exit(0);
        };

        process.on('SIGINT', () => void shutdown());
        process.on('SIGTERM', () => void shutdown());

        // Keep the process running
        await new Promise(() => {
          // Never resolves - server runs until killed
        });
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  command
    .command('tools')
    .description('List available MCP tools')
    .action(() => {
      // List tools without starting server
      const tools = [
        // Agent tools
        'agent_spawn', 'agent_list', 'agent_stop', 'agent_status', 'agent_types', 'agent_update_status',
        // Memory tools
        'memory_store', 'memory_search', 'memory_get', 'memory_list', 'memory_delete',
        // Task tools
        'task_create', 'task_assign', 'task_complete', 'task_list', 'task_get',
        // Session tools
        'session_start', 'session_end', 'session_status', 'session_active',
        // System tools
        'system_status', 'system_health', 'system_config',
        // GitHub tools
        'github_issue_create', 'github_issue_list', 'github_issue_get',
        'github_pr_create', 'github_pr_list', 'github_pr_get',
        'github_repo_info',
      ];

      console.log('Available MCP tools:\n');
      console.log('Agent Tools:');
      tools.filter(t => t.startsWith('agent_')).forEach(t => console.log(`  - ${t}`));
      console.log('\nMemory Tools:');
      tools.filter(t => t.startsWith('memory_')).forEach(t => console.log(`  - ${t}`));
      console.log('\nTask Tools:');
      tools.filter(t => t.startsWith('task_')).forEach(t => console.log(`  - ${t}`));
      console.log('\nSession Tools:');
      tools.filter(t => t.startsWith('session_')).forEach(t => console.log(`  - ${t}`));
      console.log('\nSystem Tools:');
      tools.filter(t => t.startsWith('system_')).forEach(t => console.log(`  - ${t}`));
      console.log('\nGitHub Tools:');
      tools.filter(t => t.startsWith('github_')).forEach(t => console.log(`  - ${t}`));
      console.log(`\nTotal: ${tools.length} tools`);
    });

  return command;
}
