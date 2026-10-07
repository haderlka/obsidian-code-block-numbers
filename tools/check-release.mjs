// Checks the Obsidian directory submission rules that ESLint doesn't cover. Part of `npm run lint`.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(root, f), "utf8");
const errors = [];
const fail = (msg) => errors.push(msg);

const manifest = JSON.parse(read("manifest.json"));
const pkg = JSON.parse(read("package.json"));
const versions = JSON.parse(read("versions.json"));

// id: lowercase letters, digits and dashes; no "obsidian"; doesn't end with "plugin".
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.id)) fail(`manifest id "${manifest.id}" must be lowercase words joined by dashes`);
if (/obsidian/i.test(manifest.id) || /plugin$/i.test(manifest.id)) fail(`manifest id must not contain "obsidian" or end with "plugin"`);

// name: Basic Latin, only - + ( ) as punctuation, no "Obsidian"/"Plugin".
if (!/^[A-Za-z0-9 \-+()]+$/.test(manifest.name)) fail(`manifest name "${manifest.name}" may only use letters, digits, spaces and - + ( )`);
if (/obsidian|plugin/i.test(manifest.name)) fail(`manifest name must not contain "Obsidian" or "Plugin"`);

// description: one plain sentence.
const desc = manifest.description;
if (/^this plugin/i.test(desc)) fail(`manifest description must not start with "This plugin"`);
if (/https?:\/\//.test(desc)) fail("manifest description must not contain links");

// Versions: x.y.z, no "v", in sync everywhere.
const semver = /^\d+\.\d+\.\d+$/;
if (!semver.test(manifest.version)) fail(`manifest version "${manifest.version}" must be x.y.z`);
if (!semver.test(manifest.minAppVersion)) fail(`minAppVersion "${manifest.minAppVersion}" must be x.y.z`);
if (pkg.version !== manifest.version) fail(`package.json version ${pkg.version} != manifest version ${manifest.version}`);
if (versions[manifest.version] !== manifest.minAppVersion) {
	fail(`versions.json must map ${manifest.version} to ${manifest.minAppVersion}`);
}
if (!readFileSync(join(root, ".npmrc"), "utf8").includes('tag-version-prefix=""')) fail('.npmrc needs tag-version-prefix=""');

// Donations (the user's rule for all plugins).
const COFFEE = "https://buymeacoffee.com/haderlka";
if (manifest.fundingUrl !== COFFEE) fail(`manifest fundingUrl must be ${COFFEE}`);
const readme = existsSync(join(root, "README.md")) ? read("README.md") : "";
if (!readme) fail("README.md is missing");
if (!readme.includes(`](${COFFEE})`)) fail("README.md needs the Buy Me a Coffee button");
// The community site removes images whose URL contains "buymeacoffee" (also from raw.githubusercontent).
for (const m of readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)|<img[^>]+src="([^"]+)"/g)) {
	if (/buymeacoffee/i.test(m[1] ?? m[2])) fail(`README image ${m[1] ?? m[2]} contains "buymeacoffee"; the community site drops it`);
}
// The button (an image hosted in docs/, linked to Buy Me a Coffee) goes at the top, before the
// first section heading. No extra text link: the user removed it on purpose.
const firstSection = readme.search(/^## /m);
const top = firstSection === -1 ? readme : readme.slice(0, firstSection);
const button = /\[!\[[^\]]*\]\(https:\/\/raw\.githubusercontent\.com\/[^)]+\/docs\/[^)]+\)\]\(https:\/\/buymeacoffee\.com\/haderlka\)/;
if (!button.test(top)) {
	fail("put the Buy Me a Coffee button (image from docs/, linked to buymeacoffee.com) at the top of README.md, before the first ## heading");
}
if (/!\[[^\]]*\]\((?!https:\/\/)/.test(readme)) fail("README images need absolute URLs");
if (!existsSync(join(root, "LICENSE"))) fail("LICENSE is missing");

// CSS: the review flags !important.
const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
if (/!\s*important/i.test(css)) fail("styles.css must not use !important");

if (errors.length > 0) {
	for (const e of errors) console.error(`✖ ${e}`);
	process.exit(1);
}
console.log("Submission checks passed.");
