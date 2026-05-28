/**
 * Docker sandbox adapter (AIG-634)
 *
 * Runs untrusted code inside a short-lived Docker container with
 * conservative security defaults. The container is created with
 * `docker run --rm` and the code is delivered via STDIN — we never
 * concatenate untrusted text into a host shell command.
 *
 * SECURITY DEFAULTS (see docs/SANDBOX.md "Security Model"):
 *   --network=none                 no egress (opt-in via opts.network)
 *   --read-only                    immutable rootfs
 *   --tmpfs /tmp:rw,size=64m,...   small writable scratch
 *   --workdir /sandbox             tmpfs workdir
 *   --tmpfs /sandbox:rw,size=64m   writable cwd for the script
 *   --cap-drop=ALL                 drop all Linux capabilities
 *   --security-opt no-new-privileges
 *   --pids-limit=<n>               cap forks
 *   --memory=<m>m / --memory-swap  cap RAM
 *   --cpus=<c>                     cap CPU
 *   --user 65534:65534             run as nobody
 *   env: NONE (only what caller opts in via opts.env allowlist)
 *
 * EXPLICITLY FORBIDDEN: --privileged, --cap-add, --device, --pid=host,
 * --network=host, --volume of host paths, --env-file.
 */

import { spawn } from 'node:child_process';
import {
  ResolvedSandboxConfig,
  SandboxAdapter,
  SandboxLanguage,
  SandboxOptions,
  SandboxResult,
  SandboxPolicyError,
  SandboxUnavailableError,
} from './types.js';

const DEFAULT_IMAGES: Record<SandboxLanguage, string> = {
  python: 'python:3.12-alpine',
  javascript: 'node:20-alpine',
  typescript: 'node:20-alpine',
  bash: 'alpine:3.20',
};

const LANGUAGE_COMMANDS: Record<SandboxLanguage, string[]> = {
  // Read program from stdin. `-` is the conventional "stdin" filename.
  python: ['python3', '-'],
  javascript: ['node', '-'],
  // Run TS via Node's experimental strip-types (Node 22+). Fall back to
  // plain JS-on-Node if the user pinned an older image. We use `--input-type`
  // and pipe via stdin to avoid shell quoting of the source.
  typescript: ['node', '--input-type=module', '-'],
  bash: ['sh', '-s'],
};

const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class DockerSandbox implements SandboxAdapter {
  readonly provider = 'docker' as const;

  constructor(private readonly config: ResolvedSandboxConfig) {}

  async run(code: string, opts: SandboxOptions): Promise<SandboxResult> {
    const timeout = opts.timeout ?? this.config.timeout;
    const image = this.config.images?.[opts.language] ?? DEFAULT_IMAGES[opts.language];
    const cmd = LANGUAGE_COMMANDS[opts.language];
    if (!cmd) {
      throw new SandboxPolicyError('docker', `unsupported language: ${opts.language}`);
    }

    const args = buildDockerArgs({
      image,
      cmd,
      timeoutMs: timeout,
      memoryMb: this.config.memoryMb,
      cpus: this.config.cpus,
      pidsLimit: this.config.pidsLimit,
      network: opts.network ?? this.config.network,
      env: opts.env,
    });

    const startedAt = Date.now();
    return runDocker(args, code, timeout).catch((err: unknown) => {
      // Surface "docker not installed / not running" as Unavailable so
      // callers / tests can skip gracefully.
      if (isDockerMissing(err)) {
        throw new SandboxUnavailableError('docker', 'docker CLI not found or daemon not reachable', err);
      }
      throw err;
    }).then((res) => ({
      ...res,
      durationMs: Date.now() - startedAt,
      provider: 'docker' as const,
    }));
  }
}

/** Pure: build the argv passed to `docker`. Exported for security tests. */
export function buildDockerArgs(input: {
  image: string;
  cmd: string[];
  timeoutMs: number;
  memoryMb: number;
  cpus: number;
  pidsLimit: number;
  network: boolean;
  env?: Record<string, string>;
}): string[] {
  const {
    image,
    cmd,
    memoryMb,
    cpus,
    pidsLimit,
    network,
    env,
  } = input;

  const args: string[] = [
    'run',
    '--rm',
    '-i',
    // Isolation
    '--network', network ? 'bridge' : 'none',
    '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
    '--tmpfs', '/sandbox:rw,nosuid,size=64m',
    '--workdir', '/sandbox',
    // Privilege drop
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--user', '65534:65534',
    // Resource caps
    `--memory=${memoryMb}m`,
    `--memory-swap=${memoryMb}m`, // disable swap escape
    `--cpus=${cpus}`,
    `--pids-limit=${pidsLimit}`,
  ];

  // Env allowlist — refuse anything that doesn't look like a valid env name
  // and never forward host env implicitly.
  if (env) {
    for (const [k, v] of Object.entries(env)) {
      if (!ENV_VAR_NAME.test(k)) {
        throw new SandboxPolicyError('docker', `invalid env var name: ${JSON.stringify(k)}`);
      }
      args.push('-e', `${k}=${v}`);
    }
  }

  args.push(image, ...cmd);
  return args;
}

interface RawRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

async function runDocker(args: string[], stdinPayload: string, timeoutMs: number): Promise<RawRunResult> {
  return new Promise<RawRunResult>((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const finish = (result: RawRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      // SIGKILL the docker CLI; --rm + the container's own timeout aren't
      // enough — we additionally rely on the daemon to reap the container
      // when the CLI dies.
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8'); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      finish({
        stdout,
        stderr,
        exitCode: timedOut ? null : code,
        timedOut,
      });
    });

    try {
      child.stdin.end(stdinPayload);
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    }
  });
}

function isDockerMissing(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return e.code === 'ENOENT' || /not found|cannot connect|daemon/i.test(e.message ?? '');
}
