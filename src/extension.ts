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
          const json = await readJson<LoreSnapshot>(lorePath);

          upsertLoreItem(json, msg as SavePayload, relFile, startLine, endLine);
          json.fileMetadata.lastUpdatedAt = nowISO();

          await safeWriteJson(lorePath, json);
          vscode.window.showInformationMessage('Lore saved to .lore.json');
          panel.dispose();
        } catch (e) {
          console.error(e);
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

  // Open Markdown preview (with temp file cleanup and image handling)
  const previewMarkdownCommand = vscode.commands.registerCommand('lore.previewMarkdown', async (...args: string[]) => {
    const id = args[0];
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;
    const root = folders[0].uri.fsPath;

    try {
      const lorePath = path.join(root, '.lore.json');
      const json = await readJson<LoreSnapshot>(lorePath);
      const item = json.items.find(i => i.id === id);
      if (!item) return;

      const tempDir = path.join(root, '.vscode', '.lore_temp');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      const safeFileName = `lore_${item.id}.md`;
      const tempFilePath = path.join(tempDir, safeFileName);

      const author = typeof item.author === 'string' ? item.author : item.author?.name || '';
      const mdContent = `# ${item.summary}\n\n${item.bodyMarkdown}\n\n${author ? `*Author: ${author}*` : ''}\n`;

      fs.writeFileSync(tempFilePath, mdContent, 'utf-8');

      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(tempFilePath));
      await vscode.commands.executeCommand('markdown.showPreviewToSide', doc.uri);

      const closeWatcher = vscode.workspace.onDidCloseTextDocument((closedDoc) => {
        if (closedDoc === doc) {
          fs.unlink(tempFilePath, err => {
            if (err) console.error('Failed to delete temp file', err);
          });
          closeWatcher.dispose();
        }
      });

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
            upsertLoreItem(json, msg as SavePayload, item.file, item.location.startLine, item.location.endLine);
            json.fileMetadata.lastUpdatedAt = nowISO();
            await safeWriteJson(lorePath, json);
            vscode.window.showInformationMessage('Lore updated');
            panel.dispose();
          } catch (e) {
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
