import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './integration/suite/index');

    await runTests({
        extensionDevelopmentPath,
        extensionTestsPath,
        // Disable other extensions for a clean test environment.
        launchArgs: ['--disable-extensions', '--disable-gpu'],
    });
}

main().catch(err => {
    console.error('Failed to run integration tests:', err);
    process.exit(1);
});
