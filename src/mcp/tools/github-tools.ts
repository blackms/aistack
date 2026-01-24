/**
 * GitHub MCP tools - issues, PRs, repos via gh CLI
 */

import { z } from 'zod';
import { execSync } from 'node:child_process';
import type { AgentStackConfig } from '../../types.js';
import { logger } from '../../utils/logger.js';

const log = logger.child('github');

// Input schemas
const IssueCreateSchema = z.object({
  owner: z.string().min(1).describe('Repository owner'),
  repo: z.string().min(1).describe('Repository name'),
  title: z.string().min(1).max(256).describe('Issue title'),
  body: z.string().max(65536).optional().describe('Issue body'),
  labels: z.array(z.string()).optional().describe('Labels to add'),
  assignees: z.array(z.string()).optional().describe('Assignees'),
});

const IssueListSchema = z.object({
  owner: z.string().min(1).describe('Repository owner'),
  repo: z.string().min(1).describe('Repository name'),
  state: z.enum(['open', 'closed', 'all']).optional().describe('Issue state'),
  limit: z.number().min(1).max(100).optional().describe('Maximum results'),
});

const IssueGetSchema = z.object({
  owner: z.string().min(1).describe('Repository owner'),
  repo: z.string().min(1).describe('Repository name'),
  number: z.number().int().positive().describe('Issue number'),
});

const PRCreateSchema = z.object({
  owner: z.string().min(1).describe('Repository owner'),
  repo: z.string().min(1).describe('Repository name'),
  title: z.string().min(1).max(256).describe('PR title'),
  body: z.string().max(65536).optional().describe('PR body'),
  head: z.string().min(1).describe('Head branch'),
  base: z.string().min(1).describe('Base branch'),
  draft: z.boolean().optional().describe('Create as draft'),
});

const PRListSchema = z.object({
  owner: z.string().min(1).describe('Repository owner'),
  repo: z.string().min(1).describe('Repository name'),
  state: z.enum(['open', 'closed', 'merged', 'all']).optional().describe('PR state'),
  limit: z.number().min(1).max(100).optional().describe('Maximum results'),
});

const PRGetSchema = z.object({
  owner: z.string().min(1).describe('Repository owner'),
  repo: z.string().min(1).describe('Repository name'),
  number: z.number().int().positive().describe('PR number'),
});

const RepoInfoSchema = z.object({
  owner: z.string().min(1).describe('Repository owner'),
  repo: z.string().min(1).describe('Repository name'),
});

function runGhCommand(args: string[], config: AgentStackConfig): unknown {
  try {
    const env = { ...process.env };

    // Use token if provided and not using gh CLI auth
    if (config.github.token && !config.github.useGhCli) {
      env['GH_TOKEN'] = config.github.token;
    }

    const result = execSync(`gh ${args.join(' ')}`, {
      encoding: 'utf-8',
      env,
      timeout: 30000,
    });

    return JSON.parse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('GitHub command failed', { args, error: message });
    throw new Error(`GitHub command failed: ${message}`);
  }
}

function checkGitHubEnabled(config: AgentStackConfig): void {
  if (!config.github.enabled) {
    throw new Error('GitHub integration is disabled. Enable it in agentstack.config.json');
  }
}

export function createGitHubTools(config: AgentStackConfig) {
  return {
    github_issue_create: {
      name: 'github_issue_create',
      description: 'Create a GitHub issue',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          title: { type: 'string', description: 'Issue title' },
          body: { type: 'string', description: 'Issue body' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Labels' },
          assignees: { type: 'array', items: { type: 'string' }, description: 'Assignees' },
        },
        required: ['owner', 'repo', 'title'],
      },
      handler: async (params: Record<string, unknown>) => {
        checkGitHubEnabled(config);
        const input = IssueCreateSchema.parse(params);

        const args = [
          'issue', 'create',
          '-R', `${input.owner}/${input.repo}`,
          '--title', JSON.stringify(input.title),
          '--json', 'number,url,title',
        ];

        if (input.body) {
          args.push('--body', JSON.stringify(input.body));
        }

        if (input.labels?.length) {
          args.push('--label', input.labels.join(','));
        }

        if (input.assignees?.length) {
          args.push('--assignee', input.assignees.join(','));
        }

        const result = runGhCommand(args, config);
        return { success: true, issue: result };
      },
    },

    github_issue_list: {
      name: 'github_issue_list',
      description: 'List GitHub issues',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state' },
          limit: { type: 'number', description: 'Maximum results' },
        },
        required: ['owner', 'repo'],
      },
      handler: async (params: Record<string, unknown>) => {
        checkGitHubEnabled(config);
        const input = IssueListSchema.parse(params);

        const args = [
          'issue', 'list',
          '-R', `${input.owner}/${input.repo}`,
          '--json', 'number,title,state,author,labels,createdAt',
          '--limit', String(input.limit ?? 30),
        ];

        if (input.state) {
          args.push('--state', input.state);
        }

        const result = runGhCommand(args, config) as unknown[];
        return { count: result.length, issues: result };
      },
    },

    github_issue_get: {
      name: 'github_issue_get',
      description: 'Get a GitHub issue',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          number: { type: 'number', description: 'Issue number' },
        },
        required: ['owner', 'repo', 'number'],
      },
      handler: async (params: Record<string, unknown>) => {
        checkGitHubEnabled(config);
        const input = IssueGetSchema.parse(params);

        const args = [
          'issue', 'view',
          '-R', `${input.owner}/${input.repo}`,
          String(input.number),
          '--json', 'number,title,body,state,author,labels,assignees,createdAt,closedAt',
        ];

        const result = runGhCommand(args, config);
        return { found: true, issue: result };
      },
    },

    github_pr_create: {
      name: 'github_pr_create',
      description: 'Create a pull request',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          title: { type: 'string', description: 'PR title' },
          body: { type: 'string', description: 'PR body' },
          head: { type: 'string', description: 'Head branch' },
          base: { type: 'string', description: 'Base branch' },
          draft: { type: 'boolean', description: 'Create as draft' },
        },
        required: ['owner', 'repo', 'title', 'head', 'base'],
      },
      handler: async (params: Record<string, unknown>) => {
        checkGitHubEnabled(config);
        const input = PRCreateSchema.parse(params);

        const args = [
          'pr', 'create',
          '-R', `${input.owner}/${input.repo}`,
          '--title', JSON.stringify(input.title),
          '--head', input.head,
          '--base', input.base,
          '--json', 'number,url,title',
        ];

        if (input.body) {
          args.push('--body', JSON.stringify(input.body));
        }

        if (input.draft) {
          args.push('--draft');
        }

        const result = runGhCommand(args, config);
        return { success: true, pr: result };
      },
    },

    github_pr_list: {
      name: 'github_pr_list',
      description: 'List pull requests',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          state: { type: 'string', enum: ['open', 'closed', 'merged', 'all'], description: 'PR state' },
          limit: { type: 'number', description: 'Maximum results' },
        },
        required: ['owner', 'repo'],
      },
      handler: async (params: Record<string, unknown>) => {
        checkGitHubEnabled(config);
        const input = PRListSchema.parse(params);

        const args = [
          'pr', 'list',
          '-R', `${input.owner}/${input.repo}`,
          '--json', 'number,title,state,author,headRefName,baseRefName,createdAt',
          '--limit', String(input.limit ?? 30),
        ];

        if (input.state) {
          args.push('--state', input.state);
        }

        const result = runGhCommand(args, config) as unknown[];
        return { count: result.length, prs: result };
      },
    },

    github_pr_get: {
      name: 'github_pr_get',
      description: 'Get a pull request',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          number: { type: 'number', description: 'PR number' },
        },
        required: ['owner', 'repo', 'number'],
      },
      handler: async (params: Record<string, unknown>) => {
        checkGitHubEnabled(config);
        const input = PRGetSchema.parse(params);

        const args = [
          'pr', 'view',
          '-R', `${input.owner}/${input.repo}`,
          String(input.number),
          '--json', 'number,title,body,state,author,headRefName,baseRefName,isDraft,mergeable,createdAt,closedAt,mergedAt',
        ];

        const result = runGhCommand(args, config);
        return { found: true, pr: result };
      },
    },

    github_repo_info: {
      name: 'github_repo_info',
      description: 'Get repository information',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
        },
        required: ['owner', 'repo'],
      },
      handler: async (params: Record<string, unknown>) => {
        checkGitHubEnabled(config);
        const input = RepoInfoSchema.parse(params);

        const args = [
          'repo', 'view',
          `${input.owner}/${input.repo}`,
          '--json', 'name,description,owner,url,defaultBranchRef,stargazerCount,forkCount,isPrivate,createdAt,pushedAt',
        ];

        const result = runGhCommand(args, config);
        return { found: true, repo: result };
      },
    },
  };
}
