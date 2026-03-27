import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import { promises as fsp } from 'fs';
import { migrateSnapshot, safeWriteJson, readJson, nowISO } from '../../src/fsUtils';
import type { LoreSnapshot } from '../../src/types';

// ── migrateSnapshot ──────────────────────────────────────────────────────────

describe('migrateSnapshot', () => {
    it('returns a v2 snapshot unchanged', () => {
        const v2: LoreSnapshot = {
            schemaVersion: 2,
            fileMetadata: { createdAt: 'x', lastUpdatedAt: 'x' },
            indexes: { tags: {}, filesWithComments: 0 },
            items: { 'src/foo.ts': [] },
        };
        const result = migrateSnapshot(v2);
        expect(result).toEqual(v2);
        expect(result.schemaVersion).toBe(2);
    });

    it('converts a v1 flat items array to v2 keyed record', () => {
        const v1 = {
            schemaVersion: 1,
            fileMetadata: { createdAt: 'x', lastUpdatedAt: 'x' },
            indexes: { tags: {}, filesWithComments: 0 },
            items: [
                { id: 'a', file: 'src/main.ts', state: 'active', summary: 'A', bodyMarkdown: '', location: { startLine: 1, endLine: 1 }, createdAt: 'x', updatedAt: 'x' },
                { id: 'b', file: 'src/main.ts', state: 'active', summary: 'B', bodyMarkdown: '', location: { startLine: 5, endLine: 7 }, createdAt: 'x', updatedAt: 'x' },
                { id: 'c', file: 'src/utils.ts', state: 'active', summary: 'C', bodyMarkdown: '', location: { startLine: 2, endLine: 2 }, createdAt: 'x', updatedAt: 'x' },
            ],
        };

        const result = migrateSnapshot(v1);

        expect(result.schemaVersion).toBe(2);
        expect(Array.isArray(result.items)).toBe(false);
        expect(result.items['src/main.ts']).toHaveLength(2);
        expect(result.items['src/utils.ts']).toHaveLength(1);
        expect(result.items['src/main.ts'][0].id).toBe('a');
        expect(result.items['src/utils.ts'][0].id).toBe('c');
    });

    it('handles a v1 snapshot with all items in the same file', () => {
        const v1 = {
            schemaVersion: 1,
            fileMetadata: { createdAt: 'x', lastUpdatedAt: 'x' },
            indexes: { tags: {}, filesWithComments: 0 },
            items: [
                { id: 'a', file: 'src/app.ts', state: 'active', summary: 'A', bodyMarkdown: '', location: { startLine: 1, endLine: 1 }, createdAt: 'x', updatedAt: 'x' },
            ],
        };
        const result = migrateSnapshot(v1);
        expect(result.items['src/app.ts']).toHaveLength(1);
        expect(Object.keys(result.items)).toHaveLength(1);
    });

    it('handles a v1 snapshot with empty items array', () => {
        const v1 = {
            schemaVersion: 1,
            fileMetadata: { createdAt: 'x', lastUpdatedAt: 'x' },
            indexes: { tags: {}, filesWithComments: 0 },
            items: [],
        };
        const result = migrateSnapshot(v1);
        expect(result.schemaVersion).toBe(2);
        expect(result.items).toEqual({});
    });

    it('passes through snapshots without a schemaVersion (treated as v2)', () => {
        const noVersion = {
            fileMetadata: { createdAt: 'x', lastUpdatedAt: 'x' },
            indexes: { tags: {}, filesWithComments: 0 },
            items: { 'src/foo.ts': [] },
        };
        const result = migrateSnapshot(noVersion);
        // Not v1 (no schemaVersion === 1), so returned as-is
        expect(result.items).toEqual({ 'src/foo.ts': [] });
    });
});

// ── safeWriteJson / readJson ─────────────────────────────────────────────────

describe('safeWriteJson + readJson', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lore-test-'));
    });

    afterEach(async () => {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    it('writes and reads back a JSON object', async () => {
        const filePath = path.join(tmpDir, 'test.json');
        const data = { hello: 'world', num: 42, nested: { a: [1, 2, 3] } };

        await safeWriteJson(filePath, data);
        const result = await readJson(filePath);

        expect(result).toEqual(data);
    });

    it('overwrites an existing file atomically', async () => {
        const filePath = path.join(tmpDir, 'overwrite.json');
        await safeWriteJson(filePath, { v: 1 });
        await safeWriteJson(filePath, { v: 2 });

        const result = await readJson<{ v: number }>(filePath);
        expect(result.v).toBe(2);
    });

    it('leaves no .tmp file behind on success', async () => {
        const filePath = path.join(tmpDir, 'clean.json');
        await safeWriteJson(filePath, { x: 1 });

        const entries = await fsp.readdir(tmpDir);
        const tmpFiles = entries.filter(e => e.includes('.tmp.'));
        expect(tmpFiles).toHaveLength(0);
    });

    it('readJson throws on missing file', async () => {
        await expect(readJson(path.join(tmpDir, 'missing.json'))).rejects.toThrow();
    });

    it('readJson throws on malformed JSON', async () => {
        const filePath = path.join(tmpDir, 'bad.json');
        await fsp.writeFile(filePath, '{ not valid json }');
        await expect(readJson(filePath)).rejects.toThrow();
    });
});

// ── nowISO ───────────────────────────────────────────────────────────────────

describe('nowISO', () => {
    it('returns a valid ISO 8601 string', () => {
        const ts = nowISO();
        expect(() => new Date(ts)).not.toThrow();
        expect(new Date(ts).toISOString()).toBe(ts);
    });
});
