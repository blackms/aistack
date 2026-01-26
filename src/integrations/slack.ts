/**
 * Slack integration for team notifications
 */

import { logger } from '../utils/logger.js';

const log = logger.child('slack');

export interface SlackConfig {
  enabled: boolean;
  webhookUrl?: string;
  channel?: string;
  username?: string;
  iconEmoji?: string;
}

export interface SlackMessage {
  text?: string;
  blocks?: SlackBlock[];
  channel?: string;
  username?: string;
  icon_emoji?: string;
}

export interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
  };
  fields?: Array<{
    type: string;
    text: string;
  }>;
  accessory?: unknown;
}

export class SlackIntegration {
  private config: SlackConfig;

  constructor(config: SlackConfig) {
    this.config = config;
  }

  isEnabled(): boolean {
    return this.config.enabled && !!this.config.webhookUrl;
  }

  async sendMessage(message: SlackMessage): Promise<boolean> {
    if (!this.isEnabled()) {
      log.debug('Slack integration is disabled');
      return false;
    }

    try {
      const payload = {
        ...message,
        channel: message.channel || this.config.channel,
        username: message.username || this.config.username || 'AgentStack Bot',
        icon_emoji: message.icon_emoji || this.config.iconEmoji || ':robot_face:',
      };

      const response = await fetch(this.config.webhookUrl!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        log.error('Failed to send Slack message', { status: response.status, error: text });
        return false;
      }

      log.debug('Slack message sent successfully');
      return true;
    } catch (error) {
      log.error('Error sending Slack message', { error });
      return false;
    }
  }

  async sendAgentSpawned(agentType: string, agentId: string): Promise<void> {
    await this.sendMessage({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:rocket: *Agent Spawned*\nType: \`${agentType}\`\nID: \`${agentId.slice(0, 8)}\``,
          },
        },
      ],
    });
  }

  async sendAgentStopped(agentId: string): Promise<void> {
    await this.sendMessage({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:octagonal_sign: *Agent Stopped*\nID: \`${agentId.slice(0, 8)}\``,
          },
        },
      ],
    });
  }

  async sendAgentError(agentId: string, error: string): Promise<void> {
    await this.sendMessage({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:x: *Agent Error*\nID: \`${agentId.slice(0, 8)}\`\nError: ${error}`,
          },
        },
      ],
    });
  }

  async sendWorkflowStarted(workflowId: string, workflowName: string): Promise<void> {
    await this.sendMessage({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:arrow_forward: *Workflow Started*\nName: *${workflowName}*\nID: \`${workflowId.slice(0, 8)}\``,
          },
        },
      ],
    });
  }

  async sendWorkflowCompleted(workflowId: string, workflowName: string, duration?: number): Promise<void> {
    const durationText = duration ? `\nDuration: ${Math.round(duration / 1000)}s` : '';
    await this.sendMessage({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:white_check_mark: *Workflow Completed*\nName: *${workflowName}*\nID: \`${workflowId.slice(0, 8)}\`${durationText}`,
          },
        },
      ],
    });
  }

  async sendWorkflowError(workflowId: string, workflowName: string, error: string): Promise<void> {
    await this.sendMessage({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:x: *Workflow Error*\nName: *${workflowName}*\nID: \`${workflowId.slice(0, 8)}\`\nError: ${error}`,
          },
        },
      ],
    });
  }

  async sendReviewLoopStarted(loopId: string, coderId: string, adversarialId: string): Promise<void> {
    await this.sendMessage({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:loop: *Review Loop Started*\nLoop ID: \`${loopId.slice(0, 8)}\`\nCoder: \`${coderId.slice(0, 8)}\`\nReviewer: \`${adversarialId.slice(0, 8)}\``,
          },
        },
      ],
    });
  }

  async sendReviewLoopApproved(loopId: string, iteration: number): Promise<void> {
    await this.sendMessage({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:white_check_mark: *Code Approved*\nLoop ID: \`${loopId.slice(0, 8)}\`\nIteration: ${iteration}`,
          },
        },
      ],
    });
  }

  async sendReviewLoopCompleted(loopId: string, iterations: number, approved: boolean): Promise<void> {
    const status = approved ? ':white_check_mark: Approved' : ':x: Not Approved';
    await this.sendMessage({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:checkered_flag: *Review Loop Completed*\nLoop ID: \`${loopId.slice(0, 8)}\`\nIterations: ${iterations}\nStatus: ${status}`,
          },
        },
      ],
    });
  }

  async sendTaskCompleted(taskId: string, agentType: string): Promise<void> {
    await this.sendMessage({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:white_check_mark: *Task Completed*\nAgent Type: \`${agentType}\`\nTask ID: \`${taskId.slice(0, 8)}\``,
          },
        },
      ],
    });
  }

  async sendTaskFailed(taskId: string, agentType: string, error: string): Promise<void> {
    await this.sendMessage({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:x: *Task Failed*\nAgent Type: \`${agentType}\`\nTask ID: \`${taskId.slice(0, 8)}\`\nError: ${error}`,
          },
        },
      ],
    });
  }

  async sendCustomMessage(title: string, message: string, level: 'info' | 'success' | 'warning' | 'error' = 'info'): Promise<void> {
    const emoji = {
      info: ':information_source:',
      success: ':white_check_mark:',
      warning: ':warning:',
      error: ':x:',
    }[level];

    await this.sendMessage({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${emoji} *${title}*\n${message}`,
          },
        },
      ],
    });
  }
}

// Singleton instance
let instance: SlackIntegration | null = null;

export function getSlackIntegration(config?: SlackConfig): SlackIntegration {
  if (!instance && config) {
    instance = new SlackIntegration(config);
  }
  if (!instance) {
    throw new Error('Slack integration not initialized');
  }
  return instance;
}

export function resetSlackIntegration(): void {
  instance = null;
}
