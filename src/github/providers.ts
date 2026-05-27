/**
 * Unified provider client for GitHub + GitLab.
 *
 * Uses raw `fetch` (no external SDK dependency) so this module stays within
 * the project's zero-deps policy. Both providers expose the same surface:
 * fetch an issue, apply labels, create a draft pull/merge request.
 */

import { logger } from '../utils/logger.js';

const log = logger.child('github:providers');

export type ProviderName = 'github' | 'gitlab';

export interface ParsedIssueUrl {
  provider: ProviderName;
  host: string;
  owner: string;
  repo: string;
  number: number;
}

export interface IssueDetails {
  provider: ProviderName;
  host: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  htmlUrl: string;
  state: string;
}

export interface CreatePrParams {
  title: string;
  body: string;
  head: string; // source branch
  base: string; // target branch
  draft?: boolean;
}

export interface CreatePrResult {
  number: number;
  url: string;
}

export interface ProviderCredentials {
  /** GitHub PAT (`GITHUB_TOKEN`) or GitLab PAT (`GITLAB_TOKEN`) */
  token?: string;
  /** Custom host for self-hosted instances (e.g. `gitlab.example.com`) */
  host?: string;
}

/**
 * Parse a GitHub/GitLab issue URL into its components.
 *
 * Supported shapes:
 *   - https://github.com/<owner>/<repo>/issues/<n>
 *   - https://gitlab.com/<owner>/<repo>/-/issues/<n>
 *   - https://gitlab.example.com/<group>/<sub>/<repo>/-/issues/<n>
 */
export function parseIssueUrl(input: string): ParsedIssueUrl {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid issue URL: ${input}`);
  }

  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  // GitHub: /<owner>/<repo>/issues/<n>
  if (host === 'github.com' || host.endsWith('.github.com')) {
    if (parts.length < 4 || parts[parts.length - 2] !== 'issues') {
      throw new Error(`Unrecognised GitHub issue URL: ${input}`);
    }
    const number = Number(parts[parts.length - 1]);
    if (!Number.isInteger(number) || number <= 0) {
      throw new Error(`Invalid issue number in URL: ${input}`);
    }
    const owner = parts[0];
    const repo = parts[1];
    return { provider: 'github', host, owner, repo, number };
  }

  // GitLab: /<group>[/<subgroup>...]/<repo>/-/issues/<n>
  const dashIdx = parts.indexOf('-');
  if (dashIdx >= 2 && parts[dashIdx + 1] === 'issues') {
    const number = Number(parts[dashIdx + 2]);
    if (!Number.isInteger(number) || number <= 0) {
      throw new Error(`Invalid issue number in URL: ${input}`);
    }
    const owner = parts.slice(0, dashIdx - 1).join('/');
    const repo = parts[dashIdx - 1];
    return { provider: 'gitlab', host, owner, repo, number };
  }

  throw new Error(`Unrecognised issue URL (not GitHub or GitLab): ${input}`);
}

/* -------------------------------------------------------------------------- */
/* Provider interface                                                          */
/* -------------------------------------------------------------------------- */

export interface ProviderClient {
  readonly provider: ProviderName;
  getIssue(owner: string, repo: string, number: number): Promise<IssueDetails>;
  setLabels(owner: string, repo: string, number: number, labels: string[]): Promise<void>;
  createPullRequest(owner: string, repo: string, params: CreatePrParams): Promise<CreatePrResult>;
}

/* -------------------------------------------------------------------------- */
/* GitHub                                                                      */
/* -------------------------------------------------------------------------- */

class GitHubProvider implements ProviderClient {
  readonly provider = 'github' as const;
  private readonly base: string;
  private readonly token?: string;

  constructor(creds: ProviderCredentials = {}) {
    this.token = creds.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    const host = creds.host ?? 'api.github.com';
    this.base = host.includes('api.github.com') ? `https://${host}` : `https://${host}/api/v3`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'aistack/1.x',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  async getIssue(owner: string, repo: string, number: number): Promise<IssueDetails> {
    const res = await fetch(`${this.base}/repos/${owner}/${repo}/issues/${number}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`GitHub getIssue failed: ${res.status} ${res.statusText}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    return {
      provider: 'github',
      host: 'github.com',
      owner,
      repo,
      number,
      title: String(raw.title ?? ''),
      body: String(raw.body ?? ''),
      labels: Array.isArray(raw.labels)
        ? (raw.labels as Array<{ name?: string } | string>)
            .map((l) => (typeof l === 'string' ? l : l.name ?? ''))
            .filter(Boolean)
        : [],
      assignees: Array.isArray(raw.assignees)
        ? (raw.assignees as Array<{ login?: string }>)
            .map((a) => a.login ?? '')
            .filter(Boolean)
        : [],
      htmlUrl: String(raw.html_url ?? ''),
      state: String(raw.state ?? 'open'),
    };
  }

  async setLabels(owner: string, repo: string, number: number, labels: string[]): Promise<void> {
    const res = await fetch(`${this.base}/repos/${owner}/${repo}/issues/${number}/labels`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels }),
    });
    if (!res.ok) {
      throw new Error(`GitHub setLabels failed: ${res.status} ${res.statusText}`);
    }
  }

  async createPullRequest(
    owner: string,
    repo: string,
    params: CreatePrParams
  ): Promise<CreatePrResult> {
    const res = await fetch(`${this.base}/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: params.title,
        body: params.body,
        head: params.head,
        base: params.base,
        draft: params.draft ?? true,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GitHub createPullRequest failed: ${res.status} ${res.statusText} ${text}`);
    }
    const raw = (await res.json()) as { number: number; html_url: string };
    return { number: raw.number, url: raw.html_url };
  }
}

/* -------------------------------------------------------------------------- */
/* GitLab                                                                      */
/* -------------------------------------------------------------------------- */

class GitLabProvider implements ProviderClient {
  readonly provider = 'gitlab' as const;
  private readonly base: string;
  private readonly token?: string;

  constructor(creds: ProviderCredentials = {}) {
    this.token = creds.token ?? process.env.GITLAB_TOKEN;
    const host = creds.host ?? 'gitlab.com';
    this.base = `https://${host}/api/v4`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'aistack/1.x',
    };
    if (this.token) h['PRIVATE-TOKEN'] = this.token;
    return h;
  }

  private projectId(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`);
  }

  async getIssue(owner: string, repo: string, number: number): Promise<IssueDetails> {
    const pid = this.projectId(owner, repo);
    const res = await fetch(`${this.base}/projects/${pid}/issues/${number}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`GitLab getIssue failed: ${res.status} ${res.statusText}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    return {
      provider: 'gitlab',
      host: new URL(this.base).host,
      owner,
      repo,
      number,
      title: String(raw.title ?? ''),
      body: String(raw.description ?? ''),
      labels: Array.isArray(raw.labels) ? (raw.labels as string[]) : [],
      assignees: Array.isArray(raw.assignees)
        ? (raw.assignees as Array<{ username?: string }>)
            .map((a) => a.username ?? '')
            .filter(Boolean)
        : [],
      htmlUrl: String(raw.web_url ?? ''),
      state: String(raw.state ?? 'opened'),
    };
  }

  async setLabels(owner: string, repo: string, number: number, labels: string[]): Promise<void> {
    const pid = this.projectId(owner, repo);
    const res = await fetch(`${this.base}/projects/${pid}/issues/${number}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: labels.join(',') }),
    });
    if (!res.ok) {
      throw new Error(`GitLab setLabels failed: ${res.status} ${res.statusText}`);
    }
  }

  async createPullRequest(
    owner: string,
    repo: string,
    params: CreatePrParams
  ): Promise<CreatePrResult> {
    const pid = this.projectId(owner, repo);
    const res = await fetch(`${this.base}/projects/${pid}/merge_requests`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: params.title,
        description: params.body,
        source_branch: params.head,
        target_branch: params.base,
        // GitLab uses a `WIP:`/`Draft:` title prefix for drafts
        ...(params.draft ? { title: `Draft: ${params.title}` } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GitLab createMergeRequest failed: ${res.status} ${res.statusText} ${text}`);
    }
    const raw = (await res.json()) as { iid: number; web_url: string };
    return { number: raw.iid, url: raw.web_url };
  }
}

/* -------------------------------------------------------------------------- */
/* Factory                                                                     */
/* -------------------------------------------------------------------------- */

export function createProviderClient(
  provider: ProviderName,
  creds: ProviderCredentials = {}
): ProviderClient {
  log.debug('Creating provider client', { provider });
  return provider === 'github' ? new GitHubProvider(creds) : new GitLabProvider(creds);
}
