import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ensureLoreFile, readJson, safeWriteJson, nowISO } from './fsUtils';
import { getWebviewContent } from './webview';
import { upsertLoreItem } from './itemManager';
import type { LoreSnapshot, WebviewMessage, SavePayload, LoreItem } from './types';

const decorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(255, 255, 0, 0.3)',
  isWholeLine: true
});

const commentRanges = new Map<string, { range: vscode.Range, item: LoreItem }[]>();
let loreSnapshot: LoreSnapshot | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('Lore extension activating');

  if (vscode.workspace.workspaceFolders?.length) {
    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    ensureLoreFile(root)
      .then(fp => console.log('Ensured lore file:', fp))
      .catch(err => console.error('Failed to ensure lore file:', err));
  }

  // Create new Lore entry
  const createCommand = vscode.commands.registerCommand('lore.createEnrichedComment', async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      vscode.window.showErrorMessage('Open a workspace before creating lore entries.');
      return;
    }

    const root = folders[0].uri.fsPath;
    await ensureLoreFile(root);

    const editor = vscode.window.activeTextEditor;
    let relFile = '';
    let startLine = 1;
    let endLine = 1;

    if (editor) {
      relFile = path.relative(root, editor.document.uri.fsPath);
      const sel = editor.selection;
      startLine = sel.start.line + 1;
      endLine = sel.end.line + 1;
    }

    const panel = vscode.window.createWebviewPanel(
      'loreCreate',
      'Lore — Chronicle new lore',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: false }
    );

    panel.webview.html = getWebviewContent(panel.webview, context.extensionUri, relFile, startLine, endLine, 'create');

    const disposables: vscode.Disposable[] = [];

      panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
        if (msg.command === 'save') {
          try {
            const lorePath = path.join(root, '.lore.json');
            console.log('Reading lore file from:', lorePath);
            const json = await readJson<LoreSnapshot>(lorePath);
            console.log('Read json with', json.items.length, 'items');

            upsertLoreItem(json, msg as SavePayload, relFile, startLine, endLine);
            json.fileMetadata.lastUpdatedAt = nowISO();
            console.log('Updated json, now has', json.items.length, 'items');

            await safeWriteJson(lorePath, json);
            console.log('Wrote to file');
            loreSnapshot = json; // Update in-memory snapshot

            // Add new item to commentRanges for immediate highlighting
            const newItem = json.items[json.items.length - 1]; // Assuming upsertLoreItem adds to end
            if (newItem.location.startLine && newItem.location.endLine) {
              const filePath = path.join(root, newItem.file);
              const range = new vscode.Range(newItem.location.startLine - 1, 0, newItem.location.endLine - 1, 0);
              if (!commentRanges.has(filePath)) commentRanges.set(filePath, []);
              commentRanges.get(filePath)!.push({ range, item: newItem });

              // Update decorations in visible editors
              const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath === filePath);
              if (editor) {
                const ranges = commentRanges.get(filePath) || [];
                editor.setDecorations(decorationType, ranges.map(r => r.range));
                vscode.commands.executeCommand('editor.action.codeLensRefresh');
              }
            }

            vscode.window.showInformationMessage('Lore saved to .lore.json');
            panel.dispose();
          } catch (e) {
            console.error('Error saving lore:', e);
            vscode.window.showErrorMessage('Failed to save Lore: ' + String(e));
          }
        } else if (msg.command === 'cancel') {
          panel.dispose();
        }
      }, undefined, disposables);

    panel.onDidDispose(() => disposables.forEach(d => d.dispose()), null, context.subscriptions);
  });

  // Hover provider
  const hoverProvider = vscode.languages.registerHoverProvider('*', {
    provideHover(document, position) {
      const filePath = document.uri.fsPath;
      const ranges = commentRanges.get(filePath) || [];

      for (const { range, item } of ranges) {
        if (range.contains(position)) {

          const editCommandUri = vscode.Uri.parse(
            `command:lore.editComment?${encodeURIComponent(JSON.stringify([item.id]))}`
          );

          const previewCommandUri = vscode.Uri.parse(
            `command:lore.previewMarkdown?${encodeURIComponent(JSON.stringify([item.id]))}`
          );

          const truncatedBody = (item.bodyMarkdown || '').substring(0, 100);
          const mdContent = `# ${item.summary}\n\n${truncatedBody}${(item.bodyMarkdown || '').length > 100 ? '...' : ''}\n\n---\n[Edit Lore](${editCommandUri}) | [View Lore](${previewCommandUri})`;

          const markdown = new vscode.MarkdownString(mdContent, true);
          markdown.isTrusted = true;

          return new vscode.Hover(markdown, range);
        }
      }
      return null;
    }
  });

  // CodeLens provider
  const codeLensProvider = vscode.languages.registerCodeLensProvider('*', {
    provideCodeLenses(document) {
      const filePath = document.uri.fsPath;
      const ranges = commentRanges.get(filePath) || [];
      const lenses: vscode.CodeLens[] = [];

      for (const { range, item } of ranges) {
        lenses.push(
          new vscode.CodeLens(range, { title: 'Edit Lore', command: 'lore.editComment', arguments: [item.id] }),
          new vscode.CodeLens(range, { title: 'View Lore', command: 'lore.previewMarkdown', arguments: [item.id] })
        );
      }
      return lenses;
    }
  });

  // Show enriched comments
  const showCommand = vscode.commands.registerCommand('lore.showEnrichedComments', async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return;

    const root = folders[0].uri.fsPath;
    const lorePath = path.join(root, '.lore.json');

    try {
      const json = await readJson<LoreSnapshot>(lorePath);
      loreSnapshot = json;
      commentRanges.clear();

      let highlighted = 0;
      for (const item of json.items) {
        if (item.location.startLine && item.location.endLine) {
          const filePath = path.join(root, item.file);
          const range = new vscode.Range(item.location.startLine - 1, 0, item.location.endLine - 1, 0);
          if (!commentRanges.has(filePath)) commentRanges.set(filePath, []);
          commentRanges.get(filePath)!.push({ range, item });
          highlighted++;
        }
      }

      for (const editor of vscode.window.visibleTextEditors) {
        const filePath = editor.document.uri.fsPath;
        const ranges = commentRanges.get(filePath) || [];
        editor.setDecorations(decorationType, ranges.map(r => r.range));
      }

      vscode.window.showInformationMessage(`Highlighted ${highlighted} comments`);
    } catch (e) {
      vscode.window.showErrorMessage('Failed to load .lore.json: ' + String(e));
    }
  });

  // Open Markdown preview
  const previewMarkdownCommand = vscode.commands.registerCommand('lore.previewMarkdown', async (...args: string[]) => {
    const id = args[0];
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length || !loreSnapshot) return;
    const root = folders[0].uri.fsPath;
    const item = loreSnapshot.items.find(i => i.id === id);
    if (!item) return;

    try {
      const author = typeof item.author === 'string' ? item.author : item.author?.name || '';
      const mdContent = `# ${item.summary}\n\n${item.bodyMarkdown}\n\n${author ? `*Author: ${author}*` : ''}\n`;

      const panel = vscode.window.createWebviewPanel(
        'lorePreview',
        `Lore — ${item.summary}`,
        vscode.ViewColumn.Beside,
        { enableScripts: false, retainContextWhenHidden: false }
      );

      const html = await vscode.commands.executeCommand('markdown.api.render', mdContent) as string;
      panel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); padding: 20px; }
            .markdown-body { max-width: none; }
          </style>
        </head>
        <body class="markdown-body">
          ${html}
        </body>
        </html>
      `;
    } catch (e) {
      vscode.window.showErrorMessage('Failed to open lore preview: ' + String(e));
    }
  });

  // Edit command (webview)
  const editCommand = vscode.commands.registerCommand('lore.editComment', async (...args: string[]) => {
    const id = args[0];
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return;
    const root = folders[0].uri.fsPath;
    const lorePath = path.join(root, '.lore.json');

    try {
      const json = await readJson<LoreSnapshot>(lorePath);
      const item = json.items.find(i => i.id === id);
      if (!item) return;

      const panel = vscode.window.createWebviewPanel(
        'loreEdit',
        `Lore — Edit`,
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: false }
      );

      panel.webview.html = getWebviewContent(
        panel.webview,
        context.extensionUri,
        item.file,
        item.location.startLine,
        item.location.endLine,
        'edit',
        item.summary,
        item.bodyMarkdown,
        typeof item.author === 'string' ? item.author : item.author?.name || '',
        item.id
      );

      const disposables: vscode.Disposable[] = [];

      panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
        if (msg.command === 'save') {
          try {
            console.log('Editing item:', item.id);
            upsertLoreItem(json, msg as SavePayload, item.file, item.location.startLine, item.location.endLine);
            json.fileMetadata.lastUpdatedAt = nowISO();
            console.log('Updated json for edit, writing to file');
            await safeWriteJson(lorePath, json);
            console.log('Wrote edit to file');
            loreSnapshot = json; // Update in-memory snapshot

            // Refresh live decorations and CodeLens
            const editor = vscode.window.visibleTextEditors.find(e => path.relative(root, e.document.uri.fsPath) === item.file);
            if (editor) {
              const tracked = commentRanges.get(editor.document.uri.fsPath) || [];
              editor.setDecorations(decorationType, tracked.map(t => t.range));
              vscode.commands.executeCommand('editor.action.codeLensRefresh');
            }

            vscode.window.showInformationMessage('Lore updated');
            panel.dispose();
          } catch (e) {
            console.error('Error updating lore:', e);
            vscode.window.showErrorMessage('Failed to update Lore: ' + String(e));
          }
        } else if (msg.command === 'cancel') {
          panel.dispose();
        }
      }, undefined, disposables);

      panel.onDidDispose(() => disposables.forEach(d => d.dispose()), null, context.subscriptions);
    } catch (e) {
      vscode.window.showErrorMessage('Failed to load Lore for editing');
    }
  });

  // Live tracking of decorations for active editor
  vscode.window.onDidChangeTextEditorVisibleRanges(event => {
    const editor = event.textEditor;
    const filePath = editor.document.uri.fsPath;
    const ranges = commentRanges.get(filePath) || [];
    editor.setDecorations(decorationType, ranges.map(r => r.range));
  });

  vscode.workspace.onDidChangeTextDocument(async event => {
    if (!loreSnapshot || !vscode.workspace.workspaceFolders?.length) return;

    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const filePath = event.document.uri.fsPath;
    const relFile = path.relative(root, filePath).replace(/\\/g, '/');

    // Get all items for this file
    const items = loreSnapshot.items.filter(i => i.file === relFile && i.state === 'active');
    if (items.length === 0) return;

    let hasChanges = false;

    // Process each content change
    for (const change of event.contentChanges) {
      // Calculate line delta
      const newLines = (change.text.match(/\n/g) || []).length;
      const oldLines = change.range.end.line - change.range.start.line;
      const delta = newLines - oldLines;

      if (delta === 0) continue;

      hasChanges = true;
      const changeStartLine = change.range.start.line;

      // Adjust each lore item's location
      for (const item of items) {
        let start = item.location.startLine - 1; // Convert to 0-based
        let end = item.location.endLine - 1;

        // Single-line comment
        if (start === end) {
          if (changeStartLine <= start) {
            start += delta;
            end += delta;
          }
        }
        // Multi-line comment
        else {
          if (changeStartLine < start) {
            // Change is before the comment - shift both
            start += delta;
            end += delta;
          } else if (changeStartLine <= end) {
            // Change is within or at the comment - adjust end only
            end += delta;
            // Ensure end doesn't go below start
            if (end < start) end = start;
          }
          // If change is after the comment, no adjustment needed
        }

        // Update with 1-based line numbers, ensure minimum of 1
        item.location.startLine = Math.max(1, start + 1);
        item.location.endLine = Math.max(1, end + 1);
      }
    }

    if (hasChanges) {
      // Update commentRanges map with new ranges
      const tracked = items.map(item => ({
        range: new vscode.Range(
          item.location.startLine - 1, 0,
          item.location.endLine - 1, 0
        ),
        item
      }));
      commentRanges.set(filePath, tracked);

      // Update decorations in visible editors
      const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath === filePath);
      if (editor) {
        editor.setDecorations(decorationType, tracked.map(t => t.range));
        vscode.commands.executeCommand('editor.action.codeLensRefresh');
      }

      // Save updated locations to file
      const lorePath = path.join(root, '.lore.json');
      loreSnapshot.fileMetadata.lastUpdatedAt = nowISO();
      try {
        await safeWriteJson(lorePath, loreSnapshot);
      } catch (e) {
        console.error('Failed to save adjusted lore locations:', e);
      }
    }
  });

  context.subscriptions.push(
    createCommand,
    hoverProvider,
    codeLensProvider,
    showCommand,
    editCommand,
    previewMarkdownCommand
  );
}

export function deactivate() { }
