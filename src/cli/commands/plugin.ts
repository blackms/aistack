/**
 * plugin command - Plugin management
 */

import { Command } from 'commander';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getConfig } from '../../utils/config.js';
import type { AgentStackPlugin } from '../../types.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('plugin');

// In-memory plugin registry for now
const loadedPlugins: Map<string, AgentStackPlugin> = new Map();

async function loadPlugin(path: string): Promise<AgentStackPlugin | null> {
  try {
    const module = await import(path) as { default: AgentStackPlugin };
    return module.default;
  } catch (error) {
    log.error('Failed to load plugin', { path, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export function createPluginCommand(): Command {
  const command = new Command('plugin')
    .description('Plugin management');

  // list subcommand
  command
    .command('list')
    .description('List installed plugins')
    .action(async () => {
      const config = getConfig();
      const pluginDir = config.plugins.directory;

      if (!config.plugins.enabled) {
        console.log('Plugins are disabled in configuration.');
        return;
      }

      if (!existsSync(pluginDir)) {
        console.log('No plugins installed.');
        console.log(`Plugin directory: ${pluginDir}`);
        return;
      }

      const entries = readdirSync(pluginDir);
      const plugins: { name: string; version: string; description: string; loaded: boolean }[] = [];

      for (const entry of entries) {
        const entryPath = join(pluginDir, entry);
        if (statSync(entryPath).isDirectory()) {
          const packagePath = join(entryPath, 'package.json');
          if (existsSync(packagePath)) {
            try {
              const pkg = JSON.parse(await import('node:fs').then(fs => fs.readFileSync(packagePath, 'utf-8'))) as {
                name: string;
                version: string;
                description?: string;
              };
              plugins.push({
                name: pkg.name,
                version: pkg.version,
                description: pkg.description ?? '',
                loaded: loadedPlugins.has(pkg.name),
              });
            } catch {
              // Skip invalid packages
            }
          }
        }
      }

      if (plugins.length === 0) {
        console.log('No plugins installed.');
        return;
      }

      console.log('Installed plugins:\n');
      console.log('Name                           Version    Loaded    Description');
      console.log('─'.repeat(80));

      for (const plugin of plugins) {
        console.log(
          `${plugin.name.padEnd(30)} ${plugin.version.padEnd(10)} ${(plugin.loaded ? 'yes' : 'no').padEnd(9)} ${plugin.description.slice(0, 30)}`
        );
      }

      console.log(`\nTotal: ${plugins.length} plugin(s)`);
    });

  // install subcommand
  command
    .command('install')
    .description('Install a plugin')
    .argument('<name>', 'Plugin name or path')
    .action(async (name: string) => {
      const config = getConfig();

      if (!config.plugins.enabled) {
        console.error('Plugins are disabled in configuration.');
        process.exit(1);
      }

      // For now, we support loading from local path
      if (existsSync(name)) {
        const plugin = await loadPlugin(name);
        if (plugin) {
          loadedPlugins.set(plugin.name, plugin);
          console.log(`Plugin '${plugin.name}' installed and loaded.`);
          console.log(`Version: ${plugin.version}`);
          if (plugin.agents?.length) {
            console.log(`Agents: ${plugin.agents.map(a => a.type).join(', ')}`);
          }
          if (plugin.tools?.length) {
            console.log(`Tools: ${plugin.tools.map(t => t.name).join(', ')}`);
          }
        } else {
          console.error('Failed to load plugin.');
          process.exit(1);
        }
      } else {
        console.log('Installing from npm is not yet supported.');
        console.log('Use a local path to install plugins.');
      }
    });

  // enable subcommand
  command
    .command('enable')
    .description('Enable a plugin')
    .argument('<name>', 'Plugin name')
    .action((name: string) => {
      const plugin = loadedPlugins.get(name);
      if (!plugin) {
        console.error(`Plugin '${name}' not found. Install it first.`);
        process.exit(1);
      }

      // Plugin is already loaded, nothing to do
      console.log(`Plugin '${name}' is enabled.`);
    });

  // disable subcommand
  command
    .command('disable')
    .description('Disable a plugin')
    .argument('<name>', 'Plugin name')
    .action((name: string) => {
      const plugin = loadedPlugins.get(name);
      if (!plugin) {
        console.error(`Plugin '${name}' not found.`);
        process.exit(1);
      }

      // Unload plugin
      if (plugin.cleanup) {
        plugin.cleanup().catch(err => {
          log.error('Plugin cleanup failed', { name, error: err instanceof Error ? err.message : String(err) });
        });
      }

      loadedPlugins.delete(name);
      console.log(`Plugin '${name}' disabled.`);
    });

  return command;
}
