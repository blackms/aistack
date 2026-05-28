/**
 * Issue→PR coordinator tests — mock the review loop + plan generator and
 * verify lifecycle labels + PR body content.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  IssueDetails,
  ProviderClient,
  CreatePrParams,
  CreatePrResult,
} from '../../../src/github/providers.js';
import type { AgentStackConfig, ReviewLoopState, ReviewResult } from '../../../src/types.js';
import { buildPrBody } from '../../../src/github/pr-body.js';
import { applyLifecycleLabel, DEFAULT_LABELS } from '../../../src/github/labels.js';

// Mock the spawner so the coordinator does not try to start real agents.
vi.mock('../../../src/agents/spawner.js', () => ({
  spawnAgent: vi.fn(() => ({ id: 'agent-1', type: 'coordinator', name: 'planner', status: 'idle', createdAt: new Date() })),
  executeAgent: vi.fn(async () => ({ response: '1. Goal: foo\n2. Files: src/a.ts\n3. Steps: do it', model: 'mock', duration: 1, agentId: 'agent-1' })),
  updateAgentStatus: vi.fn(() => true),
  stopAgent: vi.fn(() => true),
}));

// Mock the review loop to return a deterministic approved state.
const reviewLoopMock = vi.fn();
vi.mock('../../../src/coordination/review-loop.js', () => {
  return {
    ReviewLoopCoordinator: vi.fn().mockImplementation(() => ({
      start: reviewLoopMock,
      cleanup: vi.fn(),
    })),
  };
});

// Import AFTER the mocks so module wiring picks them up.
const { runIssueToPRWorkflow } = await import('../../../src/github/coordinator.js');

function baseConfig(overrides: Partial<AgentStackConfig['github']> = {}): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: { path: ':memory:', defaultNamespace: 'default', vectorSearch: { enabled: false } },
    providers: { default: 'anthropic' },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: true, ...overrides },
    plugins: { enabled: false, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: false, sessionEnd: false, preTask: false, postTask: false },
  };
}

function fakeIssue(): IssueDetails {
  return {
    provider: 'github',
    host: 'github.com',
    owner: 'octocat',
    repo: 'hello',
    number: 42,
    title: 'Add new feature',
    body: 'Please add X',
    labels: ['enhancement'],
    assignees: [],
    htmlUrl: 'https://github.com/octocat/hello/issues/42',
    state: 'open',
  };
}

interface FakeClient extends ProviderClient {
  setLabelCalls: string[][];
  createPRCall?: CreatePrParams;
}

function fakeClient(opts: { failPr?: boolean } = {}): FakeClient {
  const setLabelCalls: string[][] = [];
  let createPRCall: CreatePrParams | undefined;
  const client: FakeClient = {
    provider: 'github',
    setLabelCalls,
    get createPRCall() {
      return createPRCall;
    },
    async getIssue() {
      return fakeIssue();
    },
    async setLabels(_o, _r, _n, labels) {
      setLabelCalls.push([...labels]);
    },
    async createPullRequest(_o, _r, params): Promise<CreatePrResult> {
      createPRCall = params;
      if (opts.failPr) throw new Error('upstream PR failure');
      return { number: 7, url: 'https://github.com/octocat/hello/pull/7' };
    },
  };
  return client;
}

function approvedState(): ReviewLoopState {
  const review: ReviewResult = {
    reviewId: 'r1',
    verdict: 'APPROVE',
    issues: [],
    summary: 'looks good',
    timestamp: new Date(),
  };
  return {
    id: 'loop-1',
    coderId: 'c1',
    adversarialId: 'a1',
    iteration: 1,
    maxIterations: 2,
    status: 'approved',
    codeInput: '',
    reviews: [review],
    startedAt: new Date(),
    finalVerdict: 'APPROVE',
    completedAt: new Date(),
  };
}

function rejectedState(): ReviewLoopState {
  const review: ReviewResult = {
    reviewId: 'r1',
    verdict: 'REJECT',
    issues: [{ id: 'i1', severity: 'HIGH', title: 'bad thing', requiredFix: 'fix it' }],
    summary: 'nope',
    timestamp: new Date(),
  };
  return {
    id: 'loop-1',
    coderId: 'c1',
    adversarialId: 'a1',
    iteration: 2,
    maxIterations: 2,
    status: 'max_iterations_reached',
    codeInput: '',
    reviews: [review, review],
    startedAt: new Date(),
    finalVerdict: 'REJECT',
    completedAt: new Date(),
  };
}

describe('runIssueToPRWorkflow', () => {
  beforeEach(() => {
    reviewLoopMock.mockReset();
  });

  it('opens a draft PR and applies done label when review approves', async () => {
    reviewLoopMock.mockResolvedValue(approvedState());
    const client = fakeClient();
    const config = baseConfig();

    const result = await runIssueToPRWorkflow(fakeIssue(), client, config, { maxIterations: 1 });

    expect(result.status).toBe('success');
    expect(result.pullRequest?.url).toBe('https://github.com/octocat/hello/pull/7');
    expect(client.createPRCall?.draft).toBe(true);
    expect(client.createPRCall?.title.startsWith('[aistack]')).toBe(true);

    // Lifecycle labels: claimed -> in-progress -> done
    const lastLabels = client.setLabelCalls.at(-1) ?? [];
    expect(lastLabels).toContain(DEFAULT_LABELS.done);
    expect(client.setLabelCalls.length).toBeGreaterThanOrEqual(3);

    // PR body must mention the issue and a review iteration
    expect(client.createPRCall?.body).toContain('Add new feature');
    expect(client.createPRCall?.body).toContain('Adversarial review');
    expect(client.createPRCall?.body).toContain('aistack');
  });

  it('marks issue blocked when adversarial review never approves', async () => {
    reviewLoopMock.mockResolvedValue(rejectedState());
    const client = fakeClient();
    const config = baseConfig();

    const result = await runIssueToPRWorkflow(fakeIssue(), client, config, { maxIterations: 2 });

    expect(result.status).toBe('blocked');
    expect(client.createPRCall).toBeUndefined();
    const finalLabels = client.setLabelCalls.at(-1) ?? [];
    expect(finalLabels).toContain(DEFAULT_LABELS.blocked);
  });

  it('honours dry-run by skipping PR creation', async () => {
    reviewLoopMock.mockResolvedValue(approvedState());
    const client = fakeClient();

    const result = await runIssueToPRWorkflow(fakeIssue(), client, baseConfig(), { dryRun: true });

    expect(result.status).toBe('success');
    expect(result.pullRequest).toBeUndefined();
    expect(client.createPRCall).toBeUndefined();
  });

  it('captures upstream PR failures and labels the issue blocked', async () => {
    reviewLoopMock.mockResolvedValue(approvedState());
    const client = fakeClient({ failPr: true });

    const result = await runIssueToPRWorkflow(fakeIssue(), client, baseConfig());

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/PR creation failed/);
    const finalLabels = client.setLabelCalls.at(-1) ?? [];
    expect(finalLabels).toContain(DEFAULT_LABELS.blocked);
  });
});

describe('buildPrBody', () => {
  it('renders all required sections', () => {
    const body = buildPrBody({
      issue: fakeIssue(),
      plan: '1. Do X\n2. Do Y',
      reviews: [
        {
          reviewId: 'r1',
          verdict: 'APPROVE',
          issues: [],
          summary: 'lgtm',
          timestamp: new Date(),
        },
      ],
      branch: 'aistack/github-42-abc',
      auditUrl: 'https://audit.example/42',
    });

    expect(body).toContain('## Summary');
    expect(body).toContain('## Plan');
    expect(body).toContain('## Adversarial review');
    expect(body).toContain('## Audit trail');
    expect(body).toContain('aistack/github-42-abc');
    expect(body).toContain('https://audit.example/42');
  });

  it('uses issue refs for GitLab issues, not merge-request refs', () => {
    const body = buildPrBody({
      issue: fakeIssue({
        provider: 'gitlab',
        host: 'gitlab.com',
        htmlUrl: 'https://gitlab.com/acme/app/-/issues/42',
      }),
      plan: 'Plan',
      reviews: [],
      branch: 'aistack/gitlab-42-abc',
    });

    expect(body).toContain('issue #42');
    expect(body).not.toContain('issue !42');
  });
});

describe('applyLifecycleLabel', () => {
  it('replaces existing lifecycle labels with the requested phase', async () => {
    const captured: string[] = [];
    const client: ProviderClient = {
      provider: 'github',
      async getIssue() {
        return fakeIssue();
      },
      async setLabels(_o, _r, _n, labels) {
        captured.push(...labels);
      },
      async createPullRequest() {
        return { number: 0, url: '' };
      },
    };

    const next = await applyLifecycleLabel(
      client,
      'o',
      'r',
      1,
      'inProgress',
      ['bug', 'aistack-claimed']
    );

    expect(next).toContain('bug');
    expect(next).toContain(DEFAULT_LABELS.inProgress);
    expect(next).not.toContain(DEFAULT_LABELS.claimed);
    expect(captured).toContain(DEFAULT_LABELS.inProgress);
  });

  it('preserves user labels that only share the aistack prefix', async () => {
    const captured: string[] = [];
    const client: ProviderClient = {
      provider: 'github',
      async getIssue() {
        return fakeIssue();
      },
      async setLabels(_o, _r, _n, labels) {
        captured.push(...labels);
      },
      async createPullRequest() {
        return { number: 0, url: '' };
      },
    };

    const next = await applyLifecycleLabel(
      client,
      'o',
      'r',
      1,
      'inProgress',
      ['bug', 'aistack-roadmap', 'aistack-claimed']
    );

    expect(next).toContain('aistack-roadmap');
    expect(next).toContain(DEFAULT_LABELS.inProgress);
    expect(next).not.toContain(DEFAULT_LABELS.claimed);
    expect(captured).toContain('aistack-roadmap');
  });
});
