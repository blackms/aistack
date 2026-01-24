/**
 * Plugins tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getPlugin,
  listPlugins,
  getPluginCount,
  clearPlugins,
  discoverPlugins,
} from '../../src/plugins/loader.js';
import type { AgentStackConfig } from '../../src/types.js';

function createConfig(pluginsEnabled: boolean = false): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: './test.db',
      defaultNamespace: 'default',
      vectorSearch: { enabled: false },
    },
    providers: { default: 'anthropic' },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: false },
    plugins: { enabled: pluginsEnabled, directory: './nonexistent-plugins' },
    mcp: { transport: 'stdio' },
    hooks: {
      sessionStart: true,
      sessionEnd: true,
      preTask: true,
      postTask: true,
    },
  };
}

describe('Plugin Registry', () => {
  beforeEach(async () => {
    await clearPlugins();
  });

  describe('getPlugin', () => {
    it('should return null for non-existent plugin', () => {
      const plugin = getPlugin('nonexistent');
      expect(plugin).toBeNull();
    });
  });

  describe('listPlugins', () => {
    it('should return empty array when no plugins loaded', () => {
      const plugins = listPlugins();
      expect(plugins).toEqual([]);
    });
  });

  describe('getPluginCount', () => {
    it('should return 0 when no plugins loaded', () => {
      expect(getPluginCount()).toBe(0);
    });
  });

  describe('clearPlugins', () => {
    it('should not throw when no plugins exist', async () => {
      await expect(clearPlugins()).resolves.not.toThrow();
    });
  });

  describe('discoverPlugins', () => {
    it('should return 0 when plugins disabled', async () => {
      const config = createConfig(false);
      const count = await discoverPlugins(config);

      expect(count).toBe(0);
    });

    it('should return 0 when plugin directory does not exist', async () => {
      const config = createConfig(true);
      const count = await discoverPlugins(config);

      expect(count).toBe(0);
    });
  });
});
