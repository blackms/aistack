/**
 * Sandbox adapter integration tests (AIG-634)
 *
 * Covers all three production providers in one file (file-count budget):
 *   - DockerSandbox  — live, skipped when docker daemon unreachable
 *   - E2BSandbox     — error path always; live test skipped without E2B_API_KEY
 *   - DaytonaSandbox — HTTP mocked; never hits the network
 *
 * Pure argv-builder hardening assertions live in ./security.test.ts.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { DockerSandbox } from '../../../src/sandbox/docker.js';
import { E2BSandbox } from '../../../src/sandbox/e2b.js';
import { DaytonaSandbox } from '../../../src/sandbox/daytona.js';
import { DEFAULT_SANDBOX_CONFIG } from '../../../src/sandbox/index.js';
import { SandboxUnavailableError } from '../../../src/sandbox/types.js';

// ---------- Docker (live) ----------

function dockerAvailable(): boolean {
  if (process.env.SKIP_DOCKER_SANDBOX_TESTS === '1') return false;
  try {
    const r = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      stdio: 'ignore',
      timeout: 3000,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

const HAS_DOCKER = dockerAvailable();
const dockerSuite = HAS_DOCKER ? describe : describe.skip;

dockerSuite('DockerSandbox (live)', () => {
  const sbx = new DockerSandbox({
    ...DEFAULT_SANDBOX_CONFIG,
    provider: 'docker',
    timeout: 20_000,
  });

  it('runs python hello world', async () => {
    const res = await sbx.run('print("hello python")', { language: 'python', timeout: 20_000 });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('hello python');
  }, 60_000);

  it('runs javascript hello world', async () => {
    const res = await sbx.run('console.log("hello node")', { language: 'javascript', timeout: 20_000 });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('hello node');
  }, 60_000);

  it('runs bash hello world', async () => {
    const res = await sbx.run('echo hello bash', { language: 'bash', timeout: 20_000 });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('hello bash');
  }, 60_000);
});

if (!HAS_DOCKER) {
  // Make the skip visible in test reports without spawning anything.
  describe.skip('DockerSandbox (live)', () => {
    it('skipped: docker daemon not reachable', () => { /* no-op */ });
  });
}

// ---------- E2B ----------

async function e2bSdkAvailable(): Promise<boolean> {
  try {
    await import('@e2b/code-interpreter' as string);
    return true;
  } catch {
    return false;
  }
}

const HAS_E2B_KEY = !!process.env.E2B_API_KEY;

describe('E2BSandbox', () => {
  it('throws SandboxUnavailableError when no API key', async () => {
    const prev = process.env.E2B_API_KEY;
    delete process.env.E2B_API_KEY;
    try {
      const sbx = new E2BSandbox({ ...DEFAULT_SANDBOX_CONFIG, provider: 'e2b' });
      await expect(sbx.run('print(1)', { language: 'python' })).rejects.toBeInstanceOf(
        SandboxUnavailableError,
      );
    } finally {
      if (prev !== undefined) process.env.E2B_API_KEY = prev;
    }
  });

  (HAS_E2B_KEY ? it : it.skip)('runs python hello world (live)', async () => {
    if (!(await e2bSdkAvailable())) {
      const sbx = new E2BSandbox({ ...DEFAULT_SANDBOX_CONFIG, provider: 'e2b' });
      await expect(sbx.run('print(1)', { language: 'python' })).rejects.toBeInstanceOf(
        SandboxUnavailableError,
      );
      return;
    }
    const sbx = new E2BSandbox({ ...DEFAULT_SANDBOX_CONFIG, provider: 'e2b', timeout: 30_000 });
    const res = await sbx.run('print("hello e2b")', { language: 'python', timeout: 30_000 });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('hello e2b');
  }, 60_000);
});

// ---------- Daytona (mocked HTTP) ----------

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init ?? {}),
  ) as unknown as typeof fetch;
}

describe('DaytonaSandbox', () => {
  it('throws SandboxUnavailableError when daytonaApiUrl missing', async () => {
    const sbx = new DaytonaSandbox({ ...DEFAULT_SANDBOX_CONFIG, provider: 'daytona' });
    await expect(sbx.run('print(1)', { language: 'python' })).rejects.toBeInstanceOf(
      SandboxUnavailableError,
    );
  });

  it('throws SandboxUnavailableError when API key missing', async () => {
    const prev = process.env.DAYTONA_API_KEY;
    delete process.env.DAYTONA_API_KEY;
    try {
      const sbx = new DaytonaSandbox({
        ...DEFAULT_SANDBOX_CONFIG,
        provider: 'daytona',
        daytonaApiUrl: 'https://daytona.example.com',
      });
      await expect(sbx.run('print(1)', { language: 'python' })).rejects.toBeInstanceOf(
        SandboxUnavailableError,
      );
    } finally {
      if (prev !== undefined) process.env.DAYTONA_API_KEY = prev;
    }
  });

  it('runs python hello world via mocked HTTP', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    mockFetch((url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/sandboxes') && init.method === 'POST') {
        return new Response(JSON.stringify({ id: 'sbx-123' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/sandboxes/sbx-123/exec')) {
        return new Response(
          JSON.stringify({ stdout: 'hello daytona\n', stderr: '', exitCode: 0 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/sandboxes/sbx-123')) {
        return new Response(null, { status: 204 });
      }
      return new Response('not found', { status: 404 });
    });

    const sbx = new DaytonaSandbox({
      ...DEFAULT_SANDBOX_CONFIG,
      provider: 'daytona',
      daytonaApiUrl: 'https://daytona.example.com/api',
      daytonaApiKey: 'super-secret-token',
    });

    const res = await sbx.run('print("hello daytona")', { language: 'python', timeout: 10_000 });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe('hello daytona\n');
    expect(res.provider).toBe('daytona');

    const auth = (requests[0].init.headers as Record<string, string>).authorization;
    expect(auth).toBe('Bearer super-secret-token');

    expect(
      requests.some((r) => r.init.method === 'DELETE' && r.url.endsWith('/sandboxes/sbx-123')),
    ).toBe(true);
  });

  it('does NOT include API key in error messages', async () => {
    mockFetch(() => new Response('forbidden', { status: 403 }));

    const sbx = new DaytonaSandbox({
      ...DEFAULT_SANDBOX_CONFIG,
      provider: 'daytona',
      daytonaApiUrl: 'https://daytona.example.com/api',
      daytonaApiKey: 'super-secret-token',
    });

    let err: unknown;
    try {
      await sbx.run('print(1)', { language: 'python', timeout: 5000 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect((err as Error).message).not.toContain('super-secret-token');
  });
});
