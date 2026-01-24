/**
 * CLI Providers tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ClaudeCodeProvider,
  GeminiCLIProvider,
  CodexProvider,
  checkCLIProviders,
} from '../../src/providers/cli-providers.js';
import { createProvider, getProvider } from '../../src/providers/index.js';
import type { AgentStackConfig, ChatMessage } from '../../src/types.js';

// Mock module state
const mockState = {
  execCallback: null as ((err: Error | null, stdout: string, stderr: string) => void) | null,
  nextResult: { stdout: '', stderr: '', error: null as Error | null },
};

// Mock child_process
vi.mock('node:child_process', () => ({
  exec: vi.fn((_cmd: string, _opts: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
    if (mockState.nextResult.error) {
      callback(mockState.nextResult.error, '', '');
    } else {
      callback(null, mockState.nextResult.stdout, mockState.nextResult.stderr);
    }
    mockState.nextResult = { stdout: '', stderr: '', error: null };
  }),
  execSync: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: vi.fn((fn: Function) => {
    return async (command: string, options: unknown) => {
      return new Promise((resolve, reject) => {
        fn(command, options, (error: Error | null, stdout: string, stderr: string) => {
          if (error) reject(error);
          else resolve({ stdout, stderr });
        });
      });
    };
  }),
}));

const mockExecSync = vi.mocked(execSync);

// Helper to simulate successful CLI execution
function mockExecSuccess(stdout: string, stderr: string = '') {
  mockState.nextResult = { stdout, stderr, error: null };
}

// Helper to simulate failed CLI execution
function mockExecError(message: string) {
  mockState.nextResult = { stdout: '', stderr: '', error: new Error(message) };
}

function createTestConfig(defaultProvider: string = 'anthropic'): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: './test.db',
      defaultNamespace: 'default',
      vectorSearch: { enabled: false },
    },
    providers: {
      default: defaultProvider,
      anthropic: { apiKey: 'test-key' },
      openai: { apiKey: 'test-key' },
      ollama: { baseUrl: 'http://localhost:11434' },
      claude_code: { command: 'claude', model: 'sonnet', timeout: 60000 },
      gemini_cli: { command: 'gemini', model: 'gemini-2.0-flash', timeout: 60000 },
      codex: { command: 'codex', timeout: 60000 },
    },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: false },
    plugins: { enabled: false, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: false, sessionEnd: false, preTask: false, postTask: false },
  };
}

describe('ClaudeCodeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default values', () => {
      const provider = new ClaudeCodeProvider();
      expect(provider.name).toBe('claude-code');
    });

    it('should accept custom options', () => {
      const provider = new ClaudeCodeProvider({
        command: 'my-claude',
        model: 'opus',
        timeout: 120000,
      });
      expect(provider.name).toBe('claude-code');
    });
  });

  describe('isAvailable', () => {
    it('should return true when CLI is available', () => {
      mockExecSync.mockReturnValueOnce('claude-code version 1.0.0');

      const provider = new ClaudeCodeProvider();
      expect(provider.isAvailable()).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith('claude --version', expect.any(Object));
    });

    it('should return false when CLI is not available', () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('Command not found');
      });

      const provider = new ClaudeCodeProvider();
      expect(provider.isAvailable()).toBe(false);
    });

    it('should use custom command', () => {
      mockExecSync.mockReturnValueOnce('version 1.0.0');

      const provider = new ClaudeCodeProvider({ command: 'my-claude' });
      provider.isAvailable();
      expect(mockExecSync).toHaveBeenCalledWith('my-claude --version', expect.any(Object));
    });
  });

  describe('getVersion', () => {
    it('should return version string', () => {
      mockExecSync.mockReturnValueOnce('claude-code version 1.2.3\n');

      const provider = new ClaudeCodeProvider();
      expect(provider.getVersion()).toBe('claude-code version 1.2.3');
    });

    it('should return null on error', () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('Command failed');
      });

      const provider = new ClaudeCodeProvider();
      expect(provider.getVersion()).toBeNull();
    });
  });

  describe('chat', () => {
    it('should execute CLI and return response', async () => {
      mockExecSuccess('This is the response from Claude Code');

      const provider = new ClaudeCodeProvider();
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello, Claude!' },
      ];

      const response = await provider.chat(messages);

      expect(response.content).toBe('This is the response from Claude Code');
      expect(response.model).toBe('claude-code:sonnet');
    });

    it('should use custom model from options', async () => {
      mockExecSuccess('Response with opus model');

      const provider = new ClaudeCodeProvider();
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const response = await provider.chat(messages, { model: 'opus' });

      expect(response.model).toBe('claude-code:opus');
    });

    it('should format system messages correctly', async () => {
      mockExecSuccess('Response with system context');

      const provider = new ClaudeCodeProvider();
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ];

      const response = await provider.chat(messages);

      expect(response.content).toBe('Response with system context');
    });

    it('should handle stderr warnings', async () => {
      mockExecSuccess('Response text', 'Warning: something happened');

      const provider = new ClaudeCodeProvider();
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const response = await provider.chat(messages);

      expect(response.content).toBe('Response text');
    });

    it('should throw on CLI error', async () => {
      mockExecError('CLI execution failed');

      const provider = new ClaudeCodeProvider();
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      await expect(provider.chat(messages)).rejects.toThrow('Claude Code CLI error');
    });
  });
});

describe('GeminiCLIProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default values', () => {
      const provider = new GeminiCLIProvider();
      expect(provider.name).toBe('gemini-cli');
    });

    it('should accept custom options', () => {
      const provider = new GeminiCLIProvider({
        command: 'my-gemini',
        model: 'gemini-pro',
        timeout: 180000,
      });
      expect(provider.name).toBe('gemini-cli');
    });
  });

  describe('isAvailable', () => {
    it('should return true when CLI is available', () => {
      mockExecSync.mockReturnValueOnce('gemini version 1.0.0');

      const provider = new GeminiCLIProvider();
      expect(provider.isAvailable()).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith('gemini --version', expect.any(Object));
    });

    it('should return false when CLI is not available', () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('Command not found');
      });

      const provider = new GeminiCLIProvider();
      expect(provider.isAvailable()).toBe(false);
    });
  });

  describe('getVersion', () => {
    it('should return version string', () => {
      mockExecSync.mockReturnValueOnce('gemini-cli 2.0.0\n');

      const provider = new GeminiCLIProvider();
      expect(provider.getVersion()).toBe('gemini-cli 2.0.0');
    });

    it('should return null on error', () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('Command failed');
      });

      const provider = new GeminiCLIProvider();
      expect(provider.getVersion()).toBeNull();
    });
  });

  describe('chat', () => {
    it('should execute CLI and return response', async () => {
      mockExecSuccess('This is the response from Gemini');

      const provider = new GeminiCLIProvider();
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello, Gemini!' },
      ];

      const response = await provider.chat(messages);

      expect(response.content).toBe('This is the response from Gemini');
      expect(response.model).toBe('gemini-cli:gemini-2.0-flash');
    });

    it('should use custom model from options', async () => {
      mockExecSuccess('Response with pro model');

      const provider = new GeminiCLIProvider();
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const response = await provider.chat(messages, { model: 'gemini-pro' });

      expect(response.model).toBe('gemini-cli:gemini-pro');
    });

    it('should format assistant messages correctly', async () => {
      mockExecSuccess('Response with conversation');

      const provider = new GeminiCLIProvider();
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ];

      const response = await provider.chat(messages);

      expect(response.content).toBe('Response with conversation');
    });

    it('should throw on CLI error', async () => {
      mockExecError('Gemini CLI failed');

      const provider = new GeminiCLIProvider();
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      await expect(provider.chat(messages)).rejects.toThrow('Gemini CLI error');
    });
  });
});

describe('CodexProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default values', () => {
      const provider = new CodexProvider();
      expect(provider.name).toBe('codex');
    });

    it('should accept custom options', () => {
      const provider = new CodexProvider({
        command: 'my-codex',
        timeout: 600000,
      });
      expect(provider.name).toBe('codex');
    });
  });

  describe('isAvailable', () => {
    it('should return true when CLI is available', () => {
      mockExecSync.mockReturnValueOnce('codex version 1.0.0');

      const provider = new CodexProvider();
      expect(provider.isAvailable()).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith('codex --version', expect.any(Object));
    });

    it('should return false when CLI is not available', () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('Command not found');
      });

      const provider = new CodexProvider();
      expect(provider.isAvailable()).toBe(false);
    });
  });

  describe('getVersion', () => {
    it('should return version string', () => {
      mockExecSync.mockReturnValueOnce('codex v3.0.0\n');

      const provider = new CodexProvider();
      expect(provider.getVersion()).toBe('codex v3.0.0');
    });

    it('should return null on error', () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('Command failed');
      });

      const provider = new CodexProvider();
      expect(provider.getVersion()).toBeNull();
    });
  });

  describe('chat', () => {
    it('should execute CLI and return response', async () => {
      mockExecSuccess('This is the response from Codex');

      const provider = new CodexProvider();
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Write a function' },
      ];

      const response = await provider.chat(messages);

      expect(response.content).toBe('This is the response from Codex');
      expect(response.model).toBe('codex-cli');
    });

    it('should format multiple messages', async () => {
      mockExecSuccess('Code output');

      const provider = new CodexProvider();
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are a code generator' },
        { role: 'user', content: 'Write hello world' },
      ];

      const response = await provider.chat(messages);

      expect(response.content).toBe('Code output');
    });

    it('should throw on CLI error', async () => {
      mockExecError('Codex CLI failed');

      const provider = new CodexProvider();
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      await expect(provider.chat(messages)).rejects.toThrow('Codex CLI error');
    });
  });
});

describe('checkCLIProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should check all CLI providers', () => {
    // First call for claude, second for gemini, third for codex
    mockExecSync
      .mockReturnValueOnce('claude v1.0.0')
      .mockImplementationOnce(() => {
        throw new Error('not found');
      })
      .mockReturnValueOnce('codex v1.0.0');

    const result = checkCLIProviders();

    expect(result.claude_code).toBe(true);
    expect(result.gemini_cli).toBe(false);
    expect(result.codex).toBe(true);
  });

  it('should return all false when no CLI available', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not found');
    });

    const result = checkCLIProviders();

    expect(result.claude_code).toBe(false);
    expect(result.gemini_cli).toBe(false);
    expect(result.codex).toBe(false);
  });
});

describe('Provider Factory with CLI providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createProvider', () => {
    it('should create ClaudeCodeProvider for claude-code', () => {
      const config = createTestConfig('claude-code');
      const provider = createProvider(config);
      expect(provider.name).toBe('claude-code');
    });

    it('should create ClaudeCodeProvider for claude_code', () => {
      const config = createTestConfig('claude_code');
      const provider = createProvider(config);
      expect(provider.name).toBe('claude-code');
    });

    it('should create GeminiCLIProvider for gemini-cli', () => {
      const config = createTestConfig('gemini-cli');
      const provider = createProvider(config);
      expect(provider.name).toBe('gemini-cli');
    });

    it('should create GeminiCLIProvider for gemini_cli', () => {
      const config = createTestConfig('gemini_cli');
      const provider = createProvider(config);
      expect(provider.name).toBe('gemini-cli');
    });

    it('should create CodexProvider for codex', () => {
      const config = createTestConfig('codex');
      const provider = createProvider(config);
      expect(provider.name).toBe('codex');
    });
  });

  describe('getProvider', () => {
    it('should get ClaudeCodeProvider by name', () => {
      const config = createTestConfig();
      const provider = getProvider('claude-code', config);
      expect(provider).not.toBeNull();
      expect(provider?.name).toBe('claude-code');
    });

    it('should get GeminiCLIProvider by name', () => {
      const config = createTestConfig();
      const provider = getProvider('gemini-cli', config);
      expect(provider).not.toBeNull();
      expect(provider?.name).toBe('gemini-cli');
    });

    it('should get CodexProvider by name', () => {
      const config = createTestConfig();
      const provider = getProvider('codex', config);
      expect(provider).not.toBeNull();
      expect(provider?.name).toBe('codex');
    });
  });
});
