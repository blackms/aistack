/**
 * Routing layer - pick a remote peer for a task delegation.
 *
 * Three policies are supported:
 *
 *   - round-robin       Cycles peers that advertise the requested capability.
 *   - least-loaded      Picks the peer with the lowest reported load (0..1).
 *                       Ties broken by round-robin among the tied peers.
 *   - capability-match  Picks the peer whose capability metadata + tags best
 *                       match the task hints (preferredTags + agentType).
 *
 * The router is intentionally stateless aside from the round-robin cursor:
 * peers and load come in as arguments, so this module is trivially testable.
 */

import { logger } from '../utils/logger.js';
import type {
  NodeInfo,
  RoutingDecision,
  RoutingPolicy,
  TaskDelegation,
} from './types.js';

const log = logger.child('federation:routing');

/**
 * Per-router round-robin state.
 */
export class TaskRouter {
  private rrCursor = 0;

  /**
   * Choose a peer for the given task. Returns a RoutingDecision with
   * `peer === null` when no peer is suitable (caller should run locally).
   */
  delegateTask(
    task: TaskDelegation,
    peers: NodeInfo[],
    policy: RoutingPolicy = 'least-loaded'
  ): RoutingDecision {
    const candidates = filterByCapability(task, peers);
    if (candidates.length === 0) {
      return {
        peer: null,
        policy,
        reason: `No peer advertises capability "${task.agentType}"`,
      };
    }

    let chosen: NodeInfo;
    switch (policy) {
      case 'round-robin':
        chosen = this.pickRoundRobin(candidates);
        break;
      case 'capability-match':
        chosen = pickCapabilityMatch(task, candidates);
        break;
      case 'least-loaded':
      default:
        chosen = this.pickLeastLoaded(candidates);
        break;
    }

    log.debug('Delegation decision', {
      taskId: task.taskId,
      policy,
      chosen: chosen.nodeId,
      candidates: candidates.length,
    });

    return {
      peer: chosen,
      policy,
      reason: `Selected via ${policy} from ${candidates.length} candidate(s)`,
    };
  }

  private pickRoundRobin(peers: NodeInfo[]): NodeInfo {
    const idx = this.rrCursor % peers.length;
    this.rrCursor = (this.rrCursor + 1) % Math.max(peers.length, 1);
    return peers[idx];
  }

  private pickLeastLoaded(peers: NodeInfo[]): NodeInfo {
    let bestLoad = Number.POSITIVE_INFINITY;
    const tied: NodeInfo[] = [];
    for (const p of peers) {
      const l = p.load ?? 0;
      if (l < bestLoad) {
        bestLoad = l;
        tied.length = 0;
        tied.push(p);
      } else if (l === bestLoad) {
        tied.push(p);
      }
    }
    if (tied.length === 1) return tied[0];
    // Break ties via round-robin among the tied set
    return this.pickRoundRobin(tied);
  }
}

/* ---------- helpers ---------- */

/**
 * Keep only peers that advertise the requested capability. The capability
 * matches if the peer has any Capability entry with the same `name`. If the
 * task carries explicit `requiredCapabilities`, all of them must be present.
 */
function filterByCapability(task: TaskDelegation, peers: NodeInfo[]): NodeInfo[] {
  const required = new Set<string>([task.agentType, ...(task.hints?.requiredCapabilities ?? [])]);
  return peers.filter((p) => {
    const names = new Set(p.capabilities.map((c) => c.name));
    for (const r of required) {
      if (!names.has(r)) return false;
    }
    return true;
  });
}

/**
 * Capability-match score: +2 per preferred tag matched, +1 per metadata key
 * match, plus a small bonus for lower load to break ties.
 */
function pickCapabilityMatch(task: TaskDelegation, peers: NodeInfo[]): NodeInfo {
  const preferred = new Set(task.hints?.preferredTags ?? []);
  let bestScore = -Infinity;
  let best = peers[0];

  for (const p of peers) {
    let score = 0;
    const tags = new Set(p.tags ?? []);
    for (const t of preferred) if (tags.has(t)) score += 2;

    const cap = p.capabilities.find((c) => c.name === task.agentType);
    if (cap?.metadata && task.hints) {
      for (const key of Object.keys(task.hints)) {
        if (key in cap.metadata) score += 1;
      }
    }
    // Tie-break: lower load wins
    score += (1 - (p.load ?? 0)) * 0.1;

    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}
