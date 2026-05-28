/**
 * View Memory command — opens a webview that browses memory entries from
 * the aistack daemon. Loads on open, refreshes on demand.
 *
 * The webview message protocol:
 *   webview -> ext : { type: 'refresh' }
 *   ext     -> wv  : { type: 'data', items: MemoryEntry[], total: number, error?: string }
 */

import * as vscode from 'vscode';
import type { AistackClient } from '../client/aistackClient';

export function registerViewMemoryCommand(
  context: vscode.ExtensionContext,
  clientProvider: () => AistackClient
): vscode.Disposable {
  return vscode.commands.registerCommand('aistack.viewMemory', async () => {
    const panel = vscode.window.createWebviewPanel(
      'aistackMemory',
      'aistack Memory',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.webview.html = renderHtml(panel.webview);

    const send = async () => {
      try {
        const data = await clientProvider().listMemory({ limit: 200 });
        await panel.webview.postMessage({ type: 'data', items: data.items, total: data.total });
      } catch (err) {
        await panel.webview.postMessage({ type: 'data', items: [], total: 0, error: (err as Error).message });
      }
    };

    panel.webview.onDidReceiveMessage(
      (msg: { type?: string }) => {
        if (msg?.type === 'refresh') void send();
      },
      undefined,
      context.subscriptions
    );

    await send();
  });
}

function renderHtml(webview: vscode.Webview): string {
  // Minimal CSP. No external resources, inline script only.
  const nonce = makeNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>aistack Memory</title>
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 12px; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 6px; width: 240px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
  th { position: sticky; top: 0; background: var(--vscode-editor-background); }
  td.value { font-family: var(--vscode-editor-font-family); white-space: pre-wrap; max-width: 600px; word-break: break-word; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .error { color: var(--vscode-errorForeground); margin: 8px 0; }
</style>
</head>
<body>
<header>
  <div>
    <strong>aistack Memory</strong>
    <span class="meta" id="count"></span>
  </div>
  <div>
    <input id="filter" placeholder="filter by key/namespace" />
    <button id="refresh">Refresh</button>
  </div>
</header>
<div id="error" class="error" hidden></div>
<table>
  <thead><tr><th>Namespace</th><th>Key</th><th>Value</th><th>Created</th></tr></thead>
  <tbody id="rows"></tbody>
</table>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let items = [];
const rows = document.getElementById('rows');
const count = document.getElementById('count');
const errBox = document.getElementById('error');
const filter = document.getElementById('filter');

function render() {
  const q = filter.value.trim().toLowerCase();
  const filtered = q
    ? items.filter(e => (e.key||'').toLowerCase().includes(q) || (e.namespace||'').toLowerCase().includes(q))
    : items;
  rows.innerHTML = '';
  for (const e of filtered) {
    const tr = document.createElement('tr');
    const value = typeof e.value === 'string' ? e.value : JSON.stringify(e.value, null, 2);
    tr.innerHTML = '<td>' + escapeHtml(e.namespace || '') + '</td>' +
      '<td>' + escapeHtml(e.key || '') + '</td>' +
      '<td class="value">' + escapeHtml(value) + '</td>' +
      '<td class="meta">' + escapeHtml(e.createdAt || '') + '</td>';
    rows.appendChild(tr);
  }
  count.textContent = ' — showing ' + filtered.length + ' / ' + items.length;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
filter.addEventListener('input', render);

window.addEventListener('message', e => {
  const m = e.data || {};
  if (m.type === 'data') {
    items = m.items || [];
    errBox.hidden = !m.error;
    errBox.textContent = m.error || '';
    render();
  }
});
</script>
</body>
</html>`;
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
