# The goal
Build a VS Code extension to support enriched in-line code comments.

# The problem
Developers today focus on writing code comments that describe code in it's current state - they are descriptive and explain how the code works, but often leave out how it *got* to this point i.e design decisions, technical tradeoffs etc. This information is often externally stored in design wikis or Jira stories.

# The idea
Developers can create inline comments.
The comment expands and show a tooltip with additional information, similar to syntax explanations currently available in VS Code.
The tooltip has embedded links. For example, an iframe to a website where an architecture diagram is hosted, or a link to a section of a design doc.
All comment information is stored in a single file at the root of the project directory parsed by the extension.