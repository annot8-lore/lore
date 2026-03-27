import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Only run unit tests — integration tests need @vscode/test-electron.
        include: ['tests/unit/**/*.test.ts'],
        environment: 'node',
        reporters: ['verbose'],
    },
});
