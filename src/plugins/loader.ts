/**
 * Plugin loader - discover and load plugins
 */

import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentStackPlugin, AgentStackConfig } from '../types.js';
import { registerAgent } from '../agents/registry.js';
import { logger } from '../utils/logger.js';

const log = logger.child('plugins');

// Loaded plugins
const plugins: Map<string, AgentStackPlugin> = new Map();

/**
 * Load a plugin from a path
 */
export async function loadPlugin(
  path: string,
  config: AgentStackConfig
): Promise<AgentStackPlugin | null> {
  try {
    // Import the plugin module
    const module = await import(path) as { default?: AgentStackPlugin };
    const plugin = module.default;

    if (!plugin || !plugin.name || !plugin.version) {
      log.error('Invalid plugin format', { path });
      return null;
    }

    // Initialize plugin if it has an init function
    if (plugin.init) {
      await plugin.init(config);
    }

    // Register agents from plugin
    if (plugin.agents) {
      for (const agent of plugin.agents) {
        registerAgent(agent);
      }
    }

    plugins.set(plugin.name, plugin);
    log.info('Loaded plugin', {
      name: plugin.name,
      version: plugin.version,
      agents: plugin.agents?.length ?? 0,
      tools: plugin.tools?.length ?? 0,
    });

    return plugin;
  } catch (error) {
    log.error('Failed to load plugin', {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Discover and load plugins from directory
 */
export async function discoverPlugins(config: AgentStackConfig): Promise<number> {
  if (!config.plugins.enabled) {
    log.debug('Plugins disabled');
    return 0;
  }

  const pluginDir = config.plugins.directory;

  if (!existsSync(pluginDir)) {
    log.debug('Plugin directory not found', { path: pluginDir });
    return 0;
  }

  let loaded = 0;
  const entries = readdirSync(pluginDir);

  for (const entry of entries) {
    const entryPath = join(pluginDir, entry);

    if (!statSync(entryPath).isDirectory()) {
      continue;
    }

    // Look for package.json
    const packagePath = join(entryPath, 'package.json');
    if (!existsSync(packagePath)) {
      continue;
    }

    try {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf-8')) as {
        main?: string;
        module?: string;
      };

      // Determine entry point
      const mainFile = pkg.module ?? pkg.main ?? 'index.js';
      const mainPath = join(entryPath, mainFile);

      if (existsSync(mainPath)) {
        const plugin = await loadPlugin(mainPath, config);
        if (plugin) {
          loaded++;
        }
      }
    } catch (error) {
      log.warn('Failed to read plugin package', {
        path: packagePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  log.info('Discovered plugins', { count: loaded, directory: pluginDir });
  return loaded;
}

/**
 * Get a loaded plugin by name
 */
export function getPlugin(name: string): AgentStackPlugin | null {
  return plugins.get(name) ?? null;
}

/**
 * List all loaded plugins
 */
export function listPlugins(): AgentStackPlugin[] {
  return Array.from(plugins.values());
}

/**
 * Unload a plugin
 */
export async function unloadPlugin(name: string): Promise<boolean> {
  const plugin = plugins.get(name);
  if (!plugin) {
    return false;
  }

  // Call cleanup if defined
  if (plugin.cleanup) {
    try {
      await plugin.cleanup();
    } catch (error) {
      log.warn('Plugin cleanup failed', {
        name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  plugins.delete(name);
  log.info('Unloaded plugin', { name });
  return true;
}

/**
 * Get plugin count
 */
export function getPluginCount(): number {
  return plugins.size;
}

/**
 * Clear all plugins (for testing)
 */
export async function clearPlugins(): Promise<void> {
  for (const name of plugins.keys()) {
    await unloadPlugin(name);
  }
}
