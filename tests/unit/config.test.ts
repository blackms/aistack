/**
 * Configuration tests
 */

import { describe, it, expect } from 'vitest';
import { getDefaultConfig, validateConfig } from '../../src/utils/config.js';

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
