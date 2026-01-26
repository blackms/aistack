/**
 * Slack notification handler that listens to system events
 */

import type { AgentStackConfig } from '../types.js';
import { getSlackIntegration } from './slack.js';
import { logger } from '../utils/logger.js';

const log = logger.child('slack-notifier');

export class SlackNotifier {
  private config: AgentStackConfig;

  constructor(config: AgentStackConfig) {
    this.config = config;
  }

  /**
   * Initialize Slack integration and set up event listeners
   */
  initialize(): void {
    if (!this.config.slack.enabled) {
      log.debug('Slack integration is disabled');
      return;
    }

    try {
      getSlackIntegration(this.config.slack);
      log.info('Slack notifier initialized');
    } catch (error) {
      log.error('Failed to initialize Slack integration', { error });
    }
  }

  /**
   * Handle agent spawned event
   */
  async onAgentSpawned(agentType: string, agentId: string): Promise<void> {
    if (!this.config.slack.enabled || !this.config.slack.notifyOnAgentSpawn) {
      return;
    }

    try {
      const slack = getSlackIntegration();
      await slack.sendAgentSpawned(agentType, agentId);
    } catch (error) {
      log.error('Failed to send agent spawned notification', { error });
    }
  }

  /**
   * Handle agent stopped event
   */
  async onAgentStopped(agentId: string): Promise<void> {
    if (!this.config.slack.enabled) {
      return;
    }

    try {
      const slack = getSlackIntegration();
      await slack.sendAgentStopped(agentId);
    } catch (error) {
      log.error('Failed to send agent stopped notification', { error });
    }
  }

  /**
   * Handle agent error event
   */
  async onAgentError(agentId: string, error: string): Promise<void> {
    if (!this.config.slack.enabled || !this.config.slack.notifyOnErrors) {
      return;
    }

    try {
      const slack = getSlackIntegration();
      await slack.sendAgentError(agentId, error);
    } catch (err) {
      log.error('Failed to send agent error notification', { error: err });
    }
  }

  /**
   * Handle workflow started event
   */
  async onWorkflowStarted(workflowId: string, workflowName: string): Promise<void> {
    if (!this.config.slack.enabled) {
      return;
    }

    try {
      const slack = getSlackIntegration();
      await slack.sendWorkflowStarted(workflowId, workflowName);
    } catch (error) {
      log.error('Failed to send workflow started notification', { error });
    }
  }

  /**
   * Handle workflow completed event
   */
  async onWorkflowCompleted(workflowId: string, workflowName: string, duration?: number): Promise<void> {
    if (!this.config.slack.enabled || !this.config.slack.notifyOnWorkflowComplete) {
      return;
    }

    try {
      const slack = getSlackIntegration();
      await slack.sendWorkflowCompleted(workflowId, workflowName, duration);
    } catch (error) {
      log.error('Failed to send workflow completed notification', { error });
    }
  }

  /**
   * Handle workflow error event
   */
  async onWorkflowError(workflowId: string, workflowName: string, error: string): Promise<void> {
    if (!this.config.slack.enabled || !this.config.slack.notifyOnErrors) {
      return;
    }

    try {
      const slack = getSlackIntegration();
      await slack.sendWorkflowError(workflowId, workflowName, error);
    } catch (err) {
      log.error('Failed to send workflow error notification', { error: err });
    }
  }

  /**
   * Handle review loop started event
   */
  async onReviewLoopStarted(loopId: string, coderId: string, adversarialId: string): Promise<void> {
    if (!this.config.slack.enabled || !this.config.slack.notifyOnReviewLoop) {
      return;
    }

    try {
      const slack = getSlackIntegration();
      await slack.sendReviewLoopStarted(loopId, coderId, adversarialId);
    } catch (error) {
      log.error('Failed to send review loop started notification', { error });
    }
  }

  /**
   * Handle review loop approved event
   */
  async onReviewLoopApproved(loopId: string, iteration: number): Promise<void> {
    if (!this.config.slack.enabled || !this.config.slack.notifyOnReviewLoop) {
      return;
    }

    try {
      const slack = getSlackIntegration();
      await slack.sendReviewLoopApproved(loopId, iteration);
    } catch (error) {
      log.error('Failed to send review loop approved notification', { error });
    }
  }

  /**
   * Handle review loop completed event
   */
  async onReviewLoopCompleted(loopId: string, iterations: number, approved: boolean): Promise<void> {
    if (!this.config.slack.enabled || !this.config.slack.notifyOnReviewLoop) {
      return;
    }

    try {
      const slack = getSlackIntegration();
      await slack.sendReviewLoopCompleted(loopId, iterations, approved);
    } catch (error) {
      log.error('Failed to send review loop completed notification', { error });
    }
  }

  /**
   * Handle task completed event
   */
  async onTaskCompleted(taskId: string, agentType: string): Promise<void> {
    if (!this.config.slack.enabled) {
      return;
    }

    try {
      const slack = getSlackIntegration();
      await slack.sendTaskCompleted(taskId, agentType);
    } catch (error) {
      log.error('Failed to send task completed notification', { error });
    }
  }

  /**
   * Handle task failed event
   */
  async onTaskFailed(taskId: string, agentType: string, error: string): Promise<void> {
    if (!this.config.slack.enabled || !this.config.slack.notifyOnErrors) {
      return;
    }

    try {
      const slack = getSlackIntegration();
      await slack.sendTaskFailed(taskId, agentType, error);
    } catch (err) {
      log.error('Failed to send task failed notification', { error: err });
    }
  }

  /**
   * Send a custom notification
   */
  async sendCustom(title: string, message: string, level: 'info' | 'success' | 'warning' | 'error' = 'info'): Promise<void> {
    if (!this.config.slack.enabled) {
      return;
    }

    try {
      const slack = getSlackIntegration();
      await slack.sendCustomMessage(title, message, level);
    } catch (error) {
      log.error('Failed to send custom notification', { error });
    }
  }
}

// Singleton instance
let instance: SlackNotifier | null = null;

export function getSlackNotifier(config?: AgentStackConfig): SlackNotifier {
  if (!instance && config) {
    instance = new SlackNotifier(config);
    instance.initialize();
  }
  if (!instance) {
    throw new Error('Slack notifier not initialized');
  }
  return instance;
}

export function resetSlackNotifier(): void {
  instance = null;
}
