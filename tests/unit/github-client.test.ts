/**
 * GitHub Client tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitHubClient, createGitHubClient } from '../../src/github/client.js';
import * as childProcess from 'node:child_process';

// Mock child_process
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process');
  return {
    ...actual,
    exec: vi.fn(),
    execSync: vi.fn(),
  };
});

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

    it('should create client with token and no gh CLI mode', () => {
      const c = new GitHubClient({ token: 'my-token', useGhCli: false });
      expect(c).toBeDefined();
    });
  });

  describe('isAvailable', () => {
    it('should return true when gh CLI is available', () => {
      vi.mocked(childProcess.execSync).mockReturnValue('gh version 2.0.0');
      const available = client.isAvailable();
      expect(available).toBe(true);
    });

    it('should return false when gh CLI is not available', () => {
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error('gh not found');
      });
      const available = client.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('isAuthenticated', () => {
    it('should return true when authenticated', async () => {
      vi.mocked(childProcess.exec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) callback(null, 'authenticated', '');
        return {} as any;
      });

      const authenticated = await client.isAuthenticated();
      expect(authenticated).toBe(true);
    });

    it('should return false when not authenticated', async () => {
      vi.mocked(childProcess.exec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) callback(new Error('not authenticated'), '', '');
        return {} as any;
      });

      const authenticated = await client.isAuthenticated();
      expect(authenticated).toBe(false);
    });
  });

  describe('createIssue', () => {
    it('should create an issue', async () => {
      const mockResult = { number: 1, url: 'https://github.com/owner/repo/issues/1' };
      vi.mocked(childProcess.exec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) callback(null, JSON.stringify(mockResult), '');
        return {} as any;
      });

      const result = await client.createIssue('owner', 'repo', 'Test Issue');
      expect(result.number).toBe(1);
      expect(result.url).toBe('https://github.com/owner/repo/issues/1');
    });

    it('should create an issue with body and options', async () => {
      const mockResult = { number: 2, url: 'https://github.com/owner/repo/issues/2' };
      vi.mocked(childProcess.exec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) callback(null, JSON.stringify(mockResult), '');
        return {} as any;
      });

      const result = await client.createIssue('owner', 'repo', 'Bug', 'Description', {
        labels: ['bug', 'priority'],
        assignees: ['user1', 'user2'],
      });
      expect(result.number).toBe(2);
    });

    it('should handle command failure', async () => {
      vi.mocked(childProcess.exec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) callback(new Error('API error'), '', 'error');
        return {} as any;
      });

      await expect(client.createIssue('owner', 'repo', 'Issue')).rejects.toThrow('GitHub command failed');
    });
  });

  describe('listIssues', () => {
    it('should list issues', async () => {
      const mockResult = [
        { number: 1, title: 'Issue 1', state: 'open' },
        { number: 2, title: 'Issue 2', state: 'closed' },
      ];
      vi.mocked(childProcess.exec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) callback(null, JSON.stringify(mockResult), '');
        return {} as any;
      });

      const result = await client.listIssues('owner', 'repo');
      expect(result).toHaveLength(2);
    });

    it('should list issues with options', async () => {
      const mockResult = [{ number: 1, title: 'Open Issue', state: 'open' }];
      vi.mocked(childProcess.exec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) callback(null, JSON.stringify(mockResult), '');
        return {} as any;
      });

      const result = await client.listIssues('owner', 'repo', { state: 'open', limit: 10 });
      expect(result).toHaveLength(1);
    });
  });

  describe('getIssue', () => {
    it('should get issue details', async () => {
      const mockResult = { number: 1, title: 'Issue', body: 'Description', state: 'open' };
      vi.mocked(childProcess.exec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) callback(null, JSON.stringify(mockResult), '');
        return {} as any;
      });

      const result = await client.getIssue('owner', 'repo', 1);
      expect(result).toEqual(mockResult);
    });
  });

  describe('createPR', () => {
    it('should create a PR', async () => {
      const mockResult = { number: 1, url: 'https://github.com/owner/repo/pull/1' };
      vi.mocked(childProcess.exec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) callback(null, JSON.stringify(mockResult), '');
        return {} as any;
      });

      const result = await client.createPR('owner', 'repo', 'Feature', 'feature-branch', 'main');
      expect(result.number).toBe(1);
    });

    it('should create a draft PR with body', async () => {
      const mockResult = { number: 2, url: 'https://github.com/owner/repo/pull/2' };
      vi.mocked(childProcess.exec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) callback(null, JSON.stringify(mockResult), '');
        return {} as any;
      });

      const result = await client.createPR('owner', 'repo', 'WIP', 'wip-branch', 'main', 'Work in progress', true);
      expect(result.number).toBe(2);
    });
  });

  describe('listPRs', () => {
    it('should list PRs', async () => {
      const mockResult = [
        { number: 1, title: 'PR 1', state: 'open' },
        { number: 2, title: 'PR 2', state: 'merged' },
      ];
      vi.mocked(childProcess.exec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) callback(null, JSON.stringify(mockResult), '');
        return {} as any;
      });

      const result = await client.listPRs('owner', 'repo');
      expect(result).toHaveLength(2);
    });

    it('should list PRs with options', async () => {
      const mockResult = [{ number: 1, title: 'Open PR', state: 'open' }];
      vi.mocked(childProcess.exec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) callback(null, JSON.stringify(mockResult), '');
        return {} as any;
      });

      const result = await client.listPRs('owner', 'repo', { state: 'open', limit: 5 });
      expect(result).toHaveLength(1);
    });
  });

  describe('getPR', () => {
    it('should get PR details', async () => {
      const mockResult = { number: 1, title: 'PR', body: 'Description', state: 'open' };
      vi.mocked(childProcess.exec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) callback(null, JSON.stringify(mockResult), '');
        return {} as any;
      });

      const result = await client.getPR('owner', 'repo', 1);
      expect(result).toEqual(mockResult);
    });
  });

  describe('getRepo', () => {
    it('should get repo details', async () => {
      const mockResult = { name: 'repo', owner: { login: 'owner' }, stargazerCount: 100 };
      vi.mocked(childProcess.exec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) callback(null, JSON.stringify(mockResult), '');
        return {} as any;
      });

      const result = await client.getRepo('owner', 'repo');
      expect(result).toEqual(mockResult);
    });
  });

  describe('executeGh with non-JSON response', () => {
    it('should handle plain text response', async () => {
      vi.mocked(childProcess.exec).mockImplementation((_cmd, _opts, callback) => {
        if (callback) callback(null, 'plain text response', '');
        return {} as any;
      });

      const result = await client.isAuthenticated();
      expect(result).toBe(true);
    });
  });

  describe('with token and useGhCli false', () => {
    it('should set GH_TOKEN env var', async () => {
      const tokenClient = new GitHubClient({ token: 'my-token', useGhCli: false });
      vi.mocked(childProcess.exec).mockImplementation((_cmd, opts, callback) => {
        expect((opts as any).env?.GH_TOKEN).toBe('my-token');
        if (callback) callback(null, 'ok', '');
        return {} as any;
      });

      await tokenClient.isAuthenticated();
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
