/**
 * Unified provider client for GitHub + GitLab.
 *
 * Uses raw `fetch` (no external SDK dependency) so this module stays within
 * the project's zero-deps policy. Both providers expose the same surface:
 * fetch an issue, apply labels, create a draft pull/merge request.
 */

import { logger } from '../utils/logger.js';

const log = logger.child('github:providers');

const MAX_RATE_LIMIT_WAIT_MS = 30_000;
const PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

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
    this.base = host === 'api.github.com' ? `https://${host}` : `https://${host}/api/v3`;
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
    const res = await fetchWithRateLimitRetry('GitHub', 'getIssue', `${this.base}/repos/${owner}/${repo}/issues/${number}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw await providerError('GitHub', 'getIssue', res);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    if (raw.pull_request) {
      throw new Error(`GitHub getIssue failed: ${owner}/${repo}#${number} is a pull request, not an issue`);
    }
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
    const res = await fetchWithRateLimitRetry('GitHub', 'setLabels', `${this.base}/repos/${owner}/${repo}/issues/${number}/labels`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels }),
    });
    if (!res.ok) {
      throw await providerError('GitHub', 'setLabels', res);
    }
  }

  async createPullRequest(
    owner: string,
    repo: string,
    params: CreatePrParams
  ): Promise<CreatePrResult> {
    const res = await fetchWithRateLimitRetry('GitHub', 'createPullRequest', `${this.base}/repos/${owner}/${repo}/pulls`, {
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
      throw await providerError('GitHub', 'createPullRequest', res);
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
    const res = await fetchWithRateLimitRetry('GitLab', 'getIssue', `${this.base}/projects/${pid}/issues/${number}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw await providerError('GitLab', 'getIssue', res);
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
    const res = await fetchWithRateLimitRetry('GitLab', 'setLabels', `${this.base}/projects/${pid}/issues/${number}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: labels.join(',') }),
    });
    if (!res.ok) {
      throw await providerError('GitLab', 'setLabels', res);
    }
  }

  async createPullRequest(
    owner: string,
    repo: string,
    params: CreatePrParams
  ): Promise<CreatePrResult> {
    const pid = this.projectId(owner, repo);
    const title = params.draft ? `Draft: ${params.title}` : params.title;
    const res = await fetchWithRateLimitRetry('GitLab', 'createMergeRequest', `${this.base}/projects/${pid}/merge_requests`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description: params.body,
        source_branch: params.head,
        target_branch: params.base,
      }),
    });
    if (!res.ok) {
      throw await providerError('GitLab', 'createMergeRequest', res);
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

async function fetchWithRateLimitRetry(
  provider: string,
  operation: string,
  input: string,
  init: RequestInit
): Promise<Response> {
  const first = await fetchWithTimeout(provider, operation, input, init);
  if (!isRateLimited(first)) return first;

  const waitMs = retryDelayMs(first.headers);
  log.warn('Provider rate limit hit; retrying once', {
    provider,
    operation,
    status: first.status,
    waitMs,
  });
  await delay(waitMs);
  return fetchWithTimeout(provider, operation, input, init);
}

async function fetchWithTimeout(
  provider: string,
  operation: string,
  input: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal?.aborted) {
    controller.abort();
  } else {
    upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), PROVIDER_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`${provider} ${operation} timed out after ${PROVIDER_REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  }
}

function isRateLimited(res: Response): boolean {
  if (res.status === 429) return true;
  return res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0';
}

function retryDelayMs(headers: Headers): number {
  const retryAfter = Number(headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(retryAfter * 1000, MAX_RATE_LIMIT_WAIT_MS);
  }

  const reset = Number(headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) {
    return Math.min(Math.max(reset * 1000 - Date.now(), 0), MAX_RATE_LIMIT_WAIT_MS);
  }

  return 1000;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function providerError(provider: string, operation: string, res: Response): Promise<Error> {
  const text = await res.text().catch(() => '');
  const reason =
    res.status === 401
      ? 'authentication failed'
      : isRateLimited(res)
        ? 'rate limited'
        : res.statusText;
  return new Error(
    `${provider} ${operation} failed: ${res.status} ${reason}${text ? ` ${text}` : ''}`
  );
}
