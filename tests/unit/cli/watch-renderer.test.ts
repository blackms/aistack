/**
 * Tests for watch renderer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WatchRenderer, type AgentWatchData } from '../../../src/cli/utils/watch-renderer.js';
import type { SpawnedAgent } from '../../../src/types.js';

describe('WatchRenderer', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  function createMockAgent(overrides: Partial<SpawnedAgent> = {}): SpawnedAgent {
    return {
      id: 'test-agent-id',
      type: 'coder',
      name: 'coder-12345678',
      status: 'idle',
      createdAt: new Date(Date.now() - 60000), // 1 minute ago
      ...overrides,
    };
  }

  function createMockData(agents: SpawnedAgent[] = []): AgentWatchData {
    return {
      agents,
      stats: {
        active: agents.length,
        maxConcurrent: 20,
        byStatus: {
          idle: agents.filter(a => a.status === 'idle').length,
          running: agents.filter(a => a.status === 'running').length,
          completed: agents.filter(a => a.status === 'completed').length,
          failed: agents.filter(a => a.status === 'failed').length,
          stopped: agents.filter(a => a.status === 'stopped').length,
        },
      },
    };
  }

  describe('render', () => {
    it('should render without agents', () => {
      const renderer = new WatchRenderer({ clearScreen: false });
      const data = createMockData([]);

      renderer.render(data);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('AISTACK Agent Monitor');
      expect(output).toContain('No active agents');
    });

    it('should render with agents', () => {
      const renderer = new WatchRenderer({ clearScreen: false });
      const agents = [
        createMockAgent({ status: 'running', name: 'coder-running' }),
        createMockAgent({ status: 'idle', name: 'tester-idle', type: 'tester' }),
      ];
      const data = createMockData(agents);

      renderer.render(data);

      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('AISTACK Agent Monitor');
      expect(output).toContain('Agents:');
      expect(output).toContain('coder-running');
      expect(output).toContain('tester-idle');
    });

    it('should sort running agents first', () => {
      const renderer = new WatchRenderer({ clearScreen: false });
      const agents = [
        createMockAgent({ status: 'idle', name: 'agent-idle', createdAt: new Date() }),
        createMockAgent({ status: 'running', name: 'agent-running', createdAt: new Date(Date.now() - 5000) }),
      ];
      const data = createMockData(agents);

      renderer.render(data);

      const calls = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      const runningIndex = calls.indexOf('agent-running');
      const idleIndex = calls.indexOf('agent-idle');
      expect(runningIndex).toBeLessThan(idleIndex);
    });

    it('should clear screen when option is set', () => {
      const renderer = new WatchRenderer({ clearScreen: true });
      const data = createMockData([]);

      renderer.render(data);

      expect(stdoutSpy).toHaveBeenCalledWith('\x1b[2J\x1b[H');
    });

    it('should not clear screen when option is false', () => {
      const renderer = new WatchRenderer({ clearScreen: false });
      const data = createMockData([]);

      renderer.render(data);

      expect(stdoutSpy).not.toHaveBeenCalledWith('\x1b[2J\x1b[H');
    });
  });

  describe('agent status display', () => {
    it('should show status counts in summary', () => {
      const renderer = new WatchRenderer({ clearScreen: false });
      const agents = [
        createMockAgent({ status: 'running' }),
        createMockAgent({ status: 'running', name: 'agent-2' }),
        createMockAgent({ status: 'idle', name: 'agent-3' }),
        createMockAgent({ status: 'failed', name: 'agent-4' }),
      ];
      const data = createMockData(agents);

      renderer.render(data);

      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('4');
      expect(output).toContain('active');
    });
  });
});
