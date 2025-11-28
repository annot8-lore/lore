# The goal
Build a VS Code extension to support enriched in-line code comments.

# The problem
Developers today focus on writing code comments that describe code in it's current state - they are descriptive and explain how the code works, but often leave out how it *got* to this point i.e design decisions, technical tradeoffs etc. This information is often externally stored in design wikis or Jira stories.

# The idea
Developers can create inline comments.
The comment expands and show a tooltip with additional information, similar to syntax explanations currently available in VS Code.
The tooltip has embedded links. For example, an iframe to a website where an architecture diagram is hosted, or a link to a section of a design doc.
All comment information is stored in a single file at the root of the project directory parsed by the extension.

# Implementation
MVP features implemented:

- On activation, the extension creates a `.lore.json` file at the workspace root if one does not exist.
- A Command Palette command: `Lore: Chronicle new lore` opens a webview allowing you to author a short summary and longer Markdown body and save it into `.lore.json`.

# Contributing
How to run locally:

1. Install dev dependencies:
```bash
pnpm install
```

2. Build the extension:
```bash
pnpm run compile
```

3. In VS Code press `F5` to launch an Extension Development Host.

4. Open a workspace folder, open a file and (optionally) select a region, then run the command `Lore: Chronicle new lore` from the Command Palette.

What the webview does:
- Lets you enter a one-line summary and Markdown details
- Populates file and selected lines (if an active editor exists)
- On Save it appends an entry to `.lore.json` in the workspace root using a safe write (atomic rename)

Next steps (future work):
- Add inline text decorations and hover previews
- Allow editing existing entries
- Implement a more robust id scheme and author discovery
- Add remote embed handling with a trust model
