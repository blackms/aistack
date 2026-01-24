/**
 * GitHub client - wraps gh CLI for GitHub operations
 */

import { execSync, exec } from 'node:child_process';
import type { AgentStackConfig } from '../types.js';
import { logger } from '../utils/logger.js';

const log = logger.child('github');

export interface GitHubClientOptions {
  token?: string;
  useGhCli?: boolean;
}

export class GitHubClient {
  private token?: string;
  private useGhCli: boolean;

  constructor(options: GitHubClientOptions = {}) {
    this.token = options.token;
    this.useGhCli = options.useGhCli ?? true;
  }

  /**
   * Execute a gh CLI command
   */
  private async executeGh(args: string[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env };

      if (this.token && !this.useGhCli) {
        env['GH_TOKEN'] = this.token;
      }

      const command = `gh ${args.join(' ')}`;
      log.debug('Executing gh command', { args });

      exec(command, { env, timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          log.error('gh command failed', { error: error.message, stderr });
          reject(new Error(`GitHub command failed: ${error.message}`));
          return;
        }

        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(stdout.trim());
        }
      });
    });
  }

  /**
   * Execute a gh CLI command synchronously
   */
  private executeGhSync(args: string[]): unknown {
    const env = { ...process.env };

    if (this.token && !this.useGhCli) {
      env['GH_TOKEN'] = this.token;
    }

    try {
      const result = execSync(`gh ${args.join(' ')}`, {
        encoding: 'utf-8',
        env,
        timeout: 30000,
      });

      return JSON.parse(result);
    } catch (error) {
      throw new Error(`GitHub command failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if gh CLI is available
   */
  isAvailable(): boolean {
    try {
      execSync('gh --version', { encoding: 'utf-8', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      await this.executeGh(['auth', 'status']);
      return true;
    } catch {
      return false;
    }
  }

  // Issue operations

  async createIssue(
    owner: string,
    repo: string,
    title: string,
    body?: string,
    options?: { labels?: string[]; assignees?: string[] }
  ): Promise<{ number: number; url: string }> {
    const args = [
      'issue', 'create',
      '-R', `${owner}/${repo}`,
      '--title', JSON.stringify(title),
      '--json', 'number,url',
    ];

    if (body) args.push('--body', JSON.stringify(body));
    if (options?.labels?.length) args.push('--label', options.labels.join(','));
    if (options?.assignees?.length) args.push('--assignee', options.assignees.join(','));

    return await this.executeGh(args) as { number: number; url: string };
  }

  async listIssues(
    owner: string,
    repo: string,
    options?: { state?: 'open' | 'closed' | 'all'; limit?: number }
  ): Promise<unknown[]> {
    const args = [
      'issue', 'list',
      '-R', `${owner}/${repo}`,
      '--json', 'number,title,state,author,labels,createdAt',
      '--limit', String(options?.limit ?? 30),
    ];

    if (options?.state) args.push('--state', options.state);

    return await this.executeGh(args) as unknown[];
  }

  async getIssue(owner: string, repo: string, number: number): Promise<unknown> {
    const args = [
      'issue', 'view',
      '-R', `${owner}/${repo}`,
      String(number),
      '--json', 'number,title,body,state,author,labels,assignees,createdAt,closedAt',
    ];

    return await this.executeGh(args);
  }

  // PR operations

  async createPR(
    owner: string,
    repo: string,
    title: string,
    head: string,
    base: string,
    body?: string,
    draft?: boolean
  ): Promise<{ number: number; url: string }> {
    const args = [
      'pr', 'create',
      '-R', `${owner}/${repo}`,
      '--title', JSON.stringify(title),
      '--head', head,
      '--base', base,
      '--json', 'number,url',
    ];

    if (body) args.push('--body', JSON.stringify(body));
    if (draft) args.push('--draft');

    return await this.executeGh(args) as { number: number; url: string };
  }

  async listPRs(
    owner: string,
    repo: string,
    options?: { state?: 'open' | 'closed' | 'merged' | 'all'; limit?: number }
  ): Promise<unknown[]> {
    const args = [
      'pr', 'list',
      '-R', `${owner}/${repo}`,
      '--json', 'number,title,state,author,headRefName,baseRefName,createdAt',
      '--limit', String(options?.limit ?? 30),
    ];

    if (options?.state) args.push('--state', options.state);

    return await this.executeGh(args) as unknown[];
  }

  async getPR(owner: string, repo: string, number: number): Promise<unknown> {
    const args = [
      'pr', 'view',
      '-R', `${owner}/${repo}`,
      String(number),
      '--json', 'number,title,body,state,author,headRefName,baseRefName,isDraft,mergeable,createdAt,closedAt,mergedAt',
    ];

    return await this.executeGh(args);
  }

  // Repo operations

  async getRepo(owner: string, repo: string): Promise<unknown> {
    const args = [
      'repo', 'view',
      `${owner}/${repo}`,
      '--json', 'name,description,owner,url,defaultBranchRef,stargazerCount,forkCount,isPrivate,createdAt,pushedAt',
    ];

    return await this.executeGh(args);
  }
}

/**
 * Create GitHub client from config
 */
export function createGitHubClient(config: AgentStackConfig): GitHubClient | null {
  if (!config.github.enabled) {
    log.debug('GitHub integration disabled');
    return null;
  }

  return new GitHubClient({
    token: config.github.token,
    useGhCli: config.github.useGhCli,
  });
}
