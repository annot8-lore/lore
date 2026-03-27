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
const assert = __importStar(require("assert"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs_1 = require("fs");
const LoreStore_1 = require("../../../src/LoreStore");
const fsUtils_1 = require("../../../src/fsUtils");
suite('LoreStore — integration', () => {
    let tmpDir;
    setup(async () => {
        tmpDir = await fs_1.promises.mkdtemp(path.join(os.tmpdir(), 'lore-store-test-'));
        // Write a valid v2 snapshot so LoreStore.create() finds an existing file.
        const initial = {
            schemaVersion: 2,
            fileMetadata: { workspace: 'test', createdAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString(), lastUpdatedBy: '' },
            indexes: { tags: {}, filesWithComments: 0 },
            items: {},
        };
        await (0, fsUtils_1.safeWriteJson)(path.join(tmpDir, '.lore.json'), initial);
    });
    teardown(async () => {
        await fs_1.promises.rm(tmpDir, { recursive: true, force: true });
    });
    test('create() loads an empty store', async () => {
        const store = await LoreStore_1.LoreStore.create(tmpDir);
        assert.strictEqual(store.getAllFlat().length, 0);
        store.dispose();
    });
    test('upsert() adds an item and getById() retrieves it', async () => {
        const store = await LoreStore_1.LoreStore.create(tmpDir);
        const id = await store.upsert({ command: 'save', summary: 'Test item', body: 'Body text', tags: ['perf'], links: [], categories: [] }, 'src/app.ts', 10, 15);
        const item = store.getById(id);
        assert.ok(item, 'item should exist');
        assert.strictEqual(item.summary, 'Test item');
        assert.strictEqual(item.bodyMarkdown, 'Body text');
        assert.deepStrictEqual(item.tags, ['perf']);
        assert.strictEqual(item.state, 'active');
        assert.strictEqual(item.file, 'src/app.ts');
        assert.strictEqual(item.location.startLine, 10);
        assert.strictEqual(item.location.endLine, 15);
        store.dispose();
    });
    test('upsert() with existing id updates in place', async () => {
        const store = await LoreStore_1.LoreStore.create(tmpDir);
        const id = await store.upsert({ command: 'save', summary: 'Original', body: '' }, 'src/app.ts', 1, 1);
        await store.upsert({ command: 'save', id, summary: 'Updated', body: 'New body' }, 'src/app.ts', 1, 1);
        const items = store.getAllFlat();
        assert.strictEqual(items.length, 1, 'should not create duplicate');
        assert.strictEqual(items[0].summary, 'Updated');
        assert.strictEqual(items[0].bodyMarkdown, 'New body');
        store.dispose();
    });
    test('setState() archives an item', async () => {
        const store = await LoreStore_1.LoreStore.create(tmpDir);
        const id = await store.upsert({ command: 'save', summary: 'To archive', body: '' }, 'src/app.ts', 5, 5);
        const ok = store.setState(id, 'archived');
        assert.ok(ok);
        const item = store.getById(id);
        assert.strictEqual(item.state, 'archived');
        store.dispose();
    });
    test('setState() soft-deletes an item', async () => {
        const store = await LoreStore_1.LoreStore.create(tmpDir);
        const id = await store.upsert({ command: 'save', summary: 'To delete', body: '' }, 'src/app.ts', 3, 3);
        store.setState(id, 'deleted');
        const item = store.getById(id);
        assert.strictEqual(item.state, 'deleted');
        // getAllFlat() still returns it (LoreManager.getAllLoreItems() filters deleted)
        assert.strictEqual(store.getAllFlat().length, 1);
        store.dispose();
    });
    test('getByFile() returns only items for the given file', async () => {
        const store = await LoreStore_1.LoreStore.create(tmpDir);
        await store.upsert({ command: 'save', summary: 'A', body: '' }, 'src/a.ts', 1, 1);
        await store.upsert({ command: 'save', summary: 'B', body: '' }, 'src/b.ts', 1, 1);
        await store.upsert({ command: 'save', summary: 'C', body: '' }, 'src/a.ts', 5, 5);
        const aItems = store.getByFile('src/a.ts');
        assert.strictEqual(aItems.length, 2);
        assert.ok(aItems.every(i => i.file === 'src/a.ts'));
        store.dispose();
    });
    test('onDidChange fires when upsert runs', async () => {
        const store = await LoreStore_1.LoreStore.create(tmpDir);
        let fired = false;
        store.onDidChange(() => { fired = true; });
        await store.upsert({ command: 'save', summary: 'Trigger', body: '' }, 'src/app.ts', 1, 1);
        assert.ok(fired, 'onDidChange should fire after upsert');
        store.dispose();
    });
    test('v1 snapshot is migrated to v2 on load', async () => {
        const v1 = {
            schemaVersion: 1,
            fileMetadata: { createdAt: 'x', lastUpdatedAt: 'x', lastUpdatedBy: '' },
            indexes: { tags: {}, filesWithComments: 0 },
            items: [
                { id: 'migrated-id', state: 'active', file: 'src/legacy.ts', location: { startLine: 1, endLine: 1 }, summary: 'Legacy', bodyMarkdown: '', tags: [], links: [], author: '', createdAt: 'x', updatedAt: 'x', categories: [] },
            ],
        };
        await (0, fsUtils_1.safeWriteJson)(path.join(tmpDir, '.lore.json'), v1);
        const store = await LoreStore_1.LoreStore.create(tmpDir);
        const item = store.getById('migrated-id');
        assert.ok(item, 'migrated item should be accessible');
        assert.strictEqual(item.file, 'src/legacy.ts');
        store.dispose();
    });
});
//# sourceMappingURL=loreStore.test.js.map