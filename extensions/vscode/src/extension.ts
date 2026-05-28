/**
 * aistack VS Code extension — activation entry point.
 *
 * Wires up:
 *   - Commands (spawn agent, view memory, run review loop)
 *   - Agent activity sidebar (TreeDataProvider)
 *   - Review loop status bar item
 *   - Configuration listener (re-builds client when daemon URL changes)
 *
 * Secrets: the API token is stored via VS Code `SecretStorage`. The
 * legacy `aistack.apiToken` setting is migrated into SecretStorage on
 * first activation and then cleared from settings.json.
 */

import * as vscode from 'vscode';
import { AistackClient, type ClientConfig } from './client/aistackClient';
import { registerSpawnAgentCommand, registerSpawnCoderOnSelectionCommand } from './commands/spawnAgent';
import { registerViewMemoryCommand } from './commands/viewMemory';
import { registerRunReviewLoopCommand } from './commands/runReviewLoop';
import { AgentActivityProvider } from './views/AgentActivityProvider';
import { ReviewLoopStatusBar } from './views/ReviewLoopStatusBar';

const CONFIG_NAMESPACE = 'aistack';
const SECRET_TOKEN_KEY = 'aistack.apiToken';

async function migrateLegacyToken(context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  const legacy = cfg.get<string>('apiToken', '');
  if (!legacy) return;
  const existing = await context.secrets.get(SECRET_TOKEN_KEY);
  if (!existing) {
    await context.secrets.store(SECRET_TOKEN_KEY, legacy);
  }
  // Clear from settings.json regardless — never persist plaintext token.
  try {
    await cfg.update('apiToken', '', vscode.ConfigurationTarget.Global);
    await cfg.update('apiToken', undefined, vscode.ConfigurationTarget.Workspace);
    await cfg.update('apiToken', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
  } catch {
    // Best-effort — some scopes may not be writable.
  }
}

async function readClientConfig(context: vscode.ExtensionContext): Promise<ClientConfig> {
  const cfg = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  // Token precedence: env var > SecretStorage. The legacy `aistack.apiToken`
  // setting is never read at runtime — see migrateLegacyToken().
  const envToken = process.env.AISTACK_API_TOKEN;
  const secretToken = await context.secrets.get(SECRET_TOKEN_KEY);
  return {
    baseUrl: cfg.get<string>('daemonUrl', 'http://localhost:3001'),
    token: envToken && envToken.length > 0 ? envToken : (secretToken || undefined),
    timeoutMs: cfg.get<number>('requestTimeoutMs', 15000),
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('aistack');
  context.subscriptions.push(output);
  output.appendLine('aistack extension activating...');

  await migrateLegacyToken(context);

  let client = new AistackClient(await readClientConfig(context), output);

  // Sidebar: agent activity — instantiate BEFORE the config-change listener
  // so the listener never references a TDZ binding.
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

  // Re-build client on config or secret change. Both providers now exist.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration(CONFIG_NAMESPACE)) {
        // If the user re-typed a token into settings.json, migrate again.
        await migrateLegacyToken(context);
        client = new AistackClient(await readClientConfig(context), output);
        output.appendLine('aistack: configuration changed, client rebuilt.');
        agentProvider.setClient(client);
        statusBar.setClient(client);
      }
    }),
    context.secrets.onDidChange(async (e) => {
      if (e.key === SECRET_TOKEN_KEY) {
        client = new AistackClient(await readClientConfig(context), output);
        output.appendLine('aistack: API token changed, client rebuilt.');
        agentProvider.setClient(client);
        statusBar.setClient(client);
      }
    })
  );

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
    vscode.commands.registerCommand('aistack.setApiToken', async () => {
      const token = await vscode.window.showInputBox({
        prompt: 'Enter aistack API token (stored in OS keychain via VS Code SecretStorage)',
        password: true,
        ignoreFocusOut: true,
      });
      if (token === undefined) return; // cancelled
      if (token.length === 0) {
        await context.secrets.delete(SECRET_TOKEN_KEY);
        vscode.window.showInformationMessage('aistack: API token cleared.');
      } else {
        await context.secrets.store(SECRET_TOKEN_KEY, token);
        vscode.window.showInformationMessage('aistack: API token saved to SecretStorage.');
      }
    }),
    vscode.commands.registerCommand('aistack.clearApiToken', async () => {
      await context.secrets.delete(SECRET_TOKEN_KEY);
      vscode.window.showInformationMessage('aistack: API token cleared.');
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
