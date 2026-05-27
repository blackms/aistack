/**
 * Issue ingest tests — URL parsing + provider client routing.
 */

import { describe, it, expect } from 'vitest';
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
