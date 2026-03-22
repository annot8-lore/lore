# Lore

Enriched inline comments for VS Code that allow for capturing design decisions, technical tradeoffs, and contextual information beyond standard code comments.

## Problem

Traditional code comments describe *what* the code does and *how* it works, but often miss the *why* — design decisions, architectural choices, and historical context. This information is typically scattered across design docs, wikis, or issue trackers, making it hard to access when reviewing or maintaining code.

## Solution

Lore allows developers to create enriched inline comments that:
- Expand into detailed tooltips with markdown content
- Include links to external resources (docs, diagrams, issues)
- Are stored locally in a structured JSON file (`.lore.json`) at the project root
- Provide hover previews and code lens actions for easy access
- Support editing and previewing full markdown content

## Features

- **Create Comments**: Use the Command Palette to add enriched comments to code selections
- **Categories**: Tag entries as Architectural Decision, Tech Debt, Bug Fix, and more
- **Hover Previews**: See comment summaries and links on hover
- **Code Lens Actions**: Quick access to edit or view full comments
- **Highlight Comments**: Visually highlight lines with associated comments
- **Live Line Tracking**: Annotations follow code as you edit — no manual re-pinning
- **Markdown Support**: Rich text formatting in comment bodies
- **Local Storage**: All data stored in `.lore.json` (no external dependencies)
- **Safe Writes**: Atomic file operations (write → fsync → rename) to prevent data loss

## Installation

### For Users
1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/) (coming soon)
2. Or install the `.vsix` file manually via VS Code's "Install from VSIX" command

### For Developers
1. Clone this repository
2. Install dependencies:
```bash
pnpm install
```
3. Build the extension:
```bash
pnpm run compile
```
4. Press `F5` in VS Code to launch the Extension Development Host

## Usage

1. __Open a workspace__ in VS Code

2. __Create a comment__:

   - Select code lines (optional)
   - Run `Lore: Weave new Lore` from the Command Palette (`Ctrl+Shift+P`)
   - Fill in summary, markdown body, and optional categories/author
   - Click **Save to .lore.json**

3. __View comments__:

   - Run `Lore: Summon Highlights` to highlight annotated lines
   - Hover over a highlighted line to see a preview with quick-action links
   - Use Code Lens **Edit Lore** / **View Lore** actions above annotated lines
   - Run `Lore: Reveal all Entries` to browse and jump to any annotation

4. __Edit a comment__: Click **Edit Lore** in Code Lens, the hover tooltip, or run `Lore: Patch the Lore`

5. __Hide highlights__: Run `Lore: Seal Highlights` or click the `$(eye) Lore` status bar item

Comments are stored in `.lore.json` at the workspace root. See `docs/.lore.sample.json` for the file format.

## Contributing

Contributions are welcome. Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

1. Install dependencies: `pnpm install`
2. Build: `pnpm run compile`
3. Watch for changes: `pnpm run watch`
4. Launch Extension Development Host: Press `F5` in VS Code

### Commands Available

| Command | Description |
|---|---|
| `Lore: Weave new Lore` | Create a new annotation |
| `Lore: Summon Highlights` | Highlight all annotated lines |
| `Lore: Seal Highlights` | Hide all highlights |
| `Lore: Reveal all Entries` | Browse and jump to any annotation |

## Roadmap

- [ ] Inline text decorations and enhanced hover previews
- [ ] Improved ID scheme and author discovery
- [ ] Remote embed handling with trust model
- [ ] Export/import functionality
- [ ] Integration with Git history

## Support

- [Issues](https://github.com/annot8-lore/lore/issues) - Report bugs or request features
- [Discussions](https://github.com/annot8-lore/lore/discussions) - Ask questions or share ideas
