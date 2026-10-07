// Pure logic, no Obsidian or DOM imports: fence info parsing, option resolution and
// fenced-block discovery. Unit-tested in tests/fence.test.ts.

/** Inclusive range of line labels, e.g. `5-7` → { from: 5, to: 7 }. */
export interface LineRange {
	from: number;
	to: number;
}

/** What the opening fence says. Undefined means "not given". */
export interface FenceOptions {
	/** First word of the info string, as Obsidian and other plugins read it. */
	language: string;
	title?: string;
	start?: number;
	highlight: LineRange[];
	/** `ln` / `ln=false` etc. Overrides the global setting. */
	numbers?: boolean;
}

/** Options after applying the global defaults. */
export interface ResolvedOptions {
	numbers: boolean;
	start: number;
	title: string;
	highlight: LineRange[];
}

const TITLE_KEYS = new Set(["title", "file", "filename"]);
const START_KEYS = new Set(["start", "from", "first", "startline"]);
const HIGHLIGHT_KEYS = new Set(["hl", "highlight", "mark"]);
const NUMBER_KEYS = new Set(["ln", "linenumbers", "numbers", "nums", "numbered"]);

const TRUE_WORDS = new Set(["", "true", "yes", "on", "1"]);
const FALSE_WORDS = new Set(["false", "no", "off", "0", "none"]);

interface Token {
	key: string;
	value: string;
	/** True for `key=value` / `key:value`, false for a bare word. */
	hasValue: boolean;
}

/**
 * Splits the info string into words and `key=value` / `key:value` pairs. Values may be
 * quoted with " or ' and then contain spaces. `{…}` groups (Execute Code's arguments)
 * are skipped as a whole.
 */
function tokenize(info: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	const n = info.length;
	const isSpace = (c: string) => c === " " || c === "\t";

	while (i < n) {
		while (i < n && isSpace(info[i])) i++;
		if (i >= n) break;

		if (info[i] === "{") {
			let depth = 0;
			for (; i < n; i++) {
				if (info[i] === "{") depth++;
				else if (info[i] === "}" && --depth === 0) {
					i++;
					break;
				}
			}
			continue;
		}

		let key = "";
		while (i < n && !isSpace(info[i]) && info[i] !== "=" && info[i] !== ":" && info[i] !== "{") key += info[i++];

		if (i < n && (info[i] === "=" || info[i] === ":") && key !== "") {
			i++;
			let value = "";
			const quote = info[i];
			if (quote === '"' || quote === "'") {
				i++;
				while (i < n && info[i] !== quote) value += info[i++];
				i++;
			} else {
				while (i < n && !isSpace(info[i])) value += info[i++];
			}
			tokens.push({ key, value, hasValue: true });
		} else if (key !== "") {
			tokens.push({ key, value: "", hasValue: false });
		} else {
			// A lone "=" or ":" — skip it.
			i++;
		}
	}
	return tokens;
}

/** Parses `2,5-7`, `2 5..7` or `{2,5-7}` into ranges. Unknown parts are ignored. */
export function parseRanges(text: string): LineRange[] {
	const ranges: LineRange[] = [];
	for (const part of text.replace(/[{}[\]]/g, "").split(/[,;\s]+/)) {
		const m = /^(-?\d+)(?:\s*(?:-|\.\.|–)\s*(-?\d+))?$/.exec(part.trim());
		if (!m) continue;
		const a = parseInt(m[1], 10);
		const b = m[2] === undefined ? a : parseInt(m[2], 10);
		ranges.push({ from: Math.min(a, b), to: Math.max(a, b) });
	}
	return ranges;
}

function parseInteger(text: string): number | undefined {
	return /^-?\d+$/.test(text.trim()) ? parseInt(text, 10) : undefined;
}

/** Parses the info string of an opening fence (everything after ``` or ~~~). */
export function parseFenceInfo(info: string): FenceOptions {
	const tokens = tokenize(info.trim());
	const options: FenceOptions = { language: "", highlight: [] };

	// The language is the first word, as long as it isn't itself an option.
	if (tokens.length > 0 && !tokens[0].hasValue && !NUMBER_KEYS.has(tokens[0].key.toLowerCase())) {
		options.language = tokens.shift()!.key;
	}

	for (const { key: rawKey, value, hasValue } of tokens) {
		const key = rawKey.toLowerCase();
		if (TITLE_KEYS.has(key) && hasValue) {
			if (value.trim() !== "") options.title = value.trim();
		} else if (START_KEYS.has(key) && hasValue) {
			const start = parseInteger(value);
			if (start !== undefined) options.start = start;
		} else if (HIGHLIGHT_KEYS.has(key) && hasValue) {
			options.highlight.push(...parseRanges(value));
		} else if (NUMBER_KEYS.has(key)) {
			const word = value.trim().toLowerCase();
			const start = parseInteger(word);
			// `ln:10` (Code Styler style) means "numbers on, starting at 10".
			if (hasValue && start !== undefined && word !== "0" && word !== "1") {
				options.numbers = true;
				options.start ??= start;
			} else if (TRUE_WORDS.has(word)) options.numbers = true;
			else if (FALSE_WORDS.has(word)) options.numbers = false;
		}
	}
	return options;
}

/** Applies the global default. An explicit `start` turns numbering on. */
export function resolveOptions(options: FenceOptions, numbersByDefault: boolean): ResolvedOptions {
	return {
		numbers: options.numbers ?? (options.start !== undefined ? true : numbersByDefault),
		start: options.start ?? 1,
		title: options.title ?? "",
		highlight: options.highlight,
	};
}

/** Whether the line with this label (not index) is highlighted. */
export function isHighlighted(label: number, ranges: LineRange[]): boolean {
	return ranges.some((r) => label >= r.from && label <= r.to);
}

/** A fenced code block found in Markdown source. Line numbers are 0-based. */
export interface FencedBlock {
	/** Line of the opening fence. */
	openLine: number;
	/** Line of the closing fence, or the last line of the text if the block is unclosed. */
	closeLine: number;
	/** Whether a closing fence was found. */
	closed: boolean;
	/** Blockquote/callout markers before the fence, e.g. `> `. Empty for top-level blocks. */
	quotePrefix: string;
	/** Indentation of the fence (after the quote prefix), in characters. */
	indent: number;
	info: string;
	/** Content lines with the quote prefix and fence indentation removed. */
	body: string[];
}

const OPEN_FENCE = /^((?:[ \t]*>[ \t]?)*)([ \t]*)(`{3,}|~{3,})(.*)$/;

function stripQuote(line: string, depth: number): string | undefined {
	let rest = line;
	for (let d = 0; d < depth; d++) {
		const m = /^[ \t]*>[ \t]?/.exec(rest);
		if (!m) return undefined;
		rest = rest.slice(m[0].length);
	}
	return rest;
}

function stripIndent(line: string, indent: number): string {
	let i = 0;
	while (i < indent && i < line.length && (line[i] === " " || line[i] === "\t")) i++;
	return line.slice(i);
}

/**
 * Finds fenced code blocks (``` and ~~~) following CommonMark's fence rules, including
 * blocks inside blockquotes/callouts and list items. Indented code is not considered.
 */
export function findFencedBlocks(lines: string[]): FencedBlock[] {
	const blocks: FencedBlock[] = [];
	let i = 0;
	while (i < lines.length) {
		const m = OPEN_FENCE.exec(lines[i]);
		if (!m || (m[3][0] === "`" && m[4].includes("`"))) {
			i++;
			continue;
		}
		const quotePrefix = m[1];
		const depth = (quotePrefix.match(/>/g) ?? []).length;
		const indent = m[2].length;
		const fence = m[3];
		const close = new RegExp(`^[ \\t]*${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);

		const body: string[] = [];
		let j = i + 1;
		let closed = false;
		for (; j < lines.length; j++) {
			const inner = stripQuote(lines[j], depth);
			if (inner === undefined) break; // the quote ended, so does the block
			if (close.test(inner)) {
				closed = true;
				break;
			}
			body.push(stripIndent(inner, indent));
		}
		const closeLine = closed ? j : j - 1;
		blocks.push({ openLine: i, closeLine, closed, quotePrefix, indent, info: m[4], body });
		i = closeLine + 1;
	}
	return blocks;
}

/** Splits code text into lines the way it is displayed (a single trailing newline adds no line). */
export function codeLines(text: string): string[] {
	const lines = text.split("\n");
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

/**
 * Picks the source block for each rendered code element. Matching is by content, so it
 * survives sections that contain several blocks (callouts, lists) and blocks rendered by
 * other plugins (which have no code element). Falls back to order when counts agree.
 */
export function matchBlocks(
	codeTexts: string[],
	blocks: FencedBlock[],
	fallbackToOrder = true
): (FencedBlock | undefined)[] {
	const used = new Set<FencedBlock>();
	const result = codeTexts.map((text) => {
		const want = codeLines(text).join("\n").replace(/\s+$/, "");
		const hit = blocks.find((b) => !used.has(b) && b.body.join("\n").replace(/\s+$/, "") === want);
		if (hit) used.add(hit);
		return hit;
	});
	if (fallbackToOrder && result.some((b) => b === undefined) && codeTexts.length === blocks.length) {
		return blocks.slice();
	}
	return result;
}

/** Number of characters the widest line label needs, e.g. 3 for labels up to 999. */
export function labelWidth(start: number, lineCount: number): number {
	const last = start + Math.max(lineCount, 1) - 1;
	return Math.max(String(start).length, String(last).length);
}
