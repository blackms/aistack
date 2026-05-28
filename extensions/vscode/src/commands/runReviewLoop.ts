/**
 * Run Review Loop command.
 *
 * Sends the active selection (or full document if no selection) as `codeInput`
 * to the daemon's review loop. Reports progress via the status bar item.
 */

import * as vscode from 'vscode';
import type { AistackClient } from '../client/aistackClient';

export function registerRunReviewLoopCommand(
  clientProvider: () => AistackClient,
  onStarted: () => void
): vscode.Disposable {
  return vscode.commands.registerCommand('aistack.runReviewLoop', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('aistack: no active editor.');
      return;
    }
    const selection = editor.document.getText(editor.selection);
    const codeInput = selection.trim() ? selection : editor.document.getText();
    if (!codeInput.trim()) {
      vscode.window.showWarningMessage('aistack: nothing to review.');
      return;
    }

    const iterStr = await vscode.window.showInputBox({
      prompt: 'Max review iterations',
      value: '3',
      validateInput: (v) => (/^\d+$/.test(v) && Number(v) > 0 ? null : 'Enter a positive integer'),
    });
    if (!iterStr) return;
    const maxIterations = Number(iterStr);

    try {
      const loop = await clientProvider().startReviewLoop({ codeInput, maxIterations });
      vscode.window.showInformationMessage(
        `aistack: review loop ${loop.id} started (status: ${loop.status}).`
      );
      onStarted();
    } catch (err) {
      vscode.window.showErrorMessage(`aistack: ${(err as Error).message}`);
    }
  });
}
