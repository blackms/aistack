/**
 * MCP GitHub Tools tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { createGitHubTools } from '../../src/mcp/tools/github-tools.js';
import type { AgentStackConfig } from '../../src/types.js';

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process');
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

const mockedExecSync = vi.mocked(execSync);

function createTestConfig(enabled = true, useToken = false): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: ':memory:',
      defaultNamespace: 'default',
      vectorSearch: { enabled: false },
    },
    providers: {
      default: 'anthropic',
      anthropic: { apiKey: 'test-key' },
    },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: {
      enabled,
      useGhCli: !useToken,
      token: useToken ? 'ghp_test-token' : undefined,
    },
    plugins: { enabled: true, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
  };
}

describe('MCP GitHub Tools', () => {
  let config: AgentStackConfig;
  let tools: ReturnType<typeof createGitHubTools>;

  beforeEach(() => {
    vi.resetAllMocks();
    config = createTestConfig();
    tools = createGitHubTools(config);
  });

  describe('github_issue_create', () => {
    it('should create an issue', async () => {
      mockedExecSync.mockReturnValue(
        JSON.stringify({ number: 1, url: 'https://github.com/owner/repo/issues/1', title: 'Test Issue' })
      );

      const result = await tools.github_issue_create.handler({
        owner: 'owner',
        repo: 'repo',
        title: 'Test Issue',
      });

      expect(result.success).toBe(true);
      expect(result.issue).toBeDefined();
      expect(mockedExecSync).toHaveBeenCalled();
    });

    it('should create issue with body', async () => {
      mockedExecSync.mockReturnValue(JSON.stringify({ number: 1 }));

      await tools.github_issue_create.handler({
        owner: 'owner',
        repo: 'repo',
        title: 'Test',
        body: 'Issue description',
      });

      expect(mockedExecSync).toHaveBeenCalled();
      const callArgs = mockedExecSync.mock.calls[0][0] as string;
      expect(callArgs).toContain('--body');
    });

    it('should create issue with labels', async () => {
      mockedExecSync.mockReturnValue(JSON.stringify({ number: 1 }));

      await tools.github_issue_create.handler({
        owner: 'owner',
        repo: 'repo',
        title: 'Test',
        labels: ['bug', 'priority-high'],
      });

      const callArgs = mockedExecSync.mock.calls[0][0] as string;
      expect(callArgs).toContain('--label');
      expect(callArgs).toContain('bug,priority-high');
    });

    it('should create issue with assignees', async () => {
      mockedExecSync.mockReturnValue(JSON.stringify({ number: 1 }));

      await tools.github_issue_create.handler({
        owner: 'owner',
        repo: 'repo',
        title: 'Test',
        assignees: ['user1', 'user2'],
      });

      const callArgs = mockedExecSync.mock.calls[0][0] as string;
      expect(callArgs).toContain('--assignee');
      expect(callArgs).toContain('user1,user2');
    });

    it('should throw when GitHub is disabled', async () => {
      const disabledConfig = createTestConfig(false);
      const disabledTools = createGitHubTools(disabledConfig);

      await expect(
        disabledTools.github_issue_create.handler({
          owner: 'owner',
          repo: 'repo',
          title: 'Test',
        })
      ).rejects.toThrow('GitHub integration is disabled');
    });

    it('should have correct tool definition', () => {
      expect(tools.github_issue_create.name).toBe('github_issue_create');
      expect(tools.github_issue_create.inputSchema.required).toContain('owner');
      expect(tools.github_issue_create.inputSchema.required).toContain('repo');
      expect(tools.github_issue_create.inputSchema.required).toContain('title');
    });
  });

  describe('github_issue_list', () => {
    it('should list issues', async () => {
      mockedExecSync.mockReturnValue(
        JSON.stringify([
          { number: 1, title: 'Issue 1', state: 'open' },
          { number: 2, title: 'Issue 2', state: 'open' },
        ])
      );

      const result = await tools.github_issue_list.handler({
        owner: 'owner',
        repo: 'repo',
      });

      expect(result.count).toBe(2);
      expect(result.issues).toHaveLength(2);
    });

    it('should filter by state', async () => {
      mockedExecSync.mockReturnValue(JSON.stringify([{ number: 1 }]));

      await tools.github_issue_list.handler({
        owner: 'owner',
        repo: 'repo',
        state: 'closed',
      });

      const callArgs = mockedExecSync.mock.calls[0][0] as string;
      expect(callArgs).toContain('--state closed');
    });

    it('should respect limit', async () => {
      mockedExecSync.mockReturnValue(JSON.stringify([]));

      await tools.github_issue_list.handler({
        owner: 'owner',
        repo: 'repo',
        limit: 50,
      });

      const callArgs = mockedExecSync.mock.calls[0][0] as string;
      expect(callArgs).toContain('--limit 50');
    });

    it('should have correct tool definition', () => {
      expect(tools.github_issue_list.name).toBe('github_issue_list');
      expect(tools.github_issue_list.inputSchema.required).toContain('owner');
      expect(tools.github_issue_list.inputSchema.required).toContain('repo');
    });
  });

  describe('github_issue_get', () => {
    it('should get an issue', async () => {
      mockedExecSync.mockReturnValue(
        JSON.stringify({ number: 1, title: 'Issue 1', body: 'Description', state: 'open' })
      );

      const result = await tools.github_issue_get.handler({
        owner: 'owner',
        repo: 'repo',
        number: 1,
      });

      expect(result.found).toBe(true);
      expect(result.issue).toBeDefined();
    });

    it('should have correct tool definition', () => {
      expect(tools.github_issue_get.name).toBe('github_issue_get');
      expect(tools.github_issue_get.inputSchema.required).toContain('number');
    });
  });

  describe('github_pr_create', () => {
    it('should create a PR', async () => {
      mockedExecSync.mockReturnValue(
        JSON.stringify({ number: 1, url: 'https://github.com/owner/repo/pull/1', title: 'Test PR' })
      );

      const result = await tools.github_pr_create.handler({
        owner: 'owner',
        repo: 'repo',
        title: 'Test PR',
        head: 'feature-branch',
        base: 'main',
      });

      expect(result.success).toBe(true);
      expect(result.pr).toBeDefined();
    });

    it('should create PR with body', async () => {
      mockedExecSync.mockReturnValue(JSON.stringify({ number: 1 }));

      await tools.github_pr_create.handler({
        owner: 'owner',
        repo: 'repo',
        title: 'Test',
        head: 'feature',
        base: 'main',
        body: 'PR description',
      });

      const callArgs = mockedExecSync.mock.calls[0][0] as string;
      expect(callArgs).toContain('--body');
    });

    it('should create draft PR', async () => {
      mockedExecSync.mockReturnValue(JSON.stringify({ number: 1 }));

      await tools.github_pr_create.handler({
        owner: 'owner',
        repo: 'repo',
        title: 'Test',
        head: 'feature',
        base: 'main',
        draft: true,
      });

      const callArgs = mockedExecSync.mock.calls[0][0] as string;
      expect(callArgs).toContain('--draft');
    });

    it('should have correct tool definition', () => {
      expect(tools.github_pr_create.name).toBe('github_pr_create');
      expect(tools.github_pr_create.inputSchema.required).toContain('head');
      expect(tools.github_pr_create.inputSchema.required).toContain('base');
    });
  });

  describe('github_pr_list', () => {
    it('should list PRs', async () => {
      mockedExecSync.mockReturnValue(
        JSON.stringify([
          { number: 1, title: 'PR 1', state: 'open' },
          { number: 2, title: 'PR 2', state: 'merged' },
        ])
      );

      const result = await tools.github_pr_list.handler({
        owner: 'owner',
        repo: 'repo',
      });

      expect(result.count).toBe(2);
      expect(result.prs).toHaveLength(2);
    });

    it('should filter by state', async () => {
      mockedExecSync.mockReturnValue(JSON.stringify([{ number: 1 }]));

      await tools.github_pr_list.handler({
        owner: 'owner',
        repo: 'repo',
        state: 'merged',
      });

      const callArgs = mockedExecSync.mock.calls[0][0] as string;
      expect(callArgs).toContain('--state merged');
    });

    it('should have correct tool definition', () => {
      expect(tools.github_pr_list.name).toBe('github_pr_list');
    });
  });

  describe('github_pr_get', () => {
    it('should get a PR', async () => {
      mockedExecSync.mockReturnValue(
        JSON.stringify({ number: 1, title: 'PR 1', body: 'Description', state: 'open' })
      );

      const result = await tools.github_pr_get.handler({
        owner: 'owner',
        repo: 'repo',
        number: 1,
      });

      expect(result.found).toBe(true);
      expect(result.pr).toBeDefined();
    });

    it('should have correct tool definition', () => {
      expect(tools.github_pr_get.name).toBe('github_pr_get');
      expect(tools.github_pr_get.inputSchema.required).toContain('number');
    });
  });

  describe('github_repo_info', () => {
    it('should get repo info', async () => {
      mockedExecSync.mockReturnValue(
        JSON.stringify({
          name: 'repo',
          description: 'A test repo',
          owner: { login: 'owner' },
          stargazerCount: 100,
        })
      );

      const result = await tools.github_repo_info.handler({
        owner: 'owner',
        repo: 'repo',
      });

      expect(result.found).toBe(true);
      expect(result.repo).toBeDefined();
    });

    it('should have correct tool definition', () => {
      expect(tools.github_repo_info.name).toBe('github_repo_info');
      expect(tools.github_repo_info.inputSchema.required).toContain('owner');
      expect(tools.github_repo_info.inputSchema.required).toContain('repo');
    });
  });

  describe('error handling', () => {
    it('should handle command failure', async () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('Command failed');
      });

      await expect(
        tools.github_issue_list.handler({
          owner: 'owner',
          repo: 'repo',
        })
      ).rejects.toThrow('GitHub command failed');
    });

    it('should throw for validation errors', async () => {
      mockedExecSync.mockReturnValue(JSON.stringify({ number: 1 }));

      await expect(
        tools.github_issue_create.handler({
          owner: '',
          repo: 'repo',
          title: 'Test',
        })
      ).rejects.toThrow();
    });
  });

  describe('token authentication', () => {
    it('should set GH_TOKEN when using token auth', async () => {
      const tokenConfig = createTestConfig(true, true);
      const tokenTools = createGitHubTools(tokenConfig);

      mockedExecSync.mockReturnValue(JSON.stringify([{ number: 1 }]));

      await tokenTools.github_issue_list.handler({
        owner: 'owner',
        repo: 'repo',
      });

      expect(mockedExecSync).toHaveBeenCalled();
      const callOptions = mockedExecSync.mock.calls[0][1] as { env?: Record<string, string> };
      expect(callOptions.env?.GH_TOKEN).toBe('ghp_test-token');
    });

    it('should not set GH_TOKEN when using gh CLI auth', async () => {
      mockedExecSync.mockReturnValue(JSON.stringify([{ number: 1 }]));

      await tools.github_issue_list.handler({
        owner: 'owner',
        repo: 'repo',
      });

      expect(mockedExecSync).toHaveBeenCalled();
      const callOptions = mockedExecSync.mock.calls[0][1] as { env?: Record<string, string> };
      expect(callOptions.env?.GH_TOKEN).toBeUndefined();
    });
  });
});
