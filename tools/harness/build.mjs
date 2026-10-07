// `npm run harness`: bundles the plugin with an Obsidian shim into tools/harness/.build/
// (serve that folder over http and open page.html). `npm run screenshots` also captures
// docs/*.png with headless Chrome/Edge (set CHROME_PATH if it isn't found).
// Needs internet access for Prism (cdnjs).
import esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const build = join(here, ".build");

rmSync(build, { recursive: true, force: true });
mkdirSync(build, { recursive: true });
await esbuild.build({
	entryPoints: [join(here, "entry.ts")],
	bundle: true,
	format: "iife",
	outfile: join(build, "bundle.js"),
	alias: { obsidian: join(here, "obsidian-shim.ts") },
	logLevel: "warning",
});
copyFileSync(join(here, "page.html"), join(build, "page.html"));
copyFileSync(join(root, "styles.css"), join(build, "styles.css"));
console.log(`Built ${join(build, "page.html")}`);

if (process.argv.includes("--shoot")) {
	// The user prefers dark screenshots.
	const SHOTS = [{ name: "dark", size: [680, 640], query: "theme=dark&only=reading" }];
	const browser = [
		process.env.CHROME_PATH,
		"C:/Program Files/Google/Chrome/Application/chrome.exe",
		"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/usr/bin/google-chrome",
		"/usr/bin/chromium",
	].find((p) => p && existsSync(p));
	if (!browser) throw new Error("No Chrome/Edge found — set CHROME_PATH.");
	mkdirSync(join(root, "docs"), { recursive: true });
	for (const shot of SHOTS) {
		execFileSync(
			browser,
			[
				"--headless=new",
				"--disable-gpu",
				"--hide-scrollbars",
				"--force-device-scale-factor=2",
				`--window-size=${shot.size.join(",")}`,
				"--virtual-time-budget=3000",
				`--user-data-dir=${join(build, "profile")}`,
				`--screenshot=${join(root, "docs", shot.name + ".png")}`,
				`${pathToFileURL(join(build, "page.html")).href}?${shot.query}`,
			],
			{ stdio: "ignore" }
		);
		console.log(`docs/${shot.name}.png`);
	}
}
