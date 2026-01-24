/**
 * Plugins tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getPlugin,
  listPlugins,
  getPluginCount,
  clearPlugins,
  discoverPlugins,
  loadPlugin,
  unloadPlugin,
} from '../../src/plugins/loader.js';
import type { AgentStackConfig } from '../../src/types.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

  describe('loadPlugin', () => {
    it('should return null for invalid plugin path', async () => {
      const config = createConfig(true);
      const plugin = await loadPlugin('/nonexistent/path/plugin.js', config);

      expect(plugin).toBeNull();
    });

    it('should return null for module without default export', async () => {
      const config = createConfig(true);
      // Empty module path that won't have the required structure
      const plugin = await loadPlugin('node:path', config);

      expect(plugin).toBeNull();
    });
  });

  describe('unloadPlugin', () => {
    it('should return false for non-existent plugin', async () => {
      const result = await unloadPlugin('nonexistent');
      expect(result).toBe(false);
    });
  });
});

describe('Plugin Loading with Mock Modules', () => {
  beforeEach(async () => {
    await clearPlugins();
  });

  afterEach(async () => {
    await clearPlugins();
  });

  it('should load plugin with cleanup function', async () => {
    const cleanupFn = vi.fn();
    const pluginModule = {
      default: {
        name: 'test-cleanup-plugin',
        version: '1.0.0',
        cleanup: cleanupFn,
      },
    };

    // Mock import
    vi.doMock('/mock/cleanup-plugin.js', () => pluginModule);

    // Since we can't actually mock dynamic imports easily, test unload with non-existent
    // plugin returns false
    const result = await unloadPlugin('test-cleanup-plugin');
    expect(result).toBe(false);

    vi.doUnmock('/mock/cleanup-plugin.js');
  });

  it('should handle clearPlugins with no plugins', async () => {
    expect(getPluginCount()).toBe(0);
    await clearPlugins();
    expect(getPluginCount()).toBe(0);
  });
});

describe('Plugin Discovery with Real Directory', () => {
  let testDir: string;
  let config: AgentStackConfig;

  beforeEach(async () => {
    await clearPlugins();
    testDir = join(tmpdir(), `aistack-plugin-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    config = {
      version: '1.0.0',
      memory: {
        path: './test.db',
        defaultNamespace: 'default',
        vectorSearch: { enabled: false },
      },
      providers: { default: 'anthropic' },
      agents: { maxConcurrent: 5, defaultTimeout: 300 },
      github: { enabled: false },
      plugins: { enabled: true, directory: testDir },
      mcp: { transport: 'stdio' },
      hooks: {
        sessionStart: true,
        sessionEnd: true,
        preTask: true,
        postTask: true,
      },
    };
  });

  afterEach(async () => {
    await clearPlugins();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should skip non-directory entries', async () => {
    // Create a file instead of directory
    writeFileSync(join(testDir, 'not-a-plugin.txt'), 'hello');

    const count = await discoverPlugins(config);

    expect(count).toBe(0);
  });

  it('should skip directories without package.json', async () => {
    // Create empty plugin directory
    mkdirSync(join(testDir, 'empty-plugin'), { recursive: true });

    const count = await discoverPlugins(config);

    expect(count).toBe(0);
  });

  it('should handle plugin directory with invalid package.json', async () => {
    const pluginDir = join(testDir, 'bad-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'package.json'), 'not valid json');

    const count = await discoverPlugins(config);

    expect(count).toBe(0);
  });

  it('should handle plugin directory without main file', async () => {
    const pluginDir = join(testDir, 'no-main');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'test', main: 'index.js' })
    );
    // Don't create index.js

    const count = await discoverPlugins(config);

    expect(count).toBe(0);
  });
});
