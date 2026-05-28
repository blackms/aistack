/**
 * GitHub remote MCP server adapter (battle pack)
 *
 * Bridges aistack config to the official github/github-mcp-server.
 * Distinct from src/github/client.ts (which is a local gh-cli/REST wrapper):
 * this exposes the full remote GitHub API (issues, PRs, code search, actions)
 * as tools to Claude Code via MCP.
 *
 * Required env: GITHUB_PERSONAL_ACCESS_TOKEN (or `token` inline — discouraged)
 */

import type { BattlePackAdapter, BattlePackEntry, ProviderConfig } from './index.js';

/** Pinned image tag for github/github-mcp-server. Bump deliberately, never `latest`. */
export const GITHUB_MCP_IMAGE_TAG = 'v1.0.5';

export interface GithubRemoteIntegrationConfig extends ProviderConfig {
  /** Personal access token. Prefer env var GITHUB_PERSONAL_ACCESS_TOKEN. */
  token?: string;
  /** Restrict toolsets exposed (e.g. ['repos', 'issues', 'pull_requests']). */
  toolsets?: string[];
  /** Override the docker image (default ghcr.io/github/github-mcp-server). */
  image?: string;
}

export const githubRemoteAdapter: BattlePackAdapter<GithubRemoteIntegrationConfig> = {
  name: 'github-remote',
  envVars: ['GITHUB_PERSONAL_ACCESS_TOKEN'],

  build(config: GithubRemoteIntegrationConfig): BattlePackEntry {
    const image = config.image ?? `ghcr.io/github/github-mcp-server:${GITHUB_MCP_IMAGE_TAG}`;
    const args = [
      'run', '-i', '--rm',
      '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN',
    ];
    if (config.toolsets && config.toolsets.length > 0) {
      args.push('-e', `GITHUB_TOOLSETS=${config.toolsets.join(',')}`);
    }
    args.push(image);

    return {
      name: 'github-remote',
      type: 'stdio',
      command: 'docker',
      args,
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: config.token ?? '${GITHUB_PERSONAL_ACCESS_TOKEN}',
      },
    };
  },
};
