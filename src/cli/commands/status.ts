/**
 * status command - System status
 */

import { Command } from 'commander';
import { getConfig } from '../../utils/config.js';
import { getMemoryManager } from '../../memory/index.js';
import { getAgentCount as getActiveAgentCount, listAgents } from '../../agents/spawner.js';
import { getAgentCount as getRegisteredAgentCount } from '../../agents/registry.js';

export function createStatusCommand(): Command {
  const command = new Command('status')
    .description('Show system status')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const { json } = options as { json?: boolean };

      try {
        const config = getConfig();
        const memory = getMemoryManager(config);

        const vectorStats = memory.getVectorStats();
        const registeredAgents = getRegisteredAgentCount();
        const activeAgentCount = getActiveAgentCount();
        const activeAgents = listAgents();
        const session = memory.getActiveSession();

        const status = {
          version: config.version,
          session: session
            ? {
                id: session.id,
                status: session.status,
                startedAt: session.startedAt.toISOString(),
              }
            : null,
          agents: {
            registered: {
              core: registeredAgents.core,
              custom: registeredAgents.custom,
              total: registeredAgents.total,
            },
            active: activeAgentCount,
            running: activeAgents.filter(a => a.status === 'running').length,
          },
          memory: {
            entries: vectorStats.total,
            indexed: vectorStats.indexed,
            coverage: `${vectorStats.coverage}%`,
            vectorEnabled: config.memory.vectorSearch.enabled,
          },
          providers: {
            default: config.providers.default,
            configured: [
              config.providers.anthropic ? 'anthropic' : null,
              config.providers.openai ? 'openai' : null,
              config.providers.ollama ? 'ollama' : null,
            ].filter(Boolean),
          },
          github: {
            enabled: config.github.enabled,
            useGhCli: config.github.useGhCli,
          },
          plugins: {
            enabled: config.plugins.enabled,
            directory: config.plugins.directory,
          },
        };

        if (json) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }

        console.log('agentstack status\n');
        console.log('─'.repeat(50));

        // Version
        console.log(`Version: ${status.version}`);

        // Session
        if (status.session) {
          console.log(`\nSession:`);
          console.log(`  ID:      ${status.session.id}`);
          console.log(`  Status:  ${status.session.status}`);
          console.log(`  Started: ${status.session.startedAt}`);
        } else {
          console.log(`\nSession: none`);
        }

        // Agents
        console.log(`\nAgents:`);
        console.log(`  Registered: ${status.agents.registered.total} (${status.agents.registered.core} core, ${status.agents.registered.custom} custom)`);
        console.log(`  Active:     ${status.agents.active}`);
        console.log(`  Running:    ${status.agents.running}`);

        // Memory
        console.log(`\nMemory:`);
        console.log(`  Entries: ${status.memory.entries}`);
        console.log(`  Indexed: ${status.memory.indexed} (${status.memory.coverage})`);
        console.log(`  Vector:  ${status.memory.vectorEnabled ? 'enabled' : 'disabled'}`);

        // Providers
        console.log(`\nProviders:`);
        console.log(`  Default:    ${status.providers.default}`);
        console.log(`  Configured: ${status.providers.configured.join(', ') || 'none'}`);

        // GitHub
        console.log(`\nGitHub:`);
        console.log(`  Enabled: ${status.github.enabled ? 'yes' : 'no'}`);
        if (status.github.enabled) {
          console.log(`  Auth:    ${status.github.useGhCli ? 'gh CLI' : 'token'}`);
        }

        // Plugins
        console.log(`\nPlugins:`);
        console.log(`  Enabled:   ${status.plugins.enabled ? 'yes' : 'no'}`);
        console.log(`  Directory: ${status.plugins.directory}`);

        console.log('\n' + '─'.repeat(50));
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  return command;
}
