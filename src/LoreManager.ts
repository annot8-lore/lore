import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ensureLoreFile, readJson, safeWriteJson, nowISO } from './fsUtils';
import { createHash } from 'crypto';
import type { LoreSnapshot, LoreItem, SavePayload } from './types';

// Debounce utility to prevent excessive file writes
function debounce<T extends (...args: any[]) => void>(func: T, wait: number): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | undefined;
    return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
        const later = () => {
            timeout = undefined;
            func.apply(this, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

interface LoreDecoration {
  decoration: vscode.DecorationOptions;
  item: LoreItem;
}

export class LoreManager implements vscode.Disposable {
    private isHighlightingEnabled = false;
    private loreSnapshot: LoreSnapshot | null = null;
    private commentRanges = new Map<string, LoreDecoration[]>();
    private readonly loreFilePath: string;
    private readonly workspaceRoot: string;
    private readonly decorationType: vscode.TextEditorDecorationType;
    private readonly onDidChangeLoreEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChangeLore = this.onDidChangeLoreEmitter.event;

    constructor(private context: vscode.ExtensionContext, workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.loreFilePath = path.join(this.workspaceRoot, '.lore.json');
        this.decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 255, 0, 0.3)',
            isWholeLine: true
        });

        // Initialize lore file and load snapshot
        this.initialize();
    }

    private async initialize() {
        await ensureLoreFile(this.workspaceRoot);
        await this.loadLore();
    }

    private async loadLore() {
        try {
            this.loreSnapshot = await readJson<LoreSnapshot>(this.loreFilePath);

            // attempt to repair any items whose stored line numbers no longer exist
            await this.reanchorItems();

            this.updateCommentRanges();
            this.refreshDecorations();
            this.onDidChangeLoreEmitter.fire(); // Notify listeners that lore has changed
        } catch (e) {
            vscode.window.showErrorMessage('Failed to load .lore.json: ' + String(e));
            this.loreSnapshot = {
                schemaVersion: 1,
                fileMetadata: {
                    workspace: path.basename(this.workspaceRoot),
                    createdAt: nowISO(),
                    lastUpdatedAt: nowISO(),
                    lastUpdatedBy: ''
                },
                indexes: { tags: {}, filesWithComments: 0 },
                items: []
            };
        }
    }

    private updateCommentRanges() {
        // rebuild cache of ranges without touching the highlighting flag
        this.commentRanges.clear();
        if (!this.loreSnapshot) return;

        for (const item of this.loreSnapshot.items) {
            if (item.location.startLine && item.location.endLine) {
                const filePath = path.join(this.workspaceRoot, item.file);
                const range = new vscode.Range(item.location.startLine - 1, 0, item.location.endLine - 1, 0);

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

                const decoration: vscode.DecorationOptions = {
                    range,
                    hoverMessage: markdown,
                };

                if (!this.commentRanges.has(filePath)) {
                    this.commentRanges.set(filePath, []);
                }
                this.commentRanges.get(filePath)!.push({ decoration, item });
            }
        }
    }

    public getLoreItemsForFile(filePath: string): LoreDecoration[] {
        return this.commentRanges.get(filePath) || [];
    }

    /**
     * Update items when files are renamed in the workspace.
     * `event` is the object received from `workspace.onDidRenameFiles`.
     */
    public async handleFileRenames(event: vscode.FileRenameEvent) {
        if (!this.loreSnapshot) return;
        let mutated = false;
        for (const change of event.files) {
            const oldRel = path.relative(this.workspaceRoot, change.oldUri.fsPath);
            const newRel = path.relative(this.workspaceRoot, change.newUri.fsPath);
            for (const item of this.loreSnapshot.items) {
                if (item.file === oldRel) {
                    item.file = newRel;
                    mutated = true;
                }
            }
        }
        if (mutated) {
            this.updateCommentRanges();
            this.refreshDecorations();
            this.saveLoreDebounced();
        }
    }

    public getLoreItemById(id: string): LoreItem | undefined {
        return this.loreSnapshot?.items.find((item: LoreItem) => item.id === id);
    }

    public getAllLoreItems(): LoreItem[] {
        return this.loreSnapshot?.items || [];
    }

    // attempt to reposition items whose range is out of bounds using anchor text/hash
    private async reanchorItems() {
        if (!this.loreSnapshot) return;
        for (const item of this.loreSnapshot.items) {
            const absPath = path.join(this.workspaceRoot, item.file);
            let doc: vscode.TextDocument | null = null;
            try {
                doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
            } catch {
                continue; // file deleted or not openable
            }

            const lineCount = doc.lineCount;
            if (item.location.startLine > lineCount || item.location.startLine < 1) {
                // try to search using anchorText first
                if (item.location.anchorText) {
                    const idx = doc.getText().indexOf(item.location.anchorText);
                    if (idx !== -1) {
                        const pos = doc.positionAt(idx);
                        const lines = item.location.anchorText.split('\n').length;
                        item.location.startLine = pos.line + 1;
                        item.location.endLine = pos.line + lines;
                        continue;
                    }
                }
                // fallback: search whole file for hash match (rare)
                if (item.location.lineHash) {
                    const text = doc.getText();
                    // naive sliding window
                    const lines = text.split(/\r?\n/);
                    for (let i = 0; i < lines.length; i++) {
                        const snippet = lines.slice(i, i + 1).join('\n');
                        const h = createHash('sha1').update(snippet).digest('hex');
                        if (h === item.location.lineHash) {
                            item.location.startLine = i + 1;
                            item.location.endLine = i + 1;
                            break;
                        }
                    }
                }
            }
        }
    }

    public async reloadLore() {
        await this.loadLore();
    }

    public async upsertLoreItem(payload: SavePayload, relFile: string, startLine: number, endLine: number): Promise<string> {
        if (!this.loreSnapshot) {
            await this.loadLore(); // Ensure snapshot is loaded before proceeding
            if (!this.loreSnapshot) {
                throw new Error('Lore snapshot could not be loaded or initialized.');
            }
        }

        // helper: read snippet & compute anchor data
        const computeAnchor = async (file: string, s: number, e: number) => {
            try {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(this.workspaceRoot, file)));
                const anchorText = doc.getText(new vscode.Range(s - 1, 0, e - 1, doc.lineAt(e - 1).text.length)).trim();
                const contextStart = Math.max(0, s - 2);
                const contextEnd = Math.min(doc.lineCount - 1, e);
                const contextLines = doc.getText(new vscode.Range(contextStart, 0, contextEnd, doc.lineAt(contextEnd).text.length)).trim();
                const hash = createHash('sha1').update(anchorText).digest('hex');
                return { anchorText, contextPreview: contextLines, lineHash: hash };
            } catch {
                return { anchorText: '', contextPreview: '', lineHash: '' };
            }
        };

        const makeNewItem = async (id?: string): Promise<LoreItem> => {
            const loc = { startLine: payload.startLine || startLine, endLine: payload.endLine || endLine };
            const anchorData = await computeAnchor(payload.file || relFile, loc.startLine, loc.endLine);
            return {
                id: id ?? uuidv4(),
                state: 'active',
                file: payload.file || relFile,
                location: { ...loc, ...anchorData },
                summary: payload.summary || '',
                bodyMarkdown: payload.body || '',
                tags: payload.tags || [],
                links: payload.links || [],
                author: payload.author || '',
                createdAt: nowISO(),
                updatedAt: nowISO(),
                contentType: 'markdown',
                isTrusted: false,
                categories: payload.categories || [], // New field
            };
        };

        let itemId: string;

        if (payload.id) {
            const idx = this.loreSnapshot.items.findIndex((i: LoreItem) => i.id === payload.id);
            if (idx >= 0) {
                const existing = this.loreSnapshot.items[idx];
                const loc = {
                    startLine: payload.startLine || startLine || existing.location.startLine,
                    endLine: payload.endLine || endLine || existing.location.endLine,
                };
                const anchorData = await computeAnchor(payload.file || relFile || existing.file, loc.startLine, loc.endLine);
                const updated: LoreItem = {
                    ...existing,
                    file: payload.file || relFile || existing.file,
                    location: {
                        ...loc,
                        ...anchorData,
                    },
                    summary: payload.summary ?? existing.summary,
                    bodyMarkdown: payload.body ?? existing.bodyMarkdown,
                    tags: payload.tags ?? existing.tags ?? [],
                    links: payload.links ?? existing.links ?? [],
                    author: payload.author ?? existing.author ?? '',
                    updatedAt: nowISO(),
                    categories: payload.categories ?? existing.categories ?? [], // New field
                };
                this.loreSnapshot.items[idx] = updated;
                itemId = updated.id;
            } else {
                const created = await makeNewItem(payload.id);
                this.loreSnapshot.items.push(created);
                itemId = created.id;
            }
        } else {
            const created = await makeNewItem();
            this.loreSnapshot.items.push(created);
            itemId = created.id;
        }

        this.loreSnapshot.fileMetadata.lastUpdatedAt = nowISO();
        this.saveLoreDebounced();
        this.updateCommentRanges(); // Update ranges immediately after upserting
        this.refreshDecorations();
        this.onDidChangeLoreEmitter.fire(); // Notify listeners that lore has changed
        return itemId;
    }

    private saveLore = async () => {
        if (this.loreSnapshot) {
            try {
                await safeWriteJson(this.loreFilePath, this.loreSnapshot);
                console.log('Lore saved to .lore.json');
            } catch (e) {
                vscode.window.showErrorMessage('Failed to save Lore: ' + String(e));
                console.error('Error saving lore:', e);
            }
        }
    };

    private saveLoreDebounced = debounce(this.saveLore, 500); // Debounce by 500ms

    public adjustLoreLocations(event: vscode.TextDocumentChangeEvent) {
        const { document, contentChanges } = event;
        const filePath = document.uri.fsPath;
        const loreForFile = this.commentRanges.get(filePath);

        // always operate on the cache even if highlights are off
        if (!loreForFile || loreForFile.length === 0) {
            return;
        }

        let hasChanges = false;
        for (const change of contentChanges) {
            const delta = (change.text.match(/\n/g) || []).length - (change.range.end.line - change.range.start.line);
            if (delta === 0) continue;

            hasChanges = true;
            const changeStartLine = change.range.start.line;

            for (const lore of loreForFile) {
                let start = lore.decoration.range.start.line;
                let end = lore.decoration.range.end.line;

                if (changeStartLine < start) {
                    start += delta;
                    end += delta;
                } else if (changeStartLine >= start && changeStartLine <= end) {
                    end += delta;
                }

                // clamp negatives
                if (start < 0) start = 0;
                if (end < start) {
                    end = start;
                }

                lore.decoration.range = new vscode.Range(start, 0, end, 0);
                
                // Also update the canonical item in the snapshot
                lore.item.location.startLine = start + 1;
                lore.item.location.endLine = end + 1;
            }
        }

        if (hasChanges) {
            this.refreshDecorations();
            this.saveLoreDebounced();
        }
    }



    public refreshDecorations() {
        for (const editor of vscode.window.visibleTextEditors) {
            const decorations = this.isHighlightingEnabled ? (this.commentRanges.get(editor.document.uri.fsPath) || []) : [];
            editor.setDecorations(this.decorationType, decorations.map(d => d.decoration));
        }
    }

    public getIsHighlightingEnabled(): boolean {
        return this.isHighlightingEnabled;
    }

    public toggleHighlights() {
        this.isHighlightingEnabled = !this.isHighlightingEnabled;
        if (this.isHighlightingEnabled) {
            // ensure cache available
            if (!this.commentRanges.size) {
                this.updateCommentRanges();
            }
        }
        this.refreshDecorations();
        this.onDidChangeLoreEmitter.fire(); // To update status bar and codelens
    }

    public enableHighlights() {
        this.isHighlightingEnabled = true;
        this.refreshDecorations();
        this.onDidChangeLoreEmitter.fire();
    }

    public clearDecorations() {
        this.isHighlightingEnabled = false;
        // keep commentRanges intact; we only disable visuals
        for (const editor of vscode.window.visibleTextEditors) {
            editor.setDecorations(this.decorationType, []);
        }
        this.onDidChangeLoreEmitter.fire(); // Notify to refresh codelens
    }

    public dispose() {
        this.decorationType.dispose();
        this.onDidChangeLoreEmitter.dispose();
    }
}
