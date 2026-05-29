/**
 * README positioning guardrails for M0.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const separatorIndex = readme.indexOf('---');
const aboveFold = separatorIndex >= 0 ? readme.slice(0, separatorIndex) : readme;

function words(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean);
}

describe('README M0 positioning', () => {
  it('uses an outcome-driven hero tagline capped at 12 words', () => {
    const tagline = readme.match(/^##\s+(.+)$/m)?.[1] ?? '';

    expect(words(tagline).length).toBeGreaterThan(0);
    expect(words(tagline).length).toBeLessThanOrEqual(12);
    expect(tagline).toMatch(/adversarial layer/i);
    expect(tagline).toMatch(/survives review/i);
  });

  it('shows three above-fold value pillars with real proof points', () => {
    for (const pillar of [
      'Adversarial code review',
      'Local-first Claude Code orchestration',
      'Governable autonomy',
    ]) {
      expect(aboveFold).toContain(pillar);
    }

    expect(aboveFold).toContain('createReviewLoop');
    expect(aboveFold).toContain('46 MCP tools');
    expect(aboveFold).toContain('consensus checkpoints');
    expect(aboveFold).toContain('resource limits');
  });

  it('states who should and should not use aistack', () => {
    expect(readme).toMatch(/^## Who should use aistack$/m);
    expect(readme).toMatch(/^## Who should NOT use aistack$/m);
  });

  it('does not regress known documentation claims', () => {
    expect(readme).not.toContain('41 tools');
    expect(readme).toContain('not exposed as MCP tools');
    expect(readme).toContain('REST/web API');
    expect(readme).not.toContain('workflow run adversarial-review');
    expect(readme).not.toContain('review_loop_start tool');
    expect(readme).not.toContain('production-ready code');
  });
});
