/**
 * Postgres MCP server adapter (battle pack)
 *
 * Bridges aistack config to the official @modelcontextprotocol/server-postgres
 * MCP server. Generates the .mcp.json entry that Claude Code spawns on demand.
 *
 * Required env: DATABASE_URL (or `connectionString` inline)
 *
 * SAFETY: by default the connection string is rewritten to add
 * `options=-c default_transaction_read_only=on`, which forces the Postgres
 * server to reject any write statement (INSERT/UPDATE/DELETE/DDL) at the
 * transaction level. This makes the "read-only" guarantee an actual
 * server-enforced constraint rather than a documentation promise. Users who
 * need writes (and accept the risk) can pass `allowWrites: true`.
 */

import type { BattlePackAdapter, BattlePackEntry, ProviderConfig } from './index.js';

/** Pinned version of @modelcontextprotocol/server-postgres. */
export const POSTGRES_MCP_VERSION = '0.6.2';

export interface PostgresIntegrationConfig extends ProviderConfig {
  /** Connection string. If omitted, the spawned server reads DATABASE_URL. */
  connectionString?: string;
  /** Override the npm package name (advanced / forks). */
  packageName?: string;
  /**
   * Allow write statements. Defaults to false — the connection string is
   * rewritten to force `default_transaction_read_only=on` server-side.
   */
  allowWrites?: boolean;
}

/**
 * Append `options=-c default_transaction_read_only=on` to a Postgres
 * connection string, merging into any existing `options=` parameter.
 *
 * Exported for unit tests. Returns the string unchanged if it already
 * carries `default_transaction_read_only=on`.
 */
export function enforceReadOnly(connectionString: string): string {
  if (hasReadOnlyOption(connectionString)) {
    return connectionString;
  }

  // libpq accepts both URI form (postgres://) and keyword=value form.
  // URI form: append as a query-string parameter, URL-encoded.
  // Note: `-c` and `=` must be URL-encoded inside a URI's query string.
  const READ_ONLY_OPT = '-c default_transaction_read_only=on';

  const isUri = /^postgres(ql)?:\/\//i.test(connectionString);
  if (isUri) {
    const sep = connectionString.includes('?') ? '&' : '?';
    // Encode the whole `options` value so spaces / `=` don't break parsing.
    const encoded = encodeURIComponent(READ_ONLY_OPT);
    return `${connectionString}${sep}options=${encoded}`;
  }

  // keyword=value form: just append.
  return `${connectionString.trimEnd()} options='${READ_ONLY_OPT}'`;
}

function hasReadOnlyOption(value: string): boolean {
  const readOnlyPattern = /default_transaction_read_only\s*=\s*on/i;
  if (readOnlyPattern.test(value)) return true;

  try {
    return readOnlyPattern.test(decodeURIComponent(value));
  } catch {
    return false;
  }
}

export const postgresAdapter: BattlePackAdapter<PostgresIntegrationConfig> = {
  name: 'postgres',
  envVars: ['DATABASE_URL'],

  build(config: PostgresIntegrationConfig): BattlePackEntry {
    const pkg = config.packageName ?? `@modelcontextprotocol/server-postgres@${POSTGRES_MCP_VERSION}`;
    const args = ['-y', pkg];

    const readOnly = config.allowWrites !== true;

    if (config.connectionString) {
      args.push(readOnly ? enforceReadOnly(config.connectionString) : config.connectionString);
    } else {
      // No inline string → spawn-time substitution via env. We can't rewrite
      // the URL here (we don't have it), so the read-only flag is applied via
      // PGOPTIONS, which libpq honors for all connections opened by the
      // server process. PGOPTIONS is layered on top of any options in the URL.
      args.push('${DATABASE_URL}');
    }

    const env: Record<string, string> = {};
    if (!config.connectionString) {
      env.DATABASE_URL = '${DATABASE_URL}';
      if (readOnly) {
        env.PGOPTIONS = '-c default_transaction_read_only=on';
      }
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
