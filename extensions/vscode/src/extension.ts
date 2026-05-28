/**
 * aistack VS Code extension — activation entry point.
 *
 * Wires up:
 *   - Commands (spawn agent, view memory, run review loop)
 *   - Agent activity sidebar (TreeDataProvider)
 *   - Review loop status bar item
 *   - Configuration listener (re-builds client when daemon URL changes)
 */

import * as vscode from 'vscode';
import { AistackClient, type ClientConfig } from './client/aistackClient';
import { registerSpawnAgentCommand, registerSpawnCoderOnSelectionCommand } from './commands/spawnAgent';
import { registerViewMemoryCommand } from './commands/viewMemory';
import { registerRunReviewLoopCommand } from './commands/runReviewLoop';
import { AgentActivityProvider } from './views/AgentActivityProvider';
import { ReviewLoopStatusBar } from './views/ReviewLoopStatusBar';

const CONFIG_NAMESPACE = 'aistack';

function readClientConfig(): ClientConfig {
  const cfg = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  // Prefer env var for token (more secure than settings.json)
  const envToken = process.env.AISTACK_API_TOKEN;
  const settingToken = cfg.get<string>('apiToken', '');
  return {
    baseUrl: cfg.get<string>('daemonUrl', 'http://localhost:3001'),
    token: envToken && envToken.length > 0 ? envToken : (settingToken || undefined),
    timeoutMs: cfg.get<number>('requestTimeoutMs', 15000),
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('aistack');
  context.subscriptions.push(output);
  output.appendLine('aistack extension activating...');

  let client = new AistackClient(readClientConfig(), output);

  // Re-build client on config change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_NAMESPACE)) {
        client = new AistackClient(readClientConfig(), output);
        output.appendLine('aistack: configuration changed, client rebuilt.');
        agentProvider.setClient(client);
        statusBar.setClient(client);
      }
    })
  );

  // Sidebar: agent activity
  const refreshInterval = vscode.workspace
    .getConfiguration(CONFIG_NAMESPACE)
    .get<number>('refreshIntervalMs', 5000);
  const agentProvider = new AgentActivityProvider(client, output);
  const treeView = vscode.window.createTreeView('aistack.agentActivity', {
    treeDataProvider: agentProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);
  agentProvider.startAutoRefresh(refreshInterval);
  context.subscriptions.push({ dispose: () => agentProvider.dispose() });

  // Status bar: review loop progress
  const statusBar = new ReviewLoopStatusBar(client, output);
  context.subscriptions.push(statusBar);
  statusBar.startAutoRefresh(refreshInterval);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('aistack.refreshAgents', () => agentProvider.refresh()),
    vscode.commands.registerCommand('aistack.stopAgent', (item: { agentId?: string }) => {
      const id = item?.agentId;
      if (!id) {
        vscode.window.showWarningMessage('aistack: no agent selected.');
        return;
      }
      client
        .stopAgent(id)
        .then(() => {
          vscode.window.showInformationMessage(`aistack: agent ${id} stopped.`);
          agentProvider.refresh();
        })
        .catch((err: Error) => vscode.window.showErrorMessage(`aistack: ${err.message}`));
    }),
    registerSpawnAgentCommand(() => client, () => agentProvider.refresh()),
    registerSpawnCoderOnSelectionCommand(() => client, () => agentProvider.refresh()),
    registerViewMemoryCommand(context, () => client),
    registerRunReviewLoopCommand(() => client, () => statusBar.refresh())
  );

  output.appendLine('aistack extension activated.');
}

export function deactivate(): void {
  // Subscriptions are auto-disposed by VS Code.
}
