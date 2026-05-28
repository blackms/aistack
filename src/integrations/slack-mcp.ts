/**
 * Slack MCP server adapter (battle pack)
 *
 * Bridges aistack config to @modelcontextprotocol/server-slack. Distinct from
 * src/integrations/slack.ts (one-way webhook notifier): this exposes the full
 * Slack Web API (channels, messages, search, users) as MCP tools, enabling
 * bidirectional flows.
 *
 * Required env: SLACK_BOT_TOKEN, SLACK_TEAM_ID
 *
 * SAFETY: write tools (post_message, reply, reaction, post_to_user) are NOT
 * exposed unless the user opts in with `enableWrites: true`. By default we
 * emit an explicit `disabledTools` allow-list into the .mcp.json entry,
 * which aistack also enforces in its tool-call interceptor (see
 * src/coordination/mcp-tool-policy.ts when wired). Without opt-in, agents
 * get a read-only Slack surface — safe for triage / search.
 */

import type { BattlePackAdapter, BattlePackEntry, ProviderConfig } from './index.js';

/** Pinned version of @modelcontextprotocol/server-slack. */
export const SLACK_MCP_VERSION = '2025.4.25';

/**
 * Tools exposed by @modelcontextprotocol/server-slack that mutate state.
 * Exported so consumers (tests, policy layer) can reason about the set.
 */
export const SLACK_WRITE_TOOLS = [
  'slack_post_message',
  'slack_reply_to_thread',
  'slack_add_reaction',
  'slack_post_to_user',
] as const;

export interface SlackMcpIntegrationConfig extends ProviderConfig {
  /** Slack bot token (xoxb-...). */
  botToken?: string;
  /** Slack team / workspace ID (T...). */
  teamId?: string;
  /** Comma-separated channel IDs to restrict tool access to. */
  channelIds?: string[];
  /** Override the npm package name (advanced; bypasses the pinned version). */
  packageName?: string;
  /**
   * Allow write tools (post_message, reply, reaction, post_to_user).
   * Defaults to false. Must be set to `true` explicitly to enable —
   * `slack: {}` alone gives you a read-only Slack surface.
   */
  enableWrites?: boolean;
}

export const slackMcpAdapter: BattlePackAdapter<SlackMcpIntegrationConfig> = {
  name: 'slack',
  envVars: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],

  build(config: SlackMcpIntegrationConfig): BattlePackEntry {
    const pkg = config.packageName ?? `@modelcontextprotocol/server-slack@${SLACK_MCP_VERSION}`;

    const env: Record<string, string> = {
      SLACK_BOT_TOKEN: config.botToken ?? '${SLACK_BOT_TOKEN}',
      SLACK_TEAM_ID: config.teamId ?? '${SLACK_TEAM_ID}',
    };
    if (config.channelIds && config.channelIds.length > 0) {
      env.SLACK_CHANNEL_IDS = config.channelIds.join(',');
    }

    const writesAllowed = config.enableWrites === true;
    if (!writesAllowed) {
      // Hint to the server (some forks honor this) and document intent in env.
      env.SLACK_MCP_READ_ONLY = '1';
    }

    return {
      name: 'slack-mcp',
      type: 'stdio',
      command: 'npx',
      args: ['-y', pkg],
      env,
      // Emitted into .mcp.json so the MCP host / aistack policy layer can
      // reject calls to these tools. Empty array when writes are enabled.
      disabledTools: writesAllowed ? [] : [...SLACK_WRITE_TOOLS],
    };
  },
};
