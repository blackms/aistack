/**
 * Battle pack: top-5 MCP server integrations
 *
 * Auto-wires Postgres, GitHub remote, Sentry, Playwright and Slack MCP servers
 * by generating a Claude Code `.mcp.json` file from the `integrations` section
 * of `aistack.config.json`.
 *
 * Design choice: bridge-sync (no process spawning). aistack writes a config
 * file; Claude Code spawns the MCP server processes on demand. This keeps the
 * aistack process surface small and lets users continue using `claude mcp list`
 * to inspect what is wired up.
 *
 * Also re-exports the legacy Slack webhook notifier from ./slack and
 * ./slack-notifier for backward compatibility.
 */

import type { AgentStackConfig, IntegrationsConfig } from '../types.js';
import { logger } from '../utils/logger.js';
import { postgresAdapter, type PostgresIntegrationConfig } from './postgres.js';
import { githubRemoteAdapter, type GithubRemoteIntegrationConfig } from './github-remote.js';
import { sentryAdapter, type SentryIntegrationConfig } from './sentry.js';
import { playwrightAdapter, type PlaywrightIntegrationConfig } from './playwright.js';
import { slackMcpAdapter, type SlackMcpIntegrationConfig } from './slack-mcp.js';

const log = logger.child('integrations');

// ============================================================================
// Public types (kept here so adapters can import without circular deps)
// ============================================================================

/** Shared base for any battle-pack provider config. */
export interface ProviderConfig {
  enabled?: boolean;
}

/** One entry of a generated `.mcp.json` `mcpServers` map. */
export interface BattlePackEntry {
  name: string;
  type: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
  /**
   * Optional allow-list of tool names the host / policy layer must reject.
   * Used by adapters that expose dangerous capabilities (e.g. Slack writes)
   * to enforce "no auto-enable" without disabling the server entirely.
   * Omitted from `.mcp.json` when empty.
   */
  disabledTools?: string[];
}

/** Adapter contract: every provider exposes its env vars + a builder. */
export interface BattlePackAdapter<TConfig extends ProviderConfig = ProviderConfig> {
  name: string;
  envVars: string[];
  build(config: TConfig): BattlePackEntry;
}

/** Final shape written to `.mcp.json`. */
export interface McpJsonOutput {
  mcpServers: Record<string, {
    type: 'stdio';
    command: string;
    args: string[];
    env?: Record<string, string>;
    /** Tool names the host / policy layer must reject. */
    disabledTools?: string[];
  }>;
}

// Re-exports
export { postgresAdapter } from './postgres.js';
export { githubRemoteAdapter } from './github-remote.js';
export { sentryAdapter } from './sentry.js';
export { playwrightAdapter } from './playwright.js';
export { slackMcpAdapter } from './slack-mcp.js';
export type { PostgresIntegrationConfig } from './postgres.js';
export type { GithubRemoteIntegrationConfig } from './github-remote.js';
export type { SentryIntegrationConfig } from './sentry.js';
export type { PlaywrightIntegrationConfig } from './playwright.js';
export type { SlackMcpIntegrationConfig } from './slack-mcp.js';

// Backward-compat: legacy webhook integration lives at ./slack
export { SlackIntegration, getSlackIntegration, resetSlackIntegration } from './slack.js';
export type { SlackConfig, SlackMessage } from './slack.js';
export { SlackNotifier, getSlackNotifier, resetSlackNotifier } from './slack-notifier.js';

// ============================================================================
// Registry
// ============================================================================

interface AdapterBinding {
  adapter: BattlePackAdapter<ProviderConfig>;
  configKey: keyof IntegrationsConfig;
}

const REGISTRY: AdapterBinding[] = [
  { adapter: postgresAdapter as BattlePackAdapter<ProviderConfig>, configKey: 'postgres' },
  { adapter: githubRemoteAdapter as BattlePackAdapter<ProviderConfig>, configKey: 'githubRemote' },
  { adapter: sentryAdapter as BattlePackAdapter<ProviderConfig>, configKey: 'sentry' },
  { adapter: playwrightAdapter as BattlePackAdapter<ProviderConfig>, configKey: 'playwright' },
  { adapter: slackMcpAdapter as BattlePackAdapter<ProviderConfig>, configKey: 'slack' },
];

export interface BuildOptions {
  /** When true, skip providers that have any missing required env var. */
  skipIfEnvMissing?: boolean;
  /** Process.env-like map to check (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
}

export interface BuildReport {
  enabled: string[];
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * Build a `.mcp.json` payload from an aistack config's `integrations` section.
 * Pure function: no side effects, safe to unit-test.
 */
export function buildMcpJson(
  integrations: IntegrationsConfig | undefined,
  options: BuildOptions = {}
): { output: McpJsonOutput; report: BuildReport } {
  const env = options.env ?? process.env;
  const output: McpJsonOutput = { mcpServers: {} };
  const report: BuildReport = { enabled: [], skipped: [] };

  if (!integrations) {
    return { output, report };
  }

  for (const { adapter, configKey } of REGISTRY) {
    const cfg = integrations[configKey] as ProviderConfig | undefined;
    if (!cfg) continue;
    if (cfg.enabled === false) {
      report.skipped.push({ name: adapter.name, reason: 'disabled in config' });
      continue;
    }

    if (options.skipIfEnvMissing && adapter.envVars.length > 0) {
      const missing = adapter.envVars.filter((v) => !env[v]);
      if (missing.length > 0) {
        report.skipped.push({
          name: adapter.name,
          reason: `missing env vars: ${missing.join(', ')}`,
        });
        continue;
      }
    }

    const entry = adapter.build(cfg);
    output.mcpServers[entry.name] = {
      type: entry.type,
      command: entry.command,
      args: entry.args,
      ...(Object.keys(entry.env).length > 0 ? { env: entry.env } : {}),
      ...(entry.disabledTools && entry.disabledTools.length > 0
        ? { disabledTools: entry.disabledTools }
        : {}),
    };
    report.enabled.push(adapter.name);
  }

  return { output, report };
}

/**
 * Boot integrations: invoked from CLI / runtime hooks. Currently a pure logger
 * — actual MCP server spawning is delegated to Claude Code via `.mcp.json`.
 * This is the auto-discovery entrypoint described in the acceptance criteria.
 */
export function bootIntegrations(config: AgentStackConfig): BuildReport {
  const { report } = buildMcpJson(config.integrations, { skipIfEnvMissing: true });
  if (report.enabled.length > 0) {
    log.info('Battle pack integrations available', { providers: report.enabled });
  }
  if (report.skipped.length > 0) {
    log.debug('Battle pack integrations skipped', { skipped: report.skipped });
  }
  return report;
}

/** Exposed for CLI: list adapters and their required env vars. */
export function listBattlePackAdapters(): Array<{ name: string; envVars: string[] }> {
  return REGISTRY.map(({ adapter }) => ({
    name: adapter.name,
    envVars: adapter.envVars,
  }));
}
