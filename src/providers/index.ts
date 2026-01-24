/**
 * LLM Provider interface and implementations
 */

import type { LLMProvider, ChatMessage, ChatOptions, ChatResponse, AgentStackConfig } from '../types.js';
import { logger } from '../utils/logger.js';

const log = logger.child('providers');

/**
 * Anthropic Claude provider
 */
export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private apiKey: string;
  private defaultModel: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.defaultModel = model ?? 'claude-sonnet-4-20250514';
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const model = options?.model ?? this.defaultModel;

    // Convert messages format for Anthropic API
    const systemMessage = messages.find(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    interface AnthropicMessage {
      role: 'user' | 'assistant';
      content: string;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: options?.maxTokens ?? 4096,
        system: systemMessage?.content,
        messages: otherMessages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })) as AnthropicMessage[],
        temperature: options?.temperature,
        stop_sequences: options?.stopSequences,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    interface AnthropicResponse {
      content: Array<{ type: string; text: string }>;
      model: string;
      usage: {
        input_tokens: number;
        output_tokens: number;
      };
    }

    const data = await response.json() as AnthropicResponse;
    const textContent = data.content.find(c => c.type === 'text');

    return {
      content: textContent?.text ?? '',
      model: data.model,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      },
    };
  }
}

/**
 * OpenAI provider
 */
export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private apiKey: string;
  private defaultModel: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.defaultModel = model ?? 'gpt-4o';
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const model = options?.model ?? this.defaultModel;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature,
        stop: options?.stopSequences,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    interface OpenAIResponse {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
      };
    }

    const data = await response.json() as OpenAIResponse;
    const choice = data.choices[0];

    return {
      content: choice?.message.content ?? '',
      model: data.model,
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      },
    };
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    interface OpenAIEmbeddingResponse {
      data: Array<{ embedding: number[] }>;
    }

    const data = await response.json() as OpenAIEmbeddingResponse;
    const embedding = data.data[0]?.embedding;
    if (!embedding) {
      throw new Error('No embedding returned');
    }
    return embedding;
  }
}

/**
 * Ollama provider (local)
 */
export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private baseUrl: string;
  private defaultModel: string;

  constructor(baseUrl?: string, model?: string) {
    this.baseUrl = baseUrl ?? 'http://localhost:11434';
    this.defaultModel = model ?? 'llama3.2';
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const model = options?.model ?? this.defaultModel;

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature: options?.temperature,
          num_predict: options?.maxTokens,
          stop: options?.stopSequences,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    interface OllamaResponse {
      message: { content: string };
      model: string;
      eval_count?: number;
      prompt_eval_count?: number;
    }

    const data = await response.json() as OllamaResponse;

    return {
      content: data.message.content,
      model: data.model,
      usage: data.eval_count
        ? {
            inputTokens: data.prompt_eval_count ?? 0,
            outputTokens: data.eval_count,
          }
        : undefined,
    };
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        prompt: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    interface OllamaEmbeddingResponse {
      embedding: number[];
    }

    const data = await response.json() as OllamaEmbeddingResponse;
    return data.embedding;
  }
}

/**
 * Create a provider based on configuration
 */
export function createProvider(config: AgentStackConfig): LLMProvider {
  const defaultProvider = config.providers.default;

  switch (defaultProvider) {
    case 'anthropic': {
      const anthropicConfig = config.providers.anthropic;
      if (!anthropicConfig?.apiKey) {
        throw new Error('Anthropic API key not configured');
      }
      return new AnthropicProvider(anthropicConfig.apiKey, anthropicConfig.model);
    }

    case 'openai': {
      const openaiConfig = config.providers.openai;
      if (!openaiConfig?.apiKey) {
        throw new Error('OpenAI API key not configured');
      }
      return new OpenAIProvider(openaiConfig.apiKey, openaiConfig.model);
    }

    case 'ollama': {
      const ollamaConfig = config.providers.ollama;
      return new OllamaProvider(ollamaConfig?.baseUrl, ollamaConfig?.model);
    }

    default:
      throw new Error(`Unknown provider: ${defaultProvider}`);
  }
}

// Provider registry for custom providers
const customProviders: Map<string, LLMProvider> = new Map();

/**
 * Register a custom provider
 */
export function registerProvider(name: string, provider: LLMProvider): void {
  customProviders.set(name, provider);
  log.info('Registered custom provider', { name });
}

/**
 * Get a provider by name
 */
export function getProvider(name: string, config: AgentStackConfig): LLMProvider | null {
  // Check custom providers first
  const custom = customProviders.get(name);
  if (custom) return custom;

  // Check built-in providers
  switch (name) {
    case 'anthropic': {
      const anthropicConfig = config.providers.anthropic;
      if (!anthropicConfig?.apiKey) return null;
      return new AnthropicProvider(anthropicConfig.apiKey, anthropicConfig.model);
    }
    case 'openai': {
      const openaiConfig = config.providers.openai;
      if (!openaiConfig?.apiKey) return null;
      return new OpenAIProvider(openaiConfig.apiKey, openaiConfig.model);
    }
    case 'ollama': {
      const ollamaConfig = config.providers.ollama;
      return new OllamaProvider(ollamaConfig?.baseUrl, ollamaConfig?.model);
    }
    default:
      return null;
  }
}
