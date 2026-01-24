/**
 * CLI Init Command Handler tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInitCommand } from '../../src/cli/commands/init.js';

describe('Init Command Handler', () => {
  let tempDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = join(tmpdir(), `aistack-init-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should initialize a new project', async () => {
    const command = createInitCommand();
    await command.parseAsync(['node', 'test', '--directory', tempDir]);

    expect(consoleSpy).toHaveBeenCalled();
    const calls = consoleSpy.mock.calls.map(c => c[0]);

    expect(calls.some(c => c?.includes?.('Initializing aistack project'))).toBe(true);
    expect(calls.some(c => c?.includes?.('Project initialized successfully'))).toBe(true);

    // Check files were created
    expect(existsSync(join(tempDir, 'aistack.config.json'))).toBe(true);
    expect(existsSync(join(tempDir, 'data'))).toBe(true);
    expect(existsSync(join(tempDir, 'data', '.gitignore'))).toBe(true);
  });

  it('should fail if project already initialized without force', async () => {
    // Initialize once
    const command1 = createInitCommand();
    await command1.parseAsync(['node', 'test', '--directory', tempDir]);

    // Try to initialize again
    const command2 = createInitCommand();
    await command2.parseAsync(['node', 'test', '--directory', tempDir]);

    expect(errorSpy).toHaveBeenCalledWith('Project already initialized. Use --force to overwrite.');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should overwrite with force flag', async () => {
    // Initialize once
    const command1 = createInitCommand();
    await command1.parseAsync(['node', 'test', '--directory', tempDir]);

    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Initialize again with force
    const command2 = createInitCommand();
    await command2.parseAsync(['node', 'test', '--directory', tempDir, '--force']);

    expect(consoleSpy).toHaveBeenCalled();
    const calls = consoleSpy.mock.calls.map(c => c[0]);
    expect(calls.some(c => c?.includes?.('Project initialized successfully'))).toBe(true);
  });

  it('should show next steps after initialization', async () => {
    const command = createInitCommand();
    await command.parseAsync(['node', 'test', '--directory', tempDir]);

    const calls = consoleSpy.mock.calls.map(c => c[0]);
    expect(calls.some(c => c?.includes?.('Next steps'))).toBe(true);
    expect(calls.some(c => c?.includes?.('Configure providers'))).toBe(true);
  });
});
