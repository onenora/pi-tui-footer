#!/usr/bin/env bun
/**
 * scripts/sync-upstream.ts
 *
 * Automated helper to inspect and synchronize upstream pi-open-tui & pi-rounded-tools updates.
 *
 * Usage:
 *   bun run sync           # Check versions, download latest pi-open-tui, and show diff / sync status
 *   bun run sync --apply   # Download latest pi-open-tui, update identical files, and preserve local integrations
 *   bun run sync --check   # Check if upstream has newer versions available
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT_DIR = join(import.meta.dirname, "..");
const EXT_DIR = join(ROOT_DIR, "extensions");

// Files that are 100% upstream-identical and safe to copy directly from open-tui
const PURE_UPSTREAM_FILES = [
	"editor.ts",
	"fullscreen-scroll.ts",
	"git.ts",
	"header.ts",
	"icons.ts",
	"peek.ts",
	"runtime.ts",
	"session-lifecycle.ts",
	"state.ts",
	"telemetry.ts",
	"utils.ts",
];

// Files that have custom integrations (rounded-tools, customized icons, etc.)
// These require patch preservation or manual verification
const INTEGRATION_FILES = [
	"config.ts",           // Has LocalFeatureConfig (roundedTools)
	"footer.ts",           // Has half-height parallelogram blocks (▰/▱)
	"index.ts",            // Has roundedTools lifecycle hooks
	"settings-command.ts", // Has roundedTools settings row & dual command registration
	"rounded-tools.ts",    // Local-only module from pi-rounded-tools
];

function run(cmd: string): string {
	try {
		return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
	} catch (err) {
		return "";
	}
}

function getLatestNpmVersion(pkg: string): string {
	return run(`npm view ${pkg} version 2>/dev/null`) || "unknown";
}

function parseCurrentOpenTuiVersion(): string {
	const content = readFileSync(join(EXT_DIR, "rounded-tools.ts"), "utf8");
	const match = content.match(/pi-open-tui\s+v?(\d+\.\d+\.\d+)/);
	return match ? match[1]! : "unknown";
}

function parseCurrentRoundedToolsVersion(): string {
	const content = readFileSync(join(EXT_DIR, "rounded-tools.ts"), "utf8");
	const match = content.match(/pi-rounded-tools@(\d+\.\d+\.\d+)/);
	return match ? match[1]! : "unknown";
}

async function main() {
	const args = process.argv.slice(2);
	const checkOnly = args.includes("--check");
	const apply = args.includes("--apply");

	console.log("=== Upstream Version Check ===");
	const curOpenTui = parseCurrentOpenTuiVersion();
	const curRounded = parseCurrentRoundedToolsVersion();
	const latestOpenTui = getLatestNpmVersion("pi-open-tui");
	const latestRounded = getLatestNpmVersion("pi-rounded-tools");

	console.log(`pi-open-tui:     local v${curOpenTui}  ->  npm v${latestOpenTui}`);
	console.log(`pi-rounded-tools: local v${curRounded}  ->  npm v${latestRounded}`);

	const openTuiHasUpdate = latestOpenTui !== "unknown" && latestOpenTui !== curOpenTui;
	const roundedHasUpdate = latestRounded !== "unknown" && latestRounded !== curRounded;

	if (!openTuiHasUpdate && !roundedHasUpdate) {
		console.log("\nAll integrated upstreams are up to date!");
		if (checkOnly || !apply) return;
	} else {
		console.log(`\nUpdates available:${openTuiHasUpdate ? ` [pi-open-tui -> v${latestOpenTui}]` : ""}${roundedHasUpdate ? ` [pi-rounded-tools -> v${latestRounded}]` : ""}`);
	}

	if (checkOnly) return;

	// Prepare temp download directory
	const workDir = join(tmpdir(), `pi-tui-sync-${Date.now()}`);
	mkdirSync(workDir, { recursive: true });

	try {
		console.log(`\nFetching pi-open-tui@${latestOpenTui}...`);
		execSync(`npm pack pi-open-tui@${latestOpenTui} --quiet`, { cwd: workDir, stdio: "inherit" });
		const tgz = readdirSync(workDir).find((f) => f.endsWith(".tgz"));
		if (!tgz) {
			console.error("Failed to download package tarball");
			return;
		}
		execSync(`tar -xzf "${tgz}"`, { cwd: workDir });
		const upstreamDir = join(workDir, "package", "extensions", "open-tui");

		if (!existsSync(upstreamDir)) {
			console.error(`Upstream path not found: ${upstreamDir}`);
			return;
		}

		console.log("\n=== Analyzing Differences ===");

		let modifiedPure = 0;
		for (const file of PURE_UPSTREAM_FILES) {
			const upFile = join(upstreamDir, file);
			const locFile = join(EXT_DIR, file);
			if (!existsSync(upFile)) {
				console.log(`  [Removed upstream] ${file}`);
				continue;
			}
			if (!existsSync(locFile)) {
				console.log(`  [New upstream]     ${file}`);
				if (apply) {
					copyFileSync(upFile, locFile);
					console.log(`    -> Copied ${file}`);
				}
				modifiedPure++;
				continue;
			}
			const upContent = readFileSync(upFile, "utf8").replace(/\r\n/g, "\n");
			const locContent = readFileSync(locFile, "utf8").replace(/\r\n/g, "\n");
			if (upContent !== locContent) {
				console.log(`  [Changed upstream] ${file}`);
				if (apply) {
					writeFileSync(locFile, upContent, "utf8");
					console.log(`    -> Updated ${file}`);
				}
				modifiedPure++;
			} else {
				console.log(`  [Identical]        ${file}`);
			}
		}

		console.log("\n=== Integration Files Status ===");
		for (const file of INTEGRATION_FILES) {
			if (file === "rounded-tools.ts") {
				console.log(`  [Local module]     ${file} (retains rounded tool frames)`);
				continue;
			}
			const upFile = join(upstreamDir, file);
			if (existsSync(upFile)) {
				console.log(`  [Hybrid module]    ${file} (requires verified merge to retain rounded-tools integration)`);
			}
		}

		if (apply) {
			// Ensure half-height parallelogram blocks remain preserved in footer.ts
			const footerPath = join(EXT_DIR, "footer.ts");
			if (existsSync(footerPath)) {
				let footerContent = readFileSync(footerPath, "utf8");
				if (footerContent.includes('"█"') && footerContent.includes('"░"')) {
					footerContent = footerContent
						.replace('const filledCell = ascii ? "#" : "█";', 'const filledCell = ascii ? "#" : "▰";')
						.replace('const emptyCell = ascii ? "-" : "░";', 'const emptyCell = ascii ? "-" : "▱";');
					writeFileSync(footerPath, footerContent, "utf8");
					console.log("  -> Preserved custom ▰/▱ blocks in footer.ts");
				}
			}

			// Update version comments in rounded-tools.ts and index.ts
			const roundedPath = join(EXT_DIR, "rounded-tools.ts");
			if (existsSync(roundedPath)) {
				let roundedContent = readFileSync(roundedPath, "utf8");
				roundedContent = roundedContent.replace(
					/pi-open-tui\s+v?\d+\.\d+\.\d+/,
					`pi-open-tui v${latestOpenTui}`,
				);
				writeFileSync(roundedPath, roundedContent, "utf8");
			}

			const indexPath = join(EXT_DIR, "index.ts");
			if (existsSync(indexPath)) {
				let indexContent = readFileSync(indexPath, "utf8");
				indexContent = indexContent.replace(
					/pi-open-tui\s+\(v\d+\.\d+\.\d+/,
					`pi-open-tui (v${latestOpenTui}`,
				);
				writeFileSync(indexPath, indexContent, "utf8");
			}

			console.log("\nRunning validation test...");
			execSync("bun run check", { cwd: ROOT_DIR, stdio: "inherit" });
			console.log("\nSync applied and validated successfully!");
		} else {
			console.log("\nRun `bun run sync --apply` to apply the updates to pure upstream files.");
		}
	} finally {
		// Clean up temporary files
		try {
			execSync(`node -e 'fs.rmSync(process.argv[1], { recursive: true, force: true })' "${workDir}"`);
		} catch {
			// ignore cleanup errors
		}
	}
}

main().catch(console.error);
