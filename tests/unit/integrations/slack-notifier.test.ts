import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlackNotifier, getSlackNotifier, resetSlackNotifier } from '../../../src/integrations/slack-notifier.js';
import type { AgentStackConfig } from '../../../src/types.js';
import * as slackModule from '../../../src/integrations/slack.js';

// Mock the slack integration module
vi.mock('../../../src/integrations/slack.js', () => ({
  getSlackIntegration: vi.fn(),
}));

describe('SlackNotifier', () => {
  let mockConfig: AgentStackConfig;
  let mockSlackIntegration: any;

  beforeEach(() => {
    mockConfig = {
      version: '1.0.0',
      memory: {
        path: ':memory:',
        defaultNamespace: 'test',
        vectorSearch: { enabled: false },
      },
      providers: { llm: {}, embeddings: {} },
      agents: {},
      github: { enabled: false },
      plugins: { enabled: false, directory: 'plugins' },
      mcp: { enabled: false, servers: {} },
      hooks: { session: {}, task: {}, workflow: {} },
      slack: {
        enabled: true,
        webhookUrl: 'https://hooks.slack.com/test',
        botToken: 'xoxb-test-token',
        channel: '#general',
        notifyOnAgentSpawn: true,
        notifyOnErrors: true,
        notifyOnWorkflowComplete: true,
        notifyOnReviewLoop: true,
      },
    };

    mockSlackIntegration = {
      sendAgentSpawned: vi.fn().mockResolvedValue(undefined),
      sendAgentStopped: vi.fn().mockResolvedValue(undefined),
      sendAgentError: vi.fn().mockResolvedValue(undefined),
      sendWorkflowStarted: vi.fn().mockResolvedValue(undefined),
      sendWorkflowCompleted: vi.fn().mockResolvedValue(undefined),
      sendWorkflowError: vi.fn().mockResolvedValue(undefined),
      sendReviewLoopStarted: vi.fn().mockResolvedValue(undefined),
      sendReviewLoopApproved: vi.fn().mockResolvedValue(undefined),
      sendReviewLoopCompleted: vi.fn().mockResolvedValue(undefined),
      sendTaskCompleted: vi.fn().mockResolvedValue(undefined),
      sendTaskFailed: vi.fn().mockResolvedValue(undefined),
      sendCustomMessage: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(slackModule.getSlackIntegration).mockReturnValue(mockSlackIntegration);

    resetSlackNotifier();
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetSlackNotifier();
  });

  describe('constructor', () => {
    it('should create notifier with config', () => {
      const notifier = new SlackNotifier(mockConfig);
      expect(notifier).toBeInstanceOf(SlackNotifier);
    });
  });

  describe('initialize', () => {
    it('should initialize when slack is enabled', () => {
      const notifier = new SlackNotifier(mockConfig);
      notifier.initialize();
      expect(slackModule.getSlackIntegration).toHaveBeenCalledWith(mockConfig.slack);
    });

    it('should not initialize when slack is disabled', () => {
      mockConfig.slack!.enabled = false;
      const notifier = new SlackNotifier(mockConfig);
      notifier.initialize();
      expect(slackModule.getSlackIntegration).not.toHaveBeenCalled();
    });

    it('should not initialize when slack config is undefined', () => {
      mockConfig.slack = undefined;
      const notifier = new SlackNotifier(mockConfig);
      notifier.initialize();
      expect(slackModule.getSlackIntegration).not.toHaveBeenCalled();
    });

    it('should handle initialization errors gracefully', () => {
      vi.mocked(slackModule.getSlackIntegration).mockImplementationOnce(() => {
        throw new Error('Init failed');
      });
      const notifier = new SlackNotifier(mockConfig);
      expect(() => notifier.initialize()).not.toThrow();
    });
  });

  describe('onAgentSpawned', () => {
    it('should send notification when enabled', async () => {
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onAgentSpawned('coder', 'agent-123');
      expect(mockSlackIntegration.sendAgentSpawned).toHaveBeenCalledWith('coder', 'agent-123');
    });

    it('should not send when slack is disabled', async () => {
      mockConfig.slack!.enabled = false;
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onAgentSpawned('coder', 'agent-123');
      expect(mockSlackIntegration.sendAgentSpawned).not.toHaveBeenCalled();
    });

    it('should not send when notifyOnAgentSpawn is false', async () => {
      mockConfig.slack!.notifyOnAgentSpawn = false;
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onAgentSpawned('coder', 'agent-123');
      expect(mockSlackIntegration.sendAgentSpawned).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockSlackIntegration.sendAgentSpawned.mockRejectedValueOnce(new Error('Send failed'));
      const notifier = new SlackNotifier(mockConfig);
      await expect(notifier.onAgentSpawned('coder', 'agent-123')).resolves.not.toThrow();
    });
  });

  describe('onAgentStopped', () => {
    it('should send notification when enabled', async () => {
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onAgentStopped('agent-123');
      expect(mockSlackIntegration.sendAgentStopped).toHaveBeenCalledWith('agent-123');
    });

    it('should not send when slack is disabled', async () => {
      mockConfig.slack!.enabled = false;
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onAgentStopped('agent-123');
      expect(mockSlackIntegration.sendAgentStopped).not.toHaveBeenCalled();
    });
  });

  describe('onAgentError', () => {
    it('should send notification when enabled', async () => {
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onAgentError('agent-123', 'Error message');
      expect(mockSlackIntegration.sendAgentError).toHaveBeenCalledWith('agent-123', 'Error message');
    });

    it('should not send when notifyOnErrors is false', async () => {
      mockConfig.slack!.notifyOnErrors = false;
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onAgentError('agent-123', 'Error message');
      expect(mockSlackIntegration.sendAgentError).not.toHaveBeenCalled();
    });
  });

  describe('onWorkflowStarted', () => {
    it('should send notification when enabled', async () => {
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onWorkflowStarted('workflow-123', 'My Workflow');
      expect(mockSlackIntegration.sendWorkflowStarted).toHaveBeenCalledWith('workflow-123', 'My Workflow');
    });
  });

  describe('onWorkflowCompleted', () => {
    it('should send notification when enabled', async () => {
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onWorkflowCompleted('workflow-123', 'My Workflow', 5000);
      expect(mockSlackIntegration.sendWorkflowCompleted).toHaveBeenCalledWith('workflow-123', 'My Workflow', 5000);
    });

    it('should not send when notifyOnWorkflowComplete is false', async () => {
      mockConfig.slack!.notifyOnWorkflowComplete = false;
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onWorkflowCompleted('workflow-123', 'My Workflow');
      expect(mockSlackIntegration.sendWorkflowCompleted).not.toHaveBeenCalled();
    });
  });

  describe('onWorkflowError', () => {
    it('should send notification when enabled', async () => {
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onWorkflowError('workflow-123', 'My Workflow', 'Error message');
      expect(mockSlackIntegration.sendWorkflowError).toHaveBeenCalledWith('workflow-123', 'My Workflow', 'Error message');
    });

    it('should not send when notifyOnErrors is false', async () => {
      mockConfig.slack!.notifyOnErrors = false;
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onWorkflowError('workflow-123', 'My Workflow', 'Error');
      expect(mockSlackIntegration.sendWorkflowError).not.toHaveBeenCalled();
    });
  });

  describe('onReviewLoopStarted', () => {
    it('should send notification when enabled', async () => {
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onReviewLoopStarted('loop-123', 'coder-123', 'adversarial-123');
      expect(mockSlackIntegration.sendReviewLoopStarted).toHaveBeenCalledWith('loop-123', 'coder-123', 'adversarial-123');
    });

    it('should not send when notifyOnReviewLoop is false', async () => {
      mockConfig.slack!.notifyOnReviewLoop = false;
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onReviewLoopStarted('loop-123', 'coder-123', 'adversarial-123');
      expect(mockSlackIntegration.sendReviewLoopStarted).not.toHaveBeenCalled();
    });
  });

  describe('onReviewLoopApproved', () => {
    it('should send notification when enabled', async () => {
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onReviewLoopApproved('loop-123', 3);
      expect(mockSlackIntegration.sendReviewLoopApproved).toHaveBeenCalledWith('loop-123', 3);
    });
  });

  describe('onReviewLoopCompleted', () => {
    it('should send notification when enabled', async () => {
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onReviewLoopCompleted('loop-123', 5, true);
      expect(mockSlackIntegration.sendReviewLoopCompleted).toHaveBeenCalledWith('loop-123', 5, true);
    });
  });

  describe('onTaskCompleted', () => {
    it('should send notification when enabled', async () => {
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onTaskCompleted('task-123', 'coder');
      expect(mockSlackIntegration.sendTaskCompleted).toHaveBeenCalledWith('task-123', 'coder');
    });
  });

  describe('onTaskFailed', () => {
    it('should send notification when enabled', async () => {
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onTaskFailed('task-123', 'coder', 'Error message');
      expect(mockSlackIntegration.sendTaskFailed).toHaveBeenCalledWith('task-123', 'coder', 'Error message');
    });

    it('should not send when notifyOnErrors is false', async () => {
      mockConfig.slack!.notifyOnErrors = false;
      const notifier = new SlackNotifier(mockConfig);
      await notifier.onTaskFailed('task-123', 'coder', 'Error');
      expect(mockSlackIntegration.sendTaskFailed).not.toHaveBeenCalled();
    });
  });

  describe('sendCustom', () => {
    it('should send custom notification', async () => {
      const notifier = new SlackNotifier(mockConfig);
      await notifier.sendCustom('Title', 'Message', 'info');
      expect(mockSlackIntegration.sendCustomMessage).toHaveBeenCalledWith('Title', 'Message', 'info');
    });

    it('should use default level', async () => {
      const notifier = new SlackNotifier(mockConfig);
      await notifier.sendCustom('Title', 'Message');
      expect(mockSlackIntegration.sendCustomMessage).toHaveBeenCalledWith('Title', 'Message', 'info');
    });

    it('should not send when slack is disabled', async () => {
      mockConfig.slack!.enabled = false;
      const notifier = new SlackNotifier(mockConfig);
      await notifier.sendCustom('Title', 'Message');
      expect(mockSlackIntegration.sendCustomMessage).not.toHaveBeenCalled();
    });
  });

  describe('singleton functions', () => {
    it('should create and return singleton instance', () => {
      const notifier1 = getSlackNotifier(mockConfig);
      const notifier2 = getSlackNotifier();
      expect(notifier1).toBe(notifier2);
    });

    it('should throw when getting notifier before initialization', () => {
      expect(() => getSlackNotifier()).toThrow('Slack notifier not initialized');
    });

    it('should reset singleton', () => {
      getSlackNotifier(mockConfig);
      resetSlackNotifier();
      expect(() => getSlackNotifier()).toThrow('Slack notifier not initialized');
    });
  });
});
