/**
 * Plugin registry tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerPluginEntry,
  getPluginEntry,
  listPluginEntries,
  setPluginEnabled,
  setPluginConfig,
  removePluginEntry,
  isPluginRegistered,
  getRegisteredPluginCount,
} from '../../src/plugins/registry.js';
import type { AgentStackPlugin } from '../../src/types.js';

// Helper to create a mock plugin
function createMockPlugin(name: string, version: string = '1.0.0'): AgentStackPlugin {
  return {
    name,
    version,
    description: `Test plugin ${name}`,
    init: async () => {},
    cleanup: async () => {},
  };
}

describe('Plugin Registry', () => {
  beforeEach(() => {
    // Clean registry between tests by removing all registered plugins
    for (const entry of listPluginEntries()) {
      removePluginEntry(entry.name);
    }
  });

  describe('registerPluginEntry', () => {
    it('should register a plugin', () => {
      const plugin = createMockPlugin('test-plugin');
      registerPluginEntry(plugin);

      expect(isPluginRegistered('test-plugin')).toBe(true);
    });

    it('should store plugin metadata', () => {
      const plugin = createMockPlugin('metadata-plugin', '2.0.0');
      registerPluginEntry(plugin);

      const entry = getPluginEntry('metadata-plugin');
      expect(entry).not.toBeNull();
      expect(entry?.name).toBe('metadata-plugin');
      expect(entry?.version).toBe('2.0.0');
      expect(entry?.enabled).toBe(true);
      expect(entry?.installedAt).toBeInstanceOf(Date);
    });

    it('should overwrite existing plugin with same name', () => {
      registerPluginEntry(createMockPlugin('dup-plugin', '1.0.0'));
      registerPluginEntry(createMockPlugin('dup-plugin', '2.0.0'));

      const entry = getPluginEntry('dup-plugin');
      expect(entry?.version).toBe('2.0.0');
    });
  });

  describe('getPluginEntry', () => {
    it('should return plugin entry when exists', () => {
      registerPluginEntry(createMockPlugin('existing'));

      const entry = getPluginEntry('existing');
      expect(entry).not.toBeNull();
      expect(entry?.name).toBe('existing');
    });

    it('should return null for non-existent plugin', () => {
      const entry = getPluginEntry('non-existent');
      expect(entry).toBeNull();
    });
  });

  describe('listPluginEntries', () => {
    it('should return empty array when no plugins registered', () => {
      const entries = listPluginEntries();
      expect(entries).toEqual([]);
    });

    it('should return all registered plugins', () => {
      registerPluginEntry(createMockPlugin('plugin-1'));
      registerPluginEntry(createMockPlugin('plugin-2'));
      registerPluginEntry(createMockPlugin('plugin-3'));

      const entries = listPluginEntries();
      expect(entries.length).toBe(3);

      const names = entries.map((e) => e.name);
      expect(names).toContain('plugin-1');
      expect(names).toContain('plugin-2');
      expect(names).toContain('plugin-3');
    });
  });

  describe('setPluginEnabled', () => {
    it('should disable a plugin', () => {
      registerPluginEntry(createMockPlugin('to-disable'));

      const result = setPluginEnabled('to-disable', false);
      expect(result).toBe(true);

      const entry = getPluginEntry('to-disable');
      expect(entry?.enabled).toBe(false);
    });

    it('should re-enable a disabled plugin', () => {
      registerPluginEntry(createMockPlugin('to-enable'));
      setPluginEnabled('to-enable', false);
      setPluginEnabled('to-enable', true);

      const entry = getPluginEntry('to-enable');
      expect(entry?.enabled).toBe(true);
    });

    it('should return false for non-existent plugin', () => {
      const result = setPluginEnabled('non-existent', false);
      expect(result).toBe(false);
    });
  });

  describe('setPluginConfig', () => {
    it('should set plugin config', () => {
      registerPluginEntry(createMockPlugin('configurable'));

      const config = { setting1: 'value1', setting2: 42 };
      const result = setPluginConfig('configurable', config);

      expect(result).toBe(true);

      const entry = getPluginEntry('configurable');
      expect(entry?.config).toEqual(config);
    });

    it('should replace existing config', () => {
      registerPluginEntry(createMockPlugin('update-config'));
      setPluginConfig('update-config', { old: 'value' });
      setPluginConfig('update-config', { new: 'value' });

      const entry = getPluginEntry('update-config');
      expect(entry?.config).toEqual({ new: 'value' });
    });

    it('should return false for non-existent plugin', () => {
      const result = setPluginConfig('non-existent', { key: 'value' });
      expect(result).toBe(false);
    });
  });

  describe('removePluginEntry', () => {
    it('should remove a registered plugin', () => {
      registerPluginEntry(createMockPlugin('to-remove'));

      const result = removePluginEntry('to-remove');
      expect(result).toBe(true);
      expect(isPluginRegistered('to-remove')).toBe(false);
    });

    it('should return false for non-existent plugin', () => {
      const result = removePluginEntry('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('isPluginRegistered', () => {
    it('should return true for registered plugin', () => {
      registerPluginEntry(createMockPlugin('registered'));
      expect(isPluginRegistered('registered')).toBe(true);
    });

    it('should return false for unregistered plugin', () => {
      expect(isPluginRegistered('not-registered')).toBe(false);
    });
  });

  describe('getRegisteredPluginCount', () => {
    it('should return zero for empty registry', () => {
      const count = getRegisteredPluginCount();
      expect(count.total).toBe(0);
      expect(count.enabled).toBe(0);
    });

    it('should count all plugins', () => {
      registerPluginEntry(createMockPlugin('count-1'));
      registerPluginEntry(createMockPlugin('count-2'));

      const count = getRegisteredPluginCount();
      expect(count.total).toBe(2);
      expect(count.enabled).toBe(2);
    });

    it('should separate enabled and disabled counts', () => {
      registerPluginEntry(createMockPlugin('enabled-1'));
      registerPluginEntry(createMockPlugin('enabled-2'));
      registerPluginEntry(createMockPlugin('disabled-1'));
      setPluginEnabled('disabled-1', false);

      const count = getRegisteredPluginCount();
      expect(count.total).toBe(3);
      expect(count.enabled).toBe(2);
    });
  });
});
