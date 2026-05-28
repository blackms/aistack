/**
 * Sandbox security tests (AIG-634)
 *
 * These are PURE tests against the argv builder used by the Docker adapter.
 * They assert that conservative hardening flags are always present and that
 * the policy-violating shapes (host network, host volumes, --privileged,
 * --cap-add, --env-file, host env passthrough) are NEVER generated.
 *
 * We never spawn `docker` here — these run on any host, including CI without
 * Docker installed.
 */

import { describe, it, expect } from 'vitest';
import {
  buildDockerArgs,
  createSandbox,
  DEFAULT_SANDBOX_CONFIG,
  NoopSandbox,
  SandboxPolicyError,
} from '../../../src/sandbox/index.js';

function makeArgs(overrides: Partial<Parameters<typeof buildDockerArgs>[0]> = {}) {
  return buildDockerArgs({
    image: 'python:3.12-alpine',
    cmd: ['python3', '-'],
    timeoutMs: 5000,
    memoryMb: 512,
    cpus: 1,
    pidsLimit: 100,
    network: false,
    ...overrides,
  });
}

describe('sandbox/docker security flags', () => {
  it('disables network by default', () => {
    const args = makeArgs();
    const idx = args.indexOf('--network');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('none');
  });

  it('makes the rootfs read-only', () => {
    expect(makeArgs()).toContain('--read-only');
  });

  it('drops all Linux capabilities', () => {
    const args = makeArgs();
    const idx = args.indexOf('--cap-drop');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('ALL');
  });

  it('disallows privilege escalation via no-new-privileges', () => {
    const args = makeArgs();
    const idx = args.indexOf('--security-opt');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('no-new-privileges');
  });

  it('runs as the unprivileged "nobody" user (65534)', () => {
    const args = makeArgs();
    const idx = args.indexOf('--user');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('65534:65534');
  });

  it('applies memory, swap, cpu and pids caps', () => {
    const args = makeArgs({ memoryMb: 256, cpus: 0.5, pidsLimit: 50 });
    expect(args).toContain('--memory=256m');
    expect(args).toContain('--memory-swap=256m'); // no swap escape
    expect(args).toContain('--cpus=0.5');
    expect(args).toContain('--pids-limit=50');
  });

  it('mounts only tmpfs at /tmp and /sandbox — never host paths', () => {
    const args = makeArgs();
    const tmpfsFlags = args.filter((_, i) => args[i - 1] === '--tmpfs');
    expect(tmpfsFlags.length).toBe(2);
    for (const f of tmpfsFlags) {
      expect(f).toMatch(/^\/(tmp|sandbox):/);
    }
    expect(args).not.toContain('--volume');
    expect(args).not.toContain('-v');
  });

  it('NEVER emits --privileged', () => {
    expect(makeArgs()).not.toContain('--privileged');
  });

  it('NEVER emits --cap-add', () => {
    expect(makeArgs()).not.toContain('--cap-add');
  });

  it('NEVER emits --env-file or host env passthrough', () => {
    const args = makeArgs();
    expect(args).not.toContain('--env-file');
    // The only -e entries should be from the caller-provided allowlist
    // (none in this base case).
    expect(args.filter((a) => a === '-e').length).toBe(0);
  });

  it('opt-in network switches to bridge', () => {
    const args = makeArgs({ network: true });
    const idx = args.indexOf('--network');
    expect(args[idx + 1]).toBe('bridge');
  });

  it('forwards allowlisted env vars only', () => {
    const args = makeArgs({ env: { FOO: 'bar', BAZ: 'qux' } });
    const eFlags: string[] = [];
    args.forEach((a, i) => { if (a === '-e') eFlags.push(args[i + 1]); });
    expect(eFlags).toEqual(['FOO=bar', 'BAZ=qux']);
  });

  it('rejects invalid env var names (shell metacharacters)', () => {
    expect(() => makeArgs({ env: { 'BAD;NAME': 'x' } })).toThrow(SandboxPolicyError);
    expect(() => makeArgs({ env: { '$(rm -rf /)': 'x' } })).toThrow(SandboxPolicyError);
  });

  it('uses --rm so containers do not persist', () => {
    expect(makeArgs()).toContain('--rm');
  });

  it('reads code from stdin (-i), never from argv', () => {
    expect(makeArgs()).toContain('-i');
  });
});

describe('sandbox factory', () => {
  it('returns NoopSandbox by default', () => {
    const sbx = createSandbox();
    expect(sbx).toBeInstanceOf(NoopSandbox);
    expect(sbx.provider).toBe('none');
  });

  it('NoopSandbox refuses to execute', async () => {
    const sbx = createSandbox({ provider: 'none' });
    await expect(sbx.run('print(1)', { language: 'python' })).rejects.toThrow(
      SandboxPolicyError,
    );
  });

  it('exposes safe defaults', () => {
    expect(DEFAULT_SANDBOX_CONFIG.provider).toBe('none');
    expect(DEFAULT_SANDBOX_CONFIG.network).toBe(false);
    expect(DEFAULT_SANDBOX_CONFIG.memoryMb).toBeLessThanOrEqual(1024);
    expect(DEFAULT_SANDBOX_CONFIG.timeout).toBeLessThanOrEqual(60_000);
  });
});
