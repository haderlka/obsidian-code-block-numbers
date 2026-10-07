# AGENTS.md

Guidance for AI coding agents (and humans) working on **Code Block Numbers**, an Obsidian community plugin. General Obsidian plugin learnings live in `C:\Users\DevUser\projects\agents\obsidian-plugins.md`.

- Repo: https://github.com/haderlka/obsidian-code-block-numbers (author `haderlka`, default branch `main`)
- Donations: `fundingUrl` in `manifest.json` → https://buymeacoffee.com/haderlka, plus the support block at the **top** of the README: button image `docs/support-button.png` linked to buymeacoffee.com (no extra text link — the user removed it). The image file name must not contain "buymeacoffee" (the community site removes such images). Keep links out of the manifest `description`.
- README images and links are **absolute** GitHub URLs (`raw.githubusercontent.com/.../main/docs/`), so they also work in Obsidian's plugin browser.

## What it does

Options in the info string of an ordinary fenced code block add a title bar, line numbers and highlighted lines:

````markdown
```python title="utils/math.py" start=10 hl=10,13-14
...
```
````

- `title=` (`file=`, `filename=`), `start=N` (default 1), `hl=` (`highlight=`, `mark=`) with lines/ranges, and `ln` / `ln=false`. `:` works like `=`. `ln:10` = numbers on, start at 10 (Code Styler style).
- `hl` refers to the **displayed labels**: with `start=10`, `hl=10` is the first line.
- Setting "Number all code blocks" (default **on**). When off, only blocks with `ln` or `start=` are numbered. An explicit `start` turns numbers on unless `ln=false`.

## Commands

| Command | Purpose |
| ------- | ------- |
| `npm ci` | Install dependencies |
| `npm run dev` | esbuild watch → `main.js` |
| `npm run build` | `tsc` type-check + production bundle |
| `npm run lint` | ESLint with `eslint-plugin-obsidianmd` (`--max-warnings 0`, incl. `validate-manifest` on manifest.json and `validate-license` on LICENSE) + `tools/check-release.mjs` (submission rules ESLint doesn't cover). **Must be green before a release.** |
| `npm audit` | Must report 0 vulnerabilities (CI runs it). `moment` is pinned via `overrides` because `obsidian` pulls in a vulnerable version. |
| `npm test` | `node:test` unit tests for `src/fence.ts` |
| `npm run harness` | Builds the browser test page into `tools/harness/.build/` (serve over http, see `.claude/launch.json`) |
| `npm run screenshots` | Harness + regenerates `docs/dark.png` (dark only, the user prefers dark screenshots). Run after visual changes. |

Run `lint`, `test` and `build` after every change.

**Git is the user's job.** Don't run git commands that change the repository (`commit`, `push`, `tag`, `add`, `npm version`, …). Read-only commands are fine.

## Layout

```
src/fence.ts      Pure logic: parseFenceInfo, resolveOptions, findFencedBlocks, matchBlocks, …
src/main.ts       Plugin, ReadingDecorator (reading view), Live Preview ViewPlugin, settings tab
styles.css        All styling, classes prefixed cbn-
tests/            Unit tests for fence.ts
tools/harness/    Obsidian shim + note-like page (Prism reading view + real CodeMirror editor)
docs/             README images (dark.png generated, support-button.png)
```

## Architecture and non-obvious decisions

- **Compatibility is the top priority.** The language must remain the first word of the info string; the plugin only *adds* things and never modifies the `<code>` element or its text. That keeps Prism/Obsidian highlighting, the copy button, Execute Code (reads the first word and the code text, and has its own `{…}` args, which the tokenizer skips) and other post-processors working. A custom block language (```` ```cbn-python ````) was rejected for that reason.
- **Reading view** (`registerMarkdownPostProcessor`): the section's source comes from `ctx.getSectionInfo(el)`. Rendered HTML loses the info string, so `findFencedBlocks` scans the section's lines and `matchBlocks` pairs each `pre > code` with its fence **by content** (sections can hold several blocks, e.g. callouts, and blocks rendered by other plugins have no `pre`). It falls back to order when the counts agree. Without section info (embeds), the whole file is read with `vault.cachedRead` and matched the same way. `pre.frontmatter` is skipped.
- **Overlay instead of DOM rewrite.** Numbers (`.cbn-gutter`, appended to the `pre`) and highlight bands (`.cbn-marks`, prepended so they paint below the code, which gets `position: relative`) are absolutely positioned. `measureLines` uses `Range.getClientRects()` per source line, so wrapped lines, the font and other plugins' re-highlighting are handled. A `ResizeObserver` (pre) and `MutationObserver` (pre children + code subtree) re-measure; the layout signature skips no-op writes. The labels are `::before { content: attr(data-cbn-n) }`, so they're never selected or copied.
- **Other plugins put things inside the `pre`.** Code Emitter (0.4) renders `<pre><code/><div.code-emitter-block>▶ + output</div></pre>` via a code block processor (Prism highlighting runs later). So the decorator indents **only the `<code>`** (`display: block` + `padding-inline-start: --cbn-code-indent`, computed from the gutter width minus the pre's padding), never the `pre`, and the gutter ends at the code's bottom (`--cbn-gutter-height`). Don't go back to padding the `pre` or `top: 0; bottom: 0` for the gutter.
- **`SectionWatcher` (Reading view sections and Live Preview widgets).** Code block processors of other plugins replace Obsidian's `<pre>` with their own **after** our post-processor ran, so a one-time pass decorates an element that's about to be removed. This was the actual bug with Code Emitter in Reading view. Each rendered section therefore gets a `SectionWatcher` (a `MarkdownRenderChild` added via `ctx.addChild`). It decorates the current `pre > code`, then watches the section with a MutationObserver. It decorates `pre`s that appear later and unloads decorators whose `pre` left the DOM. Batching uses `window.setTimeout(…, 0)`, **not** `requestAnimationFrame`, because frames pause while the window/pane is hidden.
- **Live Preview widgets.** A block that another plugin renders itself (Code Emitter for python, …) is a CodeMirror block widget in Live Preview, so line decorations don't reach it and Obsidian's post-processors don't run on it. The ViewPlugin owns a `SectionWatcher` on `view.contentDOM` and gives it the document's blocks (`setBlocks` on doc changes). Here matching is **by content only** (`fallbackToOrder = false`), and unmatched widget code (a plugin's output) is left alone. `plugin.decorated` (WeakMap) prevents double decoration.
- **Live Preview lines**: a `ViewPlugin` adds line decorations (classes + `data-cbn-n`) to code lines of top-level fences. Blocks are rescanned on doc changes only. Digit widths use classes `cbn-d1…cbn-d6` instead of inline styles. The title is shown on the opening fence line via `::before` **only while the cursor is outside the block** (Obsidian reveals the raw fence then). Blocks in lists/blockquotes are skipped in Live Preview (their lines have Obsidian's own indentation styling); callouts render through the post-processor anyway. Only active when `editorLivePreviewField` is true.
- **Settings change**: `saveSettings()` refreshes all `ReadingDecorator`s and swaps the editor extension in place + `workspace.updateOptions()` so every editor rebuilds.
- Settings tab: `getSettingDefinitions()` (1.13+) and `display()` fallback share `SETTING_TEXT`.

## Design decisions (don't reintroduce)

- README screenshots are **dark theme only**, and show no copy button. Obsidian only shows it on hover, and the harness does the same.
- The Buy Me a Coffee button sits at the **top** of the README, under the intro, not in a "Support" section at the end. **No** extra plain text coffee link under it (the user removed it).

## Testing

- `npm run harness`, then start the `harness` server from `.claude/launch.json` and open `page.html`. Query params: `theme=light|dark`, `mobile=1` (375px column), `numbers=0` (setting off), `only=reading`.
- The harness's Live Preview editor does **not** hide fence text like Obsidian does, so the title appears next to the raw fence there. README shots therefore show Reading view only.
- The harness note includes a Code Emitter stand-in (`emitter.py` block). In Reading view it renders Obsidian's normal `pre` first and **replaces** it with Code Emitter's DOM 150 ms later, like the real plugin. In the editor it's a block widget (`emitterWidgets`) that shows the source while the cursor is inside. `window.plugin` exposes the plugin for debugging.
- **Hidden browser pane:** `document.hidden` is true and `requestAnimationFrame` never fires, so the numbers (laid out in a frame) stay empty. Check `document.hidden` before trusting a result. Taking a screenshot shows the pane.
- Final checks in real Obsidian: Reading view, Live Preview (cursor inside/outside a block), callouts, embeds, Code Emitter and Execute Code run buttons and output, mobile. The test vault is `C:\Users\DevUser\projects\Obsidian\testvault` (plugin folder `.obsidian/plugins/Code-Block-Numbers/`, needs `main.js`, `manifest.json` **and** `styles.css`).
