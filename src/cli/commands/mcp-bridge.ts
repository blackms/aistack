/**
 * mcp-bridge command - Sync battle-pack integrations to .mcp.json
 *
 * Reads `integrations` section from aistack.config.json and writes the
 * generated Claude Code .mcp.json file. This is the auto-discovery
 * mechanism: aistack owns the config, Claude Code spawns the servers.
 */

import { Command } from 'commander';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getConfig } from '../../utils/config.js';
import { buildMcpJson, listBattlePackAdapters } from '../../integrations/index.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('mcp-bridge');

export function createMcpBridgeCommand(): Command {
  const command = new Command('mcp-bridge')
    .description('Battle-pack MCP server bridge (Postgres, GitHub, Sentry, Playwright, Slack)');

  command
    .command('sync')
    .description('Generate/refresh .mcp.json from aistack.config.json integrations')
    .option('--out <path>', 'Output path for .mcp.json', './.mcp.json')
    .option('--dry-run', 'Print to stdout instead of writing', false)
    .option('--merge', 'Merge into existing .mcp.json (preserve unrelated servers)', false)
    .option('--skip-missing-env', 'Skip providers with unset required env vars', false)
    .action((options: { out: string; dryRun: boolean; merge: boolean; skipMissingEnv: boolean }) => {
      try {
        const config = getConfig();
        const { output, report } = buildMcpJson(config.integrations, {
          skipIfEnvMissing: options.skipMissingEnv,
        });

        let finalOutput = output;
        const targetPath = resolve(options.out);

        if (options.merge && existsSync(targetPath)) {
          try {
            const existing = JSON.parse(readFileSync(targetPath, 'utf-8')) as {
              mcpServers?: Record<string, unknown>;
            };
            finalOutput = {
              mcpServers: {
                ...(existing.mcpServers as typeof output.mcpServers ?? {}),
                ...output.mcpServers,
              },
            };
          } catch (err) {
            log.warn('Could not parse existing .mcp.json, overwriting', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        const json = JSON.stringify(finalOutput, null, 2);

        if (options.dryRun) {
          console.log(json);
        } else {
          writeFileSync(targetPath, json + '\n');
          console.log(`Wrote ${Object.keys(finalOutput.mcpServers).length} MCP server(s) to ${targetPath}`);
        }

        if (report.enabled.length > 0) {
          console.log(`  Enabled: ${report.enabled.join(', ')}`);
        }
        if (report.skipped.length > 0) {
          console.log('  Skipped:');
          for (const s of report.skipped) {
            console.log(`    - ${s.name}: ${s.reason}`);
          }
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  command
    .command('list')
    .description('List available battle-pack adapters and required env vars')
    .action(() => {
      const adapters = listBattlePackAdapters();
      console.log('Battle pack adapters:\n');
      for (const a of adapters) {
        const envs = a.envVars.length > 0 ? a.envVars.join(', ') : '(none)';
        console.log(`  ${a.name.padEnd(16)} env: ${envs}`);
      }
      console.log(`\nTotal: ${adapters.length} adapters`);
      console.log('\nConfigure via aistack.config.json `integrations` section, then run:');
      console.log('  aistack mcp-bridge sync');
    });

  command
    .command('status')
    .description('Show which battle-pack providers are currently configured + env-ready')
    .action(() => {
      const config = getConfig();
      const { report } = buildMcpJson(config.integrations, { skipIfEnvMissing: true });

      const configured = config.integrations
        ? Object.keys(config.integrations).filter((k) => !!(config.integrations as Record<string, unknown>)[k])
        : [];

      console.log(`Configured: ${configured.length > 0 ? configured.join(', ') : '(none)'}`);
      console.log(`Ready:      ${report.enabled.length > 0 ? report.enabled.join(', ') : '(none)'}`);
      if (report.skipped.length > 0) {
        console.log('Blocked:');
        for (const s of report.skipped) {
          console.log(`  - ${s.name}: ${s.reason}`);
        }
      }
    });

  return command;
}
