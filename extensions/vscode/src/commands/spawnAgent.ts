/**
 * Spawn agent commands.
 *
 *   - aistack.spawnAgent              — generic flow, lets user pick type via QuickPick
 *   - aistack.spawnCoderOnSelection   — spawn the default coder type and execute on selected text
 */

import * as vscode from 'vscode';
import type { AistackClient, AgentTypeDefinition } from '../client/aistackClient';

const CONFIG_NAMESPACE = 'aistack';

export function registerSpawnAgentCommand(
  clientProvider: () => AistackClient,
  onSpawned: () => void
): vscode.Disposable {
  return vscode.commands.registerCommand('aistack.spawnAgent', async () => {
    const client = clientProvider();
    let types: AgentTypeDefinition[] = [];
    try {
      types = await client.listAgentTypes();
    } catch (err) {
      vscode.window.showErrorMessage(`aistack: failed to load agent types — ${(err as Error).message}`);
      return;
    }
    if (types.length === 0) {
      vscode.window.showWarningMessage('aistack: no agent types registered on the daemon.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      types.map((t) => ({
        label: t.name || t.type,
        description: t.type,
        detail: t.description,
        type: t.type,
      })),
      { placeHolder: 'Select agent type to spawn', matchOnDescription: true, matchOnDetail: true }
    );
    if (!pick) return;
    const name = await vscode.window.showInputBox({
      prompt: 'Optional agent name',
      placeHolder: pick.label,
    });

    try {
      const agent = await client.spawnAgent({ type: pick.type, name: name || undefined });
      vscode.window.showInformationMessage(`aistack: spawned agent ${agent.id} (${agent.type}).`);
      onSpawned();
    } catch (err) {
      vscode.window.showErrorMessage(`aistack: spawn failed — ${(err as Error).message}`);
    }
  });
}

export function registerSpawnCoderOnSelectionCommand(
  clientProvider: () => AistackClient,
  onSpawned: () => void
): vscode.Disposable {
  return vscode.commands.registerCommand('aistack.spawnCoderOnSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('aistack: no active editor.');
      return;
    }
    const selection = editor.document.getText(editor.selection);
    if (!selection.trim()) {
      vscode.window.showWarningMessage('aistack: empty selection.');
      return;
    }

    const task = await vscode.window.showInputBox({
      prompt: 'Task for the coder agent',
      placeHolder: 'e.g. "refactor this function to use async/await"',
    });
    if (!task) return;

    const cfg = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const agentType = cfg.get<string>('defaultAgentType', 'coder');
    const client = clientProvider();

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `aistack: spawning ${agentType}...` },
      async (progress) => {
        try {
          progress.report({ message: 'spawning agent' });
          const agent = await client.spawnAgent({ type: agentType });
          onSpawned();

          progress.report({ message: 'executing task' });
          const filePath = editor.document.uri.fsPath;
          const language = editor.document.languageId;
          const fullTask = `${task}\n\nFile: ${filePath}\nLanguage: ${language}\n\nSelected code:\n\`\`\`${language}\n${selection}\n\`\`\``;
          const result = await client.executeAgent(agent.id, fullTask);

          const doc = await vscode.workspace.openTextDocument({
            content: `# aistack agent ${agent.id} response\n\n${result.response}\n`,
            language: 'markdown',
          });
          await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
        } catch (err) {
          vscode.window.showErrorMessage(`aistack: ${(err as Error).message}`);
        }
      }
    );
  });
}
