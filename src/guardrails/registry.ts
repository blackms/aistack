/**
 * Guardrail registry.
 *
 * The default registry is pre-populated with the 4 built-ins so the
 * config-driven path (`guardrails: ['secrets', 'pii']`) works out of the
 * box. Custom guardrails are added via `register(g)`.
 */

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
