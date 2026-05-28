/**
 * TreeDataProvider for the "Agent Activity" sidebar view.
 *
 * Root nodes are status buckets (Running / Idle / Completed / Failed / Stopped).
 * Children are individual agents. Each agent's tooltip shows id, type, session.
 */

import * as vscode from 'vscode';
import type { AistackClient, AgentSummary } from '../client/aistackClient';

type Node = StatusBucket | AgentNode;

class StatusBucket extends vscode.TreeItem {
  public readonly kind = 'bucket' as const;
  constructor(public readonly status: AgentSummary['status'], public readonly agents: AgentSummary[]) {
    super(`${status} (${agents.length})`, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'bucket';
    this.iconPath = new vscode.ThemeIcon(iconForStatus(status));
  }
}

class AgentNode extends vscode.TreeItem {
  public readonly kind = 'agent' as const;
  public readonly agentId: string;
  constructor(agent: AgentSummary) {
    super(agent.name ? `${agent.name} [${agent.type}]` : `${agent.type}`, vscode.TreeItemCollapsibleState.None);
    this.agentId = agent.id;
    this.contextValue = 'agent';
    this.description = agent.id.slice(0, 8);
    this.tooltip = [
      `ID: ${agent.id}`,
      `Type: ${agent.type}`,
      `Status: ${agent.status}`,
      agent.sessionId ? `Session: ${agent.sessionId}` : undefined,
      `Created: ${agent.createdAt}`,
    ]
      .filter(Boolean)
      .join('\n');
    this.iconPath = new vscode.ThemeIcon(iconForStatus(agent.status));
  }
}

function iconForStatus(s: AgentSummary['status']): string {
  switch (s) {
    case 'running': return 'sync~spin';
    case 'idle': return 'circle-outline';
    case 'completed': return 'check';
    case 'failed': return 'error';
    case 'stopped': return 'stop-circle';
    default: return 'circle-outline';
  }
}

export class AgentActivityProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChange = new vscode.EventEmitter<Node | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private agents: AgentSummary[] = [];
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(private client: AistackClient, private readonly output: vscode.OutputChannel) {}

  setClient(client: AistackClient): void {
    this.client = client;
    this.refresh();
  }

  startAutoRefresh(intervalMs: number): void {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), intervalMs);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this._onDidChange.dispose();
  }

  refresh(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    if (this.disposed) return;
    try {
      this.agents = await this.client.listAgents();
    } catch (err) {
      this.output.appendLine(`aistack: agent list failed — ${(err as Error).message}`);
      this.agents = [];
    }
    this._onDidChange.fire();
  }

  getTreeItem(el: Node): vscode.TreeItem {
    return el;
  }

  getChildren(el?: Node): Node[] {
    if (!el) {
      const order: AgentSummary['status'][] = ['running', 'idle', 'completed', 'failed', 'stopped'];
      const buckets: Node[] = [];
      for (const status of order) {
        const inBucket = this.agents.filter((a) => a.status === status);
        if (inBucket.length > 0) buckets.push(new StatusBucket(status, inBucket));
      }
      return buckets;
    }
    if (el.kind === 'bucket') return el.agents.map((a) => new AgentNode(a));
    return [];
  }
}
