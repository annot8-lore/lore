import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension — activation smoke test', () => {
    test('extension activates and registers all expected commands', async () => {
        // Allow extra time for the extension to activate fully.
        await new Promise(r => setTimeout(r, 2000));

        const allCommands = await vscode.commands.getCommands(true);

        const expectedCommands = [
            'lore.createEnrichedComment',
            'lore.enableHighlights',
            'lore.disableHighlights',
            'lore.editComment',
            'lore.previewMarkdown',
            'lore.listAllEntries',
        ];

        for (const cmd of expectedCommands) {
            assert.ok(allCommands.includes(cmd), `Expected command "${cmd}" to be registered`);
        }
    });
});
