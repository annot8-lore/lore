"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("vitest/config");
exports.default = (0, config_1.defineConfig)({
    test: {
        // Only run unit tests — integration tests need @vscode/test-electron.
        include: ['src/test/unit/**/*.test.ts'],
        environment: 'node',
        reporters: ['verbose'],
    },
});
//# sourceMappingURL=vitest.config.js.map