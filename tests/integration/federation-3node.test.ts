/**
 * 3-node federation integration test.
 *
 * Spins up three FederationManager instances on local loopback ports, each
 * acting as a peer. Verifies that:
 *
 *   1. Node A's router selects either node B or node C for a task that
 *      advertises a matching capability (acceptance criterion #4).
 *   2. The chosen peer executes the task and returns a sanitized result
 *      with `executedBy` set to its own nodeId.
 *   3. The transport sanitizer truncates oversized input (no-egress
 *      sensitive-payload guarantee, acceptance criterion #5).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFederation,
  FederationManager,
  sanitizeDelegation,
  type NodeInfo,
  type TaskDelegation,
} from '../../src/federation/index.js';

interface Node {
  manager: FederationManager;
  port: number;
  nodeId: string;
}

async function makeNode(
  name: string,
  capabilities: { name: string; enabled: boolean }[],
  peers: string[] = []
): Promise<Node> {
  const manager = createFederation({
    enabled: true,
    name,
    discoveryMethod: 'static',
    advertise: false,
    peers,
    bindAddress: '127.0.0.1',
    bindPort: 0,
    routingPolicy: 'least-loaded',
    // Test fixture runs over plain HTTP loopback. Production deployments
    // MUST configure tls.certPath + keyPath; opting into plaintext is the
    // explicit dev-only path enforced by loadCredentials().
    tls: { allowPlainText: true },
  });
  manager.setLocalCapabilities(capabilities);
  manager.setTaskHandler(async (task: TaskDelegation) => ({
    taskId: task.taskId,
    status: 'completed',
    summary: `ran ${task.agentType} on ${name}`,
    executedBy: '', // populated by manager
  }));
  await manager.join();
  const status = manager.status();
  // status.address is scheme://host:port
  const url = new URL(status.address);
  return { manager, port: Number.parseInt(url.port, 10), nodeId: status.nodeId };
}

describe('Federation 3-node cluster', () => {
  let nodeA: Node;
  let nodeB: Node;
  let nodeC: Node;

  beforeEach(async () => {
    // Start B and C first so we have addresses for A's peer list.
    nodeB = await makeNode('node-b', [{ name: 'coder', enabled: true }]);
    nodeC = await makeNode('node-c', [{ name: 'coder', enabled: true }]);
    const peers = [
      `http://127.0.0.1:${nodeB.port}`,
      `http://127.0.0.1:${nodeC.port}`,
    ];
    nodeA = await makeNode('node-a', [{ name: 'coordinator', enabled: true }], peers);
    // Register the static peers with proper NodeInfo by manually telling A
    // their nodeIds. In a real cluster discovery would do this; here we
    // patch via fetchPeerCapabilities to refresh metadata.
    const aPeers: NodeInfo[] = nodeA.manager.peers();
    for (const peer of aPeers) {
      const refreshed = await nodeA.manager.fetchPeerCapabilities(peer);
      if (refreshed) {
        // Replace static placeholder with the real id+caps
        peer.nodeId = refreshed.nodeId;
        peer.capabilities = refreshed.capabilities;
        peer.name = refreshed.name;
      }
    }
  });

  afterEach(async () => {
    await Promise.all([
      nodeA?.manager.leave(),
      nodeB?.manager.leave(),
      nodeC?.manager.leave(),
    ]);
  });

  it('routes a task spawned on node A to either node B or node C', () => {
    const task: TaskDelegation = {
      taskId: 'task-1',
      agentType: 'coder',
      input: 'write hello world',
    };
    const decision = nodeA.manager.delegateTask(task);
    expect(decision.peer).not.toBeNull();
    expect([nodeB.nodeId, nodeC.nodeId]).toContain(decision.peer!.nodeId);
  });

  it('submits the task and receives a completed result from the chosen peer', async () => {
    const task: TaskDelegation = {
      taskId: 'task-2',
      agentType: 'coder',
      input: 'do something safe',
    };
    const decision = nodeA.manager.delegateTask(task);
    expect(decision.peer).not.toBeNull();
    const result = await nodeA.manager.submitTask(decision.peer!, task);
    expect(result.status).toBe('completed');
    expect(result.summary).toMatch(/ran coder/);
    expect(result.executedBy).toBe(decision.peer!.nodeId);
  });

  it('returns no peer when no node advertises the capability', () => {
    const task: TaskDelegation = {
      taskId: 'task-3',
      agentType: 'security-auditor',
      input: 'audit',
    };
    const decision = nodeA.manager.delegateTask(task);
    expect(decision.peer).toBeNull();
  });
});

describe('Federation no-egress guarantee', () => {
  it('sanitizeDelegation truncates oversized input and strips unknown keys', () => {
    const huge = 'x'.repeat(10_000);
    const dirty = {
      taskId: 't',
      agentType: 'coder',
      input: huge,
      // Unknown keys must be dropped
      secrets: { apiKey: 'leak-me' },
      filePayload: 'malicious',
      hints: {
        requiredCapabilities: ['coder'],
        preferredTags: ['gpu'],
        estimatedTokens: 1234,
        // Unknown hint keys must be dropped
        leaking: 'nope',
      },
    } as unknown as TaskDelegation;

    const clean = sanitizeDelegation(dirty, 1024);
    expect(clean.input.length).toBe(1024);
    expect((clean as unknown as Record<string, unknown>).secrets).toBeUndefined();
    expect((clean as unknown as Record<string, unknown>).filePayload).toBeUndefined();
    expect(clean.hints?.estimatedTokens).toBe(1234);
    expect((clean.hints as unknown as Record<string, unknown>).leaking).toBeUndefined();
  });
});
