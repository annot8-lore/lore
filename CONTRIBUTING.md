# Contributing

## Dev setup

```bash
pnpm install
pnpm run compile      # tsc one-shot build (output → out/)
pnpm run watch        # tsc in watch mode
node esbuild.js --watch  # esbuild bundle in watch mode
```

Press `F5` in VS Code to launch the Extension Development Host with the extension loaded.

## Project layout

| Path | Role |
|---|---|
| `src/extension.ts` | Activation, command registration, event wiring |
| `src/LoreStore.ts` | Data layer — snapshot I/O, upsert, file watcher |
| `src/LoreManager.ts` | Editor layer — decorations, hover, line tracking |
| `src/webview.ts` | Create/Edit panel HTML |
| `src/types.ts` | Shared types |
| `src/fsUtils.ts` | Safe file write, JSON read, schema migration |

See `docs/internal/implementation.md` for a full architecture walkthrough.

## Submitting changes

1. Fork and create a feature branch
2. `pnpm run compile` must pass with no errors
3. Open a pull request with a clear description of what changes and why

## Reporting bugs

Use [GitHub Issues](https://github.com/annot8-lore/lore/issues).
