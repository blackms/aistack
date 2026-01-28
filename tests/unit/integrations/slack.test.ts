import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SlackIntegration,
  getSlackIntegration,
  resetSlackIntegration,
  type SlackConfig,
  type SlackMessage,
} from '../../../src/integrations/slack.js';

// Mock the logger
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('SlackIntegration', () => {
  let enabledConfig: SlackConfig;
  let disabledConfig: SlackConfig;

  beforeEach(() => {
    enabledConfig = {
      enabled: true,
      webhookUrl: 'https://hooks.slack.com/services/test',
      channel: '#general',
      username: 'TestBot',
      iconEmoji: ':test:',
    };

    disabledConfig = {
      enabled: false,
      webhookUrl: 'https://hooks.slack.com/services/test',
    };

    mockFetch.mockReset();
    resetSlackIntegration();
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetSlackIntegration();
  });

  describe('constructor & isEnabled', () => {
    it('should create instance with config', () => {
      const slack = new SlackIntegration(enabledConfig);
      expect(slack).toBeInstanceOf(SlackIntegration);
    });

    it('should return true when enabled and webhookUrl present', () => {
      const slack = new SlackIntegration(enabledConfig);
      expect(slack.isEnabled()).toBe(true);
    });

    it('should return false when disabled', () => {
      const slack = new SlackIntegration(disabledConfig);
      expect(slack.isEnabled()).toBe(false);
    });

    it('should return false when no webhookUrl', () => {
      const configNoUrl: SlackConfig = {
        enabled: true,
        webhookUrl: undefined,
      };
      const slack = new SlackIntegration(configNoUrl);
      expect(slack.isEnabled()).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('should return false when disabled (no HTTP call)', async () => {
      const slack = new SlackIntegration(disabledConfig);
      const result = await slack.sendMessage({ text: 'test' });

      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should send correct payload structure to fetch', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      const message: SlackMessage = {
        text: 'Test message',
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Hello' } }],
      };

      await slack.sendMessage(message);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/test',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.text).toBe('Test message');
      expect(calledBody.channel).toBe('#general');
      expect(calledBody.username).toBe('TestBot');
      expect(calledBody.icon_emoji).toBe(':test:');
    });

    it('should return true on successful response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      const result = await slack.sendMessage({ text: 'test' });

      expect(result).toBe(true);
    });

    it('should return false on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad request'),
      });

      const slack = new SlackIntegration(enabledConfig);
      const result = await slack.sendMessage({ text: 'test' });

      expect(result).toBe(false);
    });

    it('should handle network/fetch errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const slack = new SlackIntegration(enabledConfig);
      const result = await slack.sendMessage({ text: 'test' });

      expect(result).toBe(false);
    });

    it('should use default username when not provided', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const configNoUsername: SlackConfig = {
        enabled: true,
        webhookUrl: 'https://hooks.slack.com/services/test',
      };
      const slack = new SlackIntegration(configNoUsername);
      await slack.sendMessage({ text: 'test' });

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.username).toBe('AgentStack Bot');
    });

    it('should use default emoji when not provided', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const configNoEmoji: SlackConfig = {
        enabled: true,
        webhookUrl: 'https://hooks.slack.com/services/test',
      };
      const slack = new SlackIntegration(configNoEmoji);
      await slack.sendMessage({ text: 'test' });

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.icon_emoji).toBe(':robot_face:');
    });

    it('should override channel when provided in message', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendMessage({ text: 'test', channel: '#alerts' });

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.channel).toBe('#alerts');
    });
  });

  describe('sendAgentSpawned', () => {
    it('should format block with truncated ID', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendAgentSpawned('coder', 'abcdefgh-1234-5678-9012');

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain('Agent Spawned');
      expect(calledBody.blocks[0].text.text).toContain('`coder`');
      expect(calledBody.blocks[0].text.text).toContain('`abcdefgh`');
      expect(calledBody.blocks[0].text.text).not.toContain('1234-5678');
    });
  });

  describe('sendAgentStopped', () => {
    it('should format block correctly', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendAgentStopped('abcdefgh-1234-5678-9012');

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain('Agent Stopped');
      expect(calledBody.blocks[0].text.text).toContain('`abcdefgh`');
    });
  });

  describe('sendAgentError', () => {
    it('should include error message', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendAgentError('abcdefgh-1234', 'Something went wrong');

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain('Agent Error');
      expect(calledBody.blocks[0].text.text).toContain('Something went wrong');
    });
  });

  describe('sendWorkflowStarted', () => {
    it('should format name and ID', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendWorkflowStarted('wf-abcdefgh-1234', 'Build Pipeline');

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain('Workflow Started');
      expect(calledBody.blocks[0].text.text).toContain('*Build Pipeline*');
      expect(calledBody.blocks[0].text.text).toContain('`wf-abcde`');
    });
  });

  describe('sendWorkflowCompleted', () => {
    it('should format with duration', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendWorkflowCompleted('wf-abcdefgh-1234', 'Build Pipeline', 65000);

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain('Workflow Completed');
      expect(calledBody.blocks[0].text.text).toContain('*Build Pipeline*');
      expect(calledBody.blocks[0].text.text).toContain('Duration: 65s');
    });

    it('should format without duration', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendWorkflowCompleted('wf-abcdefgh-1234', 'Build Pipeline');

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain('Workflow Completed');
      expect(calledBody.blocks[0].text.text).not.toContain('Duration:');
    });
  });

  describe('sendWorkflowError', () => {
    it('should include error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendWorkflowError('wf-abcdefgh-1234', 'Build Pipeline', 'Build failed');

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain('Workflow Error');
      expect(calledBody.blocks[0].text.text).toContain('Build failed');
    });
  });

  describe('sendReviewLoopStarted', () => {
    it('should include all agent IDs', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendReviewLoopStarted('loop-abcd1234', 'coder-efgh5678', 'adv-ijkl9012');

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain('Review Loop Started');
      expect(calledBody.blocks[0].text.text).toContain('`loop-abc`');
      expect(calledBody.blocks[0].text.text).toContain('`coder-ef`');
      expect(calledBody.blocks[0].text.text).toContain('`adv-ijkl`');
    });
  });

  describe('sendReviewLoopApproved', () => {
    it('should include iteration number', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendReviewLoopApproved('loop-abcd1234', 3);

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain('Code Approved');
      expect(calledBody.blocks[0].text.text).toContain('Iteration: 3');
    });
  });

  describe('sendReviewLoopCompleted', () => {
    it('should show approved status when approved', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendReviewLoopCompleted('loop-abcd1234', 5, true);

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain('Review Loop Completed');
      expect(calledBody.blocks[0].text.text).toContain('Iterations: 5');
      expect(calledBody.blocks[0].text.text).toContain(':white_check_mark: Approved');
    });

    it('should show rejected status when not approved', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendReviewLoopCompleted('loop-abcd1234', 5, false);

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain(':x: Not Approved');
    });
  });

  describe('sendTaskCompleted', () => {
    it('should include agent type and task ID', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendTaskCompleted('task-abcd1234', 'coder');

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain('Task Completed');
      expect(calledBody.blocks[0].text.text).toContain('`coder`');
      expect(calledBody.blocks[0].text.text).toContain('`task-abc`');
    });
  });

  describe('sendTaskFailed', () => {
    it('should include error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendTaskFailed('task-abcd1234', 'coder', 'Task timeout');

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain('Task Failed');
      expect(calledBody.blocks[0].text.text).toContain('Task timeout');
    });
  });

  describe('sendCustomMessage', () => {
    it('should use correct emoji for info level', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendCustomMessage('Title', 'Message', 'info');

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain(':information_source:');
    });

    it('should use correct emoji for success level', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendCustomMessage('Title', 'Message', 'success');

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain(':white_check_mark:');
    });

    it('should use correct emoji for warning level', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendCustomMessage('Title', 'Message', 'warning');

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain(':warning:');
    });

    it('should use correct emoji for error level', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendCustomMessage('Title', 'Message', 'error');

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain(':x:');
    });

    it('should default to info level', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendCustomMessage('Title', 'Message');

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain(':information_source:');
    });
  });

  describe('sendResourceWarning', () => {
    it('should format resource warning correctly', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendResourceWarning('agent-abcd1234', 'coder', 'memory', 800, 1000);

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain('Resource Warning');
      expect(calledBody.blocks[0].text.text).toContain('`coder`');
      expect(calledBody.blocks[0].text.text).toContain('`memory`');
      expect(calledBody.blocks[0].text.text).toContain('80%');
    });
  });

  describe('sendResourceIntervention', () => {
    it('should format intervention correctly', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendResourceIntervention('agent-abcd1234', 'coder', 'memory', 'Exceeded limit');

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain('Agent Paused');
      expect(calledBody.blocks[0].text.text).toContain('Exceeded limit');
    });
  });

  describe('sendResourceTermination', () => {
    it('should format termination correctly', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const slack = new SlackIntegration(enabledConfig);
      await slack.sendResourceTermination('agent-abcd1234', 'coder', 'Memory exhausted');

      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.blocks[0].text.text).toContain('Agent Terminated');
      expect(calledBody.blocks[0].text.text).toContain('Memory exhausted');
    });
  });

  describe('singleton functions', () => {
    it('should create instance with config', () => {
      const slack = getSlackIntegration(enabledConfig);
      expect(slack).toBeInstanceOf(SlackIntegration);
    });

    it('should return same instance on subsequent calls', () => {
      const slack1 = getSlackIntegration(enabledConfig);
      const slack2 = getSlackIntegration();
      expect(slack1).toBe(slack2);
    });

    it('should throw without config/instance', () => {
      expect(() => getSlackIntegration()).toThrow('Slack integration not initialized');
    });

    it('should reset instance', () => {
      getSlackIntegration(enabledConfig);
      resetSlackIntegration();
      expect(() => getSlackIntegration()).toThrow('Slack integration not initialized');
    });
  });
});
