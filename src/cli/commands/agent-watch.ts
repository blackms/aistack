/**
 * Agent watch command - Monitor agent activity in real-time
 */

import type { AgentStackConfig, SpawnedAgent, AgentStatus } from '../../types.js';
import { listAgents, getConcurrencyStats } from '../../agents/spawner.js';
import { WatchRenderer, type AgentWatchData } from '../utils/watch-renderer.js';
import { hideCursor, showCursor, clearScreen } from '../utils/terminal.js';

export interface AgentWatchOptions {
  interval: string;
  session?: string;
  type?: string;
  status?: string;
  json: boolean;
  clear: boolean;
}

/**
 * Run the agent watch command
 */
export async function runAgentWatch(
  options: AgentWatchOptions,
  _config: AgentStackConfig
): Promise<void> {
  const interval = parseInt(options.interval, 10) * 1000;

  if (isNaN(interval) || interval < 1000) {
    console.error('Error: Interval must be at least 1 second');
    process.exit(1);
  }

  // JSON mode - single snapshot
  if (options.json) {
    const data = collectAgentData(options);
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Interactive watch mode
  const renderer = new WatchRenderer({
    clearScreen: options.clear,
  });

  // Setup cleanup handler
  let running = true;
  const cleanup = (): void => {
    running = false;
    showCursor();
    // Don't clear screen on exit - preserve output for user reference
    console.log('\nWatch stopped.');
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Hide cursor during watch mode
  hideCursor();

  // Initial render
  try {
    const data = collectAgentData(options);
    renderer.render(data);
  } catch (error) {
    showCursor();
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  // Set up refresh interval
  const intervalId = setInterval(() => {
    if (!running) {
      clearInterval(intervalId);
      return;
    }

    try {
      const data = collectAgentData(options);
      renderer.render(data);
    } catch (error) {
      // Log error but continue watching
      console.error(`Refresh error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, interval);
}

/**
 * Collect agent data for display
 */
function collectAgentData(options: AgentWatchOptions): AgentWatchData {
  // Get all agents, optionally filtered by session
  let agents = listAgents(options.session);

  // Filter by type
  if (options.type) {
    agents = agents.filter((agent) => agent.type === options.type);
  }

  // Filter by status
  if (options.status) {
    agents = agents.filter((agent) => agent.status === options.status);
  }

  // Get concurrency stats
  const concurrencyStats = getConcurrencyStats();

  // Calculate status counts
  const byStatus = countByStatus(agents);

  return {
    agents,
    stats: {
      active: concurrencyStats.agents.active,
      maxConcurrent: concurrencyStats.agents.maxConcurrent,
      byStatus,
    },
  };
}

/**
 * Count agents by status
 */
function countByStatus(agents: SpawnedAgent[]): Record<AgentStatus, number> {
  const counts: Record<AgentStatus, number> = {
    idle: 0,
    running: 0,
    completed: 0,
    failed: 0,
    stopped: 0,
  };

  for (const agent of agents) {
    counts[agent.status] = (counts[agent.status] || 0) + 1;
  }

  return counts;
}
