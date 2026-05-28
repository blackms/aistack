/**
 * OpenTelemetry tracing helper tests
 */

import { describe, expect, it, vi } from 'vitest';
import {
  isTracingEnabled,
  sanitizeSpanAttributes,
  traceAsync,
  traceSync,
} from '../../../src/observability/index.js';
import type { AgentStackConfig } from '../../../src/types.js';

function createConfig(enabled = false): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: ':memory:',
      defaultNamespace: 'test',
      vectorSearch: { enabled: false },
    },
    providers: {
      default: 'anthropic',
      anthropic: { apiKey: 'test-key' },
    },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: false },
    plugins: { enabled: false, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: false, sessionEnd: false, preTask: false, postTask: false },
    observability: {
      tracing: { enabled },
    },
  };
}

describe('OpenTelemetry tracing helpers', () => {
  it('detects disabled and enabled tracing config', () => {
    expect(isTracingEnabled(createConfig(false))).toBe(false);
    expect(isTracingEnabled(createConfig(true))).toBe(true);
    expect(isTracingEnabled(undefined)).toBe(false);
  });

  it('sanitizes supported span attributes and drops nullish values', () => {
    const now = new Date('2026-05-28T10:00:00.000Z');

    expect(sanitizeSpanAttributes({
      'agent.id': 'a1',
      'llm.usage.input_tokens': 12,
      'mcp.tool.success': true,
      'event.time': now,
      empty: undefined,
      nothing: null,
    })).toEqual({
      'agent.id': 'a1',
      'llm.usage.input_tokens': 12,
      'mcp.tool.success': true,
      'event.time': '2026-05-28T10:00:00.000Z',
    });
  });

  it('runs async callbacks without creating spans when tracing is disabled', async () => {
    const fn = vi.fn(async (span) => {
      expect(span).toBeUndefined();
      return 'done';
    });

    await expect(traceAsync(createConfig(false), 'test.span', {}, fn)).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs sync callbacks without creating spans when tracing is disabled', () => {
    const result = traceSync(createConfig(false), 'test.span', {}, (span) => {
      expect(span).toBeUndefined();
      return 42;
    });

    expect(result).toBe(42);
  });

  it('propagates callback errors in disabled mode', async () => {
    await expect(traceAsync(createConfig(false), 'test.span', {}, async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
  });
});
