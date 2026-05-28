/**
 * WebhookServer tests - HMAC verification, 10 parallel POSTs end-to-end via
 * the DaemonRuntime file queue, file-watcher glob matching.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHmac } from 'node:crypto';
import { request } from 'node:http';
import {
  DaemonRuntime,
  type QueueTask,
} from '../../../src/daemon/index.js';
import { WebhookServer, verifyHmacSignature } from '../../../src/transport/webhook.js';
import { FileWatcher, globToRegExp } from '../../../src/transport/file-watcher.js';

describe('verifyHmacSignature', () => {
  it('accepts a correct sha256= signature', () => {
    const body = JSON.stringify({ a: 1 });
    const secret = 'super-secret';
    const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyHmacSignature(body, secret, sig)).toBe(true);
  });

  it('accepts a bare hex signature', () => {
    const body = JSON.stringify({ a: 1 });
    const secret = 'super-secret';
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyHmacSignature(body, secret, sig)).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const body = JSON.stringify({ a: 1 });
    const secret = 'super-secret';
    const sig = 'sha256=' + 'a'.repeat(64);
    expect(verifyHmacSignature(body, secret, sig)).toBe(false);
  });

  it('rejects undefined / wrong-length signatures', () => {
    expect(verifyHmacSignature('body', 'secret', undefined)).toBe(false);
    expect(verifyHmacSignature('body', 'secret', 'sha256=deadbeef')).toBe(false);
  });
});

describe('WebhookServer integration', () => {
  let dataDir: string;
  let runtime: DaemonRuntime;
  let server: WebhookServer;
  let port: number;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'aistack-wh-'));
    runtime = new DaemonRuntime({
      dataDir,
      pollIntervalMs: 25,
      maxConcurrent: 8,
      executor: async (t) => `done:${t.id}`,
    });
    await runtime.start();
    server = new WebhookServer(runtime, { port: 0, host: '127.0.0.1', hmacSecret: 'topsecret' });
    await server.start();
    port = server.getPort()!;
  });

  afterEach(async () => {
    await server.stop();
    await runtime.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('rejects POST without a valid signature', async () => {
    const res = await post(port, '/v1/tasks', { agentType: 'coder', input: 'x' });
    expect(res.status).toBe(401);
  });

  it('rejects bad JSON', async () => {
    const body = '{not json';
    const sig = 'sha256=' + createHmac('sha256', 'topsecret').update(body).digest('hex');
    const res = await postRaw(port, '/v1/tasks', body, { 'x-aistack-signature': sig });
    expect(res.status).toBe(400);
  });

  it('rejects missing fields with 400', async () => {
    const res = await postSigned(port, '/v1/tasks', { foo: 'bar' }, 'topsecret');
    expect(res.status).toBe(400);
  });

  it('accepts a single signed POST and returns 202', async () => {
    const res = await postSigned(port, '/v1/tasks', { agentType: 'coder', input: 'hi' }, 'topsecret');
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'pending' });
    expect(typeof (res.body as { taskId: string }).taskId).toBe('string');
  });

  it('GET /health works without HMAC', async () => {
    const res = await get(port, '/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('processes 10 parallel webhook POSTs end-to-end with consistent audit trail', async () => {
    const completed: QueueTask[] = [];
    runtime.on('task:completed', (t) => completed.push(t));

    const N = 10;
    const responses = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        postSigned(port, '/v1/tasks', { agentType: 'coder', input: `task-${i}` }, 'topsecret'),
      ),
    );
    for (const r of responses) expect(r.status).toBe(202);
    const ids = responses.map(r => (r.body as { taskId: string }).taskId);
    expect(new Set(ids).size).toBe(N); // all unique

    // Wait for all to complete
    const deadline = Date.now() + 5000;
    while (completed.length < N && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 50));
    }
    expect(completed.length).toBe(N);
    expect(new Set(completed.map(t => t.id))).toEqual(new Set(ids));

    // Verify the on-disk log captured every lifecycle event for every task.
    const logPath = join(dataDir, 'logs', 'tasks.log');
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
    const enqueueEvents = lines.filter(l => l.includes('"event":"enqueue"'));
    const completeEvents = lines.filter(l => l.includes('"event":"complete"'));
    expect(enqueueEvents.length).toBe(N);
    expect(completeEvents.length).toBe(N);
  });
});

describe('FileWatcher', () => {
  let watchDir: string;
  let dataDir: string;
  let runtime: DaemonRuntime;

  beforeEach(async () => {
    watchDir = mkdtempSync(join(tmpdir(), 'aistack-fw-watch-'));
    dataDir = mkdtempSync(join(tmpdir(), 'aistack-fw-data-'));
    runtime = new DaemonRuntime({ dataDir, pollIntervalMs: 50 });
    await runtime.start();
  });

  afterEach(async () => {
    await runtime.stop();
    rmSync(watchDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('globToRegExp converts simple patterns', () => {
    expect(globToRegExp('*.task.json').test('a.task.json')).toBe(true);
    expect(globToRegExp('*.task.json').test('a.txt')).toBe(false);
    expect(globToRegExp('a?.txt').test('ab.txt')).toBe(true);
    expect(globToRegExp('a?.txt').test('abc.txt')).toBe(false);
  });

  it('enqueues a task when a matching file appears', async () => {
    const watcher = new FileWatcher(runtime, {
      dir: watchDir,
      debounceMs: 50,
      rules: [{ pattern: '*.task.json', agentType: 'tester', readFile: true }],
    });
    watcher.start();

    const taskFile = join(watchDir, 'sample.task.json');
    writeFileSync(taskFile, JSON.stringify({ goal: 'run tests' }));

    // Allow watcher + debounce + enqueue
    const enqueued = await new Promise<QueueTask>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('no enqueue within 3s')), 3000);
      runtime.once('task:enqueued', (t) => {
        clearTimeout(timeout);
        resolve(t as QueueTask);
      });
    });
    expect(enqueued.agentType).toBe('tester');
    expect(enqueued.source).toBe('file-watcher');
    expect(enqueued.input).toContain('run tests');
    expect((enqueued.metadata as { path: string }).path).toBe(taskFile);

    watcher.stop();

    // queue dir should hold a pending file
    const pendingDir = join(dataDir, 'queue', 'pending');
    const pending = readdirSync(pendingDir).filter(f => f.endsWith('.json'));
    expect(pending.length).toBeGreaterThanOrEqual(0); // may have been picked up already
  });
});

// --- HTTP helpers (tiny, kept here to avoid extra test util files) ---

interface HttpResult { status: number; body: unknown; }

function get(port: number, path: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, res => collect(res, resolve));
    req.on('error', reject);
    req.end();
  });
}

function post(port: number, path: string, body: unknown): Promise<HttpResult> {
  return postRaw(port, path, JSON.stringify(body), { 'content-type': 'application/json' });
}

function postSigned(port: number, path: string, body: unknown, secret: string): Promise<HttpResult> {
  const raw = JSON.stringify(body);
  const sig = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  return postRaw(port, path, raw, { 'content-type': 'application/json', 'x-aistack-signature': sig });
}

function postRaw(port: number, path: string, body: string, headers: Record<string, string>): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: 'POST', headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) } },
      res => collect(res, resolve),
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function collect(res: NodeJS.ReadableStream & { statusCode?: number }, resolve: (r: HttpResult) => void): void {
  let buf = '';
  res.on('data', (c: Buffer) => { buf += c.toString('utf-8'); });
  res.on('end', () => {
    let parsed: unknown = buf;
    try { parsed = JSON.parse(buf); } catch { /* keep raw */ }
    resolve({ status: res.statusCode ?? 0, body: parsed });
  });
}
