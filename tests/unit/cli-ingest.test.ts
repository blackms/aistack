/**
 * Ingest CLI tests for option validation and provider credential selection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  parseIssueUrl: vi.fn(),
  ingestIssue: vi.fn(),
  runIssueToPRWorkflow: vi.fn(),
}));

vi.mock('../../src/utils/config.js', () => ({
  getConfig: mocks.getConfig,
}));

vi.mock('../../src/github/index.js', () => ({
  parseIssueUrl: mocks.parseIssueUrl,
  ingestIssue: mocks.ingestIssue,
  runIssueToPRWorkflow: mocks.runIssueToPRWorkflow,
}));

const { createIngestCommand } = await import('../../src/cli/commands/ingest.js');

const issue = {
  provider: 'gitlab',
  host: 'gitlab.com',
  owner: 'acme',
  repo: 'app',
  number: 7,
  title: 'Fix bug',
  body: 'Body',
  labels: ['bug'],
  assignees: [],
  htmlUrl: 'https://gitlab.com/acme/app/-/issues/7',
  state: 'open',
};

describe('createIngestCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit ${code}`);
    }) as never);
    mocks.getConfig.mockReturnValue({
      github: {
        token: 'github-token',
        gitlabToken: 'gitlab-token',
      },
    });
    mocks.parseIssueUrl.mockReturnValue({
      provider: 'gitlab',
      host: 'gitlab.com',
      owner: 'acme',
      repo: 'app',
      number: 7,
    });
    mocks.ingestIssue.mockResolvedValue({ issue, client: { provider: 'gitlab' } });
    mocks.runIssueToPRWorkflow.mockResolvedValue({
      status: 'success',
      issue,
      branch: 'aistack/gitlab-7',
      plan: 'Plan',
      reviews: [],
      prBody: 'Body',
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('uses the GitLab token and parsed max-iterations for GitLab issue URLs', async () => {
    const url = 'https://gitlab.com/acme/app/-/issues/7';

    await createIngestCommand().parseAsync(
      ['issue', url, '--max-iterations', '3'],
      { from: 'user' },
    );

    expect(mocks.ingestIssue).toHaveBeenCalledWith(url, {
      credentials: { token: 'gitlab-token', host: 'gitlab.com' },
    });
    expect(mocks.runIssueToPRWorkflow).toHaveBeenCalledWith(
      issue,
      { provider: 'gitlab' },
      expect.any(Object),
      expect.objectContaining({ maxIterations: 3 }),
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('rejects invalid max-iterations before ingesting the issue', async () => {
    await expect(
      createIngestCommand().parseAsync(
        ['issue', 'https://gitlab.com/acme/app/-/issues/7', '--max-iterations', '0'],
        { from: 'user' },
      ),
    ).rejects.toThrow('process.exit 1');

    expect(errorSpy).toHaveBeenCalledWith('Error: --max-iterations must be a positive integer');
    expect(mocks.ingestIssue).not.toHaveBeenCalled();
  });
});
