/**
 * Price-table resolution (AIG-867).
 *
 * Maps a (provider, model) pair to a USD-per-million-token price so the
 * aggregator can attach an estimated cost to each spend record. Resolution is
 * fail-open: an unknown provider/model resolves to a zero price (tokens are
 * still counted, USD is just 0) and logs a one-time-ish warning. Pricing is
 * never a reason to block a call.
 *
 * Defaults are intentionally conservative and clearly approximate; they are
 * overridable via `config.governance.priceTable`. They are a best-effort
 * estimate and WILL drift from real provider pricing — treat USD as a guide,
 * tokens as the source of truth.
 */

import { logger } from '../utils/logger.js';
import type { ModelPrice, PriceTable } from './types.js';

const log = logger.child('governance:price');

/**
 * Built-in default price table (USD per 1M tokens). Approximate, as of the
 * 2025 public list prices. Override per-deployment via config.
 */
export const DEFAULT_PRICE_TABLE: PriceTable = {
  anthropic: {
    'claude-3-5-haiku*': { inputPerMTok: 0.8, outputPerMTok: 4 },
    'claude-3-haiku*': { inputPerMTok: 0.25, outputPerMTok: 1.25 },
    'claude-3-5-sonnet*': { inputPerMTok: 3, outputPerMTok: 15 },
    'claude-3-7-sonnet*': { inputPerMTok: 3, outputPerMTok: 15 },
    'claude-sonnet*': { inputPerMTok: 3, outputPerMTok: 15 },
    'claude-3-opus*': { inputPerMTok: 15, outputPerMTok: 75 },
    'claude-opus*': { inputPerMTok: 15, outputPerMTok: 75 },
    'claude-*': { inputPerMTok: 3, outputPerMTok: 15 },
  },
  openai: {
    'gpt-4o-mini*': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
    'gpt-4o*': { inputPerMTok: 2.5, outputPerMTok: 10 },
    'gpt-4.1-mini*': { inputPerMTok: 0.4, outputPerMTok: 1.6 },
    'gpt-4.1*': { inputPerMTok: 2, outputPerMTok: 8 },
    'gpt-4-turbo*': { inputPerMTok: 10, outputPerMTok: 30 },
    'o1*': { inputPerMTok: 15, outputPerMTok: 60 },
    'o3-mini*': { inputPerMTok: 1.1, outputPerMTok: 4.4 },
    'gpt-*': { inputPerMTok: 2.5, outputPerMTok: 10 },
  },
  // Local models — no marginal API cost. Tokens are still aggregated.
  ollama: {
    '*': { inputPerMTok: 0, outputPerMTok: 0 },
  },
};

const ZERO_PRICE: ModelPrice = { inputPerMTok: 0, outputPerMTok: 0 };

/** Track which (provider/model) combos we've already warned about. */
const warnedUnknown = new Set<string>();

/**
 * Compile a glob (only `*` and `?` are special) into a RegExp anchored on both
 * ends. Used for both provider and model matching.
 */
function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Merge a user-supplied override table over the defaults. Overrides are merged
 * per provider so a user can add or replace individual model entries without
 * having to restate the whole built-in table.
 */
export function mergePriceTable(overrides?: PriceTable): PriceTable {
  if (!overrides) return DEFAULT_PRICE_TABLE;
  const merged: PriceTable = {};
  const providers = new Set([
    ...Object.keys(DEFAULT_PRICE_TABLE),
    ...Object.keys(overrides),
  ]);
  for (const provider of providers) {
    const lower = provider.toLowerCase();
    merged[lower] = {
      ...(DEFAULT_PRICE_TABLE[provider] ?? DEFAULT_PRICE_TABLE[lower] ?? {}),
      ...(overrides[provider] ?? overrides[lower] ?? {}),
    };
  }
  return merged;
}

/**
 * Resolve the price for a (provider, model) pair. The longest matching model
 * pattern (most specific) wins. Returns a zero price + warns when nothing
 * matches.
 */
export function resolvePrice(
  table: PriceTable,
  provider: string,
  model: string,
): ModelPrice {
  const providerKey = Object.keys(table).find(
    (k) => k.toLowerCase() === provider.toLowerCase(),
  );
  const models = providerKey ? table[providerKey] : undefined;

  if (models) {
    // Sort patterns by specificity (longer, fewer wildcards first) so exact and
    // narrow globs beat the catch-all `*`.
    const patterns = Object.keys(models).sort((a, b) => {
      const aw = (a.match(/\*/g) ?? []).length;
      const bw = (b.match(/\*/g) ?? []).length;
      if (aw !== bw) return aw - bw;
      return b.length - a.length;
    });
    for (const pattern of patterns) {
      if (globToRegExp(pattern).test(model)) {
        return models[pattern];
      }
    }
  }

  const cacheKey = `${provider}/${model}`;
  if (!warnedUnknown.has(cacheKey)) {
    warnedUnknown.add(cacheKey);
    log.warn('No price entry for model — USD cost will be 0 (tokens still counted)', {
      provider,
      model,
    });
  }
  return ZERO_PRICE;
}

/**
 * Estimate the USD cost of a call given resolved token counts and a price.
 */
export function estimateUsdCost(
  price: ModelPrice,
  inputTokens: number,
  outputTokens: number,
): number {
  const usd =
    (inputTokens / 1_000_000) * price.inputPerMTok +
    (outputTokens / 1_000_000) * price.outputPerMTok;
  // Round to 6 decimals to avoid float dust in stored/reported values.
  return Math.round(usd * 1e6) / 1e6;
}

/** Reset the warn cache (testing only). */
export function _resetPriceWarnings(): void {
  warnedUnknown.clear();
}
