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

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri, filePath: string, startLine: number, endLine: number): string {
  const nonce = getNonce();
  const cspSource = webview.cspSource;

  return `<!doctype html>
  <html>
  <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
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
    </style>
  </head>
  <body>
    <h2>Chronicle new lore</h2>
    <div class="muted">File: <strong>${escapeHtml(filePath || '')}</strong> • Lines: ${startLine}${startLine===endLine?'':'–'+endLine}</div>

    <label for="summary">Summary</label>
    <input id="summary" type="text" placeholder="Short one-line summary" />

    <label for="body">Details (Markdown)</label>
    <textarea id="body" placeholder="Describe the design intent, references, links, or any notes. Use #LOC:{x} to reference lines."></textarea>

    <label for="author">Author (optional)</label>
    <input id="author" type="text" placeholder="Name or email" />

    <footer>
      <button id="cancel">Cancel</button>
      <button id="save" class="primary">Save to .lore.json</button>
    </footer>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.getElementById('save').addEventListener('click', () => {
      const summary = document.getElementById('summary').value;
      const body = document.getElementById('body').value;
      const author = document.getElementById('author').value;
        vscode.postMessage({ command: 'save', file: ${JSON.stringify(filePath)}, startLine: ${startLine}, endLine: ${endLine}, summary, body, author });
      });
      document.getElementById('cancel').addEventListener('click', () => {
        vscode.postMessage({ command: 'cancel' });
      });
    </script>
  </body>
  </html>`;
}
