import {
	App,
	editorLivePreviewField,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	Plugin,
	PluginSettingTab,
	Setting,
	SettingDefinitionItem,
	TFile,
} from "obsidian";
import { Extension, RangeSetBuilder, Text as DocText } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, PluginValue, ViewPlugin, ViewUpdate } from "@codemirror/view";
import {
	codeLines,
	FencedBlock,
	FenceOptions,
	findFencedBlocks,
	isHighlighted,
	labelWidth,
	matchBlocks,
	parseFenceInfo,
	ResolvedOptions,
	resolveOptions,
} from "./fence";

interface CodeBlockNumbersSettings {
	numbersByDefault: boolean;
}

const DEFAULT_SETTINGS: CodeBlockNumbersSettings = {
	numbersByDefault: true,
};

const SETTING_TEXT = {
	numbersByDefault: {
		name: "Number all code blocks",
		desc: "Show line numbers on every code block. Turn off to number only blocks with ln or start=… in their first line. A block can always opt out with ln=false.",
	},
};

/** Widest supported label for the Live Preview width classes (cbn-d1 … cbn-d6). */
const MAX_DIGIT_CLASS = 6;

export default class CodeBlockNumbersPlugin extends Plugin {
	settings: CodeBlockNumbersSettings = { ...DEFAULT_SETTINGS };
	/** Live reading-view decorators, re-applied after a settings change. */
	readonly decorators = new Set<ReadingDecorator>();
	/** Which `pre` already has a decorator (post-processor and Live Preview widgets can both reach one). */
	readonly decorated = new WeakMap<HTMLElement, ReadingDecorator>();
	/** Registered once; replaced in place so updateOptions() rebuilds every editor. */
	private readonly editorExtensions: Extension[] = [];

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CodeBlockNumbersSettingTab(this.app, this));

		this.registerMarkdownPostProcessor((el, ctx) => this.decorateRendered(el, ctx));

		this.editorExtensions.push(livePreviewExtension(this));
		this.registerEditorExtension(this.editorExtensions);
	}

	async loadSettings() {
		const data = ((await this.loadData()) ?? {}) as Partial<CodeBlockNumbersSettings>;
		this.settings = {
			numbersByDefault:
				typeof data.numbersByDefault === "boolean" ? data.numbersByDefault : DEFAULT_SETTINGS.numbersByDefault,
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
		for (const d of this.decorators) d.refresh();
		this.editorExtensions.splice(0, this.editorExtensions.length, livePreviewExtension(this));
		this.app.workspace.updateOptions();
	}

	/** Reading view and rendered embeds/callouts: decorate every `pre > code` of the section. */
	private decorateRendered(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const info = ctx.getSectionInfo(el);
		if (info) {
			const blocks = findFencedBlocks(info.text.split(/\r?\n/).slice(info.lineStart, info.lineEnd + 1));
			if (blocks.length > 0 || decoratablePres(el, this).length > 0) {
				ctx.addChild(new SectionWatcher(el, Promise.resolve(blocks), true, this));
			}
			return;
		}

		// No section info (e.g. embeds): look the block up in the whole file by its content.
		if (decoratablePres(el, this).length === 0 && !el.querySelector("[class*='block-language-']")) return;
		const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
		const blocks =
			file instanceof TFile
				? this.app.vault.cachedRead(file).then(
						(text) => findFencedBlocks(text.split(/\r?\n/)),
						() => []
					)
				: Promise.resolve([]);
		ctx.addChild(new SectionWatcher(el, blocks, true, this));
	}
}

/**
 * Decorates the code blocks of one rendered section (Reading view) or one editor (Live
 * Preview widgets), now and whenever one appears later. Plugins with a code block processor
 * (e.g. Code Emitter) replace Obsidian's `<pre>` with their own after the post-processors
 * ran, sometimes asynchronously, so a one-time pass would decorate an element that's gone.
 */
class SectionWatcher extends MarkdownRenderChild {
	private blocks: FencedBlock[] | null = null;
	private readonly decorators = new Set<ReadingDecorator>();
	private observer: MutationObserver | null = null;
	/** Batches mutation bursts. A timer, not a frame: frames pause while the window is hidden. */
	private timer = 0;

	/**
	 * @param fallbackToOrder Match by position when contents differ (only safe when `blocks`
	 *   are exactly the section's blocks). Unmatched code is decorated with defaults if true,
	 *   left alone otherwise.
	 */
	constructor(
		containerEl: HTMLElement,
		blocks: Promise<FencedBlock[]>,
		private readonly fallbackToOrder: boolean,
		private readonly plugin: CodeBlockNumbersPlugin
	) {
		super(containerEl);
		void blocks.then((b) => {
			this.blocks = b;
			this.scan();
		});
	}

	/** Replaces the known blocks (Live Preview: the document changed). */
	setBlocks(blocks: FencedBlock[]) {
		this.blocks = blocks;
		this.schedule();
	}

	onload() {
		this.observer = new MutationObserver(() => this.schedule());
		this.observer.observe(this.containerEl, { childList: true, subtree: true });
		this.scan();
	}

	onunload() {
		this.observer?.disconnect();
		window.clearTimeout(this.timer);
		for (const d of this.decorators) this.removeChild(d);
		this.decorators.clear();
	}

	schedule() {
		if (this.timer) return;
		this.timer = window.setTimeout(() => {
			this.timer = 0;
			this.scan();
		}, 0);
	}

	private scan() {
		for (const d of this.decorators) {
			if (d.isAttached()) continue;
			this.removeChild(d);
			this.decorators.delete(d);
		}
		if (!this.blocks) return;

		const pres = decoratablePres(this.containerEl, this.plugin);
		if (pres.length === 0) return;
		const texts = pres.map((pre) => pre.querySelector(":scope > code")?.textContent ?? "");
		const matched = matchBlocks(texts, this.blocks, this.fallbackToOrder);
		pres.forEach((pre, i) => {
			// Code that isn't a fenced block of this note (e.g. a plugin's output) stays untouched.
			if (!matched[i] && !this.fallbackToOrder) return;
			this.decorators.add(this.addChild(new ReadingDecorator(pre, optionsOf(matched[i]), this.plugin)));
		});
	}
}

/** Rendered code blocks under `root` that don't have a decorator yet. */
function decoratablePres(root: HTMLElement, plugin: CodeBlockNumbersPlugin): HTMLElement[] {
	return Array.from(root.querySelectorAll("pre")).filter(
		(pre) => !pre.hasClass("frontmatter") && !plugin.decorated.has(pre) && pre.querySelector(":scope > code") !== null
	);
}

function optionsOf(block: FencedBlock | undefined): FenceOptions {
	return block ? parseFenceInfo(block.info) : { language: "", highlight: [] };
}

/**
 * Adds a title bar, line numbers and highlighted lines to a rendered code block without
 * touching its `<code>` element: highlighters and plugins that read or re-render the code
 * keep working. Numbers and highlights sit in overlay layers positioned by measuring the
 * rendered text, so wrapped lines and other plugins' changes are handled.
 */
class ReadingDecorator extends MarkdownRenderChild {
	private options: ResolvedOptions;
	private titleEl: HTMLElement | null = null;
	private gutterEl: HTMLElement | null = null;
	private marksEl: HTMLElement | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private mutationObserver: MutationObserver | null = null;
	private frame = 0;
	/** Last applied layout, to skip DOM writes when nothing moved. */
	private signature = "";

	constructor(
		private readonly pre: HTMLElement,
		private readonly fence: FenceOptions,
		private readonly plugin: CodeBlockNumbersPlugin
	) {
		super(pre);
		this.options = resolveOptions(fence, plugin.settings.numbersByDefault);
	}

	onload() {
		this.plugin.decorators.add(this);
		this.plugin.decorated.set(this.pre, this);
		this.setUp();
	}

	onunload() {
		this.plugin.decorators.delete(this);
		if (this.plugin.decorated.get(this.pre) === this) this.plugin.decorated.delete(this.pre);
		this.tearDown();
	}

	isAttached(): boolean {
		return this.pre.isConnected;
	}

	/** Re-applies the block after a settings change. */
	refresh() {
		this.tearDown();
		this.options = resolveOptions(this.fence, this.plugin.settings.numbersByDefault);
		this.setUp();
	}

	private setUp() {
		const { pre, options } = this;
		const hasHighlight = options.highlight.length > 0;
		if (!options.numbers && !hasHighlight && options.title === "") return;

		pre.addClass("cbn-block");

		if (options.title !== "") {
			this.titleEl = createDiv({ cls: "cbn-title" });
			this.titleEl.createSpan({ cls: "cbn-title-text", text: options.title });
			pre.parentElement?.insertBefore(this.titleEl, pre);
			pre.addClass("cbn-has-title");
		}

		if (!options.numbers && !hasHighlight) return;

		if (hasHighlight) {
			// First child, so it paints below the (positioned) code element.
			this.marksEl = createDiv({ cls: "cbn-marks", attr: { "aria-hidden": "true" } });
			pre.prepend(this.marksEl);
		}
		if (options.numbers) {
			pre.addClass("cbn-numbered");
			this.gutterEl = pre.createDiv({ cls: "cbn-gutter", attr: { "aria-hidden": "true" } });
		}

		this.resizeObserver = new ResizeObserver(() => this.schedule());
		this.resizeObserver.observe(pre);
		// Other plugins may re-highlight or replace the code element.
		this.mutationObserver = new MutationObserver(() => this.schedule());
		this.mutationObserver.observe(pre, { childList: true });
		const code = this.code();
		if (code) {
			this.resizeObserver.observe(code);
			this.mutationObserver.observe(code, { childList: true, subtree: true, characterData: true });
		}

		this.registerDomEvent(pre, "scroll", () => this.followScroll());
		void pre.doc.fonts?.ready.then(() => this.schedule());
		this.schedule();
	}

	private tearDown() {
		this.resizeObserver?.disconnect();
		this.mutationObserver?.disconnect();
		this.resizeObserver = this.mutationObserver = null;
		if (this.frame) window.cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.signature = "";
		this.titleEl?.remove();
		this.gutterEl?.remove();
		this.marksEl?.remove();
		this.titleEl = this.gutterEl = this.marksEl = null;
		this.pre.removeClass("cbn-block", "cbn-numbered", "cbn-has-title");
	}

	private code(): HTMLElement | null {
		return this.pre.querySelector(":scope > code");
	}

	private schedule() {
		if (this.frame) return;
		this.frame = window.requestAnimationFrame(() => {
			this.frame = 0;
			this.layout();
		});
	}

	/** Keeps the gutter in place when a non-wrapping block scrolls sideways. */
	private followScroll() {
		this.pre.setCssProps({ "--cbn-scroll-left": `${this.pre.scrollLeft}px` });
	}

	private layout() {
		const code = this.code();
		const { pre, options } = this;
		if (!code || !pre.isConnected || pre.getClientRects().length === 0) return;

		const rows = measureLines(code, pre);
		if (rows.length === 0) return;

		const signature = rows.map((r) => `${r.top.toFixed(1)}:${r.height.toFixed(1)}`).join(",");
		if (signature === this.signature) return;
		this.signature = signature;

		const style = getComputedStyle(code);
		const gutter = this.gutterEl;
		if (gutter) {
			gutter.setCssProps({
				"--cbn-digits": String(labelWidth(options.start, rows.length)),
				"--cbn-font-size": style.fontSize,
				"--cbn-line-height": `${rows[0].lineHeight}px`,
			});
			syncChildren(gutter, rows.length, "cbn-number");
			// Only the code moves right, by the gutter's width minus the pre's own padding, so
			// anything else other plugins put into the pre (e.g. Code Emitter's output) stays put.
			const preStyle = getComputedStyle(pre);
			const gap = (parseFloat(style.fontSize) || 14) * 0.85;
			const indent = Math.max(0, gutter.offsetWidth + gap - (parseFloat(preStyle.paddingLeft) || 0));
			// The gutter ends with the code (plus the pre's bottom padding), not with the pre.
			const codeBottom = code.getBoundingClientRect().bottom - pre.getBoundingClientRect().top - pre.clientTop;
			const height = Math.min(pre.clientHeight, codeBottom + (parseFloat(preStyle.paddingBottom) || 0));
			pre.setCssProps({ "--cbn-code-indent": `${indent}px`, "--cbn-gutter-height": `${height}px` });
			rows.forEach((row, i) => {
				const label = options.start + i;
				const el = gutter.children[i] as HTMLElement;
				el.setAttribute("data-cbn-n", String(label));
				el.toggleClass("is-highlighted", isHighlighted(label, options.highlight));
				el.setCssProps({ "--cbn-top": `${row.top}px` });
			});
		}

		const marks = this.marksEl;
		if (marks) {
			const highlighted = rows.filter((_, i) => isHighlighted(options.start + i, options.highlight));
			syncChildren(marks, highlighted.length, "cbn-mark");
			highlighted.forEach((row, i) => {
				(marks.children[i] as HTMLElement).setCssProps({
					"--cbn-top": `${row.top}px`,
					"--cbn-height": `${row.height}px`,
				});
			});
		}
	}
}

/** Makes `parent` have exactly `count` children with class `cls`. */
function syncChildren(parent: HTMLElement, count: number, cls: string) {
	while (parent.children.length > count) parent.lastElementChild?.remove();
	while (parent.children.length < count) parent.createDiv({ cls });
}

interface Row {
	/** Offset from the top of the pre's padding box, including half the leading. */
	top: number;
	height: number;
	lineHeight: number;
}

/**
 * Measures where each source line of `code` is drawn, relative to `pre`. A wrapped line
 * gets one row spanning all its visual lines.
 */
function measureLines(code: HTMLElement, pre: HTMLElement): Row[] {
	const doc = code.ownerDocument;
	const nodes: { node: Text; start: number }[] = [];
	let text = "";
	const walker = doc.createTreeWalker(code, NodeFilter.SHOW_TEXT);
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		nodes.push({ node: n as Text, start: text.length });
		text += (n as Text).data;
	}
	const lines = codeLines(text);
	if (nodes.length === 0) return [];

	/** Text position → DOM position. `end` prefers the end of the previous node at boundaries. */
	const locate = (index: number, end: boolean): [Text, number] => {
		let lo = 0;
		let hi = nodes.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			const s = nodes[mid].start;
			if (s < index || (!end && s === index)) lo = mid;
			else hi = mid - 1;
		}
		const { node, start } = nodes[lo];
		return [node, Math.min(index - start, node.data.length)];
	};

	const preRect = pre.getBoundingClientRect();
	const origin = preRect.top + pre.clientTop;
	const style = getComputedStyle(code);
	const fontSize = parseFloat(style.fontSize) || 16;
	let lineHeight = parseFloat(style.lineHeight);
	if (!Number.isFinite(lineHeight)) lineHeight = fontSize * 1.5;

	const range = doc.createRange();
	const rows: Row[] = [];
	let pos = 0;
	let previousBottom = code.getBoundingClientRect().top - origin + (parseFloat(style.paddingTop) || 0);

	for (const line of lines) {
		const start = pos;
		// Empty lines are measured through their newline character.
		const end = line.length > 0 ? start + line.length : Math.min(start + 1, text.length);
		pos = start + line.length + 1;

		let top = Infinity;
		let bottom = -Infinity;
		if (end > start) {
			range.setStart(...locate(start, false));
			range.setEnd(...locate(end, true));
			for (const r of Array.from(range.getClientRects())) {
				if (r.height === 0) continue;
				top = Math.min(top, r.top);
				bottom = Math.max(bottom, r.bottom);
			}
		}

		if (top === Infinity) {
			rows.push({ top: previousBottom, height: lineHeight, lineHeight });
			previousBottom += lineHeight;
			continue;
		}
		// Glyph boxes are shorter than the line box: add half the leading on each side.
		const visualLines = Math.max(1, Math.round((bottom - top) / lineHeight));
		const leading = Math.max(0, (lineHeight * visualLines - (bottom - top)) / 2);
		const rowTop = top - origin - leading;
		const height = bottom - top + 2 * leading;
		rows.push({ top: rowTop, height, lineHeight });
		previousBottom = rowTop + height;
	}
	range.detach();
	return rows;
}

/* ---------------------------------------------------------------- Live Preview */

interface DocBlock {
	block: FencedBlock;
	options: ResolvedOptions;
}

function docBlocks(doc: DocText): FencedBlock[] {
	const lines: string[] = [];
	for (const it = doc.iterLines(); !it.next().done; ) lines.push(it.value);
	return findFencedBlocks(lines);
}

function lineBlocks(all: FencedBlock[], numbersByDefault: boolean): DocBlock[] {
	// Blocks in lists and callouts have their own line styling in Live Preview; callouts are
	// rendered through the post-processor anyway.
	return all
		.filter((b) => b.quotePrefix === "" && b.indent <= 3)
		.map((block) => ({ block, options: resolveOptions(parseFenceInfo(block.info), numbersByDefault) }));
}

function livePreviewExtension(plugin: CodeBlockNumbersPlugin): Extension {
	class LivePreviewNumbers implements PluginValue {
		decorations: DecorationSet = Decoration.none;
		private allBlocks: FencedBlock[];
		private blocks: DocBlock[];
		/**
		 * Blocks that another plugin renders itself (e.g. Code Emitter for python) are widgets in
		 * Live Preview: line decorations don't reach them and post-processors don't run on them.
		 * Their rendered `pre` is decorated like in Reading view instead. Only a content match is
		 * trusted, since the widgets are a subset of the document's blocks.
		 */
		private readonly widgets: SectionWatcher;

		constructor(view: EditorView) {
			this.allBlocks = docBlocks(view.state.doc);
			this.blocks = lineBlocks(this.allBlocks, plugin.settings.numbersByDefault);
			this.decorations = this.build(view);
			this.widgets = new SectionWatcher(view.contentDOM, Promise.resolve(this.allBlocks), false, plugin);
			this.widgets.load();
		}

		update(u: ViewUpdate) {
			const modeChanged = u.startState.field(editorLivePreviewField, false) !== u.state.field(editorLivePreviewField, false);
			if (u.docChanged) {
				this.allBlocks = docBlocks(u.state.doc);
				this.blocks = lineBlocks(this.allBlocks, plugin.settings.numbersByDefault);
				this.widgets.setBlocks(this.allBlocks);
			}
			if (u.docChanged || u.viewportChanged || u.selectionSet || modeChanged) this.decorations = this.build(u.view);
		}

		destroy() {
			this.widgets.unload();
		}

		private build(view: EditorView): DecorationSet {
			const state = view.state;
			if (!state.field(editorLivePreviewField, false)) return Decoration.none;

			const builder = new RangeSetBuilder<Decoration>();
			const doc = state.doc;
			const selection = state.selection.ranges;

			for (const { from, to } of view.visibleRanges) {
				const firstLine = doc.lineAt(from).number - 1;
				const lastLine = doc.lineAt(to).number - 1;

				for (const { block, options } of this.blocks) {
					if (block.closeLine < firstLine || block.openLine > lastLine) continue;
					const hasHighlight = options.highlight.length > 0;
					if (!options.numbers && !hasHighlight && options.title === "") continue;

					// Obsidian shows the raw fence while the cursor is in the block; the title then
					// would be repeated next to it.
					const blockFrom = doc.line(block.openLine + 1).from;
					const blockTo = doc.line(block.closeLine + 1).to;
					const editing = selection.some((r) => r.to >= blockFrom && r.from <= blockTo);

					const digits = Math.min(labelWidth(options.start, block.body.length), MAX_DIGIT_CLASS);
					const contentEnd = block.closed ? block.closeLine - 1 : block.closeLine;

					for (let i = Math.max(block.openLine, firstLine); i <= Math.min(block.closeLine, lastLine); i++) {
						const line = doc.line(i + 1);
						if (i === block.openLine) {
							if (options.title !== "" && !editing) {
								builder.add(
									line.from,
									line.from,
									Decoration.line({ class: "cbn-lp-title", attributes: { "data-cbn-title": options.title } })
								);
							}
							continue;
						}
						if (i > contentEnd) continue;

						const label = options.start + (i - block.openLine - 1);
						const classes = ["cbn-lp-line"];
						const attributes: Record<string, string> = {};
						if (options.numbers) {
							classes.push("cbn-lp-numbered", `cbn-d${digits}`);
							attributes["data-cbn-n"] = String(label);
						}
						if (isHighlighted(label, options.highlight)) classes.push("cbn-lp-highlight");
						if (classes.length === 1) continue;
						builder.add(line.from, line.from, Decoration.line({ class: classes.join(" "), attributes }));
					}
				}
			}
			return builder.finish();
		}
	}

	return ViewPlugin.fromClass(LivePreviewNumbers, { decorations: (v) => v.decorations });
}

/* ---------------------------------------------------------------- Settings */

class CodeBlockNumbersSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: CodeBlockNumbersPlugin
	) {
		super(app, plugin);
	}

	/** Obsidian 1.13+: declarative, searchable settings. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				...SETTING_TEXT.numbersByDefault,
				control: { type: "toggle", key: "numbersByDefault" },
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof CodeBlockNumbersSettings];
	}

	async setControlValue(key: string, value: unknown) {
		this.plugin.settings = { ...this.plugin.settings, [key]: value };
		await this.plugin.saveSettings();
	}

	/** Obsidian before 1.13 renders the tab imperatively. Not called when getSettingDefinitions() is used. */
	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(SETTING_TEXT.numbersByDefault.name)
			.setDesc(SETTING_TEXT.numbersByDefault.desc)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.numbersByDefault).onChange(async (v) => {
					this.plugin.settings.numbersByDefault = v;
					await this.plugin.saveSettings();
				})
			);
	}
}
