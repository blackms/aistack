/**
 * Status-bar item summarising the active review loop.
 *
 * Polls /api/v1/review-loops on a configurable interval. Shows the most recent
 * loop's iteration count and status. Hidden when no loops exist.
 */

import * as vscode from 'vscode';
import type { AistackClient, ReviewLoopSummary } from '../client/aistackClient';

export class ReviewLoopStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(private client: AistackClient, private readonly output: vscode.OutputChannel) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'aistack.refreshAgents';
    this.item.tooltip = 'aistack review loop — click to refresh agent activity';
    this.item.hide();
  }

  setClient(client: AistackClient): void {
    this.client = client;
    this.refresh();
  }

  startAutoRefresh(intervalMs: number): void {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), intervalMs);
  }

  refresh(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    if (this.disposed) return;
    try {
      const loops = await this.client.listReviewLoops();
      if (loops.length === 0) {
        this.item.hide();
        return;
      }
      // Prefer the newest running loop, else the most recent loop.
      const running = loops.find((l) => l.status === 'running');
      const target: ReviewLoopSummary =
        running ??
        loops.slice().sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1))[0];
      const icon = target.status === 'running' ? '$(sync~spin)' : iconForStatus(target.status);
      this.item.text = `${icon} aistack: ${target.iteration}/${target.maxIterations} ${target.status}`;
      this.item.show();
    } catch (err) {
      this.output.appendLine(`aistack: review-loop poll failed — ${(err as Error).message}`);
      this.item.hide();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.item.dispose();
  }
}

function iconForStatus(status: ReviewLoopSummary['status']): string {
  switch (status) {
    case 'approved': return '$(check)';
    case 'aborted': return '$(stop-circle)';
    case 'max_iterations_reached': return '$(warning)';
    default: return '$(circle-outline)';
  }
}
