/**
 * Sandbox factory + public API (AIG-634)
 *
 * Resolve the sandbox provider configured in `aistack.config.json`
 * (`sandbox: { provider, ... }`) and return the matching adapter.
 *
 * Usage:
 *   const sandbox = createSandbox(getConfig().sandbox);
 *   const result = await sandbox.run(code, { language: 'python', timeout: 5000 });
 */

import { DockerSandbox } from './docker.js';
import { E2BSandbox } from './e2b.js';
import { DaytonaSandbox } from './daytona.js';
import {
  ResolvedSandboxConfig,
  SandboxAdapter,
  SandboxOptions,
  SandboxResult,
  SandboxProvider,
  SandboxPolicyError,
} from './types.js';

export * from './types.js';
export { DockerSandbox, buildDockerArgs } from './docker.js';
export { E2BSandbox } from './e2b.js';
export { DaytonaSandbox } from './daytona.js';

/**
 * No-op adapter used when `sandbox.provider = 'none'`.
 *
 * Refuses to execute and throws `SandboxPolicyError`. Keeps the rest of the
 * system from having to branch on whether sandboxing is enabled.
 */
export class NoopSandbox implements SandboxAdapter {
  readonly provider = 'none' as const;

  async run(_code: string, _opts: SandboxOptions): Promise<SandboxResult> {
    throw new SandboxPolicyError(
      'none',
      'sandbox provider is "none" — set sandbox.provider to docker|e2b|daytona to enable execution',
    );
  }
}

/** Defaults applied when the user omits fields in `sandbox: {}`. */
export const DEFAULT_SANDBOX_CONFIG: ResolvedSandboxConfig = {
  provider: 'none',
  timeout: 30_000,
  memoryMb: 512,
  cpus: 1,
  pidsLimit: 100,
  network: false,
};

/**
 * Build an adapter for the given resolved config.
 *
 * Pure factory — does NOT touch the network or spawn anything. The adapter
 * only does work when `.run()` is invoked.
 */
export function createSandbox(config?: Partial<ResolvedSandboxConfig>): SandboxAdapter {
  const merged: ResolvedSandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, ...(config ?? {}) };
  return adapterFor(merged.provider, merged);
}

function adapterFor(provider: SandboxProvider, config: ResolvedSandboxConfig): SandboxAdapter {
  switch (provider) {
    case 'docker':
      return new DockerSandbox(config);
    case 'e2b':
      return new E2BSandbox(config);
    case 'daytona':
      return new DaytonaSandbox(config);
    case 'none':
    default:
      return new NoopSandbox();
  }
}
