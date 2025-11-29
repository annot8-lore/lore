import * as vscode from 'vscode';
import * as path from 'path';
import { ensureLoreFile, readJson, safeWriteJson, nowISO } from './fsUtils';
import { getWebviewContent } from './webview';
import { upsertLoreItem } from './itemManager';
import type { LoreSnapshot, WebviewMessage, SavePayload, LoreItem } from './types';

const decorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(255, 255, 0, 1.0)',
  isWholeLine: true
});

const commentRanges = new Map<string, {range: vscode.Range, item: LoreItem}[]>();

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

    panel.webview.html = getWebviewContent(panel.webview, context.extensionUri, relFile, startLine, endLine, 'create');

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
      } else if (msg.command === 'edit') {
        panel.dispose();
        vscode.commands.executeCommand('lore.editComment', {id: msg.id});
      } else if (msg.command === 'cancel') {
        panel.dispose();
      }
    }, undefined, disposables);

    panel.onDidDispose(() => {
      disposables.forEach(d => d.dispose());
    }, null, context.subscriptions);
  });

  // const hoverProvider = vscode.languages.registerHoverProvider('*', {
  //   provideHover(document, position, token) {
  //     const filePath = document.uri.fsPath;
  //     const ranges = commentRanges.get(filePath) || [];
  //     for (const {range, item} of ranges) {
  //       if (range.contains(position)) {
  //         const markdown = new vscode.MarkdownString(`${item.summary}\n\n${item.bodyMarkdown}`, true);
  //         markdown.appendMarkdown('\n\n---\n');
  //         const editCommandUri = vscode.Uri.parse(`command:lore.editComment?${encodeURIComponent(JSON.stringify([item.id]))}`);
  //         const viewCommandUri = vscode.Uri.parse(`command:lore.openComment?${encodeURIComponent(JSON.stringify([item.id]))}`);
  //         markdown.appendMarkdown(`[Edit Lore](${editCommandUri}) | [View Lore](${viewCommandUri})`);
  //         markdown.isTrusted = true;
  //         return new vscode.Hover(markdown, range);
  //       }
  //     }
  //     return null;
  //   }
  // });

  const hoverProvider = vscode.languages.registerHoverProvider('*', {
    provideHover(document, position, token) {
      const filePath = document.uri.fsPath;
      const ranges = commentRanges.get(filePath) || [];

      for (const { range, item } of ranges) {
        if (range.contains(position)) {
          const editCommandUri = vscode.Uri.parse(
            `command:lore.editComment?${encodeURIComponent(JSON.stringify([item.id]))}`
          );
          const viewCommandUri = vscode.Uri.parse(
            `command:lore.openComment?${encodeURIComponent(JSON.stringify([item.id]))}`
          );

          const mdContent = `${item.summary}\n\n${item.bodyMarkdown || ''}\n\n---\n[Edit Lore](${editCommandUri}) | [View Lore](${viewCommandUri})`;
          
          const markdown = new vscode.MarkdownString(mdContent, true);
          markdown.isTrusted = true;

          return new vscode.Hover(markdown, range);
        }
      }
      return null;
    }
  });



  const codeLensProvider = vscode.languages.registerCodeLensProvider('*', {
    provideCodeLenses(document, token) {
      const filePath = document.uri.fsPath;
      const ranges = commentRanges.get(filePath) || [];
      const lenses: vscode.CodeLens[] = [];
      for (const {range, item} of ranges) {
        const editLens = new vscode.CodeLens(range, {
          title: 'Edit Lore',
          command: 'lore.editComment',
          arguments: [item.id]
        });
        const openLens = new vscode.CodeLens(range, {
          title: 'Open Lore',
          command: 'lore.openComment',
          arguments: [item.id]
        });
        lenses.push(editLens, openLens);
      }
      return lenses;
    }
  });

  const showCommand = vscode.commands.registerCommand('lore.showEnrichedComments', async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;
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
          commentRanges.get(filePath)!.push({range, item});
          highlighted++;
        }
      }
      for (const editor of vscode.window.visibleTextEditors) {
        const filePath = editor.document.uri.fsPath;
        const ranges = commentRanges.get(filePath) || [];
        editor.setDecorations(decorationType, ranges.map(r => r.range));
        vscode.window.showInformationMessage(`Set ${ranges.length} decorations on ${path.basename(filePath)}`);
      }
    } catch (e) {
      vscode.window.showErrorMessage('Failed to load .lore.json: ' + String(e));
    }
  });

  const openLorePanel = async (item: LoreItem, mode: 'edit' | 'view', root: string, context: vscode.ExtensionContext) => {
    const panel = vscode.window.createWebviewPanel('lorePanel', `Lore — ${mode === 'edit' ? 'Edit' : 'View'} lore`, vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: false
    });
    panel.webview.html = getWebviewContent(panel.webview, context.extensionUri, item.file, item.location.startLine, item.location.endLine, mode, item.summary, item.bodyMarkdown, typeof item.author === 'string' ? item.author : item.author?.name || '', item.id);
    const disposables: vscode.Disposable[] = [];
    panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      if (msg.command === 'save') {
        try {
          const lorePath = path.join(root, '.lore.json');
          const json = await readJson<LoreSnapshot>(lorePath);
          upsertLoreItem(json, msg as SavePayload, item.file, item.location.startLine, item.location.endLine);
          json.fileMetadata.lastUpdatedAt = nowISO();
          await safeWriteJson(lorePath, json);
          vscode.window.showInformationMessage('Lore updated');
          panel.dispose();
        } catch (e) {
          vscode.window.showErrorMessage('Failed to update Lore: ' + String(e));
        }
      } else if (msg.command === 'edit') {
        panel.dispose();
        vscode.commands.executeCommand('lore.editComment', {id: msg.id});
      } else if (msg.command === 'cancel') {
        panel.dispose();
      }
    }, undefined, disposables);
    panel.onDidDispose(() => {
      disposables.forEach(d => d.dispose());
    }, null, context.subscriptions);
  };

  const editCommand = vscode.commands.registerCommand('lore.editComment', async (...args: string[]) => {
    const id = args[0];
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;
    const root = folders[0].uri.fsPath;
    try {
      const lorePath = path.join(root, '.lore.json');
      const json = await readJson<LoreSnapshot>(lorePath);
      const item = json.items.find(i => i.id === id);
      if (item) {
        await openLorePanel(item, 'edit', root, context);
      }
    } catch (e) {
      // 
    }
  });

  const openCommand = vscode.commands.registerCommand('lore.openComment', async (...args: string[]) => {
    const id = args[0];
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;
    const root = folders[0].uri.fsPath;
    try {
      const lorePath = path.join(root, '.lore.json');
      const json = await readJson<LoreSnapshot>(lorePath);
      const item = json.items.find(i => i.id === id);
      if (item) {
        await openLorePanel(item, 'view', root, context);
      }
    } catch (e) {
      // 
    }
  });

  const testWebview = vscode.commands.registerCommand("lore.testWebview", () => {
    const panel = vscode.window.createWebviewPanel(
      "testWebview",
      "Webview Test",
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    panel.webview.html = getWebviewContent(panel.webview, context.extensionUri, '', 1, 1, 'create', 'Test Summary', 'Test body content', 'Test Author');

    const disposables: vscode.Disposable[] = [];

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      if (msg.command === 'save') {
        vscode.window.showInformationMessage('Test webview save received: ' + JSON.stringify(msg));
        panel.dispose();
      } else if (msg.command === 'cancel') {
        vscode.window.showInformationMessage('Test webview cancelled');
        panel.dispose();
      }
    }, undefined, disposables);

    panel.onDidDispose(() => {
      disposables.forEach(d => d.dispose());
    }, null, context.subscriptions);
  });

  context.subscriptions.push(disposable, hoverProvider, codeLensProvider, showCommand, editCommand, openCommand, testWebview);
}

export function deactivate() {
  // nothing special
}
