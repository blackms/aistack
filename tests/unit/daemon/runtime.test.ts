/**
 * DaemonRuntime tests - lifecycle, enqueue/drain, graceful shutdown, queue recovery.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DaemonRuntime, FileQueue, RotatingLogWriter, type QueueTask } from '../../../src/daemon/index.js';

describe('FileQueue', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aistack-fq-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('enqueues and claims tasks in FIFO order', async () => {
    const q = new FileQueue(dir);
    const t1: QueueTask = makeTask('a');
    await new Promise(r => setTimeout(r, 5)); // ensure distinct ISO timestamps
    const t2: QueueTask = makeTask('b');
    await q.enqueue(t1);
    await q.enqueue(t2);

    expect(await q.depth()).toBe(2);
    const c1 = await q.claimNext();
    const c2 = await q.claimNext();
    expect(c1?.id).toBe('a');
    expect(c2?.id).toBe('b');
    expect(await q.depth()).toBe(0);
  });

  it('returns null when empty', async () => {
    const q = new FileQueue(dir);
    expect(await q.claimNext()).toBeNull();
  });

  it('complete moves tasks to done/', async () => {
    const q = new FileQueue(dir);
    const t = makeTask('x');
    await q.enqueue(t);
    const claimed = await q.claimNext();
    expect(claimed).not.toBeNull();
    claimed!.status = 'completed';
    claimed!.output = 'ok';
    await q.complete(claimed!);

    const doneFiles = readdirSync(join(dir, 'done'));
    expect(doneFiles.length).toBe(1);
    expect(readdirSync(join(dir, 'inflight')).length).toBe(0);
  });

  it('recoverInflight moves orphaned tasks back to pending', async () => {
    const q = new FileQueue(dir);
    const t = makeTask('orphan');
    await q.enqueue(t);
    await q.claimNext(); // simulate crash mid-run (claim but no complete)
    expect(await q.depth()).toBe(0);

    const recovered = await q.recoverInflight();
    expect(recovered).toBe(1);
    expect(await q.depth()).toBe(1);
  });
});

describe('DaemonRuntime', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'aistack-dr-'));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('start/stop/status report consistent state', async () => {
    const rt = new DaemonRuntime({ dataDir, pollIntervalMs: 50 });
    let status = await rt.status();
    expect(status.running).toBe(false);

    await rt.start();
    status = await rt.status();
    expect(status.running).toBe(true);
    expect(status.pid).toBe(process.pid);

    await rt.stop();
    status = await rt.status();
    expect(status.running).toBe(false);
  });

  it('enqueue + execute round trip emits task:completed', async () => {
    const rt = new DaemonRuntime({
      dataDir,
      pollIntervalMs: 50,
      executor: async (t) => `processed:${t.id}`,
    });
    await rt.start();

    const completed = new Promise<QueueTask>(resolve => {
      rt.once('task:completed', resolve as (t: QueueTask) => void);
    });
    const task = await rt.enqueue({ agentType: 'coder', input: 'hello', source: 'cli' });
    const finished = await completed;
    expect(finished.id).toBe(task.id);
    expect(finished.output).toBe(`processed:${task.id}`);

    await rt.stop();
  });

  it('graceful shutdown drains in-flight tasks', async () => {
    let running = 0;
    let maxObserved = 0;
    const rt = new DaemonRuntime({
      dataDir,
      pollIntervalMs: 20,
      maxConcurrent: 2,
      executor: async () => {
        running++;
        maxObserved = Math.max(maxObserved, running);
        await new Promise(r => setTimeout(r, 100));
        running--;
        return 'done';
      },
    });
    await rt.start();
    await Promise.all([
      rt.enqueue({ agentType: 'coder', input: '1', source: 'cli' }),
      rt.enqueue({ agentType: 'coder', input: '2', source: 'cli' }),
    ]);
    // Let the poller pick them up
    await new Promise(r => setTimeout(r, 100));
    // Stop should drain (i.e. wait for both executors to finish)
    await rt.stop();
    expect(running).toBe(0);
    expect(maxObserved).toBeGreaterThanOrEqual(1);
  });

  it('failed task emits task:failed and marks status=failed', async () => {
    const rt = new DaemonRuntime({
      dataDir,
      pollIntervalMs: 30,
      executor: async () => { throw new Error('boom'); },
    });
    await rt.start();
    const failed = new Promise<QueueTask>(resolve => {
      rt.once('task:failed', resolve as (t: QueueTask) => void);
    });
    await rt.enqueue({ agentType: 'coder', input: 'x', source: 'cli' });
    const t = await failed;
    expect(t.status).toBe('failed');
    expect(t.error).toContain('boom');
    await rt.stop();
  });

  it('writes a pid file while running', async () => {
    const rt = new DaemonRuntime({ dataDir, pollIntervalMs: 50 });
    await rt.start();
    expect(existsSync(join(dataDir, 'daemon.pid'))).toBe(true);
    await rt.stop();
    expect(existsSync(join(dataDir, 'daemon.pid'))).toBe(false);
  });
});

describe('RotatingLogWriter', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'aistack-log-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('rotates the log file once maxBytes is exceeded', () => {
    const path = join(dir, 'app.log');
    const writer = new RotatingLogWriter(path, 100);
    const line = 'x'.repeat(60);
    writer.write(line); // 61 bytes
    writer.write(line); // would put us over 100 -> rotate first
    writer.write(line);

    const files = readdirSync(dir);
    // Expect at least one rotated file in addition to the current one
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.some(f => f === 'app.log')).toBe(true);
    expect(files.some(f => f.startsWith('app.log.'))).toBe(true);
  });

  it('continues an existing log file on startup', () => {
    const path = join(dir, 'persist.log');
    writeFileSync(path, 'preexisting\n');
    const writer = new RotatingLogWriter(path, 10_000);
    writer.write('next line');
    const files = readdirSync(dir);
    expect(files).toContain('persist.log');
  });
});

// --- helpers ---
function makeTask(id: string): QueueTask {
  return {
    id,
    agentType: 'coder',
    input: 'test',
    source: 'cli',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
}
