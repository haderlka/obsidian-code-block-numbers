import { test } from "node:test";
import assert from "node:assert/strict";
import {
	codeLines,
	findFencedBlocks,
	isHighlighted,
	labelWidth,
	matchBlocks,
	parseFenceInfo,
	parseRanges,
	resolveOptions,
} from "../src/fence.ts";

test("language stays the first word", () => {
	assert.equal(parseFenceInfo("python").language, "python");
	assert.equal(parseFenceInfo("python title=a.py").language, "python");
	assert.equal(parseFenceInfo("").language, "");
	assert.equal(parseFenceInfo("title=a.py").language, "");
	assert.equal(parseFenceInfo("ln").language, "");
});

test("all options together", () => {
	const o = parseFenceInfo(`python title="utils/my math.py" start=10 hl=10,12-14`);
	assert.equal(o.title, "utils/my math.py");
	assert.equal(o.start, 10);
	assert.deepEqual(o.highlight, [
		{ from: 10, to: 10 },
		{ from: 12, to: 14 },
	]);
	assert.equal(o.numbers, undefined);
});

test("synonyms, colon syntax and single quotes", () => {
	const o = parseFenceInfo(`js file:'a b.js' highlight:"3, 5..6"`);
	assert.equal(o.title, "a b.js");
	assert.deepEqual(o.highlight, [
		{ from: 3, to: 3 },
		{ from: 5, to: 6 },
	]);
	assert.equal(parseFenceInfo("js filename=x.js").title, "x.js");
	assert.equal(parseFenceInfo("js title:x.js").title, "x.js");
});

test("ln switches numbering", () => {
	assert.equal(parseFenceInfo("js ln").numbers, true);
	assert.equal(parseFenceInfo("js ln=false").numbers, false);
	assert.equal(parseFenceInfo("js ln:off").numbers, false);
	assert.equal(parseFenceInfo("js ln=0").numbers, false);
	assert.equal(parseFenceInfo("js ln=true").numbers, true);
});

test("ln:<number> means numbers on, starting there (Code Styler style)", () => {
	const o = parseFenceInfo("js ln:25");
	assert.equal(o.numbers, true);
	assert.equal(o.start, 25);
	assert.equal(parseFenceInfo("js start=3 ln:25").start, 3);
});

test("Execute Code arguments in braces are ignored", () => {
	const o = parseFenceInfo(`python {label="run", pre="x=1"} title=a.py hl=2`);
	assert.equal(o.language, "python");
	assert.equal(o.title, "a.py");
	assert.deepEqual(o.highlight, [{ from: 2, to: 2 }]);
});

test("unknown words and broken values are ignored", () => {
	const o = parseFenceInfo("js foo bar=baz start=abc hl=x,4");
	assert.equal(o.start, undefined);
	assert.deepEqual(o.highlight, [{ from: 4, to: 4 }]);
});

test("parseRanges", () => {
	assert.deepEqual(parseRanges("7-5"), [{ from: 5, to: 7 }]);
	assert.deepEqual(parseRanges("{1,3}"), [
		{ from: 1, to: 1 },
		{ from: 3, to: 3 },
	]);
	assert.deepEqual(parseRanges("-2--1"), [{ from: -2, to: -1 }]);
});

test("resolveOptions: defaults and start", () => {
	assert.deepEqual(resolveOptions(parseFenceInfo("js"), true), { numbers: true, start: 1, title: "", highlight: [] });
	assert.equal(resolveOptions(parseFenceInfo("js"), false).numbers, false);
	assert.equal(resolveOptions(parseFenceInfo("js start=4"), false).numbers, true);
	assert.equal(resolveOptions(parseFenceInfo("js ln=false start=4"), true).numbers, false);
	assert.equal(resolveOptions(parseFenceInfo("js ln"), false).numbers, true);
});

test("highlight refers to line labels", () => {
	const o = resolveOptions(parseFenceInfo("js start=10 hl=10,12-13"), true);
	assert.deepEqual(
		[10, 11, 12, 13, 14].map((l) => isHighlighted(l, o.highlight)),
		[true, false, true, true, false]
	);
});

test("findFencedBlocks: backticks, tildes, longer fences, unclosed", () => {
	const src = [
		"text",
		"```python title=a.py",
		"a",
		"~~~",
		"```",
		"~~~~",
		"````",
		"```",
		"~~~~~",
		"```js",
		"x",
	];
	const blocks = findFencedBlocks(src);
	assert.equal(blocks.length, 3);
	assert.deepEqual(
		blocks.map((b) => [b.openLine, b.closeLine, b.closed, b.info, b.body]),
		[
			[1, 4, true, "python title=a.py", ["a", "~~~"]],
			[5, 8, true, "", ["````", "```"]],
			[9, 10, false, "js", ["x"]],
		]
	);
});

test("findFencedBlocks: backtick info must not contain backticks", () => {
	assert.equal(findFencedBlocks(["```a`b", "x", "```"]).length, 1);
	assert.equal(findFencedBlocks(["```a`b", "x", "```"])[0].openLine, 2);
});

test("findFencedBlocks: callouts and lists", () => {
	const src = ["> [!note]", "> ```js hl=1", "> one", ">", "> ```", "", "- item", "  ```py", "  two", "  ```"];
	const blocks = findFencedBlocks(src);
	assert.equal(blocks.length, 2);
	assert.equal(blocks[0].quotePrefix, "> ");
	assert.deepEqual(blocks[0].body, ["one", ""]);
	assert.equal(blocks[1].indent, 2);
	assert.deepEqual(blocks[1].body, ["two"]);
});

test("findFencedBlocks: a quoted block ends with the quote", () => {
	const blocks = findFencedBlocks(["> ```", "> a", "b"]);
	assert.equal(blocks[0].closed, false);
	assert.equal(blocks[0].closeLine, 1);
});

test("codeLines drops one trailing newline", () => {
	assert.deepEqual(codeLines("a\nb\n"), ["a", "b"]);
	assert.deepEqual(codeLines("a\n\n"), ["a", ""]);
	assert.deepEqual(codeLines(""), [""]);
});

test("matchBlocks by content, then by order", () => {
	const blocks = findFencedBlocks(["```a", "1", "```", "```mermaid", "graph", "```", "```b", "2", "```"]);
	const m = matchBlocks(["2\n", "1\n"], blocks);
	assert.deepEqual(
		m.map((b) => b?.info),
		["b", "a"]
	);
	const fallback = matchBlocks(["x", "y", "z"], blocks);
	assert.deepEqual(
		fallback.map((b) => b?.info),
		["a", "mermaid", "b"]
	);
	assert.deepEqual(matchBlocks(["nope"], blocks), [undefined]);
	assert.deepEqual(matchBlocks(["x", "y", "z"], blocks, false), [undefined, undefined, undefined]);
});

test("labelWidth", () => {
	assert.equal(labelWidth(1, 9), 1);
	assert.equal(labelWidth(1, 10), 2);
	assert.equal(labelWidth(95, 10), 3);
	assert.equal(labelWidth(-10, 2), 3);
});
