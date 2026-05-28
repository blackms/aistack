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
import {
  enforceReadOnly,
  POSTGRES_MCP_VERSION,
} from '../../../src/integrations/postgres.js';
import { PLAYWRIGHT_MCP_VERSION } from '../../../src/integrations/playwright.js';
import { SENTRY_MCP_VERSION } from '../../../src/integrations/sentry.js';
import { GITHUB_MCP_IMAGE_TAG } from '../../../src/integrations/github-remote.js';
import {
  SLACK_MCP_VERSION,
  SLACK_WRITE_TOOLS,
} from '../../../src/integrations/slack-mcp.js';
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

  it('enables postgres with inline connection string (rewritten read-only)', () => {
    const cfg: IntegrationsConfig = {
      postgres: { connectionString: 'postgres://localhost/db' },
    };
    const { output, report } = buildMcpJson(cfg);
    expect(report.enabled).toEqual(['postgres']);
    expect(output.mcpServers.postgres.command).toBe('npx');
    expect(output.mcpServers.postgres.args).toContain(
      `@modelcontextprotocol/server-postgres@${POSTGRES_MCP_VERSION}`
    );
    const rewritten = output.mcpServers.postgres.args[output.mcpServers.postgres.args.length - 1];
    expect(rewritten).toContain('postgres://localhost/db');
    expect(rewritten).toContain('default_transaction_read_only');
  });

  it('enables postgres with env-var DATABASE_URL when no inline string (PGOPTIONS read-only)', () => {
    const cfg: IntegrationsConfig = { postgres: {} };
    const { output } = buildMcpJson(cfg);
    expect(output.mcpServers.postgres.args).toContain('${DATABASE_URL}');
    expect(output.mcpServers.postgres.env?.DATABASE_URL).toBe('${DATABASE_URL}');
    expect(output.mcpServers.postgres.env?.PGOPTIONS).toContain('default_transaction_read_only=on');
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

  it('generates github-remote with docker + toolsets (pinned image tag)', () => {
    const cfg: IntegrationsConfig = {
      githubRemote: { toolsets: ['repos', 'issues'] },
    };
    const { output } = buildMcpJson(cfg);
    const entry = output.mcpServers['github-remote'];
    expect(entry.command).toBe('docker');
    expect(entry.args).toContain(`ghcr.io/github/github-mcp-server:${GITHUB_MCP_IMAGE_TAG}`);
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

  it('generates slack-mcp with channel restriction (pinned version, writes off by default)', () => {
    const cfg: IntegrationsConfig = {
      slack: { channelIds: ['C123', 'C456'] },
    };
    const { output } = buildMcpJson(cfg);
    const entry = output.mcpServers['slack-mcp'];
    expect(entry.command).toBe('npx');
    expect(entry.args).toContain(`@modelcontextprotocol/server-slack@${SLACK_MCP_VERSION}`);
    expect(entry.env?.SLACK_CHANNEL_IDS).toBe('C123,C456');
    expect(entry.env?.SLACK_MCP_READ_ONLY).toBe('1');
    // All write tools disabled by default
    for (const tool of SLACK_WRITE_TOOLS) {
      expect(entry.disabledTools).toContain(tool);
    }
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

  it('playwright adapter defaults to no extra args (pinned version, never @latest)', () => {
    const entry = playwrightAdapter.build({});
    // -y + pinned package only
    expect(entry.args).toEqual(['-y', `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`]);
    expect(entry.args.some((a) => a.endsWith('@latest'))).toBe(false);
  });

  it('slack adapter omits SLACK_CHANNEL_IDS when none provided', () => {
    const entry = slackMcpAdapter.build({ botToken: 't', teamId: 'T1' });
    expect(entry.env.SLACK_CHANNEL_IDS).toBeUndefined();
  });

  it('sentry adapter uses a pinned npm version', () => {
    const entry = sentryAdapter.build({});
    expect(entry.args).toContain(`@sentry/mcp-server@${SENTRY_MCP_VERSION}`);
  });
});

// =============================================================================
// Fix #3: every bundled server pins its version (no `@latest`, no floating tag).
// =============================================================================

describe('battle pack: version pinning', () => {
  it('no adapter emits a floating version tag', () => {
    const cfg: IntegrationsConfig = {
      postgres: { connectionString: 'postgres://x/y' },
      githubRemote: {},
      sentry: {},
      playwright: {},
      slack: {},
    };
    const { output } = buildMcpJson(cfg);
    for (const server of Object.values(output.mcpServers)) {
      for (const arg of server.args) {
        expect(arg.endsWith('@latest')).toBe(false);
        // Docker images must carry an explicit `:vX.Y.Z` tag, never bare or `:latest`.
        if (arg.includes('ghcr.io/') || arg.includes('docker.io/')) {
          expect(arg).toMatch(/:v?\d+\.\d+\.\d+/);
        }
      }
    }
  });
});

// =============================================================================
// Fix #2: Postgres read-only enforcement.
// =============================================================================

describe('battle pack: postgres read-only enforcement', () => {
  it('appends default_transaction_read_only=on to URI connection strings', () => {
    const rewritten = enforceReadOnly('postgres://u:p@h:5432/db');
    expect(rewritten).toMatch(/^postgres:\/\/u:p@h:5432\/db\?options=/);
    expect(decodeURIComponent(rewritten)).toContain('default_transaction_read_only=on');
  });

  it('uses & when the URI already has a query string', () => {
    const rewritten = enforceReadOnly('postgres://h/db?sslmode=require');
    expect(rewritten).toContain('?sslmode=require&options=');
    expect(decodeURIComponent(rewritten)).toContain('default_transaction_read_only=on');
  });

  it('uses keyword-form for libpq keyword=value strings', () => {
    const rewritten = enforceReadOnly('host=h port=5432 dbname=db');
    expect(rewritten).toBe(
      `host=h port=5432 dbname=db options='-c default_transaction_read_only=on'`
    );
  });

  it('is idempotent when already read-only', () => {
    const already = 'postgres://h/db?options=-c%20default_transaction_read_only%3Don';
    expect(enforceReadOnly(already)).toBe(already);
  });

  it('allowWrites:true preserves the original connection string', () => {
    const cfg: IntegrationsConfig = {
      postgres: { connectionString: 'postgres://h/db', allowWrites: true },
    };
    const { output } = buildMcpJson(cfg);
    const lastArg = output.mcpServers.postgres.args[output.mcpServers.postgres.args.length - 1];
    expect(lastArg).toBe('postgres://h/db');
    expect(output.mcpServers.postgres.env?.PGOPTIONS).toBeUndefined();
  });
});

// =============================================================================
// Fix #4: Slack write tools require explicit opt-in.
// =============================================================================

describe('battle pack: slack write opt-in', () => {
  it('disables all write tools when slack config is empty', () => {
    const cfg: IntegrationsConfig = { slack: {} };
    const { output } = buildMcpJson(cfg);
    const entry = output.mcpServers['slack-mcp'];
    expect(entry.disabledTools).toEqual([...SLACK_WRITE_TOOLS]);
    expect(entry.env?.SLACK_MCP_READ_ONLY).toBe('1');
  });

  it('disables writes when enableWrites is omitted but other fields set', () => {
    const cfg: IntegrationsConfig = {
      slack: { botToken: 'xoxb', teamId: 'T1', channelIds: ['C1'] },
    };
    const { output } = buildMcpJson(cfg);
    expect(output.mcpServers['slack-mcp'].disabledTools).toEqual([...SLACK_WRITE_TOOLS]);
  });

  it('disables writes when enableWrites is explicitly false', () => {
    const cfg: IntegrationsConfig = { slack: { enableWrites: false } };
    const { output } = buildMcpJson(cfg);
    expect(output.mcpServers['slack-mcp'].disabledTools).toEqual([...SLACK_WRITE_TOOLS]);
  });

  it('enables writes only when enableWrites is exactly true', () => {
    const cfg: IntegrationsConfig = { slack: { enableWrites: true } };
    const { output } = buildMcpJson(cfg);
    const entry = output.mcpServers['slack-mcp'];
    // disabledTools is empty → omitted from .mcp.json entry
    expect(entry.disabledTools).toBeUndefined();
    expect(entry.env?.SLACK_MCP_READ_ONLY).toBeUndefined();
  });
});
