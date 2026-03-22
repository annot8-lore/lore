import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { ensureLoreFile, readJson, safeWriteJson, nowISO, migrateSnapshot } from './fsUtils';
import type { LoreSnapshot, LoreItem, SavePayload } from './types';

function debounce<T extends (...args: unknown[]) => void>(fn: T, wait: number) {
    let timer: NodeJS.Timeout | undefined;
    return function (this: unknown, ...args: Parameters<T>) {
        clearTimeout(timer);
        timer = setTimeout(() => { timer = undefined; fn.apply(this, args); }, wait);
    };
}

/**
 * Pure data / IO layer. Owns the LoreSnapshot and all reads/writes to .lore.json.
 * Emits onDidChange whenever in-memory state changes (upsert, file-rename, external reload).
 */
export class LoreStore implements vscode.Disposable {
    private snapshot: LoreSnapshot | null = null;
    private isSaving = false;

    private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChange = this.onDidChangeEmitter.event;

    private readonly fileWatcher: vscode.FileSystemWatcher;

    private constructor(
        private readonly loreFilePath: string,
        private readonly workspaceRoot: string,
    ) {
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(loreFilePath);
        // Reload when .lore.json changes externally (teammate pulled, manual edit, etc.)
        this.fileWatcher.onDidChange(() => { if (!this.isSaving) { this.load(); } });
        this.fileWatcher.onDidCreate(() => { if (!this.isSaving) { this.load(); } });
    }

    static async create(workspaceRoot: string): Promise<LoreStore> {
        const loreFilePath = path.join(workspaceRoot, '.lore.json');
        const store = new LoreStore(loreFilePath, workspaceRoot);
        await ensureLoreFile(workspaceRoot);
        await store.load();
        return store;
    }

    // ── Load ────────────────────────────────────────────────────────────────

    async load(): Promise<void> {
        try {
            const raw = await readJson(this.loreFilePath);
            const migrated = migrateSnapshot(raw);
            const needsPersist = (raw as { schemaVersion?: number }).schemaVersion !== migrated.schemaVersion;
            this.snapshot = migrated;
            if (needsPersist) {
                // Persist the migration immediately so teammates see the new schema.
                await this.writeToDisk();
            }
        } catch (e) {
            vscode.window.showErrorMessage('Failed to load .lore.json: ' + String(e));
            this.snapshot = this.emptySnapshot();
        }
        this.onDidChangeEmitter.fire();
    }

    private emptySnapshot(): LoreSnapshot {
        return {
            schemaVersion: 2,
            fileMetadata: {
                workspace: path.basename(this.workspaceRoot),
                createdAt: nowISO(),
                lastUpdatedAt: nowISO(),
                lastUpdatedBy: '',
            },
            indexes: { tags: {}, filesWithComments: 0 },
            items: {},
        };
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    getAllFlat(): LoreItem[] {
        if (!this.snapshot) { return []; }
        return Object.values(this.snapshot.items).flat();
    }

    getByFile(relFile: string): LoreItem[] {
        return this.snapshot?.items[relFile] ?? [];
    }

    getById(id: string): LoreItem | undefined {
        return this.getAllFlat().find(i => i.id === id);
    }

    // ── Write ────────────────────────────────────────────────────────────────

    async upsert(
        payload: SavePayload,
        relFile: string,
        startLine: number,
        endLine: number,
    ): Promise<string> {
        if (!this.snapshot) {
            await this.load();
            if (!this.snapshot) { throw new Error('Lore snapshot could not be loaded.'); }
        }

        const targetFile = payload.file || relFile;
        const targetStart = payload.startLine || startLine;
        const targetEnd = payload.endLine || endLine;
        const anchorData = await this.computeAnchor(targetFile, targetStart, targetEnd);

        let itemId: string;

        if (payload.id) {
            // Look for an existing item with this id across all file buckets.
            let found = false;
            outer:
            for (const [fileKey, fileItems] of Object.entries(this.snapshot.items)) {
                for (let i = 0; i < fileItems.length; i++) {
                    if (fileItems[i].id !== payload.id) { continue; }
                    const existing = fileItems[i];
                    const newFile = payload.file || relFile || existing.file;
                    const loc = {
                        startLine: payload.startLine || startLine || existing.location.startLine,
                        endLine: payload.endLine || endLine || existing.location.endLine,
                    };
                    const updated: LoreItem = {
                        ...existing,
                        file: newFile,
                        location: { ...loc, ...anchorData },
                        summary: payload.summary ?? existing.summary,
                        bodyMarkdown: payload.body ?? existing.bodyMarkdown,
                        tags: payload.tags ?? existing.tags ?? [],
                        links: payload.links ?? existing.links ?? [],
                        author: payload.author ?? existing.author ?? '',
                        updatedAt: nowISO(),
                        categories: payload.categories ?? existing.categories ?? [],
                    };
                    if (newFile !== fileKey) {
                        // Item moved to a different file bucket.
                        fileItems.splice(i, 1);
                        if (!this.snapshot.items[newFile]) { this.snapshot.items[newFile] = []; }
                        this.snapshot.items[newFile].push(updated);
                    } else {
                        fileItems[i] = updated;
                    }
                    itemId = updated.id;
                    found = true;
                    break outer;
                }
            }
            if (!found) {
                // id supplied but not found — treat as new item with that id.
                const item = this.makeItem(payload, targetFile, targetStart, targetEnd, anchorData, payload.id);
                this.pushItem(targetFile, item);
                itemId = item.id;
            }
        } else {
            const item = this.makeItem(payload, targetFile, targetStart, targetEnd, anchorData);
            this.pushItem(targetFile, item);
            itemId = item.id;
        }

        this.snapshot.fileMetadata.lastUpdatedAt = nowISO();
        this.rebuildIndexes();
        this.saveDebounced();
        this.onDidChangeEmitter.fire();
        return itemId!;
    }

    setState(id: string, newState: 'archived' | 'deleted'): boolean {
        if (!this.snapshot) { return false; }
        const item = this.getById(id);
        if (!item) { return false; }
        item.state = newState;
        item.updatedAt = nowISO();
        this.snapshot.fileMetadata.lastUpdatedAt = nowISO();
        this.rebuildIndexes();
        this.saveDebounced();
        this.onDidChangeEmitter.fire();
        return true;
    }

    async handleFileRenames(event: vscode.FileRenameEvent): Promise<void> {
        if (!this.snapshot) { return; }
        let mutated = false;
        for (const change of event.files) {
            const oldRel = path.relative(this.workspaceRoot, change.oldUri.fsPath);
            const newRel = path.relative(this.workspaceRoot, change.newUri.fsPath);
            if (this.snapshot.items[oldRel]) {
                const fileItems = this.snapshot.items[oldRel];
                for (const item of fileItems) { item.file = newRel; }
                this.snapshot.items[newRel] = fileItems;
                delete this.snapshot.items[oldRel];
                mutated = true;
            }
        }
        if (mutated) {
            this.rebuildIndexes();
            this.saveDebounced();
            this.onDidChangeEmitter.fire();
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private pushItem(file: string, item: LoreItem) {
        if (!this.snapshot!.items[file]) { this.snapshot!.items[file] = []; }
        this.snapshot!.items[file].push(item);
    }

    private makeItem(
        payload: SavePayload,
        file: string,
        startLine: number,
        endLine: number,
        anchorData: { anchorText: string; contextPreview: string; lineHash: string },
        id?: string,
    ): LoreItem {
        return {
            id: id ?? uuidv4(),
            state: 'active',
            file,
            location: { startLine, endLine, ...anchorData },
            summary: payload.summary || '',
            bodyMarkdown: payload.body || '',
            tags: payload.tags || [],
            links: payload.links || [],
            author: payload.author || '',
            createdAt: nowISO(),
            updatedAt: nowISO(),
            contentType: 'markdown',
            isTrusted: false,
            categories: payload.categories || [],
        };
    }

    private async computeAnchor(
        relFile: string,
        startLine: number,
        endLine: number,
    ): Promise<{ anchorText: string; contextPreview: string; lineHash: string }> {
        try {
            const uri = vscode.Uri.file(path.join(this.workspaceRoot, relFile));
            const doc = await vscode.workspace.openTextDocument(uri);
            const anchorText = doc.getText(
                new vscode.Range(startLine - 1, 0, endLine - 1, doc.lineAt(endLine - 1).text.length),
            ).trim();
            const ctxStart = Math.max(0, startLine - 2);
            const ctxEnd = Math.min(doc.lineCount - 1, endLine);
            const contextPreview = doc.getText(
                new vscode.Range(ctxStart, 0, ctxEnd, doc.lineAt(ctxEnd).text.length),
            ).trim();
            const lineHash = createHash('sha1').update(anchorText).digest('hex');
            return { anchorText, contextPreview, lineHash };
        } catch {
            return { anchorText: '', contextPreview: '', lineHash: '' };
        }
    }

    private rebuildIndexes() {
        if (!this.snapshot) { return; }
        const tags: Record<string, number> = {};
        let filesWithComments = 0;
        for (const fileItems of Object.values(this.snapshot.items)) {
            if (fileItems.length > 0) { filesWithComments++; }
            for (const item of fileItems) {
                for (const tag of item.tags ?? []) {
                    tags[tag] = (tags[tag] ?? 0) + 1;
                }
            }
        }
        this.snapshot.indexes = { tags, filesWithComments };
    }

    // ── Save ─────────────────────────────────────────────────────────────────

    private async writeToDisk() {
        if (!this.snapshot) { return; }
        this.isSaving = true;
        try {
            await safeWriteJson(this.loreFilePath, this.snapshot);
        } catch (e) {
            vscode.window.showErrorMessage('Failed to save Lore: ' + String(e));
        } finally {
            // Give the FileSystemWatcher event time to fire before clearing the flag.
            setTimeout(() => { this.isSaving = false; }, 200);
        }
    }

    readonly saveDebounced = debounce(() => this.writeToDisk(), 500);

    dispose() {
        this.onDidChangeEmitter.dispose();
        this.fileWatcher.dispose();
    }
}
