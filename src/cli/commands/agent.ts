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
  runAgent,
  executeAgent,
} from '../../agents/spawner.js';
import { listAgentTypes, getAgentDefinition } from '../../agents/registry.js';
import { getConfig } from '../../utils/config.js';
import { getSmartDispatcher } from '../../tasks/smart-dispatcher.js';
import { readFileSync, existsSync } from 'node:fs';
import { runAgentWatch, type AgentWatchOptions } from './agent-watch.js';
import * as readline from 'node:readline';

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

  // watch subcommand
  command
    .command('watch')
    .description('Watch agent activity in real-time')
    .option('-i, --interval <seconds>', 'Refresh interval in seconds', '2')
    .option('-s, --session <id>', 'Filter by session ID')
    .option('-t, --type <type>', 'Filter by agent type')
    .option('--status <status>', 'Filter by status (idle, running, completed, failed, stopped)')
    .option('--json', 'Output as JSON snapshot (no watch)')
    .option('--no-clear', 'Do not clear screen between refreshes')
    .action(async (options) => {
      const config = getConfig();
      await runAgentWatch(options as AgentWatchOptions, config);
    });

  // run subcommand - execute a task with an agent
  command
    .command('run')
    .description('Run a task with an agent using a CLI provider')
    .requiredOption('-t, --type <type>', 'Agent type (coder, researcher, tester, reviewer, architect, coordinator, analyst)')
    .requiredOption('-p, --prompt <prompt>', 'Task prompt or @file to read from file')
    .option('-n, --name <name>', 'Agent name')
    .option('--provider <provider>', 'Provider to use (claude-code, gemini-cli, codex, anthropic, openai, ollama)')
    .option('--model <model>', 'Model to use')
    .option('--context <context>', 'Additional context or @file to read from file')
    .option('--show-prompt', 'Show the agent system prompt before running')
    .action(async (options) => {
      const {
        type,
        prompt: rawPrompt,
        name,
        provider,
        model,
        context: rawContext,
        showPrompt,
      } = options as {
        type: string;
        prompt: string;
        name?: string;
        provider?: string;
        model?: string;
        context?: string;
        showPrompt?: boolean;
      };

      try {
        const config = getConfig();

        // Read prompt from file if it starts with @
        let prompt = rawPrompt;
        if (rawPrompt.startsWith('@')) {
          const filePath = rawPrompt.slice(1);
          if (!existsSync(filePath)) {
            console.error(`Error: File not found: ${filePath}`);
            process.exit(1);
          }
          prompt = readFileSync(filePath, 'utf-8');
        }

        // Read context from file if it starts with @
        let context = rawContext;
        if (rawContext?.startsWith('@')) {
          const filePath = rawContext.slice(1);
          if (!existsSync(filePath)) {
            console.error(`Error: Context file not found: ${filePath}`);
            process.exit(1);
          }
          context = readFileSync(filePath, 'utf-8');
        }

        // Show system prompt if requested
        if (showPrompt) {
          const systemPrompt = getAgentPrompt(type);
          if (systemPrompt) {
            console.log('System Prompt:');
            console.log('─'.repeat(60));
            console.log(systemPrompt);
            console.log('─'.repeat(60));
            console.log('');
          }
        }

        console.log(`Running ${type} agent with ${provider ?? config.providers.default} provider...\n`);

        const result = await runAgent(type, prompt, config, {
          name,
          provider,
          model,
          context,
        });

        console.log('─'.repeat(60));
        console.log('Response:');
        console.log('─'.repeat(60));
        console.log(result.response);
        console.log('─'.repeat(60));
        console.log(`\nAgent: ${result.agentId}`);
        console.log(`Model: ${result.model}`);
        console.log(`Duration: ${(result.duration / 1000).toFixed(2)}s`);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // exec subcommand - execute a task with an existing agent
  command
    .command('exec')
    .description('Execute a task with an existing agent')
    .requiredOption('-p, --prompt <prompt>', 'Task prompt or @file to read from file')
    .option('-i, --id <id>', 'Agent ID')
    .option('-n, --name <name>', 'Agent name')
    .option('--provider <provider>', 'Provider to use')
    .option('--model <model>', 'Model to use')
    .option('--context <context>', 'Additional context or @file to read from file')
    .action(async (options) => {
      const {
        prompt: rawPrompt,
        id,
        name,
        provider,
        model,
        context: rawContext,
      } = options as {
        prompt: string;
        id?: string;
        name?: string;
        provider?: string;
        model?: string;
        context?: string;
      };

      if (!id && !name) {
        console.error('Error: Either --id or --name is required');
        process.exit(1);
      }

      try {
        const config = getConfig();

        // Find agent
        let agent = null;
        if (id) {
          agent = getAgent(id);
        } else if (name) {
          agent = getAgentByName(name);
        }

        if (!agent) {
          console.error('Error: Agent not found');
          process.exit(1);
        }

        // Read prompt from file if it starts with @
        let prompt = rawPrompt;
        if (rawPrompt.startsWith('@')) {
          const filePath = rawPrompt.slice(1);
          if (!existsSync(filePath)) {
            console.error(`Error: File not found: ${filePath}`);
            process.exit(1);
          }
          prompt = readFileSync(filePath, 'utf-8');
        }

        // Read context from file if it starts with @
        let context = rawContext;
        if (rawContext?.startsWith('@')) {
          const filePath = rawContext.slice(1);
          if (!existsSync(filePath)) {
            console.error(`Error: Context file not found: ${filePath}`);
            process.exit(1);
          }
          context = readFileSync(filePath, 'utf-8');
        }

        console.log(`Executing task with ${agent.type} agent (${agent.name})...\n`);

        const result = await executeAgent(agent.id, prompt, config, {
          provider,
          model,
          context,
        });

        console.log('─'.repeat(60));
        console.log('Response:');
        console.log('─'.repeat(60));
        console.log(result.response);
        console.log('─'.repeat(60));
        console.log(`\nModel: ${result.model}`);
        console.log(`Duration: ${(result.duration / 1000).toFixed(2)}s`);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // auto subcommand - automatically select agent type and run
  command
    .command('auto')
    .description('Automatically select the best agent type for a task and run it')
    .argument('<description>', 'Task description')
    .option('--dry-run', 'Only show agent selection, do not execute')
    .option('--confirm', 'Ask for confirmation before executing')
    .option('--provider <provider>', 'Provider to use (claude-code, gemini-cli, codex, anthropic, openai, ollama)')
    .option('--model <model>', 'Model to use')
    .option('--context <context>', 'Additional context or @file to read from file')
    .action(async (description, options) => {
      const {
        dryRun,
        confirm,
        provider,
        model,
        context: rawContext,
      } = options as {
        dryRun?: boolean;
        confirm?: boolean;
        provider?: string;
        model?: string;
        context?: string;
      };

      try {
        const config = getConfig();
        const dispatcher = getSmartDispatcher(config);

        if (!dispatcher.isEnabled()) {
          console.error('Error: Smart dispatcher is not enabled or no provider configured');
          process.exit(1);
        }

        console.log('Analyzing task description...\n');

        const result = await dispatcher.dispatch(description);

        if (!result.success || !result.decision) {
          console.error(`Error: ${result.error ?? 'Failed to dispatch task'}`);
          process.exit(1);
        }

        const { agentType, confidence, reasoning, cached, latencyMs } = result.decision;

        console.log(`Selected agent: ${agentType}`);
        console.log(`Confidence: ${Math.round(confidence * 100)}%`);
        console.log(`Reasoning: ${reasoning}`);
        if (cached) {
          console.log(`(Cached result)`);
        }
        console.log(`Dispatch latency: ${latencyMs}ms\n`);

        if (dryRun) {
          console.log('Dry run - not executing agent.');
          return;
        }

        // Ask for confirmation if requested
        if (confirm) {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          const answer = await new Promise<string>((resolve) => {
            rl.question('Proceed with this agent? (y/N): ', resolve);
          });
          rl.close();

          if (answer.toLowerCase() !== 'y') {
            console.log('Aborted.');
            return;
          }
        }

        // Read context from file if it starts with @
        let context = rawContext;
        if (rawContext?.startsWith('@')) {
          const filePath = rawContext.slice(1);
          if (!existsSync(filePath)) {
            console.error(`Error: Context file not found: ${filePath}`);
            process.exit(1);
          }
          context = readFileSync(filePath, 'utf-8');
        }

        console.log(`Running ${agentType} agent...\n`);

        const agentResult = await runAgent(agentType, description, config, {
          provider,
          model,
          context,
        });

        console.log('─'.repeat(60));
        console.log('Response:');
        console.log('─'.repeat(60));
        console.log(agentResult.response);
        console.log('─'.repeat(60));
        console.log(`\nAgent: ${agentResult.agentId}`);
        console.log(`Model: ${agentResult.model}`);
        console.log(`Duration: ${(agentResult.duration / 1000).toFixed(2)}s`);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  return command;
}
