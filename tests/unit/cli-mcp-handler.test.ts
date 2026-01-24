/**
 * CLI MCP Command Handler tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMcpCommand } from '../../src/cli/commands/mcp.js';

describe('MCP Command Handler', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('tools subcommand', () => {
    it('should list all available MCP tools', async () => {
      const command = createMcpCommand();
      await command.parseAsync(['node', 'test', 'tools']);

      expect(consoleSpy).toHaveBeenCalled();
      const calls = consoleSpy.mock.calls.map(c => c[0]);

      expect(calls.some(c => c?.includes?.('Available MCP tools'))).toBe(true);
      expect(calls.some(c => c?.includes?.('Agent Tools'))).toBe(true);
      expect(calls.some(c => c?.includes?.('Memory Tools'))).toBe(true);
      expect(calls.some(c => c?.includes?.('Task Tools'))).toBe(true);
      expect(calls.some(c => c?.includes?.('Session Tools'))).toBe(true);
      expect(calls.some(c => c?.includes?.('System Tools'))).toBe(true);
      expect(calls.some(c => c?.includes?.('GitHub Tools'))).toBe(true);
      expect(calls.some(c => c?.includes?.('Total:'))).toBe(true);
    });

    it('should list agent tools', async () => {
      const command = createMcpCommand();
      await command.parseAsync(['node', 'test', 'tools']);

      const calls = consoleSpy.mock.calls.map(c => c[0]);
      expect(calls.some(c => c?.includes?.('agent_spawn'))).toBe(true);
      expect(calls.some(c => c?.includes?.('agent_list'))).toBe(true);
      expect(calls.some(c => c?.includes?.('agent_status'))).toBe(true);
    });

    it('should list memory tools', async () => {
      const command = createMcpCommand();
      await command.parseAsync(['node', 'test', 'tools']);

      const calls = consoleSpy.mock.calls.map(c => c[0]);
      expect(calls.some(c => c?.includes?.('memory_store'))).toBe(true);
      expect(calls.some(c => c?.includes?.('memory_search'))).toBe(true);
      expect(calls.some(c => c?.includes?.('memory_get'))).toBe(true);
    });

    it('should list task tools', async () => {
      const command = createMcpCommand();
      await command.parseAsync(['node', 'test', 'tools']);

      const calls = consoleSpy.mock.calls.map(c => c[0]);
      expect(calls.some(c => c?.includes?.('task_create'))).toBe(true);
      expect(calls.some(c => c?.includes?.('task_list'))).toBe(true);
    });

    it('should list github tools', async () => {
      const command = createMcpCommand();
      await command.parseAsync(['node', 'test', 'tools']);

      const calls = consoleSpy.mock.calls.map(c => c[0]);
      expect(calls.some(c => c?.includes?.('github_issue_create'))).toBe(true);
      expect(calls.some(c => c?.includes?.('github_pr_create'))).toBe(true);
    });
  });

});

