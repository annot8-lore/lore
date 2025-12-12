import * as vscode from 'vscode';
import * as path from 'path';
import { marked, Token } from 'marked';
import { ensureLoreFile } from './fsUtils';
import { getWebviewContent } from './webview';
import { LoreManager } from './LoreManager';
import type { WebviewMessage, SavePayload, LoreItem } from './types';

let loreManager: LoreManager;

export function activate(context: vscode.ExtensionContext) {
  console.log('Lore extension activating');

  if (vscode.workspace.workspaceFolders?.length) {
    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    loreManager = new LoreManager(context, root);
  } else {
    vscode.window.showErrorMessage('Lore extension requires an open workspace.');
    return;
  }

  // Create new Lore entry
  const createCommand = vscode.commands.registerCommand('lore.createEnrichedComment', async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      vscode.window.showErrorMessage('Open a workspace before creating lore entries.');
      return;
    }

    const root = folders[0].uri.fsPath;
    // ensureLoreFile is now handled by LoreManager constructor
    // await ensureLoreFile(root);

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

    panel.webview.html = getWebviewContent(
      panel.webview.cspSource,
      context.extensionUri,
      relFile,
      startLine,
      endLine,
      'create'
    );

    const disposables: vscode.Disposable[] = [];

      panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
        if (msg.command === 'save') {
          try {
            await loreManager.upsertLoreItem(msg as SavePayload, relFile, startLine, endLine);
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
      const ranges = loreManager.getLoreItemsForFile(filePath) || [];

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
      if (!loreManager.getIsHighlightingEnabled()) {
        return [];
      }
      const filePath = document.uri.fsPath;
      const ranges = loreManager.getLoreItemsForFile(filePath) || [];
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
    if (!loreManager) return; // Should not happen if activated correctly
    loreManager.enableHighlights();
    await loreManager.reloadLore(); // Reloads from disk and updates internal state
    loreManager.refreshDecorations();
    vscode.window.showInformationMessage(`Highlighted ${loreManager.getAllLoreItems().length} comments`);
  });

  // Open Markdown preview
  const previewMarkdownCommand = vscode.commands.registerCommand('lore.previewMarkdown', async (...args: string[]) => {
    const id = args[0];
    if (!loreManager || !vscode.workspace.workspaceFolders?.length) return;

    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const item = loreManager.getLoreItemById(id);
    if (!item) return;

    try {
      const author = typeof item.author === 'string' ? item.author : item.author?.name || '';
      const categoriesString = item.categories && item.categories.length > 0 ? `*Categories: ${item.categories.join(', ')}*` : '';
      const mdContent = `# ${item.summary}\n\n${categoriesString}\n\n${author ? `*Author: ${author}*` : ''}\n${item.bodyMarkdown}\n`;

      const panel = vscode.window.createWebviewPanel(
        'lorePreview',
        `Lore — ${item.summary}`,
        vscode.ViewColumn.Beside,
        {
          enableScripts: false,
          retainContextWhenHidden: false,
          localResourceRoots: [vscode.Uri.file(root)]
        }
      );

      const walkTokens = (token: Token) => {
        if (token.type === 'image') {
          if (!token.href.startsWith('http://') && !token.href.startsWith('https://')) {
            const onDiskPath = vscode.Uri.file(path.join(root, token.href));
            token.href = panel.webview.asWebviewUri(onDiskPath).toString();
          }
        }
      };
      
      marked.use({ walkTokens });
      
      const html = marked(mdContent);
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
    if (!loreManager) return;

    const item = loreManager.getLoreItemById(id);
    if (!item) return;

    const panel = vscode.window.createWebviewPanel(
      'loreEdit',
      `Lore — Edit`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: false }
    );

      panel.webview.html = getWebviewContent(
        panel.webview.cspSource,
        context.extensionUri,
        item.file,
        item.location.startLine,
        item.location.endLine,
        'edit',
        item.summary,
        item.bodyMarkdown,
        typeof item.author === 'string' ? item.author : item.author?.name || '',
        item.id,
        item.categories
      );

    const disposables: vscode.Disposable[] = [];

    panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      if (msg.command === 'save') {
        try {
          console.log('Editing item:', item.id);
          await loreManager.upsertLoreItem(msg as SavePayload, item.file, item.location.startLine, item.location.endLine);

          // The LoreManager handles refreshing decorations and CodeLens
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
  });

  // Live tracking of decorations for active editor
  vscode.window.onDidChangeTextEditorVisibleRanges(event => {
    loreManager.refreshDecorations();
  });

  vscode.workspace.onDidChangeTextDocument(event => {
    loreManager.adjustLoreLocations(event.document, event.contentChanges);
  });

  // Listen for changes in LoreManager to refresh CodeLens
  loreManager.onDidChangeLore(() => {
    vscode.commands.executeCommand('editor.action.codeLensRefresh');
  });

  const disableHighlightsCommand = vscode.commands.registerCommand('lore.disableHighlights', async () => {
    if (loreManager) {
      loreManager.clearDecorations();
      vscode.window.showInformationMessage('Lore highlights disabled.');
    }
  });

  context.subscriptions.push(
    createCommand,
    hoverProvider,
    codeLensProvider,
    showCommand,
    editCommand,
    previewMarkdownCommand,
    disableHighlightsCommand, // Add the new command
    loreManager // Ensure loreManager's dispose is called
  );
}

export function deactivate() {
  if (loreManager) {
    loreManager.dispose();
  }
}
