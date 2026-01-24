/**
 * GitHub Client tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitHubClient, createGitHubClient } from '../../src/github/client.js';

describe('GitHubClient', () => {
  let client: GitHubClient;

  beforeEach(() => {
    vi.resetAllMocks();
    client = new GitHubClient({ token: 'test-token' });
  });

  describe('constructor', () => {
    it('should create client with token', () => {
      const c = new GitHubClient({ token: 'my-token' });
      expect(c).toBeDefined();
    });

    it('should create client with gh CLI mode', () => {
      const c = new GitHubClient({ useGhCli: true });
      expect(c).toBeDefined();
    });

    it('should default to gh CLI mode', () => {
      const c = new GitHubClient();
      expect(c).toBeDefined();
    });
  });

  describe('isAvailable', () => {
    it('should check if gh CLI is available', () => {
      // This will actually check if gh is installed
      const available = client.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });
});

describe('createGitHubClient', () => {
  it('should return null when github disabled', () => {
    const client = createGitHubClient({
      version: '1.0.0',
      memory: { path: './data/memory.db', defaultNamespace: 'default', vectorSearch: { enabled: false } },
      providers: { default: 'anthropic' },
      agents: { maxConcurrent: 5, defaultTimeout: 300 },
      github: { enabled: false },
      plugins: { enabled: true, directory: './plugins' },
      mcp: { transport: 'stdio' },
      hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
    });

    expect(client).toBeNull();
  });

  it('should create client when github enabled', () => {
    const client = createGitHubClient({
      version: '1.0.0',
      memory: { path: './data/memory.db', defaultNamespace: 'default', vectorSearch: { enabled: false } },
      providers: { default: 'anthropic' },
      agents: { maxConcurrent: 5, defaultTimeout: 300 },
      github: { enabled: true, useGhCli: true },
      plugins: { enabled: true, directory: './plugins' },
      mcp: { transport: 'stdio' },
      hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
    });

    expect(client).toBeInstanceOf(GitHubClient);
  });

  it('should pass token to client', () => {
    const client = createGitHubClient({
      version: '1.0.0',
      memory: { path: './data/memory.db', defaultNamespace: 'default', vectorSearch: { enabled: false } },
      providers: { default: 'anthropic' },
      agents: { maxConcurrent: 5, defaultTimeout: 300 },
      github: { enabled: true, token: 'test-token' },
      plugins: { enabled: true, directory: './plugins' },
      mcp: { transport: 'stdio' },
      hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
    });

    expect(client).toBeInstanceOf(GitHubClient);
  });
});
