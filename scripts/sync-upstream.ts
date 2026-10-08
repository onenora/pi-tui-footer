#!/usr/bin/env bun
/**
 * scripts/sync-upstream.ts
 *
 * Tracks pi-open-tui, the upstream this extension is integrated from. The integrated version is the
 * "pi-open-tui (vX.Y.Z" marker in extensions/index.ts. pi-rounded-tools is not tracked: the local
 * rounded-tools.ts is built on pi.registerToolRenderer(), so there is nothing to merge from upstream.
 *
 * Usage:
 *   bun run sync:check   # compare the integrated version with the latest on npm
 *   bun run sync         # download both versions and report what changed upstream (writes nothing)
 *   bun run sync:apply   # also copy upstream changes into files that have no local changes
 *
 * A file is only overwritten while it is still identical to upstream's copy at the integrated version.
 * Files with local changes are listed for a manual merge, the version marker stays put until none are
 * left, and the downloaded copies are kept for `git merge-file`.
 */

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT_DIR = join(import.meta.dirname, "..");
const EXT_DIR = join(ROOT_DIR, "extensions");
const INDEX_PATH = join(EXT_DIR, "index.ts");
const PACKAGE = "pi-open-tui";
const MARKER = /(pi-open-tui \(v)(\d+\.\d+\.\d+)/;

function fail(message: string): never {
	throw new Error(message);
}

function integratedVersion(): string {
	return MARKER.exec(readFileSync(INDEX_PATH, "utf8"))?.[2] ?? fail(`no "${PACKAGE} (vX.Y.Z" marker in extensions/index.ts`);
}

function latestVersion(): string {
	let version = "";
	try {
		version = execSync(`npm view ${PACKAGE} version`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		// reported below
	}
	return /^\d+\.\d+\.\d+$/.test(version) ? version : fail("cannot read the latest version from the npm registry");
}

function isNewer(a: string, b: string): boolean {
	const [x, y] = [a, b].map((version) => version.split(".").map(Number)) as [number[], number[]];
	const i = x.findIndex((part, k) => part !== y[k]);
	return i >= 0 && x[i]! > y[i]!;
}

const filesIn = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
const read = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : undefined);

/** Download pi-open-tui@version into workDir/label and return the directory with its extension files. */
function fetchUpstream(version: string, label: string, workDir: string): string {
	const pack = join(workDir, `${label}.pack`);
	mkdirSync(pack);
	execSync(`npm pack ${PACKAGE}@${version} --pack-destination "${pack}" --quiet`, { stdio: ["ignore", "ignore", "inherit"] });
	const tgz = readdirSync(pack).find((file) => file.endsWith(".tgz")) ?? fail(`could not download ${PACKAGE}@${version}`);
	execSync(`tar -xzf "${join(pack, tgz)}" -C "${pack}"`);
	const source = join(pack, "package", "extensions", "open-tui");
	if (!existsSync(source)) fail(`${PACKAGE}@${version} has no extensions/open-tui directory`);
	const dest = join(workDir, label);
	renameSync(source, dest);
	rmSync(pack, { recursive: true, force: true });
	// Upstream ships CRLF files; this repo is LF. Normalize so comparing, copying and merging all agree.
	for (const file of filesIn(dest)) writeFileSync(join(dest, file), read(join(dest, file))!);
	return dest;
}

function main() {
	const args = process.argv.slice(2);
	const checkOnly = args.includes("--check");
	const apply = args.includes("--apply");

	const integrated = integratedVersion();
	const latest = latestVersion();
	console.log(`${PACKAGE}: integrated v${integrated}, npm latest v${latest}`);
	if (integrated === latest) {
		console.log("Up to date.");
		return;
	}
	if (isNewer(integrated, latest)) {
		console.log("The integrated version is newer than npm's latest; nothing to do.");
		return;
	}
	if (checkOnly) {
		console.log("Update available. Run `bun run sync` to see what changed upstream.");
		return;
	}

	const workDir = mkdtempSync(join(tmpdir(), "pi-tui-sync-"));
	let keepWorkDir = false;
	try {
		const baseDir = fetchUpstream(integrated, "base", workDir);
		const latestDir = fetchUpstream(latest, "latest", workDir);

		console.log(`\n=== Upstream changes v${integrated} -> v${latest} ===`);
		const updates: string[] = [];
		const merges: string[] = [];
		let unchanged = 0;
		const show = (tag: string, file: string, note = "") => console.log(`${`  [${tag}]`.padEnd(12)} ${file}${note && `  (${note})`}`);

		for (const file of [...new Set([...filesIn(baseDir), ...filesIn(latestDir)])].sort()) {
			const was = read(join(baseDir, file)); // upstream at the integrated version
			const now = read(join(latestDir, file)); // upstream at the latest version
			const mine = read(join(EXT_DIR, file)); // this repo
			if (was === now) {
				unchanged++;
			} else if (now === undefined) {
				if (mine !== undefined) {
					merges.push(file);
					show("removed", file, "removed upstream, still present locally");
				}
			} else if (mine === now) {
				show("current", file, "already matches upstream");
			} else if (mine === undefined && was !== undefined) {
				merges.push(file);
				show("merge", file, "deleted locally, changed upstream");
			} else if (mine === undefined || mine === was) {
				updates.push(file);
				show(mine === undefined ? "new" : "update", file);
			} else {
				merges.push(file);
				show("merge", file, "has local changes");
			}
		}
		console.log(`  ${unchanged} upstream file(s) unchanged`);

		const bump = merges.length === 0;
		if (!apply) {
			if (updates.length > 0 || bump) console.log(`\nRun \`bun run sync:apply\` to copy the updates${bump ? " and set the version marker" : ""}.`);
		} else {
			for (const file of updates) copyFileSync(join(latestDir, file), join(EXT_DIR, file));
			if (bump) writeFileSync(INDEX_PATH, readFileSync(INDEX_PATH, "utf8").replace(MARKER, (_match, prefix) => `${prefix}${latest}`));
			console.log(`\nCopied ${updates.length} file(s).${bump ? ` Version marker set to v${latest}.` : ""}`);
			if (updates.length > 0 || bump) execSync("bun run check", { cwd: ROOT_DIR, stdio: "inherit" });
		}

		if (merges.length > 0) {
			keepWorkDir = true;
			console.log(`\nNeeds a manual merge: ${merges.join(", ")}`);
			console.log(`  Upstream copies are kept in ${workDir}. Merge each file, for example:`);
			console.log(`    git merge-file extensions/<file> "${join(workDir, "base")}/<file>" "${join(workDir, "latest")}/<file>"`);
			console.log(`  then set the "${PACKAGE} (v..." marker in extensions/index.ts to v${latest}.`);
		}
	} finally {
		if (!keepWorkDir) rmSync(workDir, { recursive: true, force: true });
	}
}

try {
	main();
} catch (error) {
	console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
