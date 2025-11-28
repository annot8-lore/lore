import * as vscode from 'vscode';
import * as path from 'path';
import { ensureLoreFile, readJson, safeWriteJson, nowISO } from './fsUtils';
import { getWebviewContent } from './webview';
import { upsertLoreItem } from './itemManager';
import type { LoreSnapshot, WebviewMessage, SavePayload } from './types';

export function activate(context: vscode.ExtensionContext) {
  console.log('Lore extension activating');

  // On startup ensure .lore.json exists for the first workspace folder
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    ensureLoreFile(root)
      .then((fp) => console.log('Ensured lore file:', fp))
      .catch((err) => console.error('failed to ensure lore file', err));
  }

  const disposable = vscode.commands.registerCommand('lore.createEnrichedComment', async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      vscode.window.showErrorMessage('Open a workspace before creating lore entries.');
      return;
    }

    const root = folders[0].uri.fsPath;
    const lorePath = await ensureLoreFile(root);

    // Determine the file & selection
    const editor = vscode.window.activeTextEditor;
    let relFile = '';
    let startLine = 1;
    let endLine = 1;

    if (editor) {
      relFile = path.relative(root, editor.document.uri.fsPath);
      const sel = editor.selection;
      startLine = sel.start.line + 1; // make 1-based
      endLine = sel.end.line + 1;
    }

    const panel = vscode.window.createWebviewPanel('loreCreate', 'Lore — Chronicle new lore', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: false
    });

    panel.webview.html = getWebviewContent(panel.webview, context.extensionUri, relFile, startLine, endLine);

    const disposables: vscode.Disposable[] = [];

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      if (msg.command === 'save') {
        try {
          const json = await readJson<LoreSnapshot>(lorePath);

          // Delegate update/create logic to item manager helper
          upsertLoreItem(json, msg as SavePayload, relFile, startLine, endLine);

          json.fileMetadata.lastUpdatedAt = nowISO();

          // Safe write
          await safeWriteJson(lorePath, json);

          vscode.window.showInformationMessage('Lore saved to .lore.json');
          panel.dispose();
        } catch (e) {
          console.error(e);
          vscode.window.showErrorMessage('Failed to save Lore: ' + String(e));
        }
      }
    }, undefined, disposables);

    panel.onDidDispose(() => {
      disposables.forEach(d => d.dispose());
    }, null, context.subscriptions);
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {
  // nothing special
}
