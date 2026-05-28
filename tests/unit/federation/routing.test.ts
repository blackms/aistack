/**
 * Routing policy tests - round-robin, least-loaded, capability-match.
 */

import { describe, it, expect } from 'vitest';
import { TaskRouter } from '../../../src/federation/routing.js';
import type { NodeInfo, TaskDelegation } from '../../../src/federation/types.js';

function makePeer(id: string, opts: Partial<NodeInfo> = {}): NodeInfo {
  return {
    nodeId: id,
    name: id,
    address: `https://${id}:8443`,
    scheme: 'https',
    capabilities: [{ name: 'coder', enabled: true }],
    load: 0,
    tags: [],
    ...opts,
  };
}

function makeTask(agentType: string = 'coder', hints?: TaskDelegation['hints']): TaskDelegation {
  return { taskId: 't1', agentType, input: 'do work', hints };
}

describe('TaskRouter', () => {
  describe('capability filtering', () => {
    it('returns peer=null when no peer advertises the capability', () => {
      const router = new TaskRouter();
      const peers = [makePeer('a', { capabilities: [{ name: 'researcher', enabled: true }] })];
      const decision = router.delegateTask(makeTask('coder'), peers, 'round-robin');
      expect(decision.peer).toBeNull();
      expect(decision.reason).toMatch(/No peer/);
    });

    it('filters by requiredCapabilities hint (all must be present)', () => {
      const router = new TaskRouter();
      const peers = [
        makePeer('a', {
          capabilities: [
            { name: 'coder', enabled: true },
            { name: 'tester', enabled: true },
          ],
        }),
        makePeer('b', { capabilities: [{ name: 'coder', enabled: true }] }),
      ];
      const decision = router.delegateTask(
        makeTask('coder', { requiredCapabilities: ['tester'] }),
        peers,
        'round-robin'
      );
      expect(decision.peer?.nodeId).toBe('a');
    });
  });

  describe('round-robin policy', () => {
    it('cycles through candidate peers', () => {
      const router = new TaskRouter();
      const peers = [makePeer('a'), makePeer('b'), makePeer('c')];
      const ids = [
        router.delegateTask(makeTask(), peers, 'round-robin').peer?.nodeId,
        router.delegateTask(makeTask(), peers, 'round-robin').peer?.nodeId,
        router.delegateTask(makeTask(), peers, 'round-robin').peer?.nodeId,
        router.delegateTask(makeTask(), peers, 'round-robin').peer?.nodeId,
      ];
      expect(ids).toEqual(['a', 'b', 'c', 'a']);
    });
  });

  describe('least-loaded policy', () => {
    it('picks the peer with the lowest reported load', () => {
      const router = new TaskRouter();
      const peers = [
        makePeer('a', { load: 0.8 }),
        makePeer('b', { load: 0.1 }),
        makePeer('c', { load: 0.5 }),
      ];
      const decision = router.delegateTask(makeTask(), peers, 'least-loaded');
      expect(decision.peer?.nodeId).toBe('b');
    });

    it('breaks ties via round-robin', () => {
      const router = new TaskRouter();
      const peers = [
        makePeer('a', { load: 0.1 }),
        makePeer('b', { load: 0.1 }),
      ];
      const first = router.delegateTask(makeTask(), peers, 'least-loaded').peer?.nodeId;
      const second = router.delegateTask(makeTask(), peers, 'least-loaded').peer?.nodeId;
      expect(new Set([first, second])).toEqual(new Set(['a', 'b']));
    });

    it('treats missing load as 0', () => {
      const router = new TaskRouter();
      const peers = [makePeer('a', { load: 0.5 }), makePeer('b')];
      const decision = router.delegateTask(makeTask(), peers, 'least-loaded');
      expect(decision.peer?.nodeId).toBe('b');
    });
  });

  describe('capability-match policy', () => {
    it('prefers peers whose tags match preferredTags', () => {
      const router = new TaskRouter();
      const peers = [
        makePeer('a', { tags: ['eu-west', 'gpu'] }),
        makePeer('b', { tags: ['us-east'] }),
      ];
      const decision = router.delegateTask(
        makeTask('coder', { preferredTags: ['eu-west'] }),
        peers,
        'capability-match'
      );
      expect(decision.peer?.nodeId).toBe('a');
    });

    it('falls back to load when no tags match', () => {
      const router = new TaskRouter();
      const peers = [
        makePeer('a', { tags: ['us-east'], load: 0.9 }),
        makePeer('b', { tags: ['us-east'], load: 0.1 }),
      ];
      const decision = router.delegateTask(
        makeTask('coder', { preferredTags: ['eu-west'] }),
        peers,
        'capability-match'
      );
      expect(decision.peer?.nodeId).toBe('b');
    });
  });

  describe('decision shape', () => {
    it('returns the policy and a reason on success', () => {
      const router = new TaskRouter();
      const peers = [makePeer('a')];
      const decision = router.delegateTask(makeTask(), peers, 'round-robin');
      expect(decision.policy).toBe('round-robin');
      expect(decision.peer?.nodeId).toBe('a');
      expect(decision.reason).toMatch(/round-robin/);
    });
  });
});
