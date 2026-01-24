/**
 * CLI Status Command Handler tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStatusCommand } from '../../src/cli/commands/status.js';

// Mock dependencies
vi.mock('../../src/utils/config.js', () => ({
  getConfig: vi.fn(() => ({
    version: '1.0.0',
    memory: {
      path: './test.db',
      defaultNamespace: 'default',
      vectorSearch: { enabled: true },
    },
    providers: {
      default: 'anthropic',
      anthropic: { apiKey: 'test-key' },
      openai: { apiKey: 'test-openai' },
    },
    github: { enabled: true, useGhCli: true },
    plugins: { enabled: true, directory: './plugins' },
  })),
}));

vi.mock('../../src/memory/index.js', () => ({
  getMemoryManager: vi.fn(() => ({
    getVectorStats: () => ({ total: 10, indexed: 8, coverage: 80 }),
    getActiveSession: () => ({
      id: 'session-123',
      status: 'active',
      startedAt: new Date('2024-01-01'),
    }),
  })),
}));

vi.mock('../../src/agents/spawner.js', () => ({
  getAgentCount: vi.fn(() => 3),
  listAgents: vi.fn(() => [
    { id: '1', status: 'running' },
    { id: '2', status: 'idle' },
    { id: '3', status: 'running' },
  ]),
}));

vi.mock('../../src/agents/registry.js', () => ({
  getAgentCount: vi.fn(() => ({ core: 5, custom: 2, total: 7 })),
}));

describe('Status Command Handler', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should output status in JSON format', async () => {
    const command = createStatusCommand();
    await command.parseAsync(['node', 'test', '--json']);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);

    expect(output.version).toBe('1.0.0');
    expect(output.session.id).toBe('session-123');
    expect(output.agents.registered.total).toBe(7);
    expect(output.agents.active).toBe(3);
    expect(output.agents.running).toBe(2);
    expect(output.memory.entries).toBe(10);
    expect(output.providers.default).toBe('anthropic');
  });

  it('should output status in text format', async () => {
    const command = createStatusCommand();
    await command.parseAsync(['node', 'test']);

    expect(consoleSpy).toHaveBeenCalled();
    const calls = consoleSpy.mock.calls.map(c => c[0]);

    expect(calls.some(c => c?.includes?.('agentstack status'))).toBe(true);
    expect(calls.some(c => c?.includes?.('Version: 1.0.0'))).toBe(true);
    expect(calls.some(c => c?.includes?.('Session:'))).toBe(true);
    expect(calls.some(c => c?.includes?.('ID:'))).toBe(true);
    expect(calls.some(c => c?.includes?.('Agents:'))).toBe(true);
    expect(calls.some(c => c?.includes?.('Memory:'))).toBe(true);
    expect(calls.some(c => c?.includes?.('Providers:'))).toBe(true);
  });

  it('should show session info when active', async () => {
    const command = createStatusCommand();
    await command.parseAsync(['node', 'test', '--json']);

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.session).not.toBeNull();
    expect(output.session.status).toBe('active');
  });

  it('should show configured providers', async () => {
    const command = createStatusCommand();
    await command.parseAsync(['node', 'test', '--json']);

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.providers.configured).toContain('anthropic');
    expect(output.providers.configured).toContain('openai');
  });

  it('should show GitHub config', async () => {
    const command = createStatusCommand();
    await command.parseAsync(['node', 'test', '--json']);

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.github.enabled).toBe(true);
    expect(output.github.useGhCli).toBe(true);
  });

  it('should show plugins config', async () => {
    const command = createStatusCommand();
    await command.parseAsync(['node', 'test', '--json']);

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.plugins.enabled).toBe(true);
    expect(output.plugins.directory).toBe('./plugins');
  });
});

describe('Status Command Handler - No Session', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Reset and re-mock memory manager with no session
    vi.doMock('../../src/memory/index.js', () => ({
      getMemoryManager: vi.fn(() => ({
        getVectorStats: () => ({ total: 0, indexed: 0, coverage: 0 }),
        getActiveSession: () => null,
      })),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should show "Session: none" when no active session', async () => {
    // Re-import with new mocks
    vi.resetModules();

    // Mock dependencies again for this test
    vi.doMock('../../src/utils/config.js', () => ({
      getConfig: vi.fn(() => ({
        version: '1.0.0',
        memory: {
          path: './test.db',
          defaultNamespace: 'default',
          vectorSearch: { enabled: false },
        },
        providers: { default: 'anthropic' },
        github: { enabled: false, useGhCli: false },
        plugins: { enabled: false, directory: './plugins' },
      })),
    }));

    vi.doMock('../../src/memory/index.js', () => ({
      getMemoryManager: vi.fn(() => ({
        getVectorStats: () => ({ total: 0, indexed: 0, coverage: 0 }),
        getActiveSession: () => null,
      })),
    }));

    vi.doMock('../../src/agents/spawner.js', () => ({
      getAgentCount: vi.fn(() => 0),
      listAgents: vi.fn(() => []),
    }));

    vi.doMock('../../src/agents/registry.js', () => ({
      getAgentCount: vi.fn(() => ({ core: 5, custom: 0, total: 5 })),
    }));

    const { createStatusCommand: createCmd } = await import('../../src/cli/commands/status.js');
    const command = createCmd();
    await command.parseAsync(['node', 'test']);

    const calls = consoleSpy.mock.calls.map(c => c[0]);
    expect(calls.some(c => c?.includes?.('Session: none'))).toBe(true);
  });
});

describe('Status Command Handler - Error Handling', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle errors gracefully', async () => {
    vi.resetModules();

    // Mock config to throw an error
    vi.doMock('../../src/utils/config.js', () => ({
      getConfig: vi.fn(() => {
        throw new Error('Config not found');
      }),
    }));

    const { createStatusCommand: createCmd } = await import('../../src/cli/commands/status.js');
    const command = createCmd();
    await command.parseAsync(['node', 'test']);

    expect(errorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
