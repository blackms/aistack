/**
 * Smart Dispatcher Service tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SmartDispatcher,
  getSmartDispatcher,
  resetSmartDispatcher,
} from '../../src/tasks/smart-dispatcher.js';
import type { AgentStackConfig } from '../../src/types.js';
import * as providers from '../../src/providers/index.js';

// Mock fetch for LLM API calls
const mockFetch = vi.fn();
const originalFetch = global.fetch;

// Helper to create test config
function createConfig(options: {
  enabled?: boolean;
  cacheEnabled?: boolean;
  cacheTTLMs?: number;
  confidenceThreshold?: number;
  fallbackAgentType?: string;
  maxDescriptionLength?: number;
  dispatchModel?: string;
  anthropicKey?: string;
}): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: './data/memory.db',
      defaultNamespace: 'default',
      vectorSearch: { enabled: false },
    },
    providers: {
      default: 'anthropic',
      anthropic: options.anthropicKey ? { apiKey: options.anthropicKey } : undefined,
    },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: false },
    plugins: { enabled: true, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
    smartDispatcher: {
      enabled: options.enabled ?? true,
      cacheEnabled: options.cacheEnabled ?? true,
      cacheTTLMs: options.cacheTTLMs ?? 3600000,
      confidenceThreshold: options.confidenceThreshold ?? 0.7,
      fallbackAgentType: options.fallbackAgentType ?? 'coder',
      maxDescriptionLength: options.maxDescriptionLength ?? 1000,
      dispatchModel: options.dispatchModel ?? 'claude-haiku-4-5-20251001',
    },
  };
}

// Helper to create mock LLM response
function createMockLLMResponse(agentType: string, confidence: number, reasoning: string) {
  return {
    ok: true,
    json: async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ agentType, confidence, reasoning }),
        },
      ],
      model: 'claude-haiku-4-5-20251001',
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
  };
}

describe('SmartDispatcher', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch;
    resetSmartDispatcher();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('isEnabled', () => {
    it('should return false when disabled in config', () => {
      const dispatcher = new SmartDispatcher(
        createConfig({ enabled: false, anthropicKey: 'sk-test' })
      );

      expect(dispatcher.isEnabled()).toBe(false);
    });

    it('should return false when no provider is available', () => {
      const dispatcher = new SmartDispatcher(
        createConfig({ enabled: true, anthropicKey: undefined })
      );

      expect(dispatcher.isEnabled()).toBe(false);
    });

    it('should return true when enabled with valid provider', () => {
      const dispatcher = new SmartDispatcher(
        createConfig({ enabled: true, anthropicKey: 'sk-test' })
      );

      expect(dispatcher.isEnabled()).toBe(true);
    });

    it('should return false when provider creation fails', () => {
      // Mock getProvider to throw an error
      const getProviderSpy = vi.spyOn(providers, 'getProvider').mockImplementation(() => {
        throw new Error('Provider initialization failed');
      });

      const dispatcher = new SmartDispatcher(
        createConfig({ enabled: true, anthropicKey: undefined })
      );

      expect(dispatcher.isEnabled()).toBe(false);

      getProviderSpy.mockRestore();
    });
  });

  describe('dispatch', () => {
    it('should return error when disabled', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({ enabled: false })
      );

      const result = await dispatcher.dispatch('Create a REST endpoint');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not enabled');
    });

    it('should select coder for coding tasks', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({ enabled: true, anthropicKey: 'sk-test' })
      );

      mockFetch.mockResolvedValueOnce(
        createMockLLMResponse('coder', 0.95, 'Task involves implementing code')
      );

      const result = await dispatcher.dispatch('Create a REST endpoint for user authentication');

      expect(result.success).toBe(true);
      expect(result.decision?.agentType).toBe('coder');
      expect(result.decision?.confidence).toBe(0.95);
      expect(result.decision?.cached).toBe(false);
    });

    it('should select researcher for research tasks', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({ enabled: true, anthropicKey: 'sk-test' })
      );

      mockFetch.mockResolvedValueOnce(
        createMockLLMResponse('researcher', 0.9, 'Task involves code exploration')
      );

      const result = await dispatcher.dispatch('Find all usages of the UserService class');

      expect(result.success).toBe(true);
      expect(result.decision?.agentType).toBe('researcher');
    });

    it('should select tester for testing tasks', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({ enabled: true, anthropicKey: 'sk-test' })
      );

      mockFetch.mockResolvedValueOnce(
        createMockLLMResponse('tester', 0.88, 'Task involves writing tests')
      );

      const result = await dispatcher.dispatch('Write unit tests for the AuthController');

      expect(result.success).toBe(true);
      expect(result.decision?.agentType).toBe('tester');
    });

    it('should use fallback when confidence is below threshold', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({
          enabled: true,
          anthropicKey: 'sk-test',
          confidenceThreshold: 0.8,
          fallbackAgentType: 'coordinator',
        })
      );

      mockFetch.mockResolvedValueOnce(
        createMockLLMResponse('analyst', 0.5, 'Uncertain about task type')
      );

      const result = await dispatcher.dispatch('Do something with the data');

      expect(result.success).toBe(true);
      expect(result.decision?.agentType).toBe('coordinator'); // Fallback
      expect(result.decision?.reasoning).toContain('Low confidence');
    });

    it('should use fallback on LLM API error', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({
          enabled: true,
          anthropicKey: 'sk-test',
          fallbackAgentType: 'coder',
        })
      );

      mockFetch.mockRejectedValueOnce(new Error('API rate limit exceeded'));

      const result = await dispatcher.dispatch('Build a feature');

      expect(result.success).toBe(true);
      expect(result.decision?.agentType).toBe('coder'); // Fallback
      expect(result.decision?.confidence).toBe(0);
      expect(result.decision?.reasoning).toContain('failed');
    });

    it('should truncate long descriptions', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({
          enabled: true,
          anthropicKey: 'sk-test',
          maxDescriptionLength: 50,
        })
      );

      mockFetch.mockResolvedValueOnce(
        createMockLLMResponse('coder', 0.9, 'Code task')
      );

      const longDescription = 'A'.repeat(200);
      await dispatcher.dispatch(longDescription);

      // Verify the API was called with truncated text
      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArgs.body);
      const userMessage = body.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMessage.content.length).toBe(50);
    });
  });

  describe('cache', () => {
    it('should cache dispatch results', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({
          enabled: true,
          anthropicKey: 'sk-test',
          cacheEnabled: true,
        })
      );

      mockFetch.mockResolvedValueOnce(
        createMockLLMResponse('coder', 0.9, 'Code task')
      );

      // First call - should hit LLM
      const result1 = await dispatcher.dispatch('Create a function');
      expect(result1.decision?.cached).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call with same description - should be cached
      const result2 = await dispatcher.dispatch('Create a function');
      expect(result2.decision?.cached).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No additional API call
    });

    it('should not cache when caching is disabled', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({
          enabled: true,
          anthropicKey: 'sk-test',
          cacheEnabled: false,
        })
      );

      mockFetch
        .mockResolvedValueOnce(createMockLLMResponse('coder', 0.9, 'Code task'))
        .mockResolvedValueOnce(createMockLLMResponse('coder', 0.9, 'Code task'));

      await dispatcher.dispatch('Create a function');
      await dispatcher.dispatch('Create a function');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should expire cached entries after TTL', async () => {
      vi.useFakeTimers();

      const dispatcher = new SmartDispatcher(
        createConfig({
          enabled: true,
          anthropicKey: 'sk-test',
          cacheEnabled: true,
          cacheTTLMs: 1000, // 1 second
        })
      );

      mockFetch
        .mockResolvedValueOnce(createMockLLMResponse('coder', 0.9, 'Code task'))
        .mockResolvedValueOnce(createMockLLMResponse('coder', 0.9, 'Code task'));

      await dispatcher.dispatch('Create a function');

      // Advance time past TTL
      vi.advanceTimersByTime(2000);

      const result = await dispatcher.dispatch('Create a function');
      expect(result.decision?.cached).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should clear cache when clearCache is called', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({
          enabled: true,
          anthropicKey: 'sk-test',
          cacheEnabled: true,
        })
      );

      mockFetch
        .mockResolvedValueOnce(createMockLLMResponse('coder', 0.9, 'Code task'))
        .mockResolvedValueOnce(createMockLLMResponse('coder', 0.9, 'Code task'));

      await dispatcher.dispatch('Create a function');
      dispatcher.clearCache();
      await dispatcher.dispatch('Create a function');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should trigger cache cleanup when cache exceeds 1000 entries', async () => {
      vi.useFakeTimers();

      const dispatcher = new SmartDispatcher(
        createConfig({
          enabled: true,
          anthropicKey: 'sk-test',
          cacheEnabled: true,
          cacheTTLMs: 1000, // Short TTL for cleanup test
        })
      );

      // Mock fetch to always return valid response
      mockFetch.mockResolvedValue(createMockLLMResponse('coder', 0.9, 'Code task'));

      // Fill cache with 1001 unique entries
      for (let i = 0; i < 1001; i++) {
        await dispatcher.dispatch(`Unique task ${i}`);
      }

      expect(dispatcher.getCacheStats().size).toBe(1001);

      // Advance time past TTL to make all entries expired
      vi.advanceTimersByTime(2000);

      // Next dispatch should trigger cleanup of expired entries
      await dispatcher.dispatch('Trigger cleanup task');

      // Cache should have only the new entry after cleanup
      expect(dispatcher.getCacheStats().size).toBe(1);

      vi.useRealTimers();
    });

    it('should clean expired entries during cache maintenance', async () => {
      vi.useFakeTimers();

      const dispatcher = new SmartDispatcher(
        createConfig({
          enabled: true,
          anthropicKey: 'sk-test',
          cacheEnabled: true,
          cacheTTLMs: 500, // Very short TTL
        })
      );

      mockFetch.mockResolvedValue(createMockLLMResponse('coder', 0.9, 'Code task'));

      // Add some entries
      await dispatcher.dispatch('Task A');
      await dispatcher.dispatch('Task B');
      expect(dispatcher.getCacheStats().size).toBe(2);

      // Advance time to expire entries
      vi.advanceTimersByTime(1000);

      // Fill cache past threshold to trigger cleanup
      for (let i = 0; i < 1000; i++) {
        await dispatcher.dispatch(`Filler task ${i}`);
      }

      // The expired entries (Task A, Task B) should have been cleaned
      // Cache should contain only the 1000 filler tasks + cleanup trigger
      const stats = dispatcher.getCacheStats();
      expect(stats.size).toBeLessThanOrEqual(1001);
      expect(stats.size).toBeGreaterThan(0);

      vi.useRealTimers();
    });
  });

  describe('parseResponse', () => {
    it('should parse valid JSON response', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({ enabled: true, anthropicKey: 'sk-test' })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: '{"agentType":"devops","confidence":0.85,"reasoning":"Infrastructure task"}',
            },
          ],
          model: 'claude-haiku-4-5-20251001',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const result = await dispatcher.dispatch('Set up CI/CD pipeline');

      expect(result.decision?.agentType).toBe('devops');
      expect(result.decision?.confidence).toBe(0.85);
      expect(result.decision?.reasoning).toBe('Infrastructure task');
    });

    it('should handle JSON in markdown code block', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({ enabled: true, anthropicKey: 'sk-test' })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: '```json\n{"agentType":"reviewer","confidence":0.8,"reasoning":"Code review"}\n```',
            },
          ],
          model: 'claude-haiku-4-5-20251001',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const result = await dispatcher.dispatch('Review this PR');

      expect(result.decision?.agentType).toBe('reviewer');
    });

    it('should normalize agent type with underscores', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({ enabled: true, anthropicKey: 'sk-test' })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: '{"agentType":"security_auditor","confidence":0.9,"reasoning":"Security task"}',
            },
          ],
          model: 'claude-haiku-4-5-20251001',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const result = await dispatcher.dispatch('Audit security vulnerabilities');

      expect(result.decision?.agentType).toBe('security-auditor');
    });

    it('should use fallback for invalid agent type', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({
          enabled: true,
          anthropicKey: 'sk-test',
          fallbackAgentType: 'coder',
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: '{"agentType":"invalid_type","confidence":0.9,"reasoning":"Unknown type"}',
            },
          ],
          model: 'claude-haiku-4-5-20251001',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const result = await dispatcher.dispatch('Do something');

      expect(result.decision?.agentType).toBe('coder'); // Fallback
    });

    it('should handle missing confidence field', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({ enabled: true, anthropicKey: 'sk-test' })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: '{"agentType":"coder","reasoning":"Code task"}',
            },
          ],
          model: 'claude-haiku-4-5-20251001',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const result = await dispatcher.dispatch('Write code');

      expect(result.decision?.agentType).toBe('coder');
      expect(result.decision?.confidence).toBe(0.5); // Default
    });

    it('should clamp confidence to 0-1 range', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({ enabled: true, anthropicKey: 'sk-test' })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: '{"agentType":"coder","confidence":1.5,"reasoning":"Very confident"}',
            },
          ],
          model: 'claude-haiku-4-5-20251001',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const result = await dispatcher.dispatch('Write code');

      expect(result.decision?.confidence).toBe(1);
    });

    it('should handle malformed JSON', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({
          enabled: true,
          anthropicKey: 'sk-test',
          fallbackAgentType: 'coordinator',
          confidenceThreshold: 0, // No threshold so we test parse failure directly
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: 'This is not valid JSON at all',
            },
          ],
          model: 'claude-haiku-4-5-20251001',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const result = await dispatcher.dispatch('Do something');

      expect(result.decision?.agentType).toBe('coordinator'); // Fallback
      expect(result.decision?.confidence).toBe(0);
      // Note: reasoning will contain "Failed to parse" from the parse error
      expect(result.decision?.reasoning).toContain('Failed to parse');
    });
  });

  describe('getSmartDispatcher (singleton)', () => {
    it('should return the same instance for same config', () => {
      const config = createConfig({ enabled: true, anthropicKey: 'sk-test' });

      const dispatcher1 = getSmartDispatcher(config);
      const dispatcher2 = getSmartDispatcher(config);

      expect(dispatcher1).toBe(dispatcher2);
    });

    it('should create new instance when config changes', () => {
      const config1 = createConfig({ enabled: true, confidenceThreshold: 0.7, anthropicKey: 'sk-test' });
      const config2 = createConfig({ enabled: true, confidenceThreshold: 0.8, anthropicKey: 'sk-test' });

      const dispatcher1 = getSmartDispatcher(config1);
      const dispatcher2 = getSmartDispatcher(config2);

      expect(dispatcher1).not.toBe(dispatcher2);
      expect(dispatcher1.getConfig().confidenceThreshold).toBe(0.7);
      expect(dispatcher2.getConfig().confidenceThreshold).toBe(0.8);
    });

    it('should create new instance when forceNew is true', () => {
      const config = createConfig({ enabled: true, anthropicKey: 'sk-test' });

      const dispatcher1 = getSmartDispatcher(config);
      const dispatcher2 = getSmartDispatcher(config, true);

      expect(dispatcher1).not.toBe(dispatcher2);
    });

    it('should handle config with undefined smartDispatcher', () => {
      const config: AgentStackConfig = {
        version: '1.0.0',
        memory: {
          path: './data/memory.db',
          defaultNamespace: 'default',
          vectorSearch: { enabled: false },
        },
        providers: { default: 'anthropic' },
        agents: { maxConcurrent: 5, defaultTimeout: 300 },
        github: { enabled: false },
        plugins: { enabled: true, directory: './plugins' },
        mcp: { transport: 'stdio' },
        hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
        // smartDispatcher is undefined
      };

      const dispatcher = getSmartDispatcher(config);
      expect(dispatcher).toBeDefined();
      // Should use default config
      expect(dispatcher.getConfig().enabled).toBe(true);
    });

    it('should compare configs correctly when both are undefined', () => {
      // First call with undefined smartDispatcher
      const config1: AgentStackConfig = {
        version: '1.0.0',
        memory: { path: './test.db', defaultNamespace: 'default', vectorSearch: { enabled: false } },
        providers: { default: 'anthropic' },
        agents: { maxConcurrent: 5, defaultTimeout: 300 },
        github: { enabled: false },
        plugins: { enabled: true, directory: './plugins' },
        mcp: { transport: 'stdio' },
        hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
      };

      const dispatcher1 = getSmartDispatcher(config1);

      // Second call with same undefined smartDispatcher should return same instance
      const config2: AgentStackConfig = { ...config1 };
      const dispatcher2 = getSmartDispatcher(config2);

      // Both should have default config and be same instance
      expect(dispatcher1.getConfig().enabled).toBe(true);
      expect(dispatcher2).toBe(dispatcher1);
    });

    it('should create new instance when only one config has smartDispatcher', () => {
      // First with undefined
      const config1: AgentStackConfig = {
        version: '1.0.0',
        memory: { path: './test.db', defaultNamespace: 'default', vectorSearch: { enabled: false } },
        providers: { default: 'anthropic' },
        agents: { maxConcurrent: 5, defaultTimeout: 300 },
        github: { enabled: false },
        plugins: { enabled: true, directory: './plugins' },
        mcp: { transport: 'stdio' },
        hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
      };

      const dispatcher1 = getSmartDispatcher(config1);

      // Second with defined smartDispatcher
      const config2 = createConfig({ enabled: true, anthropicKey: 'sk-test' });
      const dispatcher2 = getSmartDispatcher(config2);

      // Should be different instances
      expect(dispatcher2).not.toBe(dispatcher1);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({
          enabled: true,
          anthropicKey: 'sk-test',
          cacheEnabled: true,
        })
      );

      mockFetch.mockResolvedValue(
        createMockLLMResponse('coder', 0.9, 'Code task')
      );

      expect(dispatcher.getCacheStats().size).toBe(0);
      expect(dispatcher.getCacheStats().enabled).toBe(true);

      await dispatcher.dispatch('Task 1');
      expect(dispatcher.getCacheStats().size).toBe(1);

      await dispatcher.dispatch('Task 2');
      expect(dispatcher.getCacheStats().size).toBe(2);

      dispatcher.clearCache();
      expect(dispatcher.getCacheStats().size).toBe(0);
    });
  });

  describe('getConfig', () => {
    it('should return current configuration', () => {
      const dispatcher = new SmartDispatcher(
        createConfig({
          enabled: true,
          cacheEnabled: false,
          cacheTTLMs: 7200000,
          confidenceThreshold: 0.85,
          fallbackAgentType: 'architect',
          maxDescriptionLength: 500,
          dispatchModel: 'claude-3-opus-20240229',
          anthropicKey: 'sk-test',
        })
      );

      const config = dispatcher.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.cacheEnabled).toBe(false);
      expect(config.cacheTTLMs).toBe(7200000);
      expect(config.confidenceThreshold).toBe(0.85);
      expect(config.fallbackAgentType).toBe('architect');
      expect(config.maxDescriptionLength).toBe(500);
      expect(config.dispatchModel).toBe('claude-3-opus-20240229');
    });
  });

  describe('selectAgentType', () => {
    it('should throw when no provider is available', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({
          enabled: true,
          anthropicKey: undefined, // No API key = no provider
        })
      );

      await expect(dispatcher.selectAgentType('Some task')).rejects.toThrow(
        'No provider available'
      );
    });
  });

  describe('parseResponse edge cases', () => {
    it('should handle missing agentType in JSON', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({
          enabled: true,
          anthropicKey: 'sk-test',
          fallbackAgentType: 'coordinator',
          confidenceThreshold: 0,
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: '{"confidence":0.9,"reasoning":"No agent type"}',
            },
          ],
          model: 'claude-haiku-4-5-20251001',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const result = await dispatcher.dispatch('Do something');

      expect(result.decision?.agentType).toBe('coordinator'); // Fallback
      expect(result.decision?.confidence).toBe(0);
      expect(result.decision?.reasoning).toContain('Invalid or missing agentType');
    });

    it('should handle non-string agentType in JSON', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({
          enabled: true,
          anthropicKey: 'sk-test',
          fallbackAgentType: 'coder',
          confidenceThreshold: 0,
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: '{"agentType":123,"confidence":0.9,"reasoning":"Invalid type"}',
            },
          ],
          model: 'claude-haiku-4-5-20251001',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const result = await dispatcher.dispatch('Do something');

      expect(result.decision?.agentType).toBe('coder'); // Fallback
      expect(result.decision?.reasoning).toContain('Invalid or missing agentType');
    });

    it('should provide default reasoning when not in response', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({
          enabled: true,
          anthropicKey: 'sk-test',
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: '{"agentType":"coder","confidence":0.9}',
            },
          ],
          model: 'claude-haiku-4-5-20251001',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const result = await dispatcher.dispatch('Write code');

      expect(result.decision?.agentType).toBe('coder');
      expect(result.decision?.reasoning).toBe('No reasoning provided');
    });

    it('should handle non-string reasoning in JSON', async () => {
      const dispatcher = new SmartDispatcher(
        createConfig({
          enabled: true,
          anthropicKey: 'sk-test',
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: '{"agentType":"coder","confidence":0.9,"reasoning":123}',
            },
          ],
          model: 'claude-haiku-4-5-20251001',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const result = await dispatcher.dispatch('Write code');

      expect(result.decision?.agentType).toBe('coder');
      expect(result.decision?.reasoning).toBe('No reasoning provided');
    });
  });
});
