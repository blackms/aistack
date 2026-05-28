/**
 * Sentry MCP server adapter (battle pack)
 *
 * Bridges aistack config to @sentry/mcp-server. Enables feedback-loop agents
 * (e.g. incident-responder) to query production errors directly.
 *
 * Required env: SENTRY_AUTH_TOKEN, SENTRY_ORG (optional: SENTRY_HOST for self-hosted)
 */

import type { BattlePackAdapter, BattlePackEntry, ProviderConfig } from './index.js';

export interface SentryIntegrationConfig extends ProviderConfig {
  /** Sentry auth token (User Auth Token or Internal Integration). */
  authToken?: string;
  /** Organization slug, e.g. "my-org". */
  organization?: string;
  /** Self-hosted host override (default: sentry.io). */
  host?: string;
  /** Override the npm package name. */
  packageName?: string;
}

export const sentryAdapter: BattlePackAdapter<SentryIntegrationConfig> = {
  name: 'sentry',
  envVars: ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG'],

  build(config: SentryIntegrationConfig): BattlePackEntry {
    const pkg = config.packageName ?? '@sentry/mcp-server';

    const env: Record<string, string> = {
      SENTRY_AUTH_TOKEN: config.authToken ?? '${SENTRY_AUTH_TOKEN}',
      SENTRY_ORG: config.organization ?? '${SENTRY_ORG}',
    };
    if (config.host) {
      env.SENTRY_HOST = config.host;
    }

    return {
      name: 'sentry',
      type: 'stdio',
      command: 'npx',
      args: ['-y', pkg],
      env,
    };
  },
};
