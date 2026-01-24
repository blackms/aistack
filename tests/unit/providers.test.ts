/**
 * Providers tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AnthropicProvider,
  OpenAIProvider,
  OllamaProvider,
  createProvider,
  registerProvider,
  getProvider,
} from '../../src/providers/index.js';
import type { AgentStackConfig, LLMProvider } from '../../src/types.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

function createConfig(provider: string = 'anthropic'): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: './test.db',
      defaultNamespace: 'default',
      vectorSearch: { enabled: false },
    },
    providers: {
      default: provider as 'anthropic' | 'openai' | 'ollama',
      anthropic: { apiKey: 'sk-ant-test-key', model: 'claude-sonnet-4-20250514' },
      openai: { apiKey: 'sk-openai-test-key', model: 'gpt-4o' },
      ollama: { baseUrl: 'http://localhost:11434', model: 'llama3.2' },
    },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: false },
    plugins: { enabled: false, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: {
      sessionStart: true,
      sessionEnd: true,
      preTask: true,
      postTask: true,
    },
  };
}

describe('AnthropicProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should create provider with API key', () => {
    const provider = new AnthropicProvider('test-key');
    expect(provider.name).toBe('anthropic');
  });

  it('should call Anthropic API correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Hello!' }],
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

    const provider = new AnthropicProvider('test-key');
    const response = await provider.chat([
      { role: 'user', content: 'Hi' },
    ]);

    expect(response.content).toBe('Hello!');
    expect(response.model).toBe('claude-sonnet-4-20250514');
    expect(response.usage?.inputTokens).toBe(10);
    expect(response.usage?.outputTokens).toBe(5);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'test-key',
        }),
      })
    );
  });

  it('should handle system messages', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Response' }],
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

    const provider = new AnthropicProvider('test-key');
    await provider.chat([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hi' },
    ]);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.system).toBe('You are helpful');
    expect(callBody.messages).toHaveLength(1);
  });

  it('should throw on API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const provider = new AnthropicProvider('bad-key');
    await expect(provider.chat([{ role: 'user', content: 'Hi' }]))
      .rejects.toThrow('Anthropic API error: 401');
  });

  it('should use custom model', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'OK' }],
        model: 'claude-3-opus',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    const provider = new AnthropicProvider('key', 'claude-3-opus');
    await provider.chat([{ role: 'user', content: 'Hi' }]);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.model).toBe('claude-3-opus');
  });
});

describe('OpenAIProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should create provider with API key', () => {
    const provider = new OpenAIProvider('test-key');
    expect(provider.name).toBe('openai');
  });

  it('should call OpenAI API correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hello!' } }],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    });

    const provider = new OpenAIProvider('test-key');
    const response = await provider.chat([
      { role: 'user', content: 'Hi' },
    ]);

    expect(response.content).toBe('Hello!');
    expect(response.model).toBe('gpt-4o');
    expect(response.usage?.inputTokens).toBe(10);
    expect(response.usage?.outputTokens).toBe(5);
  });

  it('should throw on API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    });

    const provider = new OpenAIProvider('key');
    await expect(provider.chat([{ role: 'user', content: 'Hi' }]))
      .rejects.toThrow('OpenAI API error: 429');
  });

  it('should call embed API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      }),
    });

    const provider = new OpenAIProvider('test-key');
    const embedding = await provider.embed!('test text');

    expect(embedding).toEqual([0.1, 0.2, 0.3]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.any(Object)
    );
  });

  it('should throw if no embedding returned', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [],
      }),
    });

    const provider = new OpenAIProvider('test-key');
    await expect(provider.embed!('test'))
      .rejects.toThrow('No embedding returned');
  });
});

describe('OllamaProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should create provider with defaults', () => {
    const provider = new OllamaProvider();
    expect(provider.name).toBe('ollama');
  });

  it('should call Ollama API correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: 'Hello!' },
        model: 'llama3.2',
        eval_count: 50,
        prompt_eval_count: 20,
      }),
    });

    const provider = new OllamaProvider();
    const response = await provider.chat([
      { role: 'user', content: 'Hi' },
    ]);

    expect(response.content).toBe('Hello!');
    expect(response.model).toBe('llama3.2');
    expect(response.usage?.inputTokens).toBe(20);
    expect(response.usage?.outputTokens).toBe(50);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.any(Object)
    );
  });

  it('should handle missing usage data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: 'Hello!' },
        model: 'llama3.2',
      }),
    });

    const provider = new OllamaProvider();
    const response = await provider.chat([{ role: 'user', content: 'Hi' }]);

    expect(response.usage).toBeUndefined();
  });

  it('should use custom base URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: 'OK' },
        model: 'llama3.2',
      }),
    });

    const provider = new OllamaProvider('http://custom:8080');
    await provider.chat([{ role: 'user', content: 'Hi' }]);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://custom:8080/api/chat',
      expect.any(Object)
    );
  });

  it('should call embed API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        embedding: [0.1, 0.2, 0.3],
      }),
    });

    const provider = new OllamaProvider();
    const embedding = await provider.embed!('test text');

    expect(embedding).toEqual([0.1, 0.2, 0.3]);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/embeddings',
      expect.any(Object)
    );
  });
});

describe('createProvider', () => {
  it('should create Anthropic provider', () => {
    const config = createConfig('anthropic');
    const provider = createProvider(config);

    expect(provider.name).toBe('anthropic');
  });

  it('should create OpenAI provider', () => {
    const config = createConfig('openai');
    const provider = createProvider(config);

    expect(provider.name).toBe('openai');
  });

  it('should create Ollama provider', () => {
    const config = createConfig('ollama');
    const provider = createProvider(config);

    expect(provider.name).toBe('ollama');
  });

  it('should throw for missing Anthropic key', () => {
    const config = createConfig('anthropic');
    config.providers.anthropic = undefined;

    expect(() => createProvider(config))
      .toThrow('Anthropic API key not configured');
  });

  it('should throw for missing OpenAI key', () => {
    const config = createConfig('openai');
    config.providers.openai = undefined;

    expect(() => createProvider(config))
      .toThrow('OpenAI API key not configured');
  });

  it('should throw for unknown provider', () => {
    const config = createConfig('unknown' as any);

    expect(() => createProvider(config))
      .toThrow('Unknown provider: unknown');
  });
});

describe('registerProvider / getProvider', () => {
  it('should register and retrieve custom provider', () => {
    const customProvider: LLMProvider = {
      name: 'custom',
      chat: async () => ({ content: 'test', model: 'custom' }),
    };

    registerProvider('custom', customProvider);

    const config = createConfig();
    const retrieved = getProvider('custom', config);

    expect(retrieved).toBe(customProvider);
  });

  it('should return null for unregistered provider', () => {
    const config = createConfig();
    const result = getProvider('nonexistent', config);

    expect(result).toBeNull();
  });

  it('should return built-in providers', () => {
    const config = createConfig();

    expect(getProvider('anthropic', config)?.name).toBe('anthropic');
    expect(getProvider('openai', config)?.name).toBe('openai');
    expect(getProvider('ollama', config)?.name).toBe('ollama');
  });

  it('should return null if built-in provider not configured', () => {
    const config = createConfig();
    config.providers.anthropic = undefined;
    config.providers.openai = undefined;

    expect(getProvider('anthropic', config)).toBeNull();
    expect(getProvider('openai', config)).toBeNull();
  });
});
