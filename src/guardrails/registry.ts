/**
 * Guardrail registry.
 *
 * The default registry is pre-populated with the 4 built-ins so the
 * config-driven path (`guardrails: ['secrets', 'pii']`) works out of the
 * box. Custom guardrails are added via `register(g)`.
 */

import { pathToFileURL } from 'node:url';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { logger } from '../utils/logger.js';
import type { Guardrail, GuardrailRegistry } from './types.js';
import { secretsGuardrail } from './builtin/secrets.js';
import { piiGuardrail } from './builtin/pii.js';
import { promptInjectionGuardrail } from './builtin/prompt-injection.js';
// NB: zod-schema is a *factory* (needs a schema arg) so it's not in the
// default registry — users compose it explicitly.

class InMemoryRegistry implements GuardrailRegistry {
  private readonly store = new Map<string, Guardrail>();

  register(guardrail: Guardrail): void {
    if (!guardrail.name) {
      throw new Error('guardrail.name is required');
    }
    this.store.set(guardrail.name, guardrail);
  }

  unregister(name: string): boolean {
    return this.store.delete(name);
  }

  get(name: string): Guardrail | undefined {
    return this.store.get(name);
  }

  list(): Guardrail[] {
    return [...this.store.values()];
  }

  resolve(names: string[]): Guardrail[] {
    const out: Guardrail[] = [];
    const unknown: string[] = [];
    for (const n of names) {
      const g = this.store.get(n);
      if (g) out.push(g);
      else unknown.push(n);
    }
    if (unknown.length > 0) {
      throw new Error(
        `unknown guardrail(s): ${unknown.join(', ')} — registered: ${this.list()
          .map((g) => g.name)
          .join(', ')}`
      );
    }
    return out;
  }
}

/**
 * Create a fresh registry pre-populated with built-ins.
 * Use this in tests / isolated scopes to avoid global state.
 */
export function defaultRegistry(): GuardrailRegistry {
  const r = new InMemoryRegistry();
  r.register(secretsGuardrail());
  r.register(piiGuardrail());
  r.register(promptInjectionGuardrail());
  return r;
}

// Module-level singleton for the common "register once globally" case.
let globalRegistry: GuardrailRegistry | null = null;

export function getGuardrailRegistry(): GuardrailRegistry {
  if (!globalRegistry) globalRegistry = defaultRegistry();
  return globalRegistry;
}

export function registerGuardrail(g: Guardrail): void {
  getGuardrailRegistry().register(g);
}

/** Test helper — reset the global registry. */
export function resetGuardrailRegistry(): void {
  globalRegistry = null;
}

/**
 * Load custom guardrail modules from filesystem paths and register their
 * exports into the supplied registry (defaults to the global one).
 *
 * Contract:
 *   - Each path is resolved relative to `cwd` if not absolute.
 *   - The module is imported and inspected for either:
 *       1. a default export that is itself a Guardrail, OR
 *       2. a default export that is an array of Guardrails, OR
 *       3. a `register(reg)` named export that registers manually, OR
 *       4. any named exports that look like a Guardrail (have
 *          `name` + `validate`).
 *   - Modules with side-effects that call `registerGuardrail` at import
 *     time also work — we just import them.
 *
 * One bad path never sinks the others: each failure is logged and skipped.
 * Returns the count of guardrails newly registered.
 */
export async function loadCustomGuardrails(
  paths: string[],
  options: { registry?: GuardrailRegistry; cwd?: string } = {}
): Promise<number> {
  const registry = options.registry ?? getGuardrailRegistry();
  const cwd = options.cwd ?? process.cwd();
  let loaded = 0;

  for (const rawPath of paths) {
    const abs = isAbsolute(rawPath) ? rawPath : resolvePath(cwd, rawPath);
    const url = pathToFileURL(abs).href;
    try {
      const mod = (await import(url)) as Record<string, unknown>;
      const before = registry.list().length;

      // Case 3: explicit `register` named export.
      if (typeof mod.register === 'function') {
        try {
          (mod.register as (r: GuardrailRegistry) => void)(registry);
        } catch (err) {
          logger.warn('custom guardrail module `register()` threw', {
            path: abs,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const candidates: unknown[] = [];
      // Case 1/2: default export.
      if (mod.default !== undefined) {
        if (Array.isArray(mod.default)) candidates.push(...mod.default);
        else candidates.push(mod.default);
      }
      // Case 4: scan named exports.
      for (const [k, v] of Object.entries(mod)) {
        if (k === 'default' || k === 'register') continue;
        candidates.push(v);
      }

      for (const c of candidates) {
        if (isGuardrail(c)) {
          registry.register(c);
        }
      }

      loaded += registry.list().length - before;
    } catch (err) {
      logger.warn('failed to load custom guardrail module', {
        path: abs,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return loaded;
}

function isGuardrail(x: unknown): x is Guardrail {
  if (x === null || typeof x !== 'object') return false;
  const o = x as { name?: unknown; validate?: unknown };
  return typeof o.name === 'string' && typeof o.validate === 'function';
}
