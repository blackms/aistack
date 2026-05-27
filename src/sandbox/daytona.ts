/**
 * Daytona sandbox adapter (AIG-634)
 *
 * HTTP client against a self-hosted Daytona server. We talk to the public
 * REST API and avoid bringing in any SDK dependency. The exact endpoint
 * shapes can vary across Daytona versions, so we keep the surface tiny:
 *
 *   POST {baseUrl}/sandboxes                  → { id }
 *   POST {baseUrl}/sandboxes/{id}/exec        → { stdout, stderr, exitCode }
 *   DELETE {baseUrl}/sandboxes/{id}           → 204
 *
 * Authentication: Bearer token from config or `DAYTONA_API_KEY` env var.
 *
 * SECURITY MODEL: isolation is provided by the Daytona workspace runtime
 * (typically Docker / DevContainer). From our side we:
 *   - require an explicit base URL + token (no defaults pointing at prod)
 *   - never log credentials
 *   - apply caller's timeout as a hard wall clock via AbortController
 *   - forward only env vars in the caller's allowlist
 * See docs/SANDBOX.md "Security Model — managed providers".
 */

import {
  ResolvedSandboxConfig,
  SandboxAdapter,
  SandboxLanguage,
  SandboxOptions,
  SandboxResult,
  SandboxError,
  SandboxPolicyError,
  SandboxUnavailableError,
} from './types.js';

const LANGUAGE_IMAGE: Record<SandboxLanguage, { image: string; shell: string[] }> = {
  python: { image: 'python:3.12-alpine', shell: ['python3', '-c'] },
  javascript: { image: 'node:20-alpine', shell: ['node', '-e'] },
  typescript: { image: 'node:20-alpine', shell: ['node', '--input-type=module', '-e'] },
  bash: { image: 'alpine:3.20', shell: ['sh', '-c'] },
};

export class DaytonaSandbox implements SandboxAdapter {
  readonly provider = 'daytona' as const;

  constructor(private readonly config: ResolvedSandboxConfig) {}

  async run(code: string, opts: SandboxOptions): Promise<SandboxResult> {
    const baseUrl = this.config.daytonaApiUrl;
    const apiKey = this.config.daytonaApiKey ?? process.env.DAYTONA_API_KEY;

    if (!baseUrl) {
      throw new SandboxUnavailableError(
        'daytona',
        'sandbox.daytonaApiUrl not set — point it at your Daytona server',
      );
    }
    if (!apiKey) {
      throw new SandboxUnavailableError(
        'daytona',
        'DAYTONA_API_KEY not set — provide via env or sandbox.daytonaApiKey config',
      );
    }

    const langCfg = LANGUAGE_IMAGE[opts.language];
    if (!langCfg) {
      throw new SandboxPolicyError('daytona', `unsupported language: ${opts.language}`);
    }

    const timeout = opts.timeout ?? this.config.timeout;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    };
    const startedAt = Date.now();

    const controller = new AbortController();
    const killer = setTimeout(() => controller.abort(), timeout);

    let sandboxId: string | undefined;
    try {
      // 1) create sandbox
      const createRes = await fetchJson<{ id: string }>(
        joinUrl(baseUrl, '/sandboxes'),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            image: langCfg.image,
            // Daytona "no host envs by default" — we forward only the allowlist
            env: opts.env ?? {},
            network: opts.network ?? this.config.network,
          }),
          signal: controller.signal,
        },
      );
      sandboxId = createRes.id;

      // 2) exec — pass code as a discrete argv element, NOT via shell string
      //    concatenation. The remote runtime is responsible for handing it to
      //    the interpreter as argv[1] without re-evaluating it as a shell.
      const execRes = await fetchJson<{ stdout?: string; stderr?: string; exitCode?: number }>(
        joinUrl(baseUrl, `/sandboxes/${encodeURIComponent(sandboxId)}/exec`),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            command: langCfg.shell,
            stdin: code,
            timeoutMs: timeout,
          }),
          signal: controller.signal,
        },
      );

      return {
        stdout: execRes.stdout ?? '',
        stderr: execRes.stderr ?? '',
        exitCode: execRes.exitCode ?? null,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        provider: 'daytona',
      };
    } catch (err) {
      if (controller.signal.aborted) {
        return {
          stdout: '',
          stderr: '',
          exitCode: null,
          timedOut: true,
          durationMs: Date.now() - startedAt,
          provider: 'daytona',
        };
      }
      if (err instanceof SandboxError) throw err;
      throw new SandboxError(
        `daytona request failed: ${(err as Error).message}`,
        'daytona',
        err,
      );
    } finally {
      clearTimeout(killer);
      if (sandboxId) {
        // best-effort teardown — never let cleanup mask the original error
        try {
          await fetch(joinUrl(baseUrl, `/sandboxes/${encodeURIComponent(sandboxId)}`), {
            method: 'DELETE',
            headers,
          });
        } catch { /* ignore */ }
      }
    }
  }
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    // Body may contain secrets in the URL/echo, do NOT include it in the
    // generic error message — surface status only.
    throw new SandboxError(
      `daytona HTTP ${res.status} ${res.statusText}`,
      'daytona',
    );
  }
  return (await res.json()) as T;
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}
