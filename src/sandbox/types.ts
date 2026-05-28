/**
 * Sandbox adapter types (AIG-634)
 *
 * Common interface for sandboxed code execution backends:
 * - DockerSandbox  (local, free, requires Docker engine)
 * - E2BSandbox     (managed cloud, requires E2B_API_KEY)
 * - DaytonaSandbox (self-hosted, HTTP API)
 * - NoopSandbox    (default fallback — refuses to execute)
 *
 * SECURITY NOTE: code is treated as UNTRUSTED. Adapters MUST never
 * concatenate `code` into a host shell command string. Use stdin / file
 * mount / managed APIs. See docs/SANDBOX.md "Security Model".
 */

export type SandboxLanguage = 'python' | 'typescript' | 'javascript' | 'bash';

export type SandboxProvider = 'none' | 'docker' | 'e2b' | 'daytona';

/**
 * Options for a single sandboxed run.
 *
 * - timeout: hard wall-clock timeout in ms (the adapter MUST kill the run
 *   when this expires). Adapters apply config defaults if omitted.
 * - env: ALLOWLIST of env vars to forward into the sandbox. Empty/undefined
 *   means "no env". Host env is NEVER forwarded implicitly.
 * - files: extra files to materialise inside the sandbox workdir before the
 *   run (e.g. fixtures). Paths are relative to the sandbox workdir; absolute
 *   paths and ".." segments are REJECTED by the adapter.
 * - network: opt-in network access. Default false → no network.
 */
export interface SandboxOptions {
  language: SandboxLanguage;
  timeout?: number;
  env?: Record<string, string>;
  files?: Record<string, string>;
  network?: boolean;
}

/**
 * Outcome of a single sandboxed run.
 *
 * - exitCode: 0 = success. `null` means the process did not exit cleanly
 *   (timeout, kill, OOM).
 * - timedOut: true iff the adapter killed the run because of `timeout`.
 * - files: snapshot of files the script wrote under the sandbox workdir
 *   (capped; adapters may truncate large outputs).
 * - durationMs: wall-clock execution time.
 */
export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  files?: Record<string, string>;
  durationMs: number;
  provider: SandboxProvider;
}

/**
 * Generic error from a sandbox adapter. Subclasses signal classes of
 * failure callers may want to handle distinctly.
 */
export class SandboxError extends Error {
  constructor(
    message: string,
    public readonly provider: SandboxProvider,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SandboxError';
  }
}

/** Sandbox provider not available on this host (binary missing, no API key). */
export class SandboxUnavailableError extends SandboxError {
  constructor(provider: SandboxProvider, reason: string, cause?: unknown) {
    super(`Sandbox provider "${provider}" unavailable: ${reason}`, provider, cause);
    this.name = 'SandboxUnavailableError';
  }
}

/** Caller asked the adapter to do something disallowed by policy. */
export class SandboxPolicyError extends SandboxError {
  constructor(provider: SandboxProvider, reason: string) {
    super(`Sandbox policy violation: ${reason}`, provider);
    this.name = 'SandboxPolicyError';
  }
}

/**
 * Adapter was constructed with a misconfigured value (bad URL scheme, private
 * host, malformed identifier, ...). This is a programmer/operator bug — it
 * is NOT recoverable by retrying, and callers SHOULD surface it to the user
 * at startup rather than at first request.
 */
export class SandboxConfigError extends SandboxError {
  constructor(provider: SandboxProvider, reason: string) {
    super(`Sandbox configuration error: ${reason}`, provider);
    this.name = 'SandboxConfigError';
  }
}

/**
 * Pluggable sandbox adapter contract. Implementations MUST NOT
 * execute untrusted code on the host process.
 */
export interface SandboxAdapter {
  readonly provider: SandboxProvider;

  /**
   * Execute `code` in an isolated environment.
   *
   * Implementations SHOULD throw `SandboxUnavailableError` rather than
   * silently degrading when the backend cannot be reached.
   */
  run(code: string, opts: SandboxOptions): Promise<SandboxResult>;

  /** Free any persistent resources held by the adapter. Optional. */
  dispose?(): Promise<void>;
}

/**
 * Resolved sandbox configuration after applying defaults.
 * Mirrors `SandboxConfig` in src/types.ts but is the runtime-facing shape
 * adapters consume.
 */
export interface ResolvedSandboxConfig {
  provider: SandboxProvider;
  /** default per-run timeout in ms */
  timeout: number;
  /** memory cap in MB (Docker only) */
  memoryMb: number;
  /** CPU cap as a fraction of a core (Docker only) */
  cpus: number;
  /** PID cap inside the container (Docker only) */
  pidsLimit: number;
  /** Default network policy. false → --network=none. */
  network: boolean;
  /** Docker-only: image overrides per language */
  images?: Partial<Record<SandboxLanguage, string>>;
  /** E2B-only: explicit API key (else read from process.env.E2B_API_KEY) */
  e2bApiKey?: string;
  /** Daytona-only: base URL of the Daytona API */
  daytonaApiUrl?: string;
  /** Daytona-only: explicit API token (else process.env.DAYTONA_API_KEY) */
  daytonaApiKey?: string;
}
