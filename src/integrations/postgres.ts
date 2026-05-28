/**
 * Postgres MCP server adapter (battle pack)
 *
 * Bridges aistack config to the official @modelcontextprotocol/server-postgres
 * MCP server. Generates the .mcp.json entry that Claude Code spawns on demand.
 *
 * Required env: DATABASE_URL (or `connectionString` inline)
 */

import type { BattlePackAdapter, BattlePackEntry, ProviderConfig } from './index.js';

export interface PostgresIntegrationConfig extends ProviderConfig {
  /** Connection string. If omitted, the spawned server reads DATABASE_URL. */
  connectionString?: string;
  /** Override the npm package name (advanced / forks). */
  packageName?: string;
}

export const postgresAdapter: BattlePackAdapter<PostgresIntegrationConfig> = {
  name: 'postgres',
  envVars: ['DATABASE_URL'],

  build(config: PostgresIntegrationConfig): BattlePackEntry {
    const pkg = config.packageName ?? '@modelcontextprotocol/server-postgres';
    const args = ['-y', pkg];
    if (config.connectionString) {
      args.push(config.connectionString);
    } else {
      args.push('${DATABASE_URL}');
    }

    const env: Record<string, string> = {};
    // DATABASE_URL must be present at server-spawn time when no inline string.
    if (!config.connectionString) {
      env.DATABASE_URL = '${DATABASE_URL}';
    }

    return {
      name: 'postgres',
      type: 'stdio',
      command: 'npx',
      args,
      env,
    };
  },
};
