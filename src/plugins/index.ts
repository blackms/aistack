/**
 * Plugin module exports
 */

export {
  loadPlugin,
  discoverPlugins,
  getPlugin,
  listPlugins,
  unloadPlugin,
  getPluginCount,
  clearPlugins,
} from './loader.js';

export {
  registerPluginEntry,
  getPluginEntry,
  listPluginEntries,
  setPluginEnabled,
  setPluginConfig,
  removePluginEntry,
  isPluginRegistered,
  getRegisteredPluginCount,
} from './registry.js';

export * from './types.js';
