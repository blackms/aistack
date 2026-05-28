/**
 * Memory Tool adapter tests (AIG-640).
 *
 * Exercises the Anthropic Memory Tool surface (view/create/str_replace/
 * insert/delete/rename) against a real in-memory SQLite store.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MemoryManager,
  MemoryToolAdapter,
  normalizeMemoryPath,
  resetMemoryManager,
} from '../../../src/memory/index.js';
import type { AgentStackConfig } from '../../../src/types.js';

function makeConfig(dbPath: string): AgentStackConfig {
  return {
    version: '1.0.0',
    memory: {
      path: dbPath,
      defaultNamespace: 'default',
      vectorSearch: { enabled: false },
    },
    providers: { default: 'anthropic' },
    agents: { maxConcurrent: 5, defaultTimeout: 300 },
    github: { enabled: false },
    plugins: { enabled: false, directory: './plugins' },
    mcp: { transport: 'stdio' },
    hooks: { sessionStart: true, sessionEnd: true, preTask: true, postTask: true },
  };
}

describe('normalizeMemoryPath', () => {
  it('strips the virtual root prefix', () => {
    expect(normalizeMemoryPath('/memories/notes/a.md')).toBe('notes/a.md');
  });

  it('accepts relative paths', () => {
    expect(normalizeMemoryPath('notes/a.md')).toBe('notes/a.md');
  });

  it('rejects empty path', () => {
    expect(() => normalizeMemoryPath('')).toThrow();
  });

  it('rejects path traversal', () => {
    expect(() => normalizeMemoryPath('/memories/../etc/passwd')).toThrow();
  });

  it('rejects paths outside the root', () => {
    expect(() => normalizeMemoryPath('/etc/passwd')).toThrow();
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(normalizeMemoryPath('notes\\sub\\a.md')).toBe('notes/sub/a.md');
  });
});

describe('MemoryToolAdapter', () => {
  let manager: MemoryManager;
  let adapter: MemoryToolAdapter;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `aistack-tool-adapter-${Date.now()}-${Math.random()}.db`);
    manager = new MemoryManager(makeConfig(dbPath));
    adapter = new MemoryToolAdapter(manager);
  });

  afterEach(() => {
    manager.close();
    resetMemoryManager();
    for (const suffix of ['', '-wal', '-shm']) {
      const p = `${dbPath}${suffix}`;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('reports its configuration', () => {
    expect(adapter.getConfig()).toEqual({ namespace: 'agent-memory', root: '/memories' });
  });

  it('create then view round-trip', async () => {
    const create = await adapter.handle({
      command: 'create',
      path: '/memories/notes/hello.md',
      file_text: 'hello world',
    });
    expect(create.ok).toBe(true);

    const view = await adapter.handle({ command: 'view', path: '/memories/notes/hello.md' });
    expect(view.ok).toBe(true);
    expect(view.content).toBe('hello world');
  });

  it('view on the root lists all entries', async () => {
    await adapter.handle({ command: 'create', path: '/memories/a.md', file_text: 'a' });
    await adapter.handle({ command: 'create', path: '/memories/b.md', file_text: 'b' });
    const view = await adapter.handle({ command: 'view', path: '/memories' });
    expect(view.ok).toBe(true);
    expect(view.content).toContain('/memories/a.md');
    expect(view.content).toContain('/memories/b.md');
  });

  it('view with view_range slices lines', async () => {
    const text = 'line1\nline2\nline3\nline4';
    await adapter.handle({ command: 'create', path: '/memories/multi.md', file_text: text });
    const view = await adapter.handle({
      command: 'view',
      path: '/memories/multi.md',
      view_range: [2, 3],
    });
    expect(view.ok).toBe(true);
    expect(view.content).toBe('line2\nline3');
  });

  it('view returns error for missing file', async () => {
    const view = await adapter.handle({ command: 'view', path: '/memories/missing.md' });
    expect(view.ok).toBe(false);
    expect(view.error).toContain('not found');
  });

  it('str_replace replaces a unique occurrence', async () => {
    await adapter.handle({ command: 'create', path: '/memories/x.md', file_text: 'foo bar baz' });
    const res = await adapter.handle({
      command: 'str_replace',
      path: '/memories/x.md',
      old_str: 'bar',
      new_str: 'BAR',
    });
    expect(res.ok).toBe(true);
    const view = await adapter.handle({ command: 'view', path: '/memories/x.md' });
    expect(view.content).toBe('foo BAR baz');
  });

  it('str_replace fails on duplicates', async () => {
    await adapter.handle({
      command: 'create',
      path: '/memories/x.md',
      file_text: 'foo foo foo',
    });
    const res = await adapter.handle({
      command: 'str_replace',
      path: '/memories/x.md',
      old_str: 'foo',
      new_str: 'bar',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('unique');
  });

  it('insert places text at the given line', async () => {
    await adapter.handle({
      command: 'create',
      path: '/memories/x.md',
      file_text: 'a\nb\nc',
    });
    const res = await adapter.handle({
      command: 'insert',
      path: '/memories/x.md',
      insert_line: 1,
      file_text: 'XX',
    });
    expect(res.ok).toBe(true);
    const view = await adapter.handle({ command: 'view', path: '/memories/x.md' });
    expect(view.content).toBe('a\nXX\nb\nc');
  });

  it('delete removes the entry', async () => {
    await adapter.handle({ command: 'create', path: '/memories/x.md', file_text: 'gone' });
    const res = await adapter.handle({ command: 'delete', path: '/memories/x.md' });
    expect(res.ok).toBe(true);
    const view = await adapter.handle({ command: 'view', path: '/memories/x.md' });
    expect(view.ok).toBe(false);
  });

  it('rename moves an entry to a new path', async () => {
    await adapter.handle({
      command: 'create',
      path: '/memories/old.md',
      file_text: 'data',
    });
    const res = await adapter.handle({
      command: 'rename',
      path: '/memories/old.md',
      new_path: '/memories/new.md',
    });
    expect(res.ok).toBe(true);
    expect((await adapter.handle({ command: 'view', path: '/memories/old.md' })).ok).toBe(false);
    expect((await adapter.handle({ command: 'view', path: '/memories/new.md' })).content).toBe(
      'data'
    );
  });

  it('rename refuses to overwrite an existing destination', async () => {
    await adapter.handle({ command: 'create', path: '/memories/a.md', file_text: '1' });
    await adapter.handle({ command: 'create', path: '/memories/b.md', file_text: '2' });
    const res = await adapter.handle({
      command: 'rename',
      path: '/memories/a.md',
      new_path: '/memories/b.md',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('destination');
  });

  it('rejects unknown commands', async () => {
    // @ts-expect-error — exercising defensive default
    const res = await adapter.handle({ command: 'noop', path: '/memories/x' });
    expect(res.ok).toBe(false);
  });
});
