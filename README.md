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
- **Hover Previews**: See comment summaries and links on hover
- **Code Lens Actions**: Quick access to edit or view full comments
- **Highlight Comments**: Visually highlight lines with associated comments
- **Markdown Support**: Rich text formatting in comment bodies
- **Local Storage**: All data stored in `.lore.json` (no external dependencies)
- **Safe Writes**: Atomic file operations to prevent data loss

## Installation

### For Users
1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/) (coming soon)
2. Or install the `.vsix` file manually via VS Code's "Install from VSIX" command

### For Developers
1. Clone this repository
2. Install dependencies:
```bash
pnpm install
````

3. Build the extension:
```bash
pnpm run compile
```
4. Press `F5` in VS Code to launch the Extension Development Host

## Usage

1. __Open a workspace__ in VS Code

2. __Create a comment__:

   - Select code lines (optional)
   - Run `Lore: Chronicle new lore` from the Command Palette (`Ctrl+Shift+P`)
   - Fill in summary and markdown details
   - Save to create the comment

3. __View comments__:

   - Run `Lore: Show enriched comments` to highlight commented lines
   - Hover over highlighted lines to see previews
   - Use Code Lens actions to edit or view full comments
   (or)
   - Use buttons on preview pane to edit or view fill comments

4. __Edit comments__: Click "Edit Lore" in Code Lens or hover menu

Comments are stored in `.lore.json` at the workspace root. See `docs/.lore.sample.json` for the file format.

## Contributing

Contributions are welcome. Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

1. Install dependencies: `pnpm install`
2. Build: `pnpm run compile`
3. Watch for changes: `pnpm run watch`
<!-- 4. Test: `pnpm run test` -->
5. Launch Extension Development Host: Press `F5` in VS Code

### Commands Available

- `Lore: Chronicle new lore` - Create new comment
- `Lore: Show enriched comments` - Highlight commented lines
<!-- - `Lore: Edit comment` - Edit existing comment -->
<!-- - `Lore: Open comment` - Preview full markdown -->

## Roadmap

- [ ] Inline text decorations and enhanced hover previews
- [ ] Improved ID scheme and author discovery
- [ ] Remote embed handling with trust model
- [ ] Export/import functionality
- [ ] Integration with Git history

## Support

- [Issues](https://github.com/annot8-lore/lore/issues) - Report bugs or request features
- [Discussions](https://github.com/annot8-lore/lore/discussions) - Ask questions or share ideas
