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

// Mock child_process
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: vi.fn((fn) => {
    return async (...args: unknown[]) => {
      return new Promise((resolve, reject) => {
        (fn as Function)(...args, (error: Error | null, stdout: string, stderr: string) => {
          if (error) reject(error);
          else resolve({ stdout, stderr });
        });
      });
    };
  }),
}));

const mockExecSync = vi.mocked(execSync);

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
