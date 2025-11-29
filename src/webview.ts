import * as vscode from 'vscode';

function escapeHtml(unsafe: string): string {
  return unsafe.replace(/[&<"'>]/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#039;';
      default: return c;
    }
  });
}

function getNonce(): string {
  return Math.random().toString(36).slice(2, 12);
}

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri, filePath: string, startLine: number, endLine: number, mode: 'create' | 'edit' | 'view' = 'create', initialSummary = '', initialBody = '', initialAuthor: any = '', itemId?: string): string {
  const nonce = getNonce();
  const cspSource = webview.cspSource;

  // Handle author display for view mode
  let authorDisplay = '';
  if (initialAuthor) {
    if (typeof initialAuthor === 'string') {
      authorDisplay = initialAuthor;
    } else if (initialAuthor && initialAuthor.name) {
      authorDisplay = initialAuthor.name;
    }
  }

  return `<!doctype html>
  <html>
  <head>
    <meta http-equiv="Content-Security-Policy"
      content="
        default-src 'none';
        img-src ${cspSource} https:;
        script-src 'nonce-${nonce}';
        style-src ${cspSource} 'unsafe-inline';
        font-src ${cspSource};
      " />
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chronicle new lore</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 16px; }
      label { display:block; margin-top:12px; font-weight:600; }
      input[type=text], textarea { width:100%; padding:8px; border-radius:4px; border:1px solid #ccc; }
      textarea { min-height:200px; }
      .row { display:flex; gap:8px; }
      .muted { color: #666; font-size: 0.9em; }
      footer { margin-top:16px; display:flex; justify-content:flex-end; gap:8px; }
      button { padding:8px 12px; border-radius:4px; border:none; cursor:pointer; }
      .primary { background:#0066cc; color:white; }
      .rendered-content { line-height: 1.6; }
      .rendered-content h1, .rendered-content h2, .rendered-content h3 { margin-top: 24px; margin-bottom: 16px; }
      .rendered-content p { margin-bottom: 16px; }
      .rendered-content code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; }
      .rendered-content pre { background: #f4f4f4; padding: 12px; border-radius: 4px; overflow-x: auto; }
      .rendered-content blockquote { border-left: 4px solid #ddd; padding-left: 16px; margin-left: 0; color: #666; }
    </style>
  </head>
  <body data-mode="${mode}" data-itemid="${itemId || ''}">
    <h2>Lore — ${mode === 'view' ? 'View' : mode === 'edit' ? 'Edit' : 'Chronicle new'} lore</h2>
    <div class="muted">File: <strong>${escapeHtml(filePath || '')}</strong> • Lines: ${startLine}${startLine===endLine?'':'–'+endLine}</div>

    ${mode === 'view' ? `
      <div class="rendered-content">
        <h3>${escapeHtml(initialSummary)}</h3>
        <div>${initialBody ? initialBody.replace(/\n/g, '<br>') : ''}</div>
        ${authorDisplay ? `<div class="muted">Author: ${escapeHtml(authorDisplay)}</div>` : ''}
      </div>
    ` : `
      <label for="summary">Summary</label>
      <input id="summary" type="text" placeholder="Short one-line summary" value="${escapeHtml(initialSummary)}" />

      <label for="body">Details (Markdown)</label>
      <textarea id="body" placeholder="Describe the design intent, references, links, or any notes. Use #LOC:{x} to reference lines.">${escapeHtml(initialBody)}</textarea>

      <label for="author">Author (optional)</label>
      <input id="author" type="text" placeholder="Name or email" value="${escapeHtml(typeof initialAuthor === 'string' ? initialAuthor : initialAuthor?.name || '')}" />
    `}

    <footer>
      <button id="cancel">Cancel</button>
      ${mode === 'view' ? '<button id="edit" class="primary">Edit</button>' : '<button id="save" class="primary">Save to .lore.json</button>'}
    </footer>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();

      const mode = document.body.dataset.mode;
      const itemId = document.body.dataset.itemid;

      const saveBtn = document.getElementById('save');
      const editBtn = document.getElementById('edit');
      const cancelBtn = document.getElementById('cancel');

      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          vscode.postMessage({
            command: 'save',
            id: itemId || undefined,
            file: ${JSON.stringify(filePath)},
            startLine: ${startLine},
            endLine: ${endLine},
            summary: document.getElementById('summary').value,
            body: document.getElementById('body').value,
            author: document.getElementById('author').value
          });
        });
      }

      if (editBtn) {
        editBtn.addEventListener('click', () => {
          vscode.postMessage({ command: 'edit', id: itemId });
        });
      }

      cancelBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'cancel' });
      });
    </script>
  </body>
  </html>`;
}
