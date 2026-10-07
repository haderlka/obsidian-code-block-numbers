// Minimal Obsidian API shim for testing the plugin in a plain browser.
import { StateField } from "@codemirror/state";

const P = Element.prototype as any;
function apply(el: any, o: any = {}) {
	if (typeof o === "string") o = { cls: o };
	if (o.cls) (Array.isArray(o.cls) ? o.cls : o.cls.split(" ")).forEach((c: string) => c && el.classList.add(c));
	if (o.text !== undefined) el.textContent = o.text;
	if (o.attr) for (const k in o.attr) el.setAttribute(k, String(o.attr[k]));
	return el;
}
P.createEl = function (tag: string, o?: any) { return this.appendChild(apply(document.createElement(tag), o)); };
P.createDiv = function (o?: any) { return this.createEl("div", o); };
P.createSpan = function (o?: any) { return this.createEl("span", o); };
P.setCssProps = function (p: Record<string, string>) { for (const k in p) this.style.setProperty(k, p[k]); };
P.empty = function () { this.replaceChildren(); };
P.addClass = function (...c: string[]) { this.classList.add(...c); };
P.removeClass = function (...c: string[]) { this.classList.remove(...c); };
P.hasClass = function (c: string) { return this.classList.contains(c); };
P.toggleClass = function (c: string, v: boolean) { this.classList.toggle(c, v); };
Object.defineProperty(Node.prototype, "doc", { get() { return this.ownerDocument; } });
Object.defineProperty(Node.prototype, "win", { get() { return this.ownerDocument.defaultView; } });
(window as any).createDiv = (o?: any) => apply(document.createElement("div"), o);

export const editorLivePreviewField = StateField.define<boolean>({ create: () => true, update: (v) => v });

export class TFile { path = "note.md"; }
export class Component {
	private cleanups: (() => void)[] = [];
	private children: Component[] = [];
	private loaded = false;
	onload() {}
	onunload() {}
	load() {
		if (this.loaded) return;
		this.loaded = true;
		this.onload();
		this.children.forEach((c) => c.load());
	}
	unload() {
		if (!this.loaded) return;
		this.loaded = false;
		this.children.forEach((c) => c.unload());
		this.children = [];
		this.cleanups.forEach((f) => f());
		this.cleanups = [];
		this.onunload();
	}
	addChild<T extends Component>(c: T): T {
		this.children.push(c);
		if (this.loaded) c.load();
		return c;
	}
	removeChild<T extends Component>(c: T): T {
		this.children = this.children.filter((x) => x !== c);
		c.unload();
		return c;
	}
	registerDomEvent(el: HTMLElement, type: string, fn: any) {
		el.addEventListener(type, fn);
		this.cleanups.push(() => el.removeEventListener(type, fn));
	}
}
export class MarkdownRenderChild extends Component { constructor(public containerEl: HTMLElement) { super(); } }
export class PluginSettingTab { constructor(public app: any, public plugin: any) {} }
export class Setting {}
export class Plugin {
	postProcessors: Function[] = [];
	editorExtensions: any[] = [];
	constructor(public app: any) {}
	registerMarkdownPostProcessor(fn: Function) { this.postProcessors.push(fn); }
	registerEditorExtension(ext: any) { this.editorExtensions.push(ext); }
	addSettingTab() {}
	async loadData() { return (window as any).__settings ?? {}; }
	async saveData() {}
}
