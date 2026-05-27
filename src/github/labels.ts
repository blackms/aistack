/**
 * Issue label helpers — single source of truth for the `aistack-*` label set
 * applied to source issues throughout the autonomous workflow lifecycle.
 */

import type { ProviderClient } from './providers.js';
import type { IssueLabelSet } from '../types.js';
import { logger } from '../utils/logger.js';

const log = logger.child('github:labels');

export const DEFAULT_LABELS: Required<IssueLabelSet> = {
  inProgress: 'aistack-in-progress',
  blocked: 'aistack-blocked-needs-human',
  done: 'aistack-done',
  claimed: 'aistack-claimed',
};

export type LifecyclePhase = 'claimed' | 'inProgress' | 'blocked' | 'done';

/**
 * Replace the lifecycle label on an issue with the one matching `phase`.
 *
 * Strategy: fetch existing labels, drop any `aistack-*` label, append the
 * single label for the requested phase, and PUT the set back. This is
 * idempotent and tolerates manual edits made by humans on the issue.
 */
export async function applyLifecycleLabel(
  client: ProviderClient,
  owner: string,
  repo: string,
  number: number,
  phase: LifecyclePhase,
  existingLabels: string[],
  overrides?: IssueLabelSet
): Promise<string[]> {
  const labelSet = { ...DEFAULT_LABELS, ...(overrides ?? {}) };
  const target = labelSet[phase];

  const filtered = existingLabels.filter((l) => !isAistackLabel(l, labelSet));
  const next = Array.from(new Set([...filtered, target]));

  log.info('Applying lifecycle label', { owner, repo, number, phase, label: target });
  await client.setLabels(owner, repo, number, next);
  return next;
}

function isAistackLabel(label: string, set: Required<IssueLabelSet>): boolean {
  return Object.values(set).includes(label) || label.toLowerCase().startsWith('aistack-');
}
