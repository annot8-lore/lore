import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { runTests } from '@vscode/test-electron';

async function main() {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './integration/suite/index');

    // The extension returns early in activate() if no workspace folder is open,
    // which means commands never get registered. Open a temp folder so activate()
    // runs fully.
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-ci-workspace-'));
    try {
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [tmpWorkspace, '--disable-extensions', '--disable-gpu'],
        });
    } finally {
        fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    }
}

main().catch(err => {
    console.error('Failed to run integration tests:', err);
    process.exit(1);
});
