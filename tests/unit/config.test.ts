/**
 * Configuration tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getDefaultConfig,
  validateConfig,
  loadConfig,
  saveConfig,
  getConfig,
  resetConfig,
} from '../../src/utils/config.js';
import { existsSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Configuration', () => {
  it('should provide default config', () => {
    const config = getDefaultConfig();

    expect(config.version).toBe('1.0.0');
    expect(config.memory.path).toBe('./data/aistack.db');
    expect(config.memory.defaultNamespace).toBe('default');
    expect(config.memory.vectorSearch.enabled).toBe(false);
    expect(config.agents.maxConcurrent).toBe(5);
    expect(config.agents.defaultTimeout).toBe(300);
    expect(config.providers.default).toBe('anthropic');
    expect(config.github.enabled).toBe(false);
    expect(config.plugins.enabled).toBe(true);
    expect(config.mcp.transport).toBe('stdio');
    expect(config.hooks.sessionStart).toBe(true);
    expect(config.hooks.sessionEnd).toBe(true);
    expect(config.hooks.preTask).toBe(true);
    expect(config.hooks.postTask).toBe(true);
  });

  it('should validate correct config', () => {
    const result = validateConfig({
      version: '1.0.0',
      memory: {
        path: './data/test.db',
        defaultNamespace: 'test',
      },
      agents: {
        maxConcurrent: 10,
      },
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('should reject invalid agent config', () => {
    const result = validateConfig({
      agents: {
        maxConcurrent: 100, // Too high
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });
});

describe('Config File Operations', () => {
  let testDir: string;
  let configPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `aistack-config-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    configPath = join(testDir, 'aistack.config.json');
    resetConfig();
  });

  afterEach(() => {
    resetConfig();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('saveConfig', () => {
    it('should save config to file', () => {
      const config = getDefaultConfig();
      saveConfig(config, configPath);

      expect(existsSync(configPath)).toBe(true);
    });

    it('should save valid JSON', () => {
      const config = getDefaultConfig();
      saveConfig(config, configPath);

      const content = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.version).toBe(config.version);
    });

    it('should create parent directories', () => {
      const nestedPath = join(testDir, 'nested', 'dir', 'config.json');
      const config = getDefaultConfig();

      saveConfig(config, nestedPath);

      expect(existsSync(nestedPath)).toBe(true);
    });
  });

  describe('loadConfig', () => {
    it('should load config from file', () => {
      const original = getDefaultConfig();
      original.agents.maxConcurrent = 10;
      saveConfig(original, configPath);

      const loaded = loadConfig(configPath);

      expect(loaded.agents.maxConcurrent).toBe(10);
    });

    it('should return default config for missing file', () => {
      const config = loadConfig(join(testDir, 'nonexistent.json'));

      expect(config.version).toBe(getDefaultConfig().version);
    });

    it('should merge with defaults for partial config', () => {
      writeFileSync(
        configPath,
        JSON.stringify({
          version: '1.0.0',
          agents: { maxConcurrent: 7, defaultTimeout: 300 },
        })
      );

      const config = loadConfig(configPath);

      expect(config.agents.maxConcurrent).toBe(7);
      expect(config.memory).toBeDefined();
      expect(config.providers).toBeDefined();
    });

    it('should handle invalid JSON gracefully', () => {
      writeFileSync(configPath, 'not valid json {{{');

      const config = loadConfig(configPath);

      // Should return defaults
      expect(config.version).toBe('1.0.0');
    });
  });

  describe('getConfig and resetConfig', () => {
    it('should cache config', () => {
      const config1 = getConfig();
      const config2 = getConfig();

      expect(config1).toBe(config2);
    });

    it('should reset cached config', () => {
      const config1 = getConfig();
      resetConfig();
      const config2 = getConfig();

      // Should be equal but not the same object
      expect(config1.version).toBe(config2.version);
    });
  });
});

describe('Config Validation', () => {
  it('should validate agents maxConcurrent range', () => {
    const resultLow = validateConfig({
      agents: { maxConcurrent: 0 },
    });
    expect(resultLow.valid).toBe(false);

    const resultHigh = validateConfig({
      agents: { maxConcurrent: 25 },
    });
    expect(resultHigh.valid).toBe(false);

    const resultValid = validateConfig({
      agents: { maxConcurrent: 10 },
    });
    expect(resultValid.valid).toBe(true);
  });

  it('should validate agents defaultTimeout range', () => {
    const resultLow = validateConfig({
      agents: { defaultTimeout: 5 },
    });
    expect(resultLow.valid).toBe(false);

    const resultHigh = validateConfig({
      agents: { defaultTimeout: 5000 },
    });
    expect(resultHigh.valid).toBe(false);
  });

  it('should validate mcp transport enum', () => {
    const resultValid = validateConfig({
      mcp: { transport: 'stdio' },
    });
    expect(resultValid.valid).toBe(true);

    const resultHttpValid = validateConfig({
      mcp: { transport: 'http' },
    });
    expect(resultHttpValid.valid).toBe(true);
  });

  it('should accept full valid config', () => {
    const fullConfig = {
      version: '1.0.0',
      memory: {
        path: './data/test.db',
        defaultNamespace: 'test',
        vectorSearch: { enabled: true, provider: 'openai' },
      },
      providers: {
        default: 'anthropic',
        anthropic: { apiKey: 'test-key' },
      },
      agents: { maxConcurrent: 5, defaultTimeout: 300 },
      github: { enabled: true, useGhCli: true },
      plugins: { enabled: true, directory: './plugins' },
      mcp: { transport: 'http', port: 3000, host: 'localhost' },
      hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
    };

    const result = validateConfig(fullConfig);
    expect(result.valid).toBe(true);
  });
});
