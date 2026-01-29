/**
 * init command - Initialize a new aistack project
 */

import { Command } from 'commander';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDefaultConfig, saveConfig } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('init');

export function createInitCommand(): Command {
  const command = new Command('init')
    .description('Initialize a new aistack project')
    .option('-f, --force', 'Overwrite existing configuration')
    .option('-d, --directory <path>', 'Directory to initialize', process.cwd())
    .action(async (options) => {
      const { force, directory } = options as { force?: boolean; directory: string };

      const configPath = join(directory, 'aistack.config.json');
      const dataDir = join(directory, 'data');

      // Check if already initialized
      if (existsSync(configPath) && !force) {
        console.error('Project already initialized. Use --force to overwrite.');
        process.exit(1);
      }

      console.log('Initializing aistack project...\n');

      // Create default config
      const config = getDefaultConfig();

      // Save config
      saveConfig(config, configPath);
      console.log(`  Created ${configPath}`);

      // Create data directory
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
        console.log(`  Created ${dataDir}/`);
      }

      // Create .gitignore for data
      const gitignorePath = join(dataDir, '.gitignore');
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, '*.db\n*.db-journal\n');
        console.log(`  Created ${gitignorePath}`);
      }

      console.log('\nProject initialized successfully!\n');
      console.log('Next steps:');
      console.log('  1. Configure providers in aistack.config.json');
      console.log('  2. Add MCP server: claude mcp add aistack -- npx @blackms/aistack mcp start');
      console.log('  3. Start using aistack commands\n');

      log.info('Project initialized', { directory });
    });

  return command;
}
