/**
 * Playwright MCP server adapter (battle pack)
 *
 * Bridges aistack config to @playwright/mcp (Microsoft official).
 * No credentials required. Exposes browser automation tools to agents
 * (e.g. browser-tester) for end-to-end testing and scraping.
 */

import type { BattlePackAdapter, BattlePackEntry, ProviderConfig } from './index.js';

/** Pinned version of @playwright/mcp. Bump deliberately, never `latest`. */
export const PLAYWRIGHT_MCP_VERSION = '0.0.75';

export interface PlaywrightIntegrationConfig extends ProviderConfig {
  /** Browser channel: 'chromium' | 'firefox' | 'webkit'. */
  browser?: 'chromium' | 'firefox' | 'webkit';
  /** Run browser in headless mode (default: true). */
  headless?: boolean;
  /** Persisted user-data dir for session reuse. */
  userDataDir?: string;
  /** Override the npm package name (advanced; bypasses the pinned version). */
  packageName?: string;
}

export const playwrightAdapter: BattlePackAdapter<PlaywrightIntegrationConfig> = {
  name: 'playwright',
  envVars: [],

  build(config: PlaywrightIntegrationConfig): BattlePackEntry {
    const pkg = config.packageName ?? `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`;
    const args = ['-y', pkg];
    if (config.browser) {
      args.push('--browser', config.browser);
    }
    if (config.headless === false) {
      args.push('--no-headless');
    }
    if (config.userDataDir) {
      args.push('--user-data-dir', config.userDataDir);
    }

    return {
      name: 'playwright',
      type: 'stdio',
      command: 'npx',
      args,
      env: {},
    };
  },
};
