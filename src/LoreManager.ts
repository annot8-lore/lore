import * as vscode from 'vscode';
import * as path from 'path';
import { createHash } from 'crypto';
import { LoreStore } from './LoreStore';
import { shiftRange } from './rangeUtils';
import type { LoreItem, SavePayload } from './types';

interface LoreDecoration {
    decoration: vscode.DecorationOptions; // no hoverMessage — HoverProvider owns that
    hoverMessage: vscode.MarkdownString;
    item: LoreItem;
    isStale: boolean;
}

export class LoreManager implements vscode.Disposable {
    private isHighlightingEnabled = false;
    private commentRanges = new Map<string, LoreDecoration[]>();
    private decorationType: vscode.TextEditorDecorationType;
    private readonly staleDecorationType: vscode.TextEditorDecorationType;
    /** Items whose anchor could not be found in the current file. Cleared on any store change. */
    private staleItemIds = new Set<string>();
    /** Tracks which files have already been lazily re-anchored this session. */
    private reanchoredFiles = new Set<string>();

    private constructor(
        private readonly store: LoreStore,
        private readonly workspaceRoot: string,
        highlightColor: string,
    ) {
        this.decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: highlightColor,
            isWholeLine: true,
        });
        this.staleDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 100, 0, 0.25)',
            isWholeLine: true,
            after: {
                contentText: '  ⚠ stale anchor',
                color: new vscode.ThemeColor('editorWarning.foreground'),
                fontStyle: 'italic',
            },
        });

        store.onDidChange(() => {
            this.reanchoredFiles.clear();
            this.staleItemIds.clear();
            this.updateCommentRanges();
            this.refreshDecorations();
        });
    }

    static async create(
        _context: vscode.ExtensionContext,
        workspaceRoot: string,
    ): Promise<LoreManager> {
        const store = await LoreStore.create(workspaceRoot);
        const color = vscode.workspace.getConfiguration('lore').get<string>('highlightColor', 'rgba(255, 255, 0, 0.2)');
        const manager = new LoreManager(store, workspaceRoot, color);
        // LoreStore.create() fires onDidChange before the listener above is registered.
        // Populate ranges explicitly here.
        manager.updateCommentRanges();
        return manager;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    get onDidChangeLore() { return this.store.onDidChange; }

    getLoreItemById(id: string): LoreItem | undefined { return this.store.getById(id); }

    /** Returns all non-deleted items (active + archived). */
    getAllLoreItems(): LoreItem[] {
        return this.store.getAllFlat().filter(i => i.state !== 'deleted');
    }

    getLoreItemsForFile(filePath: string): LoreDecoration[] {
        return this.commentRanges.get(filePath) ?? [];
    }

    async upsertLoreItem(
        payload: SavePayload,
        relFile: string,
        startLine: number,
        endLine: number,
    ): Promise<string> {
        return this.store.upsert(payload, relFile, startLine, endLine);
    }

    setItemState(id: string, state: 'archived' | 'deleted'): void {
        this.store.setState(id, state);
    }

    /** Re-creates the active decoration type with a new color and redraws. */
    updateHighlightColor(color: string) {
        this.decorationType.dispose();
        this.decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: color,
            isWholeLine: true,
        });
        this.refreshDecorations();
    }

    async handleFileRenames(event: vscode.FileRenameEvent) {
        await this.store.handleFileRenames(event);
    }

    async reloadLore() {
        await this.store.load();
    }

    // ── Decoration management ─────────────────────────────────────────────────

    updateCommentRanges() {
        this.commentRanges.clear();
        for (const item of this.store.getAllFlat()) {
            // Only active items get decorations.
            if (item.state !== 'active') { continue; }
            if (!item.location.startLine || !item.location.endLine) { continue; }

            const filePath = path.join(this.workspaceRoot, item.file);
            const range = new vscode.Range(
                item.location.startLine - 1, 0,
                item.location.endLine - 1, 0,
            );

            const isStale = this.staleItemIds.has(item.id);

            const editUri = vscode.Uri.parse(
                `command:lore.editComment?${encodeURIComponent(JSON.stringify([item.id]))}`,
            );
            const previewUri = vscode.Uri.parse(
                `command:lore.previewMarkdown?${encodeURIComponent(JSON.stringify([item.id]))}`,
            );
            const truncatedBody = (item.bodyMarkdown ?? '').substring(0, 100);
            const hasMore = (item.bodyMarkdown ?? '').length > 100;

            const staleWarning = isStale
                ? `\n\n> ⚠ **Stale** — anchor text and line hash not found. Code may have moved or been deleted.\n`
                : '';
            const mdContent = `# ${item.summary}${staleWarning}\n\n${truncatedBody}${hasMore ? '...' : ''}\n\n---\n[Edit Lore](${editUri}) | [View Lore](${previewUri})`;
            const markdown = new vscode.MarkdownString(mdContent, true);
            markdown.isTrusted = true;

            if (!this.commentRanges.has(filePath)) { this.commentRanges.set(filePath, []); }
            this.commentRanges.get(filePath)!.push({ decoration: { range }, hoverMessage: markdown, item, isStale });
        }
    }

    public refreshDecorations() {
        for (const editor of vscode.window.visibleTextEditors) {
            const all = this.isHighlightingEnabled
                ? (this.commentRanges.get(editor.document.uri.fsPath) ?? [])
                : [];
            editor.setDecorations(this.decorationType, all.filter(d => !d.isStale).map(d => d.decoration));
            editor.setDecorations(this.staleDecorationType, all.filter(d => d.isStale).map(d => d.decoration));
        }
    }

    // ── Lazy re-anchor ────────────────────────────────────────────────────────

    public async onActiveEditorChanged(editor: vscode.TextEditor | undefined) {
        if (!editor) { return; }
        const filePath = editor.document.uri.fsPath;
        if (!this.reanchoredFiles.has(filePath) && this.commentRanges.has(filePath)) {
            await this.reanchorFile(editor.document);
            this.reanchoredFiles.add(filePath);
        }
        this.refreshDecorations();
    }

    private async reanchorFile(doc: vscode.TextDocument) {
        const fileDecorations = this.commentRanges.get(doc.uri.fsPath);
        if (!fileDecorations?.length) { return; }

        let mutated = false;
        let newStaleCount = 0;

        for (const { item } of fileDecorations) {
            if (item.location.startLine >= 1 && item.location.startLine <= doc.lineCount) { continue; }

            let relocated = false;
            if (item.location.anchorText) {
                const idx = doc.getText().indexOf(item.location.anchorText);
                if (idx !== -1) {
                    const pos = doc.positionAt(idx);
                    const lines = item.location.anchorText.split('\n').length;
                    item.location.startLine = pos.line + 1;
                    item.location.endLine = pos.line + lines;
                    relocated = true;
                }
            }
            if (!relocated && item.location.lineHash) {
                const docLines = doc.getText().split(/\r?\n/);
                for (let i = 0; i < docLines.length; i++) {
                    const h = createHash('sha1').update(docLines[i]).digest('hex');
                    if (h === item.location.lineHash) {
                        item.location.startLine = i + 1;
                        item.location.endLine = i + 1;
                        relocated = true;
                        break;
                    }
                }
            }

            if (!relocated) {
                this.staleItemIds.add(item.id);
                newStaleCount++;
            }
            mutated = true;
        }

        if (mutated) {
            this.updateCommentRanges();
            this.store.saveDebounced();
        }

        if (newStaleCount > 0) {
            const fileName = path.basename(doc.uri.fsPath);
            vscode.window.showWarningMessage(
                `Lore: ${newStaleCount} annotation${newStaleCount > 1 ? 's' : ''} in "${fileName}" could not be located. The code may have moved or been deleted.`,
            );
        }
    }

    // ── Live line-number tracking ─────────────────────────────────────────────

    public adjustLoreLocations(event: vscode.TextDocumentChangeEvent) {
        const filePath = event.document.uri.fsPath;
        const fileDecorations = this.commentRanges.get(filePath);
        if (!fileDecorations?.length) { return; }

        let hasChanges = false;
        for (const change of event.contentChanges) {
            const delta =
                (change.text.match(/\n/g) ?? []).length -
                (change.range.end.line - change.range.start.line);
            if (delta === 0) { continue; }

            hasChanges = true;
            const changeStart = change.range.start.line;

            for (const lore of fileDecorations) {
                const { start, end } = shiftRange(
                    lore.decoration.range.start.line,
                    lore.decoration.range.end.line,
                    changeStart,
                    delta,
                );
                lore.decoration.range = new vscode.Range(start, 0, end, 0);
                lore.item.location.startLine = start + 1;
                lore.item.location.endLine = end + 1;
            }
        }

        if (hasChanges) {
            this.refreshDecorations();
            this.store.saveDebounced();
        }
    }

    // ── Highlight controls ────────────────────────────────────────────────────

    public toggleHighlights() {
        this.isHighlightingEnabled = !this.isHighlightingEnabled;
        this.refreshDecorations();
    }

    public enableHighlights() {
        this.isHighlightingEnabled = true;
        this.refreshDecorations();
    }

    public clearDecorations() {
        this.isHighlightingEnabled = false;
        for (const editor of vscode.window.visibleTextEditors) {
            editor.setDecorations(this.decorationType, []);
            editor.setDecorations(this.staleDecorationType, []);
        }
    }

    public getIsHighlightingEnabled() { return this.isHighlightingEnabled; }

    dispose() {
        this.decorationType.dispose();
        this.staleDecorationType.dispose();
        this.store.dispose();
    }
}
