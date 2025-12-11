import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ensureLoreFile, readJson, safeWriteJson, nowISO } from './fsUtils';
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

export class LoreManager implements vscode.Disposable {
    private loreSnapshot: LoreSnapshot | null = null;
    private commentRanges = new Map<string, { range: vscode.Range, item: LoreItem }[]>();
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
        this.commentRanges.clear();
        if (!this.loreSnapshot) return;

        for (const item of this.loreSnapshot.items) {
            if (item.location.startLine && item.location.endLine) {
                const filePath = path.join(this.workspaceRoot, item.file);
                const range = new vscode.Range(item.location.startLine - 1, 0, item.location.endLine - 1, 0);
                if (!this.commentRanges.has(filePath)) {
                    this.commentRanges.set(filePath, []);
                }
                this.commentRanges.get(filePath)!.push({ range, item });
            }
        }
    }

    public getLoreItemsForFile(filePath: string): { range: vscode.Range, item: LoreItem }[] {
        return this.commentRanges.get(filePath) || [];
    }

    public getLoreItemById(id: string): LoreItem | undefined {
        return this.loreSnapshot?.items.find(item => item.id === id);
    }

    public getAllLoreItems(): LoreItem[] {
        return this.loreSnapshot?.items || [];
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

        const makeNewItem = (id?: string): LoreItem => ({
            id: id ?? uuidv4(),
            state: 'active',
            file: payload.file || relFile,
            location: { startLine: payload.startLine || startLine, endLine: payload.endLine || endLine },
            summary: payload.summary || '',
            bodyMarkdown: payload.body || '',
            tags: payload.tags || [],
            links: payload.links || [],
            author: payload.author || '',
            createdAt: nowISO(),
            updatedAt: nowISO(),
            contentType: 'markdown',
            isTrusted: false
        });

        let itemId: string;

        if (payload.id) {
            const idx = this.loreSnapshot.items.findIndex(i => i.id === payload.id);
            if (idx >= 0) {
                const existing = this.loreSnapshot.items[idx];
                const updated: LoreItem = {
                    ...existing,
                    file: payload.file || relFile || existing.file,
                    location: {
                        startLine: payload.startLine || startLine || existing.location.startLine,
                        endLine: payload.endLine || endLine || existing.location.endLine,
                        anchorText: existing.location?.anchorText,
                        contextPreview: existing.location?.contextPreview,
                        lineHash: existing.location?.lineHash
                    },
                    summary: payload.summary ?? existing.summary,
                    bodyMarkdown: payload.body ?? existing.bodyMarkdown,
                    tags: payload.tags ?? existing.tags ?? [],
                    links: payload.links ?? existing.links ?? [],
                    author: payload.author ?? existing.author ?? '',
                    updatedAt: nowISO(),
                };
                this.loreSnapshot.items[idx] = updated;
                itemId = updated.id;
            } else {
                const created = makeNewItem(payload.id);
                this.loreSnapshot.items.push(created);
                itemId = created.id;
            }
        } else {
            const created = makeNewItem();
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

    public async adjustLoreLocations(document: vscode.TextDocument, contentChanges: readonly vscode.TextDocumentContentChangeEvent[]) {
        if (!this.loreSnapshot || !this.workspaceRoot) return;

        const filePath = document.uri.fsPath;
                const relFile = path.relative(this.workspaceRoot, filePath).replace(/\\/g, '/');

        const items = this.loreSnapshot.items.filter(i => i.file === relFile && i.state === 'active');
        if (items.length === 0) return;

        let hasChanges = false;

        for (const change of contentChanges) {
            const newLines = (change.text.match(/\n/g) || []).length;
            const oldLines = change.range.end.line - change.range.start.line;
            const delta = newLines - oldLines;

            if (delta === 0) continue;

            hasChanges = true;
            const changeStartLine = change.range.start.line;

            for (const item of items) {
                let start = item.location.startLine - 1; // Convert to 0-based
                let end = item.location.endLine - 1;

                if (start === end) { // Single-line comment
                    if (changeStartLine <= start) {
                        start += delta;
                        end += delta;
                    }
                } else { // Multi-line comment
                    if (changeStartLine < start) {
                        start += delta;
                        end += delta;
                    } else if (changeStartLine <= end) {
                        end += delta;
                        if (end < start) end = start;
                    }
                }

                item.location.startLine = Math.max(1, start + 1);
                item.location.endLine = Math.max(1, end + 1);
            }
        }

        if (hasChanges) {
            this.loreSnapshot.fileMetadata.lastUpdatedAt = nowISO();
            this.saveLoreDebounced();
            this.updateCommentRanges();
            this.refreshDecorations();
            this.onDidChangeLoreEmitter.fire(); // Notify listeners
        }
    }

    public refreshDecorations() {
        for (const editor of vscode.window.visibleTextEditors) {
            const filePath = editor.document.uri.fsPath;
            const ranges = this.commentRanges.get(filePath) || [];
            editor.setDecorations(this.decorationType, ranges.map(r => r.range));
        }
    }

    public dispose() {
        this.decorationType.dispose();
        this.onDidChangeLoreEmitter.dispose();
    }
}
