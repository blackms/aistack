/**
 * Tests for agent watch command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runAgentWatch } from '../../../src/cli/commands/agent-watch.js';
import * as spawner from '../../../src/agents/spawner.js';
import type { AgentStackConfig, SpawnedAgent } from '../../../src/types.js';

// Mock the spawner module
vi.mock('../../../src/agents/spawner.js', () => ({
  listAgents: vi.fn(),
  getConcurrencyStats: vi.fn(),
}));

describe('Agent Watch Command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  const mockConfig: AgentStackConfig = {
    version: '1.0.0',
    memory: {
      path: '/tmp/test.db',
      defaultNamespace: 'test',
      vectorSearch: { enabled: false },
    },
    providers: { default: 'anthropic' },
    agents: { maxConcurrent: 20, defaultTimeout: 30000 },
    github: { enabled: false },
    plugins: { enabled: false, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: false, sessionEnd: false, preTask: false, postTask: false },
  };

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    vi.mocked(spawner.listAgents).mockReturnValue([]);
    vi.mocked(spawner.getConcurrencyStats).mockReturnValue({
      agents: { active: 0, maxConcurrent: 20, byType: {} },
      semaphore: { available: 20, maxPermits: 20, queued: 0 },
      pool: {},
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe('JSON mode', () => {
    it('should output JSON snapshot and exit', async () => {
      const options = {
        interval: '2',
        json: true,
        clear: true,
      };

      await runAgentWatch(options, mockConfig);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('agents');
      expect(parsed).toHaveProperty('stats');
      expect(parsed.stats).toHaveProperty('active');
      expect(parsed.stats).toHaveProperty('maxConcurrent');
    });

    it('should include agents in JSON output', async () => {
      const mockAgent: SpawnedAgent = {
        id: 'test-id',
        type: 'coder',
        name: 'test-coder',
        status: 'running',
        createdAt: new Date(),
      };

      vi.mocked(spawner.listAgents).mockReturnValue([mockAgent]);
      vi.mocked(spawner.getConcurrencyStats).mockReturnValue({
        agents: { active: 1, maxConcurrent: 20, byType: { coder: 1 } },
        semaphore: { available: 19, maxPermits: 20, queued: 0 },
        pool: {},
      });

      const options = {
        interval: '2',
        json: true,
        clear: true,
      };

      await runAgentWatch(options, mockConfig);

      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.agents).toHaveLength(1);
      expect(parsed.agents[0].name).toBe('test-coder');
    });
  });

  describe('filtering', () => {
    it('should filter by session', async () => {
      const options = {
        interval: '2',
        session: 'session-123',
        json: true,
        clear: true,
      };

      await runAgentWatch(options, mockConfig);

      expect(spawner.listAgents).toHaveBeenCalledWith('session-123');
    });

    it('should filter by type', async () => {
      const agents: SpawnedAgent[] = [
        { id: '1', type: 'coder', name: 'coder-1', status: 'idle', createdAt: new Date() },
        { id: '2', type: 'tester', name: 'tester-1', status: 'idle', createdAt: new Date() },
      ];

      vi.mocked(spawner.listAgents).mockReturnValue(agents);

      const options = {
        interval: '2',
        type: 'coder',
        json: true,
        clear: true,
      };

      await runAgentWatch(options, mockConfig);

      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.agents).toHaveLength(1);
      expect(parsed.agents[0].type).toBe('coder');
    });

    it('should filter by status', async () => {
      const agents: SpawnedAgent[] = [
        { id: '1', type: 'coder', name: 'coder-1', status: 'running', createdAt: new Date() },
        { id: '2', type: 'coder', name: 'coder-2', status: 'idle', createdAt: new Date() },
      ];

      vi.mocked(spawner.listAgents).mockReturnValue(agents);

      const options = {
        interval: '2',
        status: 'running',
        json: true,
        clear: true,
      };

      await runAgentWatch(options, mockConfig);

      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.agents).toHaveLength(1);
      expect(parsed.agents[0].status).toBe('running');
    });
  });

  describe('validation', () => {
    it('should reject invalid interval', async () => {
      const options = {
        interval: 'abc',
        json: false,
        clear: true,
      };

      await runAgentWatch(options, mockConfig);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Interval must be at least 1 second');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should reject interval less than 1 second', async () => {
      const options = {
        interval: '0',
        json: false,
        clear: true,
      };

      await runAgentWatch(options, mockConfig);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Interval must be at least 1 second');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
