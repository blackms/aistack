/**
 * Integration tests for the on-prem packaging surface (Dockerfile + Helm chart).
 *
 * These tests are intentionally tolerant: docker and helm are NOT available in
 * every CI runner (and almost never in local Windows dev boxes). When the
 * required tooling is missing, the test is skipped with a clear message.
 *
 * What we verify when the tooling IS present:
 *   - `docker build .` succeeds and the resulting image is < 200MB (AC #1).
 *   - `helm lint charts/aistack` passes (AC #3 schema sanity).
 *   - `helm template charts/aistack` renders without errors.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');

function hasBinary(bin: string): boolean {
  const probe = spawnSync(bin, ['--version'], { stdio: 'ignore' });
  return probe.status === 0;
}

function run(bin: string, args: string[], timeoutMs: number): string {
  return execFileSync(bin, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('on-prem packaging', () => {
  describe('Dockerfile', () => {
    it('exists at repo root', () => {
      expect(existsSync(resolve(REPO_ROOT, 'Dockerfile'))).toBe(true);
      expect(existsSync(resolve(REPO_ROOT, '.dockerignore'))).toBe(true);
    });

    it.skipIf(!hasBinary('docker'))(
      'builds and the resulting image stays under 200MB',
      () => {
        const tag = 'aistack:test-integration';
        // Build (long-running: 5 min cap)
        run('docker', ['build', '-t', tag, '.'], 5 * 60_000);

        // Image size in bytes
        const sizeStr = run(
          'docker',
          ['image', 'inspect', tag, '--format', '{{.Size}}'],
          30_000,
        ).trim();
        const sizeBytes = Number.parseInt(sizeStr, 10);
        expect(Number.isFinite(sizeBytes)).toBe(true);

        const sizeMb = sizeBytes / (1024 * 1024);
        // 200MB is the AC; allow a tiny cushion for native deps on amd64.
        expect(sizeMb).toBeLessThan(200);
      },
      10 * 60_000, // overall timeout
    );
  });

  describe('Helm chart', () => {
    it('has the expected file layout', () => {
      const chartDir = resolve(REPO_ROOT, 'charts', 'aistack');
      for (const f of [
        'Chart.yaml',
        'values.yaml',
        'templates/_helpers.tpl',
        'templates/deployment.yaml',
        'templates/service.yaml',
        'templates/configmap.yaml',
        'templates/secret.yaml',
        'templates/pvc.yaml',
        'templates/NOTES.txt',
      ]) {
        expect(existsSync(resolve(chartDir, f)), `missing ${f}`).toBe(true);
      }
    });

    it.skipIf(!hasBinary('helm'))('lints cleanly', () => {
      const out = run('helm', ['lint', 'charts/aistack'], 30_000);
      expect(out).toMatch(/0 chart\(s\) failed/);
    });

    it.skipIf(!hasBinary('helm'))('renders templates without errors', () => {
      const out = run(
        'helm',
        [
          'template',
          'aistack',
          'charts/aistack',
          '--set-string',
          'secrets.create.JWT_SECRET=test',
        ],
        30_000,
      );
      // Spot-check that the core resources are present.
      expect(out).toMatch(/kind:\s*Deployment/);
      expect(out).toMatch(/kind:\s*Service/);
      expect(out).toMatch(/kind:\s*ConfigMap/);
    });
  });
});
