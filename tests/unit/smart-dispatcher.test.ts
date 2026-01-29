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
      model: 'claude-3-5-haiku-20241022',
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
          model: 'claude-3-5-haiku-20241022',
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
          model: 'claude-3-5-haiku-20241022',
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
          model: 'claude-3-5-haiku-20241022',
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
          model: 'claude-3-5-haiku-20241022',
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
          model: 'claude-3-5-haiku-20241022',
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
          model: 'claude-3-5-haiku-20241022',
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
          model: 'claude-3-5-haiku-20241022',
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
    });
  });
});
