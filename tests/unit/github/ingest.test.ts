/**
 * Issue ingest tests — URL parsing + provider client routing.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseIssueUrl, createProviderClient } from '../../../src/github/providers.js';
import { ingestIssue } from '../../../src/github/ingest.js';
import type {
  ProviderClient,
  IssueDetails,
  CreatePrResult,
  CreatePrParams,
} from '../../../src/github/providers.js';

function fakeIssue(overrides: Partial<IssueDetails> = {}): IssueDetails {
  return {
    provider: 'github',
    host: 'github.com',
    owner: 'octocat',
    repo: 'hello',
    number: 42,
    title: 'Sample issue',
    body: 'Body',
    labels: ['enhancement'],
    assignees: ['octocat'],
    htmlUrl: 'https://github.com/octocat/hello/issues/42',
    state: 'open',
    ...overrides,
  };
}

function stubClient(issue: IssueDetails = fakeIssue()): ProviderClient {
  return {
    provider: issue.provider,
    async getIssue() {
      return issue;
    },
    async setLabels() {
      /* noop */
    },
    async createPullRequest(_o: string, _r: string, _p: CreatePrParams): Promise<CreatePrResult> {
      return { number: 1, url: 'https://example.com/pr/1' };
    },
  };
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseIssueUrl', () => {
  it('parses a github.com issue URL', () => {
    const out = parseIssueUrl('https://github.com/octocat/hello-world/issues/123');
    expect(out).toEqual({
      provider: 'github',
      host: 'github.com',
      owner: 'octocat',
      repo: 'hello-world',
      number: 123,
    });
  });

  it('parses a gitlab.com issue URL', () => {
    const out = parseIssueUrl('https://gitlab.com/foo/bar/-/issues/7');
    expect(out.provider).toBe('gitlab');
    expect(out.owner).toBe('foo');
    expect(out.repo).toBe('bar');
    expect(out.number).toBe(7);
  });

  it('parses a self-hosted GitLab URL with subgroups', () => {
    const out = parseIssueUrl('https://gitlab.example.com/grp/sub/proj/-/issues/9');
    expect(out.provider).toBe('gitlab');
    expect(out.owner).toBe('grp/sub');
    expect(out.repo).toBe('proj');
    expect(out.number).toBe(9);
  });

  it('rejects malformed URLs', () => {
    expect(() => parseIssueUrl('not a url')).toThrow(/Invalid issue URL/);
    expect(() => parseIssueUrl('https://example.com/foo/bar')).toThrow(/Unrecognised issue URL/);
  });

  it('rejects non-numeric issue numbers', () => {
    expect(() => parseIssueUrl('https://github.com/o/r/issues/abc')).toThrow(/Invalid issue number/);
  });
});

describe('createProviderClient', () => {
  it('returns a GitHub client', () => {
    const c = createProviderClient('github', { token: 't' });
    expect(c.provider).toBe('github');
  });

  it('returns a GitLab client', () => {
    const c = createProviderClient('gitlab', { token: 't' });
    expect(c.provider).toBe('gitlab');
  });

  it('routes self-hosted GitHub calls through /api/v3', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, fakeIssue()));
    vi.stubGlobal('fetch', fetchMock);
    const c = createProviderClient('github', { token: 't', host: 'github.example.com' });

    await c.getIssue('octocat', 'hello', 42);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://github.example.com/api/v3/repos/octocat/hello/issues/42'
    );
  });

  it('retries a provider request once after a rate-limit response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('limited', {
          status: 429,
          headers: { 'Retry-After': '0' },
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, fakeIssue()));
    vi.stubGlobal('fetch', fetchMock);
    const c = createProviderClient('github', { token: 't' });

    const issue = await c.getIssue('octocat', 'hello', 42);

    expect(issue.title).toBe('Sample issue');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('differentiates authentication failures from rate limits', async () => {
    const fetchMock = vi.fn(async () => new Response('bad token', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const c = createProviderClient('github', { token: 'bad' });

    await expect(c.getIssue('octocat', 'hello', 42)).rejects.toThrow(/authentication failed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects GitHub pull requests returned from the issues API', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { ...fakeIssue(), pull_request: { html_url: 'https://example.com/pr/42' } })
    );
    vi.stubGlobal('fetch', fetchMock);
    const c = createProviderClient('github', { token: 't' });

    await expect(c.getIssue('octocat', 'hello', 42)).rejects.toThrow(/pull request, not an issue/);
  });

  it('uses a single Draft title for GitLab merge-request creation', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { title: string };
      expect(body.title).toBe('Draft: Add feature');
      return jsonResponse(201, { iid: 5, web_url: 'https://gitlab.com/acme/app/-/merge_requests/5' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const c = createProviderClient('gitlab', { token: 't' });

    const result = await c.createPullRequest('acme', 'app', {
      title: 'Add feature',
      body: 'Body',
      head: 'aistack/gitlab-7',
      base: 'main',
      draft: true,
    });

    expect(result.number).toBe(5);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('ingestIssue', () => {
  it('routes to the injected stub client', async () => {
    const issue = fakeIssue({ title: 'My test issue', number: 99 });
    const { issue: got, client } = await ingestIssue(
      'https://github.com/octocat/hello/issues/99',
      { client: stubClient(issue) }
    );
    expect(got.title).toBe('My test issue');
    expect(got.number).toBe(99);
    expect(client.provider).toBe('github');
  });

  it('propagates URL parse failures', async () => {
    await expect(ingestIssue('https://example.com/no')).rejects.toThrow(/Unrecognised|Invalid/);
  });
});
