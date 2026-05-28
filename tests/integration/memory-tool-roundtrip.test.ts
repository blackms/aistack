/**
 * Integration: aistack memory <-> Anthropic Memory Tool round-trip (AIG-640).
 *
 *  - Direction 1: store via aistack -> readable via the tool adapter.
 *  - Direction 2: write via the tool adapter -> readable via aistack APIs.
 *  - Direction 3: filesystem <-> memory via BidirectionalSync.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  promises as fsp,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BidirectionalSync,
  MemoryManager,
  MemoryToolAdapter,
  resetMemoryManager,
} from '../../src/memory/index.js';
import type { AgentStackConfig } from '../../src/types.js';

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

describe('Memory Tool round-trip (AIG-640)', () => {
  let manager: MemoryManager;
  let dbPath: string;
  let watchPath: string;

  beforeEach(() => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    dbPath = join(tmpdir(), `aistack-rt-${stamp}.db`);
    watchPath = join(tmpdir(), `aistack-rt-watch-${stamp}`);
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

  it('aistack store -> Memory Tool view', async () => {
    await manager.store('hello.md', 'hi from aistack', { namespace: 'agent-memory' });
    const adapter = new MemoryToolAdapter(manager); // default namespace == 'agent-memory'
    const view = await adapter.handle({ command: 'view', path: '/memories/hello.md' });
    expect(view.ok).toBe(true);
    expect(view.content).toBe('hi from aistack');
  });

  it('Memory Tool create -> aistack get', async () => {
    const adapter = new MemoryToolAdapter(manager);
    await adapter.handle({
      command: 'create',
      path: '/memories/from-tool.md',
      file_text: 'written via tool',
    });
    const entry = manager.get('from-tool.md', 'agent-memory');
    expect(entry).not.toBeNull();
    expect(entry?.content).toBe('written via tool');
  });

  it('filesystem write -> sync import -> aistack get -> tool view', async () => {
    mkdirSync(watchPath, { recursive: true });
    await fsp.writeFile(join(watchPath, 'plan.md'), 'rendered by claude', 'utf8');

    const sync = new BidirectionalSync(manager, { watchPath, namespace: 'agent-memory' });
    const stats = await sync.tick();
    expect(stats.imported).toBe(1);

    const adapter = new MemoryToolAdapter(manager);
    const view = await adapter.handle({ command: 'view', path: '/memories/plan.md' });
    expect(view.content).toBe('rendered by claude');
  });

  it('tool create -> sync export -> file on disk', async () => {
    const adapter = new MemoryToolAdapter(manager);
    await adapter.handle({
      command: 'create',
      path: '/memories/export-me.md',
      file_text: 'persist me to disk',
    });

    const sync = new BidirectionalSync(manager, { watchPath, namespace: 'agent-memory' });
    const stats = await sync.exportAll();
    expect(stats.exported).toBeGreaterThanOrEqual(1);

    const onDisk = await fsp.readFile(join(watchPath, 'export-me.md'), 'utf8');
    expect(onDisk).toBe('persist me to disk');
  });
});
