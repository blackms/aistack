/**
 * Price-table resolution tests (AIG-867).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_PRICE_TABLE,
  estimateUsdCost,
  mergePriceTable,
  resolvePrice,
  _resetPriceWarnings,
} from '../../../src/governance/price-table.js';

describe('governance price-table', () => {
  beforeEach(() => {
    _resetPriceWarnings();
  });

  describe('resolvePrice', () => {
    it('matches the most specific glob (sonnet beats claude-*)', () => {
      const table = mergePriceTable();
      const price = resolvePrice(table, 'anthropic', 'claude-3-5-sonnet-20241022');
      expect(price.inputPerMTok).toBe(3);
      expect(price.outputPerMTok).toBe(15);
    });

    it('falls back to the provider catch-all glob', () => {
      const table = mergePriceTable();
      const price = resolvePrice(table, 'anthropic', 'claude-some-future-model');
      // claude-* catch-all
      expect(price.inputPerMTok).toBe(3);
    });

    it('matches provider case-insensitively', () => {
      const table = mergePriceTable();
      const price = resolvePrice(table, 'OpenAI', 'gpt-4o-mini');
      expect(price.inputPerMTok).toBe(0.15);
    });

    it('fail-open: unknown model/provider resolves to zero price', () => {
      const table = mergePriceTable();
      const price = resolvePrice(table, 'mystery-provider', 'mystery-model');
      expect(price.inputPerMTok).toBe(0);
      expect(price.outputPerMTok).toBe(0);
    });

    it('local provider (ollama) is priced at zero but resolvable', () => {
      const table = mergePriceTable();
      const price = resolvePrice(table, 'ollama', 'llama3.1:8b');
      expect(price.inputPerMTok).toBe(0);
    });
  });

  describe('mergePriceTable', () => {
    it('overrides individual entries without dropping defaults', () => {
      const merged = mergePriceTable({
        anthropic: { 'claude-3-5-sonnet*': { inputPerMTok: 99, outputPerMTok: 199 } },
      });
      // overridden
      expect(
        resolvePrice(merged, 'anthropic', 'claude-3-5-sonnet-latest').inputPerMTok,
      ).toBe(99);
      // default still present
      expect(resolvePrice(merged, 'openai', 'gpt-4o').inputPerMTok).toBe(2.5);
    });

    it('adds a brand-new provider', () => {
      const merged = mergePriceTable({
        custom: { '*': { inputPerMTok: 1, outputPerMTok: 2 } },
      });
      const p = resolvePrice(merged, 'custom', 'whatever');
      expect(p.inputPerMTok).toBe(1);
      expect(p.outputPerMTok).toBe(2);
    });

    it('returns defaults unchanged when no overrides given', () => {
      expect(mergePriceTable()).toBe(DEFAULT_PRICE_TABLE);
    });
  });

  describe('estimateUsdCost', () => {
    it('computes per-million-token cost for input + output', () => {
      const price = { inputPerMTok: 3, outputPerMTok: 15 };
      // 1M input @ $3 + 1M output @ $15 = $18
      expect(estimateUsdCost(price, 1_000_000, 1_000_000)).toBe(18);
    });

    it('handles fractional token counts', () => {
      const price = { inputPerMTok: 3, outputPerMTok: 15 };
      // 1000 input -> $0.003 ; 2000 output -> $0.03 ; total 0.033
      expect(estimateUsdCost(price, 1000, 2000)).toBeCloseTo(0.033, 6);
    });

    it('zero price yields zero cost regardless of tokens', () => {
      expect(estimateUsdCost({ inputPerMTok: 0, outputPerMTok: 0 }, 5000, 9000)).toBe(0);
    });
  });
});
