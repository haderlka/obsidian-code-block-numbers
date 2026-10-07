// Lints with the same rules the Obsidian community-plugin review uses.
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import { jsonExpressionParser, plainTextParser } from "./tools/eslint-parsers.mjs";

export default defineConfig([
	globalIgnores(["main.js", "node_modules/", "esbuild.config.mjs", "version-bump.mjs", "tests/", "tools/"]),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.mjs"],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	// The review validates manifest.json and LICENSE; the recommended config doesn't reach them.
	{
		files: ["manifest.json"],
		plugins: { obsidianmd },
		languageOptions: { parser: jsonExpressionParser },
		rules: { "obsidianmd/validate-manifest": "error" },
	},
	{
		files: ["LICENSE"],
		plugins: { obsidianmd },
		languageOptions: { parser: plainTextParser },
		rules: { "obsidianmd/validate-license": "error" },
	},
]);
