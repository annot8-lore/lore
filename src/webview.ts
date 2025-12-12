import * as vscode from 'vscode';
import { LORE_CATEGORIES } from './types'; // Import LORE_CATEGORIES

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
    itemId?: string,
    initialCategories: string[] = []
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
                style-src 'unsafe-inline';
                font-src ${cspSource} vscode-resource:;
            " />
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${mode === 'edit' ? 'Edit' : 'Create'} Lore</title>
        <style>
            :root {
                color-scheme: light dark;
            }
            body {
                font-family: var(--vscode-font-family);
                padding: 0; /* Remove padding from body */
                margin: 0;
                background: var(--vscode-editor-background);
                color: var(--vscode-editor-foreground);
            }
            #app-container {
                padding: 16px;
                // background-color: var(--vscode-editor-background, white);
                // color: var(--vscode-editor-foreground, black);
            }
            label {
                display: block;
                margin-top: 12px;
                font-weight: 600;
                color: var(--vscode-editor-foreground);
            }
            input[type=text],
            textarea {
                width: 100%;
                padding: 8px;
                border-radius: 4px;
                color: var(--vscode-input-foreground);
                background: var(--vscode-input-background);
                border: 1px solid var(--vscode-editor-border, var(--vscode-editorWidget-border));
            }
            textarea {
                min-height: 200px;
            }
            .custom-multiselect {
                position: relative;
            }
            .select-box {
                border: 1px solid var(--vscode-input-border);
                border-radius: 4px;
                padding: 8px;
                cursor: pointer;
                width: 100%;
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
            }
            .checkboxes-container {
                display: none;
                position: absolute;
                border: 1px solid var(--vscode-input-border);
                border-top: none;
                border-radius: 0 0 4px 4px;
                width: 100%;
                background: var(--vscode-editor-background);
                z-index: 10;
            }
            .checkboxes-container label {
                display: block;
                padding: 8px;
                margin-top: 0;
                font-weight: normal;
                color: var(--vscode-editor-foreground);
            }
            .checkboxes-container label:hover {
                background-color: var(--vscode-list-hoverBackground);
            }
            .checkboxes-container input[type="checkbox"] {
                margin-right: 8px;
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
                background: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
            }
            button:hover {
                background: var(--vscode-button-secondaryHoverBackground);
            }
            .primary {
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
            }
            .primary:hover {
                background: var(--vscode-button-hoverBackground);
            }
            .muted {
                color: var(--vscode-descriptionForeground);
                font-size: 0.9em;
            }
        </style>
    </head>
    <body data-mode="${mode}" data-itemid="${itemId || ''}">
      <div id="app-container">
        <h2>Lore — ${mode === 'edit' ? 'Edit' : 'Chronicle new'} lore</h2>
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

        <label for="author">Author (optional)</label>
        <input id="author" type="text" placeholder="Name or email" value="${escapeHtml(initialAuthor)}" />

        <footer>
            <button id="cancel">Cancel</button>
            <button id="save" class="primary">Save to .lore.json</button>
        </footer>
      </div>

        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            const saveBtn = document.getElementById('save');
            const cancelBtn = document.getElementById('cancel');
            const itemId = document.body.dataset.itemid;
            
            // Custom dropdown logic
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
                if (expanded) {
                    checkboxesContainer.style.display = 'none';
                } else {
                    checkboxesContainer.style.display = 'block';
                }
                expanded = !expanded;
            });

            // Close dropdown if clicking outside
            document.addEventListener('click', (e) => {
                if (!checkboxesContainer.contains(e.target)) {
                    checkboxesContainer.style.display = 'none';
                    expanded = false;
                }
            });

            checkboxes.forEach(checkbox => {
                checkbox.addEventListener('change', updateSelectedText);
            });
            
            // Initial text update
            updateSelectedText();

            saveBtn.addEventListener('click', () => {
                const selectedCategories = Array.from(checkboxes)
                                            .filter(option => option.checked)
                                            .map(option => option.value);

                vscode.postMessage({
                    command: 'save',
                    id: itemId || undefined,
                    file: ${JSON.stringify(filePath)},
                    startLine: ${startLine},
                    endLine: ${endLine},
                    summary: document.getElementById('summary').value,
                    body: document.getElementById('body').value,
                    author: document.getElementById('author').value,
                    categories: selectedCategories
                });
            });

            cancelBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'cancel' });
            });
        </script>
    </body>
</html>`;
}
