/**
 * `aistack export-agents` — Generate Claude Code native subagent markdown
 * files (`.claude/agents/aistack-<type>.md`) from the in-memory agent
 * registry, so users can invoke aistack agents without installing the NPM
 * package or booting the MCP server.
 *
 * Modes:
 *   --project   (default)  Write to ./.claude/agents
 *   --user                 Write to ~/.claude/agents
 *   --output <dir>         Write to an explicit directory (overrides above)
 */

import { Command } from 'commander';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { exportAllAgents } from '../../agents/exporter.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('export-agents');

interface ExportAgentsOptions {
  project?: boolean;
  user?: boolean;
  output?: string;
}

export function createExportAgentsCommand(): Command {
  const command = new Command('export-agents')
    .description(
      'Export agent definitions as Claude Code native subagent markdown files',
    )
    .option('--project', 'Write to ./.claude/agents (default)')
    .option('--user', 'Write to ~/.claude/agents')
    .option('-o, --output <dir>', 'Explicit output directory (overrides --project/--user)')
    .action(async (options: ExportAgentsOptions) => {
      const outputDir = resolveOutputDir(options);

      console.log(`Exporting aistack agents to: ${outputDir}`);

      try {
        const written = await exportAllAgents(outputDir);

        console.log(`\nWrote ${written.length} subagent file(s):`);
        for (const path of written) {
          console.log(`  ${path}`);
        }
        console.log(
          '\nNext steps:\n' +
          '  1. Restart Claude Code (or run `/agents` to refresh the list)\n' +
          '  2. Invoke an agent with `@aistack-coder`, `@aistack-architect`, etc.\n',
        );

        log.info('Exported agents', { outputDir, count: written.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to export agents: ${message}`);
        log.error('Export failed', { error: message });
        process.exit(1);
      }
    });

  return command;
}

function resolveOutputDir(options: ExportAgentsOptions): string {
  if (options.output) {
    return resolve(options.output);
  }
  if (options.user) {
    return join(homedir(), '.claude', 'agents');
  }
  // Default: --project (also when neither flag passed)
  return resolve(process.cwd(), '.claude', 'agents');
}
