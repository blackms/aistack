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
import { SandboxConfigError, SandboxUnavailableError } from '../../../src/sandbox/types.js';

// Force every DNS lookup that fires during these tests to a public address —
// stops vitest from making real outbound queries for `daytona.example.com`
// and gives the SSRF allowlist a deterministic answer to validate against.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => {
    if (host === 'private.example.test') return { address: '10.1.2.3', family: 4 };
    if (host === 'nonexistent.invalid') throw new Error('ENOTFOUND');
    return { address: '93.184.216.34', family: 4 }; // example.com — public
  }),
}));

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

  // ----- Stdin protocol regression: AIG-634 -----
  // Daytona was previously sending `python3 -c` / `node -e` / `sh -c` AND
  // shipping the code via the `stdin` field. With `-c`/`-e` the interpreter
  // never reads stdin so the program ran as empty. We now use stdin-reader
  // argv forms and the code MUST land in the `stdin` body field unmodified.
  it('exec body carries the program via stdin and uses stdin-reader argv (no -c/-e)', async () => {
    const captured: Array<{ url: string; body: unknown }> = [];
    mockFetch((url, init) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
      captured.push({ url, body });
      if (url.endsWith('/sandboxes') && init.method === 'POST') {
        return new Response(JSON.stringify({ id: 'sbx-stdin' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/exec')) {
        return new Response(
          JSON.stringify({ stdout: 'hi\n', stderr: '', exitCode: 0 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(null, { status: 204 });
    });

    const sbx = new DaytonaSandbox({
      ...DEFAULT_SANDBOX_CONFIG,
      provider: 'daytona',
      daytonaApiUrl: 'https://daytona.example.com/api',
      daytonaApiKey: 'tok',
    });

    const program = 'print("hi")';
    const res = await sbx.run(program, { language: 'python', timeout: 5000 });
    expect(res.stdout).toBe('hi\n');

    const exec = captured.find((r) => r.url.includes('/exec'))!;
    const execBody = exec.body as { command: string[]; stdin: string };
    expect(execBody.stdin).toBe(program);
    // The argv MUST be a stdin-reader form. We refuse both -c and -e because
    // they cause the interpreter to ignore stdin entirely.
    expect(execBody.command).not.toContain('-c');
    expect(execBody.command).not.toContain('-e');
    // Python convention: a literal "-" means "read from stdin".
    expect(execBody.command).toEqual(['python3', '-']);
  });

  it('javascript and bash also use stdin-reader argv (no -c/-e/-e)', async () => {
    const captured: Array<{ url: string; body: unknown }> = [];
    mockFetch((url, init) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
      captured.push({ url, body });
      if (url.endsWith('/sandboxes')) {
        return new Response(JSON.stringify({ id: 'sbx-js' }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/exec')) {
        return new Response(JSON.stringify({ stdout: '', stderr: '', exitCode: 0 }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(null, { status: 204 });
    });

    const sbx = new DaytonaSandbox({
      ...DEFAULT_SANDBOX_CONFIG,
      provider: 'daytona',
      daytonaApiUrl: 'https://daytona.example.com/api',
      daytonaApiKey: 'tok',
    });

    await sbx.run('console.log(1)', { language: 'javascript', timeout: 5000 });
    await sbx.run('echo hi', { language: 'bash', timeout: 5000 });

    const execs = captured.filter((r) => r.url.includes('/exec')).map((r) => r.body as { command: string[] });
    expect(execs[0].command).toEqual(['node']);                  // no -e
    expect(execs[1].command).toEqual(['sh', '-s']);              // no -c
  });

  // ----- SSRF allowlist: AIG-634 -----
  describe('daytonaApiUrl SSRF allowlist', () => {
    it('rejects http:// scheme at construction', () => {
      expect(
        () =>
          new DaytonaSandbox({
            ...DEFAULT_SANDBOX_CONFIG,
            provider: 'daytona',
            daytonaApiUrl: 'http://daytona.example.com',
            daytonaApiKey: 'tok',
          }),
      ).toThrow(SandboxConfigError);
    });

    it('rejects file:// scheme at construction', () => {
      expect(
        () =>
          new DaytonaSandbox({
            ...DEFAULT_SANDBOX_CONFIG,
            provider: 'daytona',
            daytonaApiUrl: 'file:///etc/passwd',
            daytonaApiKey: 'tok',
          }),
      ).toThrow(SandboxConfigError);
    });

    it('rejects gopher:// and ftp:// schemes at construction', () => {
      for (const url of ['gopher://attacker.example.com/_GET', 'ftp://example.com/']) {
        expect(
          () =>
            new DaytonaSandbox({
              ...DEFAULT_SANDBOX_CONFIG,
              provider: 'daytona',
              daytonaApiUrl: url,
              daytonaApiKey: 'tok',
            }),
        ).toThrow(SandboxConfigError);
      }
    });

    it('rejects literal private IPs (RFC1918, loopback, link-local) at construction', () => {
      const bad = [
        'https://127.0.0.1/',
        'https://10.0.0.5/',
        'https://172.16.0.1/',
        'https://172.31.255.254/',
        'https://192.168.1.1/',
        'https://169.254.169.254/', // EC2 metadata
        'https://[::1]/',
        'https://[fc00::1]/',
        'https://[fe80::1]/',
      ];
      for (const url of bad) {
        expect(
          () =>
            new DaytonaSandbox({
              ...DEFAULT_SANDBOX_CONFIG,
              provider: 'daytona',
              daytonaApiUrl: url,
              daytonaApiKey: 'tok',
            }),
          `expected ${url} to be rejected`,
        ).toThrow(SandboxConfigError);
      }
    });

    it('rejects localhost-family hostnames at construction', () => {
      for (const url of ['https://localhost/', 'https://app.localhost/']) {
        expect(
          () =>
            new DaytonaSandbox({
              ...DEFAULT_SANDBOX_CONFIG,
              provider: 'daytona',
              daytonaApiUrl: url,
              daytonaApiKey: 'tok',
            }),
        ).toThrow(SandboxConfigError);
      }
    });

    it('rejects hostnames that resolve to private IPs at first run', async () => {
      // Construction passes (DNS not consulted) — the rejection lands on run().
      const sbx = new DaytonaSandbox({
        ...DEFAULT_SANDBOX_CONFIG,
        provider: 'daytona',
        daytonaApiUrl: 'https://private.example.test/api',
        daytonaApiKey: 'tok',
      });
      // fetch must NEVER be called — if SSRF guard fires correctly, the
      // request is aborted before any network hit.
      mockFetch(() => {
        throw new Error('fetch must not be called when SSRF guard rejects');
      });
      await expect(sbx.run('print(1)', { language: 'python', timeout: 5000 })).rejects.toBeInstanceOf(
        SandboxConfigError,
      );
    });

    it('accepts a public https URL', () => {
      expect(
        () =>
          new DaytonaSandbox({
            ...DEFAULT_SANDBOX_CONFIG,
            provider: 'daytona',
            daytonaApiUrl: 'https://daytona.example.com/api',
            daytonaApiKey: 'tok',
          }),
      ).not.toThrow();
    });
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
