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

/**
 * Generates the HTML content for the create/edit webview.
 */
export function getWebviewContent(
    cspSource: string,
    extensionUri: vscode.Uri,
    filePath: string,
    startLine: number,
    endLine: number,
    mode: 'create' | 'edit' = 'create',
    initialSummary = '',
    initialBody = '',
    initialAuthor: string = '',
    itemId?: string
): string {
    const nonce = getNonce();


    return `<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy"
            content="
                default-src 'none';
                img-src ${cspSource} https: data: vscode-resource:;
                script-src 'nonce-${nonce}';
                style-src ${cspSource} 'unsafe-inline';
                font-src ${cspSource} vscode-resource:;
            " />
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${mode === 'edit' ? 'Edit' : 'Create'} Lore</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                padding: 16px;
            }
            label {
                display: block;
                margin-top: 12px;
                font-weight: 600;
            }
            input[type=text],
            textarea {
                width: 100%;
                padding: 8px;
                border-radius: 4px;
                border: 1px solid #ccc;
            }
            textarea {
                min-height: 200px;
            }
            footer {
                margin-top: 16px;
                display: flex;
                justify-content: flex-end;
                gap: 8px;
            }
            button {
                padding: 8px 12px;
                border-radius: 4px;
                border: none;
                cursor: pointer;
            }
            .primary {
                background: #0066cc;
                color: white;
            }
            .muted {
                color: #666;
                font-size: 0.9em;
            }
        </style>
    </head>
    <body data-mode="${mode}" data-itemid="${itemId || ''}">
        <h2>Lore — ${mode === 'edit' ? 'Edit' : 'Chronicle new'} lore</h2>
        <div class="muted">
            File: <strong>${escapeHtml(filePath)}</strong> • Lines: ${startLine}${startLine === endLine ? '' : '–' + endLine}
        </div>

        <label for="summary">Summary</label>
        <input id="summary" type="text" placeholder="Short one-line summary" value="${escapeHtml(initialSummary)}" />

        <label for="body">Details (Markdown)</label>
        <textarea id="body" placeholder="Describe the design intent, references, links, or any notes. Use #LOC:{x} to reference lines.">${escapeHtml(initialBody)}</textarea>

        <label for="author">Author (optional)</label>
        <input id="author" type="text" placeholder="Name or email" value="${escapeHtml(initialAuthor)}" />

        <footer>
            <button id="cancel">Cancel</button>
            <button id="save" class="primary">Save to .lore.json</button>
        </footer>

        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            const saveBtn = document.getElementById('save');
            const cancelBtn = document.getElementById('cancel');
            const itemId = document.body.dataset.itemid;

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

            cancelBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'cancel' });
            });
        </script>
    </body>
</html>`;
}
