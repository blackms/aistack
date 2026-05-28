/**
 * Battle pack registry tests
 *
 * Verifies that buildMcpJson produces correct .mcp.json output for every
 * provider combination + handles env-var gating.
 */

import { describe, it, expect } from 'vitest';
import {
  buildMcpJson,
  listBattlePackAdapters,
  postgresAdapter,
  githubRemoteAdapter,
  sentryAdapter,
  playwrightAdapter,
  slackMcpAdapter,
} from '../../../src/integrations/index.js';
import type { IntegrationsConfig } from '../../../src/types.js';

describe('battle pack: listBattlePackAdapters', () => {
  it('exposes all 5 battle-pack adapters', () => {
    const adapters = listBattlePackAdapters();
    const names = adapters.map((a) => a.name).sort();
    expect(names).toEqual(['github-remote', 'playwright', 'postgres', 'sentry', 'slack']);
  });

  it('reports required env vars for each adapter', () => {
    const adapters = listBattlePackAdapters();
    const byName = Object.fromEntries(adapters.map((a) => [a.name, a.envVars]));
    expect(byName['postgres']).toContain('DATABASE_URL');
    expect(byName['github-remote']).toContain('GITHUB_PERSONAL_ACCESS_TOKEN');
    expect(byName['sentry']).toEqual(expect.arrayContaining(['SENTRY_AUTH_TOKEN', 'SENTRY_ORG']));
    expect(byName['playwright']).toEqual([]);
    expect(byName['slack']).toEqual(expect.arrayContaining(['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID']));
  });
});

describe('battle pack: buildMcpJson', () => {
  it('returns empty when integrations undefined', () => {
    const { output, report } = buildMcpJson(undefined);
    expect(output.mcpServers).toEqual({});
    expect(report.enabled).toEqual([]);
    expect(report.skipped).toEqual([]);
  });

  it('returns empty when integrations is empty object', () => {
    const { output, report } = buildMcpJson({});
    expect(output.mcpServers).toEqual({});
    expect(report.enabled).toEqual([]);
  });

  it('enables postgres with inline connection string', () => {
    const cfg: IntegrationsConfig = {
      postgres: { connectionString: 'postgres://localhost/db' },
    };
    const { output, report } = buildMcpJson(cfg);
    expect(report.enabled).toEqual(['postgres']);
    expect(output.mcpServers.postgres.command).toBe('npx');
    expect(output.mcpServers.postgres.args).toContain('@modelcontextprotocol/server-postgres');
    expect(output.mcpServers.postgres.args).toContain('postgres://localhost/db');
  });

  it('enables postgres with env-var DATABASE_URL when no inline string', () => {
    const cfg: IntegrationsConfig = { postgres: {} };
    const { output } = buildMcpJson(cfg);
    expect(output.mcpServers.postgres.args).toContain('${DATABASE_URL}');
    expect(output.mcpServers.postgres.env?.DATABASE_URL).toBe('${DATABASE_URL}');
  });

  it('skips providers with enabled=false', () => {
    const cfg: IntegrationsConfig = {
      postgres: { enabled: false, connectionString: 'x' },
      playwright: { enabled: true },
    };
    const { output, report } = buildMcpJson(cfg);
    expect(output.mcpServers.postgres).toBeUndefined();
    expect(output.mcpServers.playwright).toBeDefined();
    expect(report.enabled).toEqual(['playwright']);
    expect(report.skipped.some((s) => s.name === 'postgres')).toBe(true);
  });

  it('skips providers with missing env when skipIfEnvMissing=true', () => {
    const cfg: IntegrationsConfig = {
      sentry: {},
      playwright: {},
    };
    const { output, report } = buildMcpJson(cfg, {
      skipIfEnvMissing: true,
      env: {}, // empty env
    });
    expect(output.mcpServers.sentry).toBeUndefined();
    expect(output.mcpServers.playwright).toBeDefined(); // no env required
    expect(report.skipped.some((s) => s.name === 'sentry')).toBe(true);
    expect(report.enabled).toContain('playwright');
  });

  it('includes provider when env is present', () => {
    const cfg: IntegrationsConfig = { sentry: {} };
    const { output, report } = buildMcpJson(cfg, {
      skipIfEnvMissing: true,
      env: { SENTRY_AUTH_TOKEN: 't', SENTRY_ORG: 'o' },
    });
    expect(output.mcpServers.sentry).toBeDefined();
    expect(report.enabled).toEqual(['sentry']);
  });

  it('generates github-remote with docker + toolsets', () => {
    const cfg: IntegrationsConfig = {
      githubRemote: { toolsets: ['repos', 'issues'] },
    };
    const { output } = buildMcpJson(cfg);
    const entry = output.mcpServers['github-remote'];
    expect(entry.command).toBe('docker');
    expect(entry.args).toContain('ghcr.io/github/github-mcp-server');
    expect(entry.args.join(' ')).toContain('GITHUB_TOOLSETS=repos,issues');
    expect(entry.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('${GITHUB_PERSONAL_ACCESS_TOKEN}');
  });

  it('generates playwright with browser + headless option', () => {
    const cfg: IntegrationsConfig = {
      playwright: { browser: 'firefox', headless: false },
    };
    const { output } = buildMcpJson(cfg);
    const entry = output.mcpServers.playwright;
    expect(entry.args).toContain('--browser');
    expect(entry.args).toContain('firefox');
    expect(entry.args).toContain('--no-headless');
    expect(entry.env).toBeUndefined(); // no env vars → field omitted
  });

  it('generates slack-mcp with channel restriction', () => {
    const cfg: IntegrationsConfig = {
      slack: { channelIds: ['C123', 'C456'] },
    };
    const { output } = buildMcpJson(cfg);
    const entry = output.mcpServers['slack-mcp'];
    expect(entry.command).toBe('npx');
    expect(entry.args).toContain('@modelcontextprotocol/server-slack');
    expect(entry.env?.SLACK_CHANNEL_IDS).toBe('C123,C456');
  });

  it('handles all 5 providers enabled together', () => {
    const cfg: IntegrationsConfig = {
      postgres: { connectionString: 'p' },
      githubRemote: { token: 'gh_tok' },
      sentry: { authToken: 't', organization: 'o' },
      playwright: {},
      slack: { botToken: 'xoxb-tok', teamId: 'T123' },
    };
    const { output, report } = buildMcpJson(cfg);
    expect(report.enabled.sort()).toEqual(['github-remote', 'playwright', 'postgres', 'sentry', 'slack']);
    expect(Object.keys(output.mcpServers).sort()).toEqual(
      ['github-remote', 'playwright', 'postgres', 'sentry', 'slack-mcp']
    );
  });
});

describe('battle pack: individual adapters', () => {
  it('postgres adapter respects custom packageName', () => {
    const entry = postgresAdapter.build({ packageName: '@fork/server-postgres', connectionString: 'p' });
    expect(entry.args).toContain('@fork/server-postgres');
  });

  it('github-remote adapter respects custom image', () => {
    const entry = githubRemoteAdapter.build({ image: 'my-registry/github-mcp:v1' });
    expect(entry.args).toContain('my-registry/github-mcp:v1');
  });

  it('sentry adapter includes self-hosted host', () => {
    const entry = sentryAdapter.build({ host: 'sentry.internal.example.com' });
    expect(entry.env.SENTRY_HOST).toBe('sentry.internal.example.com');
  });

  it('playwright adapter defaults to no extra args', () => {
    const entry = playwrightAdapter.build({});
    // -y + package only
    expect(entry.args).toEqual(['-y', '@playwright/mcp@latest']);
  });

  it('slack adapter omits SLACK_CHANNEL_IDS when none provided', () => {
    const entry = slackMcpAdapter.build({ botToken: 't', teamId: 'T1' });
    expect(entry.env.SLACK_CHANNEL_IDS).toBeUndefined();
  });
});
