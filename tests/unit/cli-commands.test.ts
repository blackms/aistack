/**
 * CLI Commands tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import { createAgentCommand } from '../../src/cli/commands/agent.js';
import { createInitCommand } from '../../src/cli/commands/init.js';
import { createMcpCommand } from '../../src/cli/commands/mcp.js';
import { createMemoryCommand } from '../../src/cli/commands/memory.js';
import { createPluginCommand } from '../../src/cli/commands/plugin.js';
import { createStatusCommand } from '../../src/cli/commands/status.js';
import { createWorkflowCommand } from '../../src/cli/commands/workflow.js';

// Mock console to suppress output
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('CLI Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createAgentCommand', () => {
    it('should create agent command with subcommands', () => {
      const command = createAgentCommand();

      expect(command).toBeInstanceOf(Command);
      expect(command.name()).toBe('agent');
      expect(command.description()).toBe('Manage agents');

      // Check subcommands
      const subcommands = command.commands.map(c => c.name());
      expect(subcommands).toContain('spawn');
      expect(subcommands).toContain('list');
      expect(subcommands).toContain('stop');
      expect(subcommands).toContain('status');
    });

    it('should have spawn subcommand with options', () => {
      const command = createAgentCommand();
      const spawnCmd = command.commands.find(c => c.name() === 'spawn');

      expect(spawnCmd).toBeDefined();
      const options = spawnCmd?.options.map(o => o.long);
      expect(options).toContain('--type');
      expect(options).toContain('--name');
    });

    it('should have list subcommand', () => {
      const command = createAgentCommand();
      const listCmd = command.commands.find(c => c.name() === 'list');

      expect(listCmd).toBeDefined();
    });

    it('should have stop subcommand with options', () => {
      const command = createAgentCommand();
      const stopCmd = command.commands.find(c => c.name() === 'stop');

      expect(stopCmd).toBeDefined();
      const options = stopCmd?.options.map(o => o.long);
      expect(options).toContain('--id');
      expect(options).toContain('--name');
    });

    it('should have status subcommand with options', () => {
      const command = createAgentCommand();
      const statusCmd = command.commands.find(c => c.name() === 'status');

      expect(statusCmd).toBeDefined();
      const options = statusCmd?.options.map(o => o.long);
      expect(options).toContain('--id');
      expect(options).toContain('--name');
    });

    it('should have types subcommand', () => {
      const command = createAgentCommand();
      const typesCmd = command.commands.find(c => c.name() === 'types');

      expect(typesCmd).toBeDefined();
    });
  });

  describe('createInitCommand', () => {
    it('should create init command', () => {
      const command = createInitCommand();

      expect(command).toBeInstanceOf(Command);
      expect(command.name()).toBe('init');
      expect(command.description()).toContain('Initialize');
    });

    it('should have force option', () => {
      const command = createInitCommand();
      const options = command.options.map(o => o.long);

      expect(options).toContain('--force');
    });
  });

  describe('createMcpCommand', () => {
    it('should create mcp command with subcommands', () => {
      const command = createMcpCommand();

      expect(command).toBeInstanceOf(Command);
      expect(command.name()).toBe('mcp');

      const subcommands = command.commands.map(c => c.name());
      expect(subcommands).toContain('start');
      expect(subcommands).toContain('tools');
    });

    it('should have start subcommand with transport option', () => {
      const command = createMcpCommand();
      const startCmd = command.commands.find(c => c.name() === 'start');

      expect(startCmd).toBeDefined();
      const options = startCmd?.options.map(o => o.long);
      expect(options).toContain('--transport');
    });
  });

  describe('createMemoryCommand', () => {
    it('should create memory command with subcommands', () => {
      const command = createMemoryCommand();

      expect(command).toBeInstanceOf(Command);
      expect(command.name()).toBe('memory');

      const subcommands = command.commands.map(c => c.name());
      expect(subcommands).toContain('store');
      expect(subcommands).toContain('search');
      expect(subcommands).toContain('list');
      expect(subcommands).toContain('delete');
      expect(subcommands).toContain('stats');
    });

    it('should have store subcommand with options', () => {
      const command = createMemoryCommand();
      const storeCmd = command.commands.find(c => c.name() === 'store');

      expect(storeCmd).toBeDefined();
      const options = storeCmd?.options.map(o => o.long);
      expect(options).toContain('--namespace');
    });

    it('should have search subcommand with options', () => {
      const command = createMemoryCommand();
      const searchCmd = command.commands.find(c => c.name() === 'search');

      expect(searchCmd).toBeDefined();
      const options = searchCmd?.options.map(o => o.long);
      expect(options).toContain('--limit');
      expect(options).toContain('--namespace');
    });
  });

  describe('createPluginCommand', () => {
    it('should create plugin command with subcommands', () => {
      const command = createPluginCommand();

      expect(command).toBeInstanceOf(Command);
      expect(command.name()).toBe('plugin');

      const subcommands = command.commands.map(c => c.name());
      expect(subcommands).toContain('list');
      expect(subcommands).toContain('install');
      expect(subcommands).toContain('enable');
      expect(subcommands).toContain('disable');
    });

    it('should have install subcommand', () => {
      const command = createPluginCommand();
      const installCmd = command.commands.find(c => c.name() === 'install');

      expect(installCmd).toBeDefined();
    });
  });

  describe('createStatusCommand', () => {
    it('should create status command', () => {
      const command = createStatusCommand();

      expect(command).toBeInstanceOf(Command);
      expect(command.name()).toBe('status');
    });

    it('should have json option', () => {
      const command = createStatusCommand();
      const options = command.options.map(o => o.long);

      expect(options).toContain('--json');
    });
  });

  describe('createWorkflowCommand', () => {
    it('should create workflow command with subcommands', () => {
      const command = createWorkflowCommand();

      expect(command).toBeInstanceOf(Command);
      expect(command.name()).toBe('workflow');

      const subcommands = command.commands.map(c => c.name());
      expect(subcommands).toContain('run');
      expect(subcommands).toContain('list');
      expect(subcommands).toContain('triggers');
      expect(subcommands).toContain('reset');
    });

    it('should have run subcommand with options', () => {
      const command = createWorkflowCommand();
      const runCmd = command.commands.find(c => c.name() === 'run');

      expect(runCmd).toBeDefined();
      const options = runCmd?.options.map(o => o.long);
      expect(options).toContain('--docs');
      expect(options).toContain('--verbose');
    });

    it('should have triggers subcommand with options', () => {
      const command = createWorkflowCommand();
      const triggersCmd = command.commands.find(c => c.name() === 'triggers');

      expect(triggersCmd).toBeDefined();
      const options = triggersCmd?.options.map(o => o.long);
      expect(options).toContain('--list');
      expect(options).toContain('--register-defaults');
      expect(options).toContain('--clear');
    });
  });
});

describe('CLI Command Structure', () => {
  it('should have consistent command patterns', () => {
    const commands = [
      createAgentCommand(),
      createInitCommand(),
      createMcpCommand(),
      createMemoryCommand(),
      createPluginCommand(),
      createStatusCommand(),
      createWorkflowCommand(),
    ];

    for (const cmd of commands) {
      expect(cmd).toBeInstanceOf(Command);
      expect(cmd.name()).toBeTruthy();
      expect(cmd.description()).toBeTruthy();
    }
  });
});
