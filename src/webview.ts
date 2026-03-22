import * as vscode from 'vscode';
import { LORE_CATEGORIES } from './types';

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
    const { randomBytes } = require('crypto') as typeof import('crypto');
    return randomBytes(16).toString('hex');
}

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
    itemId?: string,
    initialCategories: string[] = [],
    initialTags: string[] = [],
    initialLinks: string[] = [],
): string {
    const nonce = getNonce();
    const isEdit = mode === 'edit';

    return `<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy"
            content="
                default-src 'none';
                img-src ${cspSource} https: data: vscode-resource:;
                script-src 'nonce-${nonce}';
                style-src 'unsafe-inline';
                font-src ${cspSource} vscode-resource:;
            " />
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${isEdit ? 'Edit' : 'Create'} Lore</title>
        <style>
            :root { color-scheme: light dark; }
            body {
                font-family: var(--vscode-font-family);
                padding: 0;
                margin: 0;
                background: var(--vscode-editor-background);
                color: var(--vscode-editor-foreground);
            }
            #app-container { padding: 16px; }
            label {
                display: block;
                margin-top: 12px;
                font-weight: 600;
                color: var(--vscode-editor-foreground);
            }
            input[type=text], textarea {
                width: 98%;
                padding: 8px;
                border-radius: 4px;
                color: var(--vscode-input-foreground);
                background: var(--vscode-input-background);
                border: 1px solid var(--vscode-editor-border, var(--vscode-editorWidget-border));
                box-sizing: border-box;
            }
            textarea { min-height: 200px; }
            textarea.links { min-height: 72px; }
            .hint {
                font-size: 0.82em;
                color: var(--vscode-descriptionForeground);
                margin-top: 3px;
            }
            .custom-multiselect { position: relative; }
            .select-box {
                border: 1px solid var(--vscode-input-border);
                border-radius: 4px;
                padding: 8px;
                cursor: pointer;
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                width: 98%;
                box-sizing: border-box;
            }
            .checkboxes-container {
                display: none;
                position: absolute;
                border: 1px solid var(--vscode-input-border);
                border-top: none;
                border-radius: 0 0 4px 4px;
                background: var(--vscode-editor-background);
                z-index: 10;
                width: 98%;
            }
            .checkboxes-container label {
                display: block;
                padding: 8px;
                margin-top: 0;
                font-weight: normal;
                color: var(--vscode-editor-foreground);
            }
            .checkboxes-container label:hover { background-color: var(--vscode-list-hoverBackground); }
            .checkboxes-container input[type="checkbox"] { margin-right: 8px; }
            footer {
                margin-top: 20px;
                display: flex;
                justify-content: flex-end;
                gap: 8px;
                flex-wrap: wrap;
            }
            .footer-left { margin-right: auto; display: flex; gap: 8px; }
            button {
                padding: 8px 12px;
                border-radius: 4px;
                border: none;
                cursor: pointer;
                background: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
            }
            button:hover { background: var(--vscode-button-secondaryHoverBackground); }
            .primary {
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
            }
            .primary:hover { background: var(--vscode-button-hoverBackground); }
            .destructive {
                background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
                color: var(--vscode-inputValidation-errorForeground, #f48771);
                border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
            }
            .destructive:hover { opacity: 0.85; }
            .muted { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
        </style>
    </head>
    <body data-mode="${mode}" data-itemid="${itemId || ''}">
      <div id="app-container">
        <h2>Lore — ${isEdit ? 'Edit' : 'Chronicle new'} lore</h2>
        <div class="muted">
            File: <strong>${escapeHtml(filePath)}</strong> • Lines: ${startLine}${startLine === endLine ? '' : '–' + endLine}
        </div>

        <label for="summary">Summary</label>
        <input id="summary" type="text" placeholder="Short one-line summary" value="${escapeHtml(initialSummary)}" />

        <label for="body">Details (Markdown)</label>
        <textarea id="body" placeholder="Describe the design intent, references, links, or any notes. Use #LOC:{x} to reference lines.">${escapeHtml(initialBody)}</textarea>

        <label>Categories</label>
        <div class="custom-multiselect">
            <div class="select-box" tabindex="0">
                <span class="selected-options">Select Categories...</span>
            </div>
            <div class="checkboxes-container" id="categories-checkboxes">
                ${LORE_CATEGORIES.map(category => `
                    <label>
                        <input type="checkbox" value="${escapeHtml(category)}" ${initialCategories.includes(category) ? 'checked' : ''} />
                        ${escapeHtml(category)}
                    </label>
                `).join('')}
            </div>
        </div>

        <label for="tags">Tags</label>
        <input id="tags" type="text" placeholder="design, performance, auth" value="${escapeHtml(initialTags.join(', '))}" />
        <div class="hint">Comma-separated</div>

        <label for="links">Links</label>
        <textarea id="links" class="links" placeholder="https://notion.so/... &#10;https://github.com/...">${escapeHtml(initialLinks.join('\n'))}</textarea>
        <div class="hint">One URL per line</div>

        <label for="author">Author</label>
        <input id="author" type="text" placeholder="Name or email" value="${escapeHtml(initialAuthor)}" />

        <footer>
            ${isEdit ? `
            <div class="footer-left">
                <button id="archive">Archive</button>
                <button id="delete" class="destructive">Delete</button>
            </div>` : ''}
            <button id="cancel">Cancel</button>
            <button id="save" class="primary">Save to .lore.json</button>
        </footer>
      </div>

        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            const saveBtn = document.getElementById('save');
            const cancelBtn = document.getElementById('cancel');
            const itemId = document.body.dataset.itemid;
            const isEdit = document.body.dataset.mode === 'edit';

            // ── Categories dropdown ──────────────────────────────────────────
            const selectBox = document.querySelector('.select-box');
            const checkboxesContainer = document.querySelector('.checkboxes-container');
            const selectedOptionsSpan = document.querySelector('.selected-options');
            const checkboxes = checkboxesContainer.querySelectorAll('input[type="checkbox"]');
            let expanded = false;

            function updateSelectedText() {
                const selected = Array.from(checkboxes).filter(c => c.checked);
                if (selected.length === 0) {
                    selectedOptionsSpan.textContent = 'Select Categories...';
                } else if (selected.length === 1) {
                    selectedOptionsSpan.textContent = selected[0].value;
                } else {
                    selectedOptionsSpan.textContent = selected.length + ' categories selected';
                }
            }

            selectBox.addEventListener('click', (e) => {
                e.stopPropagation();
                expanded = !expanded;
                checkboxesContainer.style.display = expanded ? 'block' : 'none';
            });

            document.addEventListener('click', (e) => {
                if (!checkboxesContainer.contains(e.target)) {
                    checkboxesContainer.style.display = 'none';
                    expanded = false;
                }
            });

            checkboxes.forEach(cb => cb.addEventListener('change', updateSelectedText));
            updateSelectedText();

            // ── Save ─────────────────────────────────────────────────────────
            saveBtn.addEventListener('click', () => {
                const selectedCategories = Array.from(checkboxes)
                    .filter(c => c.checked).map(c => c.value);

                const rawTags = document.getElementById('tags').value;
                const tags = rawTags.split(',').map(t => t.trim()).filter(t => t.length > 0);

                const rawLinks = document.getElementById('links').value;
                const links = rawLinks.split('\\n').map(l => l.trim()).filter(l => l.length > 0);

                vscode.postMessage({
                    command: 'save',
                    id: itemId || undefined,
                    file: ${JSON.stringify(filePath)},
                    startLine: ${startLine},
                    endLine: ${endLine},
                    summary: document.getElementById('summary').value,
                    body: document.getElementById('body').value,
                    author: document.getElementById('author').value,
                    categories: selectedCategories,
                    tags,
                    links,
                });
            });

            cancelBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'cancel' });
            });

            // ── Archive / Delete (edit mode only) ────────────────────────────
            if (isEdit) {
                document.getElementById('archive').addEventListener('click', () => {
                    vscode.postMessage({ command: 'archive', id: itemId });
                });

                document.getElementById('delete').addEventListener('click', () => {
                    vscode.postMessage({ command: 'delete', id: itemId });
                });
            }
        </script>
    </body>
</html>`;
}
