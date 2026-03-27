// @ts-check
const esbuild = require('esbuild');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],       // provided by the extension host at runtime
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  minify: !watch,
};

if (watch) {
  esbuild.context(config).then(ctx => ctx.watch());
} else {
  esbuild.build(config).catch(() => process.exit(1));
}
