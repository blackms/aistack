/**
 * Process-local idempotency guard for issue -> PR webhook dispatches.
 *
 * SCM providers can redeliver the same webhook. This guard prevents duplicate
 * workflow runs for the same issue while a run is active and suppresses
 * immediate post-success redeliveries for a bounded window.
 */

import { parseIssueUrl } from './providers.js';

const COMPLETED_TTL_MS = 4 * 60 * 60 * 1000;

const inFlight = new Set<string>();
const completed = new Map<string, number>();

export interface DispatchLease {
  key: string;
  started: boolean;
  reason?: 'already in flight' | 'recently completed';
}

export function beginIssueDispatch(issueUrl: string, now = Date.now()): DispatchLease {
  pruneCompleted(now);
  const parsed = parseIssueUrl(issueUrl);
  const key = [
    parsed.provider,
    parsed.host,
    parsed.owner,
    parsed.repo,
    parsed.number,
  ].join(':');

  if (inFlight.has(key)) {
    return { key, started: false, reason: 'already in flight' };
  }
  if (completed.has(key)) {
    return { key, started: false, reason: 'recently completed' };
  }

  inFlight.add(key);
  return { key, started: true };
}

export function finishIssueDispatch(key: string, cacheCompleted = true, now = Date.now()): void {
  inFlight.delete(key);
  if (cacheCompleted) {
    completed.set(key, now + COMPLETED_TTL_MS);
  }
}

export function __resetIssueDispatchDedupeForTests(): void {
  inFlight.clear();
  completed.clear();
}

function pruneCompleted(now: number): void {
  for (const [key, expiresAt] of completed) {
    if (expiresAt <= now) completed.delete(key);
  }
}
