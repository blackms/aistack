/**
 * agent command - Manage agents
 */

import { Command } from 'commander';
import {
  spawnAgent,
  getAgent,
  getAgentByName,
  listAgents,
  stopAgent,
  stopAgentByName,
  getAgentPrompt,
} from '../../agents/spawner.js';
import { listAgentTypes, getAgentDefinition } from '../../agents/registry.js';
import { getConfig } from '../../utils/config.js';

export function createAgentCommand(): Command {
  const command = new Command('agent')
    .description('Manage agents');

  // spawn subcommand
  command
    .command('spawn')
    .description('Spawn a new agent')
    .requiredOption('-t, --type <type>', 'Agent type (coder, researcher, tester, reviewer, architect, coordinator, analyst)')
    .option('-n, --name <name>', 'Agent name')
    .option('-s, --session <id>', 'Session ID')
    .option('--show-prompt', 'Show the agent system prompt')
    .action((options) => {
      const { type, name, session, showPrompt } = options as {
        type: string;
        name?: string;
        session?: string;
        showPrompt?: boolean;
      };

      try {
        const config = getConfig();
        const agent = spawnAgent(type, { name, sessionId: session }, config);

        console.log('Agent spawned:\n');
        console.log(`  ID:     ${agent.id}`);
        console.log(`  Type:   ${agent.type}`);
        console.log(`  Name:   ${agent.name}`);
        console.log(`  Status: ${agent.status}`);

        if (showPrompt) {
          const prompt = getAgentPrompt(type);
          if (prompt) {
            console.log('\nSystem Prompt:');
            console.log('─'.repeat(50));
            console.log(prompt);
            console.log('─'.repeat(50));
          }
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // list subcommand
  command
    .command('list')
    .description('List active agents')
    .option('-s, --session <id>', 'Filter by session ID')
    .action((options) => {
      const { session } = options as { session?: string };
      const agents = listAgents(session);

      if (agents.length === 0) {
        console.log('No active agents.');
        return;
      }

      console.log('Active agents:\n');
      console.log('ID                                    Type         Name                 Status');
      console.log('─'.repeat(90));

      for (const agent of agents) {
        console.log(
          `${agent.id}  ${agent.type.padEnd(12)} ${agent.name.padEnd(20)} ${agent.status}`
        );
      }

      console.log(`\nTotal: ${agents.length} agent(s)`);
    });

  // stop subcommand
  command
    .command('stop')
    .description('Stop an agent')
    .option('-i, --id <id>', 'Agent ID')
    .option('-n, --name <name>', 'Agent name')
    .action((options) => {
      const { id, name } = options as { id?: string; name?: string };

      if (!id && !name) {
        console.error('Error: Either --id or --name is required');
        process.exit(1);
      }

      let stopped = false;
      if (id) {
        stopped = stopAgent(id);
      } else if (name) {
        stopped = stopAgentByName(name);
      }

      if (stopped) {
        console.log('Agent stopped successfully.');
      } else {
        console.error('Agent not found.');
        process.exit(1);
      }
    });

  // status subcommand
  command
    .command('status')
    .description('Get agent status')
    .option('-i, --id <id>', 'Agent ID')
    .option('-n, --name <name>', 'Agent name')
    .action((options) => {
      const { id, name } = options as { id?: string; name?: string };

      if (!id && !name) {
        console.error('Error: Either --id or --name is required');
        process.exit(1);
      }

      let agent = null;
      if (id) {
        agent = getAgent(id);
      } else if (name) {
        agent = getAgentByName(name);
      }

      if (!agent) {
        console.error('Agent not found.');
        process.exit(1);
      }

      const definition = getAgentDefinition(agent.type);

      console.log('Agent status:\n');
      console.log(`  ID:           ${agent.id}`);
      console.log(`  Type:         ${agent.type}`);
      console.log(`  Name:         ${agent.name}`);
      console.log(`  Status:       ${agent.status}`);
      console.log(`  Created:      ${agent.createdAt.toISOString()}`);
      if (agent.sessionId) {
        console.log(`  Session:      ${agent.sessionId}`);
      }
      if (definition?.capabilities) {
        console.log(`  Capabilities: ${definition.capabilities.join(', ')}`);
      }
    });

  // types subcommand
  command
    .command('types')
    .description('List available agent types')
    .action(() => {
      const types = listAgentTypes();

      console.log('Available agent types:\n');
      console.log('Type          Description');
      console.log('─'.repeat(60));

      for (const type of types) {
        const def = getAgentDefinition(type);
        console.log(`${type.padEnd(14)}${def?.description ?? ''}`);
      }
    });

  return command;
}
