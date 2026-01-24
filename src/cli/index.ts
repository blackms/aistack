#!/usr/bin/env node
/**
 * agentstack CLI - Clean agent orchestration
 */

import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import {
  createInitCommand,
  createAgentCommand,
  createMemoryCommand,
  createMcpCommand,
  createPluginCommand,
  createStatusCommand,
} from './commands/index.js';

// Read version from package.json would be ideal, but for now hardcode
const VERSION = '1.0.0';

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('agentstack')
    .description('Clean agent orchestration for Claude Code')
    .version(VERSION)
    .option('-v, --verbose', 'Enable verbose logging')
    .option('-q, --quiet', 'Suppress output')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts() as { verbose?: boolean; quiet?: boolean };

      if (opts.verbose) {
        logger.setLevel('debug');
      } else if (opts.quiet) {
        logger.setLevel('error');
      }
    });

  // Add commands
  program.addCommand(createInitCommand());
  program.addCommand(createAgentCommand());
  program.addCommand(createMemoryCommand());
  program.addCommand(createMcpCommand());
  program.addCommand(createPluginCommand());
  program.addCommand(createStatusCommand());

  // Parse arguments
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
