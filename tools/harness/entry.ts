// Renders a sample note with the real plugin code: a Reading view built like Obsidian's
// (Prism-highlighted <pre><code>) and a Live Preview made of a real CodeMirror editor.
import { EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import CodeBlockNumbersPlugin from "../../src/main";
import { findFencedBlocks, parseFenceInfo } from "../../src/fence";

declare const Prism: any;
const q = new URLSearchParams(location.search);
document.body.classList.add(q.get("theme") === "dark" ? "theme-dark" : "theme-light");
if (q.get("mobile")) document.body.classList.add("is-mobile");
// README shots: the harness cannot hide raw fences like Obsidian Live Preview does.
if (q.get("only") === "reading") document.body.classList.add("only-reading");
(window as any).__settings = q.get("numbers") === "0" ? { numbersByDefault: false } : {};

const NOTE = [
	'```python title="utils/math.py" start=10 hl=10,13-14',
	"def mean(values):",
	'    """Average of a list.',
	'    Returns 0 for an empty list."""',
	"    if not values:",
	"        return 0",
	"    return sum(values) / len(values)  # a deliberately long comment line that wraps around in narrow panes",
	"",
	"print(mean([1, 2, 3]))",
	"```",
	"",
	"```js",
	"const answer = 42;",
	"console.log(answer);",
	"```",
	"",
	"```bash title=install.sh ln=false hl=2",
	"npm ci",
	"npm run build",
	'cp main.js styles.css manifest.json "$VAULT/.obsidian/plugins/code-block-numbers/"',
	"```",
	"",
	"> [!note] Inside a callout",
	"> ```ts hl=2",
	"> type Point = { x: number; y: number };",
	"> const origin: Point = { x: 0, y: 0 };",
	"> ```",
	"",
	'```python {label="demo"} title=run.py',
	"for i in range(3):",
	"    print(i)",
	"```",
	"",
	"```python title=emitter.py hl=2",
	"total = 0",
	"for i in range(3):",
	"    total += i",
	"print(total)",
	"```",
];

/** Blocks the Code Emitter stand-in takes over (it registers a code block processor for python). */
const isEmitterBlock = (info: string) => info.includes("emitter.py");

/** Code Emitter 0.4's DOM: <pre><code/><div.code-emitter-block>▶ + output</div></pre>, highlighted async. */
function emitterEl(lang: string, body: string[]) {
	const wrap = document.createElement("div");
	wrap.className = `block-language-${lang}`;
	const pre = wrap.createEl("pre", { cls: `language-${lang}` });
	const code = pre.createEl("code");
	code.textContent = body.join("\n");
	window.setTimeout(() => Prism.highlightElement(code), 50);
	const block = pre.createDiv({ cls: "code-emitter-block solid" });
	block.createEl("i", { cls: "button-play", text: "▶", attr: { "aria-label": "play" } });
	block.createEl("hr", { cls: "code-seprator" });
	const output = block.createDiv({ cls: "code-output" }).createEl("ul");
	output.createEl("li", { text: "3" });
	return wrap;
}

/** Live Preview: Obsidian shows a code block processor's output as a block widget. */
class EmitterWidget extends WidgetType {
	constructor(private readonly body: string[]) {
		super();
	}
	eq(other: EmitterWidget) {
		return other.body.join("\n") === this.body.join("\n");
	}
	toDOM() {
		const el = document.createElement("div");
		el.className = "cm-preview-code-block cm-embed-block markdown-rendered";
		el.appendChild(emitterEl("python", this.body));
		return el;
	}
}

const emitterWidgets = StateField.define<DecorationSet>({
	create: (state) => buildEmitterWidgets(state),
	update: (value, tr) => (tr.docChanged || tr.selection ? buildEmitterWidgets(tr.state) : value),
	provide: (f) => EditorView.decorations.from(f),
});

function buildEmitterWidgets(state: EditorState): DecorationSet {
	const b = new RangeSetBuilder<Decoration>();
	const head = state.selection.main.head;
	for (const blk of findFencedBlocks(state.doc.toString().split("\n"))) {
		if (!isEmitterBlock(blk.info)) continue;
		const from = state.doc.line(blk.openLine + 1).from;
		const to = state.doc.line(blk.closeLine + 1).to;
		if (head >= from && head <= to) continue; // editing: Obsidian shows the source
		b.add(from, to, Decoration.replace({ widget: new EmitterWidget(blk.body), block: true }));
	}
	return b.finish();
}

const app = {
	workspace: { updateOptions() {} },
	vault: { getAbstractFileByPath: () => null, cachedRead: async () => "" },
};
const plugin = new CodeBlockNumbersPlugin(app as any, {} as any) as any;
(window as any).plugin = plugin;

function codeEl(lang: string, body: string[]) {
	const pre = document.createElement("pre");
	const code = pre.createEl("code");
	if (lang) {
		pre.classList.add(`language-${lang}`);
		code.classList.add(`language-${lang}`);
	}
	code.textContent = body.join("\n") + "\n";
	if (lang && Prism.languages[lang]) Prism.highlightElement(code);
	pre.createEl("button", { cls: "copy-code-button", text: "Copy" });
	return pre;
}

function renderReading(host: HTMLElement) {
	const sections: { el: HTMLElement; start: number; end: number }[] = [];
	for (const b of findFencedBlocks(NOTE)) {
		const lang = parseFenceInfo(b.info).language;
		const el = host.createDiv({ cls: "el-pre" });
		if (b.quotePrefix) {
			// Callout section: Obsidian renders it as one section with the block inside.
			const callout = el.createDiv({ cls: "callout" });
			callout.createDiv({ cls: "callout-title", text: "Inside a callout" });
			callout.createDiv({ cls: "callout-content" }).appendChild(codeEl(lang, b.body));
			sections.push({ el, start: b.openLine - 1, end: b.closeLine });
		} else if (isEmitterBlock(b.info)) {
			// Obsidian renders its own <pre> first; the code block processor replaces it later.
			const original = codeEl(lang, b.body);
			el.appendChild(original);
			window.setTimeout(() => original.replaceWith(emitterEl(lang, b.body)), 150);
			sections.push({ el, start: b.openLine, end: b.closeLine });
		} else {
			el.appendChild(codeEl(lang, b.body));
			sections.push({ el, start: b.openLine, end: b.closeLine });
		}
	}
	const text = NOTE.join("\n");
	for (const s of sections) {
		const ctx = {
			sourcePath: "note.md",
			getSectionInfo: () => ({ text, lineStart: s.start, lineEnd: s.end }),
			addChild: (c: any) => c.load(),
		};
		for (const pp of plugin.postProcessors) pp(s.el, ctx);
	}

	// Another plugin (like Execute Code) adds a button and re-highlights the code later.
	const last = host.querySelectorAll("pre")[4] as HTMLElement;
	window.setTimeout(() => {
		last.createEl("button", { cls: "run-code-button", text: "Run" });
		const code = last.querySelector("code")!;
		code.textContent = code.textContent;
		Prism.highlightElement(code);
	}, 300);
}

// Stand-in for Obsidian's own Live Preview code styling (HyperMD-codeblock lines).
const fakeObsidianCodeLines = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(v: EditorView) {
			this.decorations = this.build(v);
		}
		update(u: ViewUpdate) {
			if (u.docChanged) this.decorations = this.build(u.view);
		}
		build(v: EditorView) {
			const b = new RangeSetBuilder<Decoration>();
			for (const blk of findFencedBlocks(v.state.doc.toString().split("\n"))) {
				if (blk.quotePrefix) continue;
				for (let i = blk.openLine; i <= blk.closeLine; i++) {
					const cls = i === blk.openLine ? "HyperMD-codeblock HyperMD-codeblock-begin" : "HyperMD-codeblock";
					const l = v.state.doc.line(i + 1);
					b.add(l.from, l.from, Decoration.line({ class: cls }));
				}
			}
			return b.finish();
		}
	},
	{ decorations: (v) => v.decorations }
);

async function main() {
	await plugin.onload();
	renderReading(document.getElementById("reading")!);
	const doc = NOTE.join("\n");
	(window as any).editor = new EditorView({
		parent: document.getElementById("live")!,
		state: EditorState.create({
			doc,
			extensions: [
				editorLivePreviewField,
				EditorView.lineWrapping,
				fakeObsidianCodeLines,
				emitterWidgets,
				plugin.editorExtensions,
			],
			selection: { anchor: 0 },
		}),
	});
}
void main();
