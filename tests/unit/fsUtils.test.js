"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs_1 = require("fs");
const fsUtils_1 = require("../../src/fsUtils");
// ── migrateSnapshot ──────────────────────────────────────────────────────────
(0, vitest_1.describe)('migrateSnapshot', () => {
    (0, vitest_1.it)('returns a v2 snapshot unchanged', () => {
        const v2 = {
            schemaVersion: 2,
            fileMetadata: { createdAt: 'x', lastUpdatedAt: 'x' },
            indexes: { tags: {}, filesWithComments: 0 },
            items: { 'src/foo.ts': [] },
        };
        const result = (0, fsUtils_1.migrateSnapshot)(v2);
        (0, vitest_1.expect)(result).toEqual(v2);
        (0, vitest_1.expect)(result.schemaVersion).toBe(2);
    });
    (0, vitest_1.it)('converts a v1 flat items array to v2 keyed record', () => {
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
        const result = (0, fsUtils_1.migrateSnapshot)(v1);
        (0, vitest_1.expect)(result.schemaVersion).toBe(2);
        (0, vitest_1.expect)(Array.isArray(result.items)).toBe(false);
        (0, vitest_1.expect)(result.items['src/main.ts']).toHaveLength(2);
        (0, vitest_1.expect)(result.items['src/utils.ts']).toHaveLength(1);
        (0, vitest_1.expect)(result.items['src/main.ts'][0].id).toBe('a');
        (0, vitest_1.expect)(result.items['src/utils.ts'][0].id).toBe('c');
    });
    (0, vitest_1.it)('handles a v1 snapshot with all items in the same file', () => {
        const v1 = {
            schemaVersion: 1,
            fileMetadata: { createdAt: 'x', lastUpdatedAt: 'x' },
            indexes: { tags: {}, filesWithComments: 0 },
            items: [
                { id: 'a', file: 'src/app.ts', state: 'active', summary: 'A', bodyMarkdown: '', location: { startLine: 1, endLine: 1 }, createdAt: 'x', updatedAt: 'x' },
            ],
        };
        const result = (0, fsUtils_1.migrateSnapshot)(v1);
        (0, vitest_1.expect)(result.items['src/app.ts']).toHaveLength(1);
        (0, vitest_1.expect)(Object.keys(result.items)).toHaveLength(1);
    });
    (0, vitest_1.it)('handles a v1 snapshot with empty items array', () => {
        const v1 = {
            schemaVersion: 1,
            fileMetadata: { createdAt: 'x', lastUpdatedAt: 'x' },
            indexes: { tags: {}, filesWithComments: 0 },
            items: [],
        };
        const result = (0, fsUtils_1.migrateSnapshot)(v1);
        (0, vitest_1.expect)(result.schemaVersion).toBe(2);
        (0, vitest_1.expect)(result.items).toEqual({});
    });
    (0, vitest_1.it)('passes through snapshots without a schemaVersion (treated as v2)', () => {
        const noVersion = {
            fileMetadata: { createdAt: 'x', lastUpdatedAt: 'x' },
            indexes: { tags: {}, filesWithComments: 0 },
            items: { 'src/foo.ts': [] },
        };
        const result = (0, fsUtils_1.migrateSnapshot)(noVersion);
        // Not v1 (no schemaVersion === 1), so returned as-is
        (0, vitest_1.expect)(result.items).toEqual({ 'src/foo.ts': [] });
    });
});
// ── safeWriteJson / readJson ─────────────────────────────────────────────────
(0, vitest_1.describe)('safeWriteJson + readJson', () => {
    let tmpDir;
    (0, vitest_1.beforeEach)(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path.join(os.tmpdir(), 'lore-test-'));
    });
    (0, vitest_1.afterEach)(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('writes and reads back a JSON object', async () => {
        const filePath = path.join(tmpDir, 'test.json');
        const data = { hello: 'world', num: 42, nested: { a: [1, 2, 3] } };
        await (0, fsUtils_1.safeWriteJson)(filePath, data);
        const result = await (0, fsUtils_1.readJson)(filePath);
        (0, vitest_1.expect)(result).toEqual(data);
    });
    (0, vitest_1.it)('overwrites an existing file atomically', async () => {
        const filePath = path.join(tmpDir, 'overwrite.json');
        await (0, fsUtils_1.safeWriteJson)(filePath, { v: 1 });
        await (0, fsUtils_1.safeWriteJson)(filePath, { v: 2 });
        const result = await (0, fsUtils_1.readJson)(filePath);
        (0, vitest_1.expect)(result.v).toBe(2);
    });
    (0, vitest_1.it)('leaves no .tmp file behind on success', async () => {
        const filePath = path.join(tmpDir, 'clean.json');
        await (0, fsUtils_1.safeWriteJson)(filePath, { x: 1 });
        const entries = await fs_1.promises.readdir(tmpDir);
        const tmpFiles = entries.filter(e => e.includes('.tmp.'));
        (0, vitest_1.expect)(tmpFiles).toHaveLength(0);
    });
    (0, vitest_1.it)('readJson throws on missing file', async () => {
        await (0, vitest_1.expect)((0, fsUtils_1.readJson)(path.join(tmpDir, 'missing.json'))).rejects.toThrow();
    });
    (0, vitest_1.it)('readJson throws on malformed JSON', async () => {
        const filePath = path.join(tmpDir, 'bad.json');
        await fs_1.promises.writeFile(filePath, '{ not valid json }');
        await (0, vitest_1.expect)((0, fsUtils_1.readJson)(filePath)).rejects.toThrow();
    });
});
// ── nowISO ───────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('nowISO', () => {
    (0, vitest_1.it)('returns a valid ISO 8601 string', () => {
        const ts = (0, fsUtils_1.nowISO)();
        (0, vitest_1.expect)(() => new Date(ts)).not.toThrow();
        (0, vitest_1.expect)(new Date(ts).toISOString()).toBe(ts);
    });
});
//# sourceMappingURL=fsUtils.test.js.map