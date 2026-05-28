/**
 * BidirectionalSync tests (AIG-640).
 *
 * Uses temp directories on disk and the real MemoryManager — no fs mocking
 * required because everything sandboxes under `tmpdir()`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  promises as fsp,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import {
  BidirectionalSync,
  MemoryManager,
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

describe('BidirectionalSync', () => {
  let manager: MemoryManager;
  let dbPath: string;
  let watchPath: string;

  beforeEach(() => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    dbPath = join(tmpdir(), `aistack-sync-${stamp}.db`);
    watchPath = join(tmpdir(), `aistack-sync-watch-${stamp}`);
    manager = new MemoryManager(makeConfig(dbPath));
  });

  afterEach(() => {
    manager.close();
    resetMemoryManager();
    for (const suffix of ['', '-wal', '-shm']) {
      const p = `${dbPath}${suffix}`;
      if (existsSync(p)) unlinkSync(p);
    }
    if (existsSync(watchPath)) rmSync(watchPath, { recursive: true, force: true });
  });

  it('ensureDir creates the watch directory', () => {
    const sync = new BidirectionalSync(manager, { watchPath });
    sync.ensureDir();
    expect(existsSync(watchPath)).toBe(true);
  });

  it('reports config', () => {
    const sync = new BidirectionalSync(manager, {
      watchPath,
      namespace: 'agent-memory',
      pollIntervalMs: 1234,
    });
    const cfg = sync.getConfig();
    expect(cfg.watchPath).toBe(watchPath);
    expect(cfg.namespace).toBe('agent-memory');
    expect(cfg.pollIntervalMs).toBe(1234);
  });

  it('imports new files from disk into memory', async () => {
    mkdirSync(watchPath, { recursive: true });
    await fsp.writeFile(join(watchPath, 'note.md'), 'imported content', 'utf8');
    const sync = new BidirectionalSync(manager, { watchPath, namespace: 'agent-memory' });
    const stats = await sync.tick();
    expect(stats.imported).toBe(1);
    const entry = manager.get('note.md', 'agent-memory');
    expect(entry?.content).toBe('imported content');
  });

  it('imports nested files preserving the path as a key', async () => {
    mkdirSync(join(watchPath, 'sub'), { recursive: true });
    await fsp.writeFile(join(watchPath, 'sub', 'deep.md'), 'deep', 'utf8');
    const sync = new BidirectionalSync(manager, { watchPath, namespace: 'agent-memory' });
    await sync.tick();
    const entry = manager.get('sub/deep.md', 'agent-memory');
    expect(entry?.content).toBe('deep');
  });

  it('exports memory entries to disk', async () => {
    await manager.store('exported.md', 'from memory', { namespace: 'agent-memory' });
    const sync = new BidirectionalSync(manager, { watchPath, namespace: 'agent-memory' });
    const stats = await sync.exportAll();
    expect(stats.exported).toBe(1);
    const onDisk = await fsp.readFile(join(watchPath, 'exported.md'), 'utf8');
    expect(onDisk).toBe('from memory');
  });

  it('skips identical content on subsequent ticks', async () => {
    await manager.store('a.md', 'same', { namespace: 'agent-memory' });
    const sync = new BidirectionalSync(manager, { watchPath, namespace: 'agent-memory' });
    await sync.tick(); // first tick exports
    const second = await sync.tick();
    expect(second.exported).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(1);
  });

  it('exportEntry writes a single entry on demand', async () => {
    await manager.store('on-demand.md', 'now', { namespace: 'agent-memory' });
    const sync = new BidirectionalSync(manager, { watchPath, namespace: 'agent-memory' });
    const ok = await sync.exportEntry('on-demand.md');
    expect(ok).toBe(true);
    const onDisk = await fsp.readFile(join(watchPath, 'on-demand.md'), 'utf8');
    expect(onDisk).toBe('now');
  });

  it('respects importEnabled=false', async () => {
    mkdirSync(watchPath, { recursive: true });
    await fsp.writeFile(join(watchPath, 'ignored.md'), 'should not import', 'utf8');
    const sync = new BidirectionalSync(manager, {
      watchPath,
      namespace: 'agent-memory',
      importEnabled: false,
    });
    const stats = await sync.tick();
    expect(stats.imported).toBe(0);
    expect(manager.get('ignored.md', 'agent-memory')).toBeNull();
  });

  it('respects exportEnabled=false', async () => {
    await manager.store('hidden.md', 'do not write', { namespace: 'agent-memory' });
    const sync = new BidirectionalSync(manager, {
      watchPath,
      namespace: 'agent-memory',
      exportEnabled: false,
    });
    const stats = await sync.tick();
    expect(stats.exported).toBe(0);
    expect(existsSync(join(watchPath, 'hidden.md'))).toBe(false);
  });

  it('start/stop lifecycle is idempotent', () => {
    const sync = new BidirectionalSync(manager, {
      watchPath,
      pollIntervalMs: 10_000,
    });
    sync.start();
    sync.start();
    sync.stop();
    sync.stop();
    // No assertions beyond not throwing — interval is unref'd so it never blocks.
  });

  // POSIX-only: file permission bits are largely a no-op on Windows.
  const itPosix = platform() === 'win32' ? it.skip : it;

  itPosix('ensureDir creates directory with 0o700 permissions', () => {
    const sync = new BidirectionalSync(manager, { watchPath });
    sync.ensureDir();
    const mode = statSync(watchPath).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  itPosix('exported files have 0o600 permissions', async () => {
    await manager.store('secret.md', 'sensitive', { namespace: 'agent-memory' });
    const sync = new BidirectionalSync(manager, { watchPath, namespace: 'agent-memory' });
    await sync.exportAll();
    const filePath = join(watchPath, 'secret.md');
    expect(existsSync(filePath)).toBe(true);
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  itPosix('exportEntry writes a file with 0o600 permissions', async () => {
    await manager.store('one.md', 'x', { namespace: 'agent-memory' });
    const sync = new BidirectionalSync(manager, { watchPath, namespace: 'agent-memory' });
    await sync.exportEntry('one.md');
    const mode = statSync(join(watchPath, 'one.md')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  itPosix('ensureDir tightens permissions on a pre-existing loose directory', () => {
    mkdirSync(watchPath, { recursive: true, mode: 0o755 });
    // Force loose perms in case umask masked the mode above.
    chmodSync(watchPath, 0o755);
    const sync = new BidirectionalSync(manager, { watchPath });
    sync.ensureDir();
    const mode = statSync(watchPath).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('start() installs process shutdown handlers', () => {
    const sigtermBefore = process.listenerCount('SIGTERM');
    const sigintBefore = process.listenerCount('SIGINT');
    const sync = new BidirectionalSync(manager, {
      watchPath,
      pollIntervalMs: 10_000,
    });
    sync.start();
    expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore + 1);
    expect(process.listenerCount('SIGINT')).toBe(sigintBefore + 1);
    sync.stop();
    // Handlers de-registered on stop.
    expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore);
    expect(process.listenerCount('SIGINT')).toBe(sigintBefore);
  });
});
