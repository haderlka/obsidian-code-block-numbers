// Parsers that let the official obsidianmd rules `validate-manifest` and `validate-license`
// run locally. Both rules expect an ESTree `Program`, but the recommended config never
// applies them to manifest.json / LICENSE (see obsidianmd/eslint-plugin#191).
import * as espree from "espree";

/** Parses a JSON file as one expression statement (`{…}`), the shape validate-manifest expects. */
export const jsonExpressionParser = {
	meta: { name: "json-expression-parser", version: "1.0.0" },
	parseForESLint(text) {
		// Wrap in parentheses so `{` starts an object literal, then shift positions back.
		const ast = espree.parse(`(${text}\n)`, {
			ecmaVersion: "latest",
			range: true,
			loc: true,
			tokens: true,
			comment: true,
		});
		const seen = new Set();
		const shift = (node) => {
			if (!node || typeof node !== "object" || seen.has(node)) return;
			seen.add(node);
			if (Array.isArray(node.range)) node.range = node.range.map((n) => Math.max(0, Math.min(text.length, n - 1)));
			if (typeof node.start === "number") node.start = Math.max(0, node.start - 1);
			if (typeof node.end === "number") node.end = Math.min(text.length, node.end - 1);
			if (node.loc) {
				for (const p of [node.loc.start, node.loc.end]) if (p.line === 1) p.column = Math.max(0, p.column - 1);
			}
			for (const key of Object.keys(node)) if (key !== "loc" && key !== "parent") shift(node[key]);
		};
		shift(ast);
		const parens = new Set(["(", ")"]);
		ast.tokens = ast.tokens.filter((t, i, all) => !(parens.has(t.value) && (i === 0 || i === all.length - 1)));
		ast.range = [0, text.length];
		ast.start = 0;
		ast.end = text.length;
		const lines = text.split("\n");
		ast.loc = { start: { line: 1, column: 0 }, end: { line: lines.length, column: lines[lines.length - 1].length } };
		return { ast, visitorKeys: espree.VisitorKeys };
	},
};

/** Treats each line as a `Line` token, like the plugin's internal plain-text parser. */
export const plainTextParser = {
	meta: { name: "plain-text-parser", version: "1.0.0" },
	parseForESLint(text) {
		const lines = text.split("\n");
		let index = 0;
		const tokens = lines.map((line, i) => {
			const token = {
				type: "Line",
				value: line,
				range: [index, index + line.length],
				loc: { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: line.length } },
			};
			index += line.length + 1;
			return token;
		});
		return {
			ast: {
				type: "Program",
				sourceType: "script",
				range: [0, text.length],
				loc: { start: { line: 1, column: 0 }, end: tokens[tokens.length - 1].loc.end },
				body: [],
				comments: [],
				tokens,
			},
			visitorKeys: { Program: [] },
		};
	},
};
