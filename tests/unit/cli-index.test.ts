/**
 * CLI Index tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import {
  createInitCommand,
  createAgentCommand,
  createMemoryCommand,
  createMcpCommand,
  createPluginCommand,
  createStatusCommand,
  createWorkflowCommand,
} from '../../src/cli/commands/index.js';

// Mock console
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('CLI Index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Command exports', () => {
    it('should export all command creators', () => {
      expect(typeof createInitCommand).toBe('function');
      expect(typeof createAgentCommand).toBe('function');
      expect(typeof createMemoryCommand).toBe('function');
      expect(typeof createMcpCommand).toBe('function');
      expect(typeof createPluginCommand).toBe('function');
      expect(typeof createStatusCommand).toBe('function');
      expect(typeof createWorkflowCommand).toBe('function');
    });

    it('should create valid Command instances', () => {
      const commands = [
        createInitCommand(),
        createAgentCommand(),
        createMemoryCommand(),
        createMcpCommand(),
        createPluginCommand(),
        createStatusCommand(),
        createWorkflowCommand(),
      ];

      for (const cmd of commands) {
        expect(cmd).toBeInstanceOf(Command);
        expect(cmd.name()).toBeTruthy();
      }
    });
  });

  describe('Main program structure', () => {
    it('should be able to create main program with all commands', () => {
      const program = new Command();

      program
        .name('agentstack')
        .description('Clean agent orchestration for Claude Code')
        .version('1.0.0')
        .option('-v, --verbose', 'Enable verbose logging')
        .option('-q, --quiet', 'Suppress output');

      program.addCommand(createInitCommand());
      program.addCommand(createAgentCommand());
      program.addCommand(createMemoryCommand());
      program.addCommand(createMcpCommand());
      program.addCommand(createPluginCommand());
      program.addCommand(createStatusCommand());
      program.addCommand(createWorkflowCommand());

      expect(program.name()).toBe('agentstack');
      expect(program.commands.length).toBe(7);
    });

    it('should have verbose and quiet options', () => {
      const program = new Command();

      program
        .name('agentstack')
        .option('-v, --verbose', 'Enable verbose logging')
        .option('-q, --quiet', 'Suppress output');

      const options = program.options.map(o => o.long);
      expect(options).toContain('--verbose');
      expect(options).toContain('--quiet');
    });
  });
});
