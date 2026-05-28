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

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  ResolvedSandboxConfig,
  SandboxAdapter,
  SandboxLanguage,
  SandboxOptions,
  SandboxResult,
  SandboxConfigError,
  SandboxError,
  SandboxPolicyError,
  SandboxUnavailableError,
} from './types.js';

/**
 * Interpreter commands MUST read the program from stdin — never via `-c`/`-e`.
 *
 * Using `-c`/`-e` argv form while sending the code via stdin is a no-op (the
 * interpreter ignores stdin and the `-c` value is empty), and stuffing the
 * code into the argv string opens a shell-escape / argv-length surface.
 * The remote runtime pipes the request `stdin` field into the process, so we
 * use the conventional stdin reader forms instead:
 *   python3 -      → "-" is the documented stdin sentinel
 *   node            → node with no script reads from stdin
 *   sh -s           → -s means "read commands from stdin"
 * TS is run as ESM-from-stdin via `--input-type=module`, NOT `-e`.
 */
const LANGUAGE_IMAGE: Record<SandboxLanguage, { image: string; shell: string[] }> = {
  python: { image: 'python:3.12-alpine', shell: ['python3', '-'] },
  javascript: { image: 'node:20-alpine', shell: ['node'] },
  typescript: { image: 'node:20-alpine', shell: ['node', '--input-type=module'] },
  bash: { image: 'alpine:3.20', shell: ['sh', '-s'] },
};

/**
 * RFC1918 + loopback + link-local + CGNAT + IPv6 ULA/loopback/link-local.
 * Used to reject SSRF attempts in `daytonaApiUrl` before any HTTP request.
 */
function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const parts = ip.split('.').map((n) => Number(n));
    const [a, b] = parts;
    if (a === 10) return true;                              // 10.0.0.0/8
    if (a === 127) return true;                             // 127.0.0.0/8
    if (a === 169 && b === 254) return true;                // 169.254.0.0/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true;       // 172.16.0.0/12
    if (a === 192 && b === 168) return true;                // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true;      // 100.64.0.0/10 CGNAT
    if (a === 0) return true;                               // 0.0.0.0/8
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;     // loopback / unspecified
    if (lower.startsWith('fe80:')) return true;             // link-local fe80::/10
    // fc00::/7 unique local addresses → first byte 0xfc or 0xfd
    const firstHex = lower.split(':')[0];
    if (firstHex.length > 0) {
      const n = parseInt(firstHex.padStart(4, '0').slice(0, 2), 16);
      if (n === 0xfc || n === 0xfd) return true;
    }
    // IPv4-mapped IPv6: ::ffff:a.b.c.d
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped && isPrivateIp(mapped[1])) return true;
    return false;
  }
  return false;
}

/**
 * Sync SSRF checks: scheme allowlist, hostname presence, literal-IP private
 * ranges, and loopback DNS names. Used at construction so misconfiguration
 * fails fast even without a network roundtrip. Throws `SandboxConfigError`.
 */
export function validateDaytonaApiUrlSync(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SandboxConfigError('daytona', `daytonaApiUrl is not a valid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new SandboxConfigError(
      'daytona',
      `daytonaApiUrl must use https:// (got "${parsed.protocol}")`,
    );
  }
  const hostname = parsed.hostname;
  if (!hostname) {
    throw new SandboxConfigError('daytona', 'daytonaApiUrl is missing a hostname');
  }
  const literal = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (isIP(literal) && isPrivateIp(literal)) {
    throw new SandboxConfigError(
      'daytona',
      `daytonaApiUrl host ${literal} resolves to a private/loopback range — refusing (SSRF guard)`,
    );
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new SandboxConfigError(
      'daytona',
      `daytonaApiUrl host "${hostname}" is a loopback name — refusing (SSRF guard)`,
    );
  }
}

/**
 * Validate `daytonaApiUrl` against SSRF: only `https://` is allowed, the host
 * must resolve to a public IP, and the literal IP form (if used) must also
 * be public. Throws `SandboxConfigError` on rejection — callers MUST treat
 * this as a configuration bug, not a runtime error.
 */
export async function validateDaytonaApiUrl(rawUrl: string): Promise<void> {
  validateDaytonaApiUrlSync(rawUrl);
  const hostname = new URL(rawUrl).hostname;
  const literal = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (isIP(literal)) {
    // Sync pass already accepted/rejected the literal — nothing to resolve.
    return;
  }
  let resolved: { address: string; family: number };
  try {
    resolved = await dnsLookup(hostname);
  } catch (err) {
    throw new SandboxConfigError(
      'daytona',
      `daytonaApiUrl host "${hostname}" did not resolve: ${(err as Error).message}`,
    );
  }
  if (isPrivateIp(resolved.address)) {
    throw new SandboxConfigError(
      'daytona',
      `daytonaApiUrl host "${hostname}" resolves to ${resolved.address} (private/loopback) — refusing (SSRF guard)`,
    );
  }
}

export class DaytonaSandbox implements SandboxAdapter {
  readonly provider = 'daytona' as const;
  /** Cached promise so DNS resolution runs at most once per adapter instance. */
  private urlValidation?: Promise<void>;

  constructor(private readonly config: ResolvedSandboxConfig) {
    // Sync-side SSRF checks at construction: scheme + literal-IP + loopback
    // names. Anything that needs DNS is deferred to first .run() (we cache
    // the result so we only resolve once).
    if (config.daytonaApiUrl) {
      validateDaytonaApiUrlSync(config.daytonaApiUrl);
    }
  }

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

    // Full validation (incl. DNS lookup) before any HTTP call. Cached on
    // first run so subsequent runs do not re-resolve.
    if (!this.urlValidation) {
      this.urlValidation = validateDaytonaApiUrl(baseUrl);
    }
    await this.urlValidation;

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

      // 2) exec — code is piped via `stdin`, the interpreter reads it from
      //    fd 0. We MUST NOT use `-c` / `-e` argv forms here: those would
      //    cause the interpreter to ignore stdin entirely (executing an
      //    empty program), and stuffing the source into argv would expose a
      //    shell-escape / argv-length surface. See LANGUAGE_IMAGE above.
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
