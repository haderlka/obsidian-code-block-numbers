# CLAUDE.md

@AGENTS.md

## Claude-specific notes

- **Shell on Windows:** in Bash heredocs and `node -e` strings, quotes, backslashes and regex escapes get mangled. Use the Write/Edit tools for file content, or a small `.js` script in the scratchpad.
- **Before finishing a change:** `npm run lint && npm test && npm run build`. Tell the user which files to copy into `<vault>/.obsidian/plugins/code-block-numbers/`: `styles.css` only for CSS changes, `main.js` + `styles.css` for code changes.
- **Visual checks:** use the harness (see AGENTS.md) in light and dark, plus `mobile=1`.
- **The user iterates on the look in small steps.** Make exactly the requested change, remove dead code and CSS, and record the decision under "Design decisions" in AGENTS.md.
