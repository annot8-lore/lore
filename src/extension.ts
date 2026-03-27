import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Marked } from 'marked';
import type { Token } from 'marked';
import { getWebviewContent } from './webview';
import { LoreManager } from './LoreManager';
import type { WebviewMessage, SavePayload } from './types';

const execFileAsync = promisify(execFile);

async function getGitAuthor(cwd: string): Promise<string> {
  try {
    const [nameResult, emailResult] = await Promise.allSettled([
      execFileAsync('git', ['config', 'user.name'], { cwd }),
      execFileAsync('git', ['config', 'user.email'], { cwd }),
    ]);
    const name = nameResult.status === 'fulfilled' ? nameResult.value.stdout.trim() : '';
    const email = emailResult.status === 'fulfilled' ? emailResult.value.stdout.trim() : '';
    if (name && email) { return `${name} <${email}>`; }
    return name || email;
  } catch {
    return '';
  }
}

let loreManager: LoreManager;
let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Lore extension activating');

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusBarItem);

  if (!vscode.workspace.workspaceFolders?.length) {
    vscode.window.showErrorMessage('Lore extension requires an open workspace.');
    return;
  }

  if ((vscode.workspace.workspaceFolders?.length ?? 0) > 1) {
    vscode.window.showInformationMessage(
      'Lore: Multiple workspace folders detected — annotations are tracked for the first folder only.',
    );
  }

  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  loreManager = await LoreManager.create(context, root);

  // Restore or auto-enable highlights from persisted/config state.
  const cfg = vscode.workspace.getConfiguration('lore');
  const wasHighlighting = context.workspaceState.get<boolean>('lore.highlightingEnabled', false);
  if (wasHighlighting || cfg.get<boolean>('highlightOnStartup', false)) {
    loreManager.enableHighlights();
  }

  const updateStatusBar = () => {
    statusBarItem.text = loreManager.getIsHighlightingEnabled() ? `$(eye) Lore: On` : `$(eye-closed) Lore: Off`;
    statusBarItem.tooltip = loreManager.getIsHighlightingEnabled() ? 'Click to hide Lore highlights' : 'Click to show Lore highlights';
    statusBarItem.command = 'lore.toggleHighlights';
    statusBarItem.show();
  };

  updateStatusBar();

  const codeLensEmitter = new vscode.EventEmitter<void>();
  context.subscriptions.push(codeLensEmitter);

  loreManager.onDidChangeLore(() => {
    codeLensEmitter.fire();
    updateStatusBar();
  });

  const configListener = vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('lore.highlightColor')) {
      const newColor = vscode.workspace.getConfiguration('lore').get<string>('highlightColor', 'rgba(255, 255, 0, 0.2)');
      loreManager.updateHighlightColor(newColor);
    }
  });
  context.subscriptions.push(configListener);

  // ── Commands ──────────────────────────────────────────────────────────────

  const persistHighlight = (on: boolean) => context.workspaceState.update('lore.highlightingEnabled', on);

  const toggleHighlightsCommand = vscode.commands.registerCommand('lore.toggleHighlights', () => {
    loreManager.toggleHighlights();
    persistHighlight(loreManager.getIsHighlightingEnabled());
    codeLensEmitter.fire();
    updateStatusBar();
  });

  const createCommand = vscode.commands.registerCommand('lore.createEnrichedComment', async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      vscode.window.showErrorMessage('Open a workspace before creating lore entries.');
      return;
    }

    const editor = vscode.window.activeTextEditor;
    let relFile = '';
    let startLine = 1;
    let endLine = 1;

    if (editor) {
      relFile = path.relative(root, editor.document.uri.fsPath);
      startLine = editor.selection.start.line + 1;
      endLine = editor.selection.end.line + 1;
    }

    const gitAuthor = await getGitAuthor(root);

    const panel = vscode.window.createWebviewPanel(
      'loreCreate',
      'Lore — Chronicle new lore',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: false },
    );

    panel.webview.html = getWebviewContent(
      panel.webview.cspSource,
      context.extensionUri,
      relFile,
      startLine,
      endLine,
      'create',
      '',
      '',
      gitAuthor,
    );

    const disposables: vscode.Disposable[] = [];

    panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      if (msg.command === 'save') {
        try {
          await loreManager.upsertLoreItem(msg as SavePayload, relFile, startLine, endLine);
          vscode.window.showInformationMessage('Lore saved to .lore.json');
          panel.dispose();
        } catch (e) {
          vscode.window.showErrorMessage('Failed to save Lore: ' + String(e));
        }
      } else if (msg.command === 'cancel') {
        panel.dispose();
      }
    }, undefined, disposables);

    panel.onDidDispose(() => disposables.forEach(d => d.dispose()), null, context.subscriptions);
  });

  const enableHighlightsCommand = vscode.commands.registerCommand('lore.enableHighlights', async () => {
    loreManager.enableHighlights();
    persistHighlight(true);
    await loreManager.reloadLore();
    const activeCount = loreManager.getAllLoreItems().filter(i => i.state === 'active').length;
    vscode.window.showInformationMessage(`Highlighted ${activeCount} active annotation${activeCount !== 1 ? 's' : ''}`);
  });

  const previewMarkdownCommand = vscode.commands.registerCommand('lore.previewMarkdown', async (...args: string[]) => {
    const id = args[0];
    if (!vscode.workspace.workspaceFolders?.length) { return; }

    const item = loreManager.getLoreItemById(id);
    if (!item) { return; }

    try {
      const { randomBytes } = require('crypto') as typeof import('crypto');
      const nonce = randomBytes(16).toString('hex');

      const author = typeof item.author === 'string' ? item.author : item.author?.name ?? '';
      const metaParts: string[] = [];
      if (item.categories?.length) { metaParts.push(`**Categories:** ${item.categories.join(', ')}`); }
      if (item.tags?.length) { metaParts.push(`**Tags:** ${item.tags.join(', ')}`); }
      if (author) { metaParts.push(`**Author:** ${author}`); }
      if (item.links?.length) {
        metaParts.push(`**Links:**\n${item.links.map(l => `- [${l}](${l})`).join('\n')}`);
      }
      const meta = metaParts.length ? metaParts.join('\n\n') + '\n\n---\n\n' : '';
      const mdContent = `# ${item.summary}\n\n${meta}${item.bodyMarkdown}\n`;

      const panel = vscode.window.createWebviewPanel(
        'lorePreview',
        `Lore — ${item.summary}`,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: false,
          localResourceRoots: [vscode.Uri.file(root)],
        },
      );

      const localMarked = new Marked();
      localMarked.use({
        walkTokens(token: Token) {
          if (token.type === 'image') {
            if (!token.href.startsWith('http://') && !token.href.startsWith('https://')) {
              const onDiskPath = vscode.Uri.file(path.join(root, token.href));
              token.href = panel.webview.asWebviewUri(onDiskPath).toString();
            }
          }
        },
      });

      const rawHtml = localMarked.parse(mdContent) as string;
      // Convert #LOC:x references to clickable links handled by the webview script.
      const html = rawHtml.replace(
        /#LOC:(\d+)/g,
        (_, n) => `<a class="loc-link" data-line="${n}" href="#" title="Jump to line ${n}">#LOC:${n}</a>`,
      );

      panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${panel.webview.cspSource} https: data:; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';" />
  <style>
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); padding: 20px; line-height: 1.6; }
    a { color: var(--vscode-textLink-foreground); }
    a:hover { color: var(--vscode-textLink-activeForeground); }
    a.loc-link { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; }
    code { font-family: var(--vscode-editor-font-family, monospace); background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
    pre code { display: block; padding: 12px; overflow-x: auto; }
    blockquote { border-left: 3px solid var(--vscode-textBlockQuote-border); margin: 0; padding-left: 16px; color: var(--vscode-textBlockQuote-foreground); }
    hr { border: none; border-top: 1px solid var(--vscode-widget-border); margin: 16px 0; }
  </style>
</head>
<body>
  ${html}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('.loc-link').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        vscode.postMessage({ command: 'navigateTo', line: parseInt(el.dataset.line, 10) });
      });
    });
  </script>
</body>
</html>`;

      const previewDisposables: vscode.Disposable[] = [];
      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.command === 'navigateTo' && vscode.workspace.workspaceFolders?.length) {
          const fileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, item.file);
          try {
            const doc = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
            const line = Math.max(0, (msg.line as number) - 1);
            const range = new vscode.Range(line, 0, line, 0);
            editor.selection = new vscode.Selection(range.start, range.end);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
          } catch {
            vscode.window.showErrorMessage(`Lore: cannot navigate — file "${item.file}" not found.`);
          }
        }
      }, undefined, previewDisposables);
      panel.onDidDispose(() => previewDisposables.forEach(d => d.dispose()), null, context.subscriptions);

    } catch (e) {
      vscode.window.showErrorMessage('Failed to open lore preview: ' + String(e));
    }
  });

  const editCommand = vscode.commands.registerCommand('lore.editComment', async (...args: string[]) => {
    const id = args[0];
    const item = loreManager.getLoreItemById(id);
    if (!item) { return; }

    const panel = vscode.window.createWebviewPanel(
      'loreEdit',
      'Lore — Edit',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: false },
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
      typeof item.author === 'string' ? item.author : item.author?.name ?? '',
      item.id,
      item.categories,
      item.tags ?? [],
      item.links ?? [],
    );

    const disposables: vscode.Disposable[] = [];

    panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      if (msg.command === 'save') {
        try {
          await loreManager.upsertLoreItem(
            msg as SavePayload,
            item.file,
            item.location.startLine,
            item.location.endLine,
          );
          vscode.window.showInformationMessage('Lore updated');
          panel.dispose();
        } catch (e) {
          vscode.window.showErrorMessage('Failed to update Lore: ' + String(e));
        }
      } else if (msg.command === 'archive') {
        loreManager.setItemState((msg as { command: 'archive'; id: string }).id, 'archived');
        vscode.window.showInformationMessage('Lore entry archived.');
        panel.dispose();
      } else if (msg.command === 'delete') {
        const choice = await vscode.window.showWarningMessage(
          'Delete this lore entry? It will be marked as deleted and hidden.',
          { modal: true },
          'Delete',
        );
        if (choice === 'Delete') {
          loreManager.setItemState((msg as { command: 'delete'; id: string }).id, 'deleted');
          vscode.window.showInformationMessage('Lore entry deleted.');
          panel.dispose();
        }
      } else if (msg.command === 'cancel') {
        panel.dispose();
      }
    }, undefined, disposables);

    panel.onDidDispose(() => disposables.forEach(d => d.dispose()), null, context.subscriptions);
  });

  const disableHighlightsCommand = vscode.commands.registerCommand('lore.disableHighlights', () => {
    loreManager.clearDecorations();
    persistHighlight(false);
    codeLensEmitter.fire();
    vscode.window.showInformationMessage('Lore highlights disabled.');
  });

  const listAllEntriesCommand = vscode.commands.registerCommand('lore.listAllEntries', async () => {
    const allItems = loreManager.getAllLoreItems();
    if (!allItems.length) {
      vscode.window.showInformationMessage('No lore entries found in this workspace.');
      return;
    }

    const quickPickItems = allItems.map(item => ({
      label: `${item.state === 'archived' ? '$(archive) ' : ''}${item.summary}`,
      description: `${item.file} (Lines: ${item.location.startLine}–${item.location.endLine})`,
      item,
    }));

    const selected = await vscode.window.showQuickPick(quickPickItems, {
      matchOnDescription: true,
      placeHolder: 'Select a lore entry to jump to',
    });

    if (selected && vscode.workspace.workspaceFolders) {
      const rootUri = vscode.workspace.workspaceFolders[0].uri;
      const fileUri = vscode.Uri.joinPath(rootUri, selected.item.file);
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const editor = await vscode.window.showTextDocument(doc);
      const range = new vscode.Range(
        selected.item.location.startLine - 1, 0,
        selected.item.location.endLine - 1, 0,
      );
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    }
  });

  // ── Providers ──────────────────────────────────────────────────────────────

  const hoverProvider = vscode.languages.registerHoverProvider('*', {
    provideHover(document, position) {
      for (const loreDecoration of loreManager.getLoreItemsForFile(document.uri.fsPath)) {
        if (loreDecoration.decoration.range.contains(position)) {
          return new vscode.Hover(loreDecoration.hoverMessage, loreDecoration.decoration.range);
        }
      }
      return null;
    },
  });

  const codeLensProvider = vscode.languages.registerCodeLensProvider('*', {
    onDidChangeCodeLenses: codeLensEmitter.event,
    provideCodeLenses(document) {
      if (!loreManager.getIsHighlightingEnabled()) { return []; }
      const lenses: vscode.CodeLens[] = [];
      for (const { decoration, item } of loreManager.getLoreItemsForFile(document.uri.fsPath)) {
        lenses.push(
          new vscode.CodeLens(decoration.range, { title: 'Edit Lore', command: 'lore.editComment', arguments: [item.id] }),
          new vscode.CodeLens(decoration.range, { title: 'View Lore', command: 'lore.previewMarkdown', arguments: [item.id] }),
        );
      }
      return lenses;
    },
  });

  // ── Event listeners ────────────────────────────────────────────────────────

  // Refresh decorations and lazily re-anchor when the user switches files.
  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(editor => {
    loreManager.onActiveEditorChanged(editor);
    updateStatusBar();
  });

  const textDocumentListener = vscode.workspace.onDidChangeTextDocument(event => {
    loreManager.adjustLoreLocations(event);
  });

  const fileRenameListener = vscode.workspace.onDidRenameFiles(async e => {
    await loreManager.handleFileRenames(e);
  });

  // ── Register disposables ───────────────────────────────────────────────────

  context.subscriptions.push(
    toggleHighlightsCommand,
    createCommand,
    hoverProvider,
    codeLensProvider,
    enableHighlightsCommand,
    editCommand,
    previewMarkdownCommand,
    disableHighlightsCommand,
    listAllEntriesCommand,
    activeEditorListener,
    textDocumentListener,
    fileRenameListener,
    loreManager,
  );

  // Trigger initial decoration pass for whatever editor is already open.
  loreManager.onActiveEditorChanged(vscode.window.activeTextEditor);
}

export function deactivate() {
  loreManager?.dispose();
}
