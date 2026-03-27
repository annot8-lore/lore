import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import { promises as fsp } from 'fs';
import { LoreStore } from '../../../src/LoreStore';
import { safeWriteJson } from '../../../src/fsUtils';
import type { LoreSnapshot } from '../../../src/types';

suite('LoreStore — integration', () => {
    let tmpDir: string;

    setup(async () => {
        tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lore-store-test-'));
        // Write a valid v2 snapshot so LoreStore.create() finds an existing file.
        const initial: LoreSnapshot = {
            schemaVersion: 2,
            fileMetadata: { workspace: 'test', createdAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString(), lastUpdatedBy: '' },
            indexes: { tags: {}, filesWithComments: 0 },
            items: {},
        };
        await safeWriteJson(path.join(tmpDir, '.lore.json'), initial);
    });

    teardown(async () => {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    test('create() loads an empty store', async () => {
        const store = await LoreStore.create(tmpDir);
        assert.strictEqual(store.getAllFlat().length, 0);
        store.dispose();
    });

    test('upsert() adds an item and getById() retrieves it', async () => {
        const store = await LoreStore.create(tmpDir);

        const id = await store.upsert(
            { command: 'save', summary: 'Test item', body: 'Body text', tags: ['perf'], links: [], categories: [] },
            'src/app.ts',
            10,
            15,
        );

        const item = store.getById(id);
        assert.ok(item, 'item should exist');
        assert.strictEqual(item!.summary, 'Test item');
        assert.strictEqual(item!.bodyMarkdown, 'Body text');
        assert.deepStrictEqual(item!.tags, ['perf']);
        assert.strictEqual(item!.state, 'active');
        assert.strictEqual(item!.file, 'src/app.ts');
        assert.strictEqual(item!.location.startLine, 10);
        assert.strictEqual(item!.location.endLine, 15);
        store.dispose();
    });

    test('upsert() with existing id updates in place', async () => {
        const store = await LoreStore.create(tmpDir);

        const id = await store.upsert(
            { command: 'save', summary: 'Original', body: '' },
            'src/app.ts', 1, 1,
        );

        await store.upsert(
            { command: 'save', id, summary: 'Updated', body: 'New body' },
            'src/app.ts', 1, 1,
        );

        const items = store.getAllFlat();
        assert.strictEqual(items.length, 1, 'should not create duplicate');
        assert.strictEqual(items[0].summary, 'Updated');
        assert.strictEqual(items[0].bodyMarkdown, 'New body');
        store.dispose();
    });

    test('setState() archives an item', async () => {
        const store = await LoreStore.create(tmpDir);

        const id = await store.upsert(
            { command: 'save', summary: 'To archive', body: '' },
            'src/app.ts', 5, 5,
        );

        const ok = store.setState(id, 'archived');
        assert.ok(ok);

        const item = store.getById(id);
        assert.strictEqual(item!.state, 'archived');
        store.dispose();
    });

    test('setState() soft-deletes an item', async () => {
        const store = await LoreStore.create(tmpDir);

        const id = await store.upsert(
            { command: 'save', summary: 'To delete', body: '' },
            'src/app.ts', 3, 3,
        );

        store.setState(id, 'deleted');
        const item = store.getById(id);
        assert.strictEqual(item!.state, 'deleted');
        // getAllFlat() still returns it (LoreManager.getAllLoreItems() filters deleted)
        assert.strictEqual(store.getAllFlat().length, 1);
        store.dispose();
    });

    test('getByFile() returns only items for the given file', async () => {
        const store = await LoreStore.create(tmpDir);

        await store.upsert({ command: 'save', summary: 'A', body: '' }, 'src/a.ts', 1, 1);
        await store.upsert({ command: 'save', summary: 'B', body: '' }, 'src/b.ts', 1, 1);
        await store.upsert({ command: 'save', summary: 'C', body: '' }, 'src/a.ts', 5, 5);

        const aItems = store.getByFile('src/a.ts');
        assert.strictEqual(aItems.length, 2);
        assert.ok(aItems.every(i => i.file === 'src/a.ts'));
        store.dispose();
    });

    test('onDidChange fires when upsert runs', async () => {
        const store = await LoreStore.create(tmpDir);
        let fired = false;
        store.onDidChange(() => { fired = true; });

        await store.upsert({ command: 'save', summary: 'Trigger', body: '' }, 'src/app.ts', 1, 1);

        assert.ok(fired, 'onDidChange should fire after upsert');
        store.dispose();
    });

    test('v1 snapshot is migrated to v2 on load', async () => {
        const v1: Record<string, unknown> = {
            schemaVersion: 1,
            fileMetadata: { createdAt: 'x', lastUpdatedAt: 'x', lastUpdatedBy: '' },
            indexes: { tags: {}, filesWithComments: 0 },
            items: [
                { id: 'migrated-id', state: 'active', file: 'src/legacy.ts', location: { startLine: 1, endLine: 1 }, summary: 'Legacy', bodyMarkdown: '', tags: [], links: [], author: '', createdAt: 'x', updatedAt: 'x', categories: [] },
            ],
        };
        await safeWriteJson(path.join(tmpDir, '.lore.json'), v1);

        const store = await LoreStore.create(tmpDir);
        const item = store.getById('migrated-id');
        assert.ok(item, 'migrated item should be accessible');
        assert.strictEqual(item!.file, 'src/legacy.ts');
        store.dispose();
    });
});
