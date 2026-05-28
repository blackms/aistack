/**
 * Slack MCP server adapter (battle pack)
 *
 * Bridges aistack config to @modelcontextprotocol/server-slack. Distinct from
 * src/integrations/slack.ts (one-way webhook notifier): this exposes the full
 * Slack Web API (channels, messages, search, users) as MCP tools, enabling
 * bidirectional flows.
 *
 * Required env: SLACK_BOT_TOKEN, SLACK_TEAM_ID
 */

import type { BattlePackAdapter, BattlePackEntry, ProviderConfig } from './index.js';

export interface SlackMcpIntegrationConfig extends ProviderConfig {
  /** Slack bot token (xoxb-...). */
  botToken?: string;
  /** Slack team / workspace ID (T...). */
  teamId?: string;
  /** Comma-separated channel IDs to restrict tool access to. */
  channelIds?: string[];
  /** Override the npm package name. */
  packageName?: string;
}

export const slackMcpAdapter: BattlePackAdapter<SlackMcpIntegrationConfig> = {
  name: 'slack',
  envVars: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],

  build(config: SlackMcpIntegrationConfig): BattlePackEntry {
    const pkg = config.packageName ?? '@modelcontextprotocol/server-slack';

    const env: Record<string, string> = {
      SLACK_BOT_TOKEN: config.botToken ?? '${SLACK_BOT_TOKEN}',
      SLACK_TEAM_ID: config.teamId ?? '${SLACK_TEAM_ID}',
    };
    if (config.channelIds && config.channelIds.length > 0) {
      env.SLACK_CHANNEL_IDS = config.channelIds.join(',');
    }

    return {
      name: 'slack-mcp',
      type: 'stdio',
      command: 'npx',
      args: ['-y', pkg],
      env,
    };
  },
};
