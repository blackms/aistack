/**
 * Watch display renderer for agent monitoring
 */

import type { SpawnedAgent, AgentStatus } from '../../types.js';
import {
  colors,
  formatDuration,
  formatTime,
  statusIcon,
  statusColor,
  statusLabel,
  padToWidth,
  clearScreen,
} from './terminal.js';

export interface AgentWatchData {
  agents: SpawnedAgent[];
  stats: {
    active: number;
    maxConcurrent: number;
    byStatus: Record<AgentStatus, number>;
  };
}

export interface WatchRendererOptions {
  clearScreen: boolean;
}

/**
 * Renderer for the agent watch display
 */
export class WatchRenderer {
  private options: WatchRendererOptions;

  constructor(options: Partial<WatchRendererOptions> = {}) {
    this.options = {
      clearScreen: options.clearScreen ?? true,
    };
  }

  /**
   * Render the full watch display
   */
  render(data: AgentWatchData): void {
    if (this.options.clearScreen) {
      clearScreen();
    }

    this.renderHeader();
    this.renderSummary(data);
    this.renderAgentTable(data.agents);
    this.renderFooter();
  }

  /**
   * Render header with timestamp
   */
  private renderHeader(): void {
    const title = 'AISTACK Agent Monitor';
    const timestamp = `Last updated: ${formatTime()}`;
    const width = 75;

    // Title line with timestamp right-aligned
    const padding = width - title.length - timestamp.length;
    console.log(
      `${colors.bold}${title}${colors.reset}${' '.repeat(Math.max(1, padding))}${colors.dim}${timestamp}${colors.reset}`
    );

    // Double line separator
    console.log('\u2550'.repeat(width));
  }

  /**
   * Render agent count summary
   */
  private renderSummary(data: AgentWatchData): void {
    const { stats } = data;
    const statusCounts: string[] = [];

    // Build status breakdown
    const statusOrder: AgentStatus[] = ['running', 'idle', 'failed', 'completed', 'stopped'];
    for (const status of statusOrder) {
      const count = stats.byStatus[status] || 0;
      if (count > 0) {
        statusCounts.push(`${count} ${status}`);
      }
    }

    const breakdown = statusCounts.length > 0 ? ` (${statusCounts.join(', ')})` : '';
    const agentInfo = `Agents: ${colors.bold}${stats.active}${colors.reset} active${breakdown}`;
    const limitInfo = `${colors.dim}Limit: ${stats.maxConcurrent}${colors.reset}`;

    const width = 75;
    const padding = width - stripAnsi(agentInfo).length - stripAnsi(limitInfo).length;

    console.log(`${agentInfo}${' '.repeat(Math.max(1, padding))}${limitInfo}`);

    // Single line separator
    console.log('\u2500'.repeat(width));
  }

  /**
   * Render agent list table
   */
  private renderAgentTable(agents: SpawnedAgent[]): void {
    if (agents.length === 0) {
      console.log(`${colors.dim}No active agents${colors.reset}`);
      console.log('');
      console.log(`${colors.dim}Spawn agents with: aistack agent spawn -t <type>${colors.reset}`);
      return;
    }

    // Table header
    console.log(
      `${colors.dim}STATUS   NAME                 TYPE         UPTIME     TASK${colors.reset}`
    );

    // Sort agents: running first, then by creation time
    const sortedAgents = [...agents].sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (a.status !== 'running' && b.status === 'running') return 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    for (const agent of sortedAgents) {
      this.renderAgentRow(agent);
    }
  }

  /**
   * Render a single agent row
   */
  private renderAgentRow(agent: SpawnedAgent): void {
    const color = statusColor(agent.status);
    const icon = statusIcon(agent.status);
    const label = statusLabel(agent.status);
    const uptime = formatDuration(Date.now() - agent.createdAt.getTime());
    const task = this.getAgentTask(agent);

    // Format: icon label  name  type  uptime  task
    const statusCol = `${color}${icon} ${label}${colors.reset}`;
    const nameCol = padToWidth(agent.name, 20);
    const typeCol = padToWidth(agent.type, 12);
    const uptimeCol = padToWidth(uptime, 10);
    const taskCol = task;

    console.log(`${statusCol}  ${nameCol} ${typeCol} ${uptimeCol} ${taskCol}`);
  }

  /**
   * Get task description for agent
   */
  private getAgentTask(agent: SpawnedAgent): string {
    // Check metadata for current task
    const activity = agent.metadata?.activity as { currentTask?: string } | undefined;
    if (activity?.currentTask) {
      return activity.currentTask;
    }

    // Default based on status
    switch (agent.status) {
      case 'running':
        return `${colors.dim}Processing...${colors.reset}`;
      case 'failed':
        const error = agent.metadata?.lastError as string | undefined;
        return error ? `${colors.red}Error: ${error}${colors.reset}` : `${colors.red}Error${colors.reset}`;
      case 'idle':
        return `${colors.dim}\u2014${colors.reset}`; // em dash
      case 'completed':
        return `${colors.green}Done${colors.reset}`;
      case 'stopped':
        return `${colors.dim}Stopped${colors.reset}`;
      default:
        return `${colors.dim}\u2014${colors.reset}`;
    }
  }

  /**
   * Render footer
   */
  private renderFooter(): void {
    console.log('\u2500'.repeat(75));
    console.log(`${colors.dim}Press Ctrl+C to exit${colors.reset}`);
  }
}

/**
 * Strip ANSI codes from string (for length calculation)
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}
