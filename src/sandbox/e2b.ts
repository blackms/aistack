/**
 * E2B sandbox adapter (AIG-634)
 *
 * Thin wrapper over the `@e2b/code-interpreter` SDK. The SDK itself is an
 * optionalDependency — we lazy-import it so the package still installs
 * without it. If the SDK or the API key is missing, `run()` throws
 * `SandboxUnavailableError` and the caller can fall back.
 *
 * SECURITY MODEL: isolation is provided by E2B's managed Firecracker
 * micro-VMs. From our side the responsibility is:
 *   - never log the API key
 *   - never forward host env implicitly (caller must opt in via opts.env)
 *   - apply caller's timeout as a hard wall clock
 * See docs/SANDBOX.md "Security Model — managed providers".
 */

import {
  ResolvedSandboxConfig,
  SandboxAdapter,
  SandboxLanguage,
  SandboxOptions,
  SandboxResult,
  SandboxPolicyError,
  SandboxUnavailableError,
} from './types.js';

// The shape of the bits of @e2b/code-interpreter we actually use. We type
// this loosely on purpose so we don't force the dep into devDependencies.
interface E2BSandboxLike {
  runCode(
    code: string,
    opts?: { language?: string; timeoutMs?: number; envs?: Record<string, string> },
  ): Promise<{
    logs?: { stdout?: string[]; stderr?: string[] };
    error?: { name?: string; value?: string; traceback?: string };
    text?: string;
  }>;
  kill(): Promise<void>;
}

interface E2BSandboxConstructor {
  create(opts?: { apiKey?: string; timeoutMs?: number }): Promise<E2BSandboxLike>;
}

const LANGUAGE_MAP: Record<SandboxLanguage, string> = {
  python: 'python',
  javascript: 'js',
  typescript: 'ts',
  bash: 'bash',
};

export class E2BSandbox implements SandboxAdapter {
  readonly provider = 'e2b' as const;

  constructor(private readonly config: ResolvedSandboxConfig) {}

  async run(code: string, opts: SandboxOptions): Promise<SandboxResult> {
    const apiKey = this.config.e2bApiKey ?? process.env.E2B_API_KEY;
    if (!apiKey) {
      throw new SandboxUnavailableError(
        'e2b',
        'E2B_API_KEY not set — provide via env or sandbox.e2bApiKey config',
      );
    }
    const lang = LANGUAGE_MAP[opts.language];
    if (!lang) {
      throw new SandboxPolicyError('e2b', `unsupported language: ${opts.language}`);
    }

    const SandboxCtor = await loadE2BSandbox();
    const timeout = opts.timeout ?? this.config.timeout;
    const startedAt = Date.now();

    const sbx = await SandboxCtor.create({ apiKey, timeoutMs: timeout });
    try {
      const out = await sbx.runCode(code, {
        language: lang,
        timeoutMs: timeout,
        envs: opts.env, // SDK forwards only what we pass — host env stays out
      });
      return {
        stdout: (out.logs?.stdout ?? []).join(''),
        stderr: (out.logs?.stderr ?? []).join('') + (out.error?.traceback ?? ''),
        exitCode: out.error ? 1 : 0,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        provider: 'e2b',
      };
    } finally {
      // Always reap the remote sandbox even on throw.
      try { await sbx.kill(); } catch { /* ignore */ }
    }
  }
}

async function loadE2BSandbox(): Promise<E2BSandboxConstructor> {
  try {
    // Dynamic import keeps the SDK truly optional.
    const mod = (await import('@e2b/code-interpreter' as string)) as unknown as {
      Sandbox: E2BSandboxConstructor;
    };
    if (!mod?.Sandbox) {
      throw new Error('@e2b/code-interpreter loaded but Sandbox export missing');
    }
    return mod.Sandbox;
  } catch (err) {
    throw new SandboxUnavailableError(
      'e2b',
      'install @e2b/code-interpreter to use the E2B sandbox provider',
      err,
    );
  }
}
