#!/usr/bin/env bun
/**
 * scripts/sync-upstream.ts
 *
 * Synchronizes and audits extensions against upstream `pi-open-tui`. The integrated version is the
 * "pi-open-tui (vX.Y.Z" marker in extensions/index.ts; intentional local changes are listed in
 * INTENTIONAL_CUSTOMIZATIONS and LOCAL_ONLY_FILES below.
 *
 * Commands:
 *   bun run sync:check   # Compare integrated version with latest on npm
 *   bun run sync         # Audit local customizations, or report upstream changes (writes nothing)
 *   bun run sync:apply   # Copy unchanged upstream updates and auto-merge local changes (git merge-file)
 *   bun scripts/sync-upstream.ts --diff <file>  # Diff a local file against upstream at the integrated version
 *
 * The version marker only moves once no conflicts are left. On conflicts the downloaded upstream copies
 * are kept for `git merge-file`.
 */

import { execSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT_DIR = join(import.meta.dirname, "..");
const EXT_DIR = join(ROOT_DIR, "extensions");
const INDEX_PATH = join(EXT_DIR, "index.ts");
const PACKAGE = "pi-open-tui";
const MARKER = /(pi-open-tui \(v)(\d+\.\d+\.\d+)/;

/** Files known to have intentional local customizations. */
const INTENTIONAL_CUSTOMIZATIONS: Record<string, string> = {
	"footer.ts": "progress bar uses centered squares (▪/▫)",
	"header.ts": "slash command tip is /pi-tui",
	"config.ts": "config file pi-tui.json & roundedTools option",
	"settings-command.ts": "/pi-tui command & roundedTools toggle",
	"index.ts": "roundedTools manager wiring & banner",
};

/** Files that exist only in this repo and have no upstream counterpart. */
const LOCAL_ONLY_FILES = new Set(["rounded-tools.ts"]);

function fail(message: string): never {
	throw new Error(message);
}

function integratedVersion(): string {
	const content = readFileSync(INDEX_PATH, "utf8");
	return MARKER.exec(content)?.[2] ?? fail(`no "${PACKAGE} (vX.Y.Z" marker in extensions/index.ts`);
}

function latestVersion(): string {
	let out = "";
	try {
		out = execSync(`npm view ${PACKAGE} version`, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	} catch (error) {
		// Surface npm's own reason (offline, cache permissions, ...) instead of a generic message
		const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
		fail(`cannot read latest version from npm registry${stderr ? `\n${stderr}` : ""}`);
	}
	return /^\d+\.\d+\.\d+$/.test(out) ? out : fail(`unexpected npm version output: ${JSON.stringify(out)}`);
}

function isNewer(a: string, b: string): boolean {
	const [x, y] = [a, b].map((v) => v.split(".").map(Number)) as [number[], number[]];
	const idx = x.findIndex((val, k) => val !== y[k]);
	return idx >= 0 && x[idx]! > y[idx]!;
}

const filesIn = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isFile())
		.map((e) => e.name);

const read = (path: string): string | undefined =>
	existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : undefined;

/** Download pi-open-tui@version into workDir/label and return directory with LF-normalized files. */
function fetchUpstream(version: string, label: string, workDir: string): string {
	const pack = join(workDir, `${label}.pack`);
	mkdirSync(pack, { recursive: true });
	execSync(`npm pack ${PACKAGE}@${version} --pack-destination "${pack}" --quiet`, {
		stdio: ["ignore", "ignore", "inherit"],
	});
	const tgz = readdirSync(pack).find((f) => f.endsWith(".tgz")) ?? fail(`could not download ${PACKAGE}@${version}`);
	execSync(`tar -xzf "${join(pack, tgz)}" -C "${pack}"`);
	const source = join(pack, "package", "extensions", "open-tui");
	if (!existsSync(source)) fail(`${PACKAGE}@${version} missing extensions/open-tui directory`);
	const dest = join(workDir, label);
	renameSync(source, dest);
	rmSync(pack, { recursive: true, force: true });
	// Upstream ships CRLF files; normalize to LF for reliable comparison and merging
	for (const file of filesIn(dest)) {
		const p = join(dest, file);
		writeFileSync(p, read(p)!);
	}
	return dest;
}

/** 3-way merge via `git merge-file -p` without writing to disk. `merged` is only usable when `clean`. */
function try3WayMerge(currentPath: string, basePath: string, otherPath: string): { clean: boolean; merged: string } {
	const res = spawnSync("git", ["merge-file", "-p", currentPath, basePath, otherPath], {
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
	});
	// Exit status is the number of conflicts (capped at 127); anything else is a git error
	if (res.error || res.status === null || res.status > 127) {
		fail(`git merge-file failed: ${res.error?.message ?? res.stderr.trim()}`);
	}
	return { clean: res.status === 0, merged: res.stdout };
}

/** Show git diff between upstream copy and local file */
function showDiff(upstreamFile: string, localFile: string, label: string) {
	console.log(`\n--- diff: ${label} ---`);
	const res = spawnSync("git", ["diff", "--no-index", "--color", upstreamFile, localFile], {
		encoding: "utf8",
		stdio: ["ignore", "inherit", "inherit"],
	});
	if (res.status === 0) {
		console.log("  (no differences)");
	}
}

function auditCurrentVersion(integrated: string, workDir: string, diffTarget?: string) {
	const baseDir = fetchUpstream(integrated, "current-base", workDir);
	const upstreamFiles = new Set(filesIn(baseDir));
	const localFiles = new Set(filesIn(EXT_DIR));

	console.log(`\n=== Extension Audit vs upstream ${PACKAGE}@${integrated} ===`);

	const identical: string[] = [];
	const customized: { file: string; note: string; unexpected: boolean }[] = [];
	const lostCustomizations: string[] = [];
	const missingLocal: string[] = [];
	const extraLocal: string[] = [];

	for (const file of localFiles) {
		if (LOCAL_ONLY_FILES.has(file)) continue;
		if (!upstreamFiles.has(file)) {
			extraLocal.push(file);
			continue;
		}
		const note = INTENTIONAL_CUSTOMIZATIONS[file];
		if (read(join(baseDir, file)) === read(join(EXT_DIR, file))) {
			identical.push(file);
			if (note) lostCustomizations.push(file);
		} else {
			customized.push({
				file,
				note: note ?? "UNEXPECTED DRIFT (not in known customization list)",
				unexpected: !note,
			});
		}
	}

	for (const file of upstreamFiles) {
		if (!localFiles.has(file)) missingLocal.push(file);
		if (LOCAL_ONLY_FILES.has(file)) extraLocal.push(`${file} (also exists upstream)`);
	}

	console.log(`  Identical (${identical.length} files): ${identical.sort().join(", ")}`);
	console.log(`  Local-only: ${[...LOCAL_ONLY_FILES].join(", ")}`);

	if (customized.length > 0) {
		console.log(`\n  Customized (${customized.length} files):`);
		for (const { file, note, unexpected } of customized) {
			const prefix = unexpected ? "  [!] DRIFT   " : "  [*] EXPECTED";
			console.log(`    ${prefix} ${file.padEnd(20)} - ${note}`);
		}
	}

	if (lostCustomizations.length > 0) {
		console.log(`\n  [!] Expected customizations missing (identical to upstream): ${lostCustomizations.join(", ")}`);
	}
	if (extraLocal.length > 0) {
		console.log(`\n  [!] Unexpected local files: ${extraLocal.join(", ")}`);
	}
	if (missingLocal.length > 0) {
		console.log(`\n  [!] Missing upstream files: ${missingLocal.join(", ")}`);
	}

	if (diffTarget) {
		const targetFile = diffTarget.replace(/^extensions\//, "");
		const uPath = join(baseDir, targetFile);
		const lPath = join(EXT_DIR, targetFile);
		if (existsSync(uPath) && existsSync(lPath)) {
			showDiff(uPath, lPath, targetFile);
		} else {
			console.log(`Cannot diff: ${targetFile} not found in upstream or local`);
		}
	} else if (customized.some((c) => c.unexpected)) {
		console.log("\nRun `bun scripts/sync-upstream.ts --diff <file>` to inspect unexpected drift.");
	}
}

/** Returns true when conflicts remain and the downloaded upstream copies should be kept. */
function handleUpgrade(integrated: string, latest: string, apply: boolean, workDir: string): boolean {
	console.log(`\n=== Upstream changes v${integrated} -> v${latest} ===`);
	const baseDir = fetchUpstream(integrated, "base", workDir);
	const latestDir = fetchUpstream(latest, "latest", workDir);

	const allFiles = [...new Set([...filesIn(baseDir), ...filesIn(latestDir)])].sort();

	const cleanCopies: string[] = [];
	const autoMerges: { file: string; merged: string }[] = [];
	const conflicts: { file: string; reason: string; mergeable: boolean }[] = [];
	let unchanged = 0;

	const show = (tag: string, file: string, note: string) => console.log(`  ${`[${tag}]`.padEnd(13)} ${file} (${note})`);
	const conflict = (file: string, reason: string, mergeable = false) => {
		conflicts.push({ file, reason, mergeable });
		show("conflict", file, reason);
	};

	for (const file of allFiles) {
		const was = read(join(baseDir, file)); // upstream v_base
		const now = read(join(latestDir, file)); // upstream v_latest
		const mine = read(join(EXT_DIR, file)); // local copy

		if (was === now) {
			unchanged++;
		} else if (now === undefined) {
			// Removed upstream: only matters while the local copy still exists
			if (mine !== undefined) conflict(file, "removed upstream, still present locally");
		} else if (mine === now) {
			show("current", file, "already matches latest");
		} else if (mine === undefined) {
			if (was === undefined) {
				cleanCopies.push(file);
				show("new", file, "added upstream");
			} else {
				conflict(file, "deleted locally, changed upstream");
			}
		} else if (mine === was) {
			cleanCopies.push(file);
			show("copy", file, "no local changes");
		} else if (was === undefined) {
			conflict(file, LOCAL_ONLY_FILES.has(file) ? "upstream added a file with a local-only name" : "added upstream, differs locally");
		} else {
			const { clean, merged } = try3WayMerge(join(EXT_DIR, file), join(baseDir, file), join(latestDir, file));
			if (clean) {
				autoMerges.push({ file, merged });
				show("auto-merge", file, "clean 3-way merge");
			} else {
				conflict(file, "has merge conflicts", true);
			}
		}
	}

	console.log(`  ${unchanged} upstream file(s) unchanged`);
	console.log(
		`\nDirect update: ${cleanCopies.length}, auto-merge: ${autoMerges.length}, conflicts: ${conflicts.length}`,
	);

	if (!apply) {
		if (cleanCopies.length + autoMerges.length > 0 || conflicts.length === 0) {
			console.log("Run `bun run sync:apply` to apply updates and merges.");
		}
		return false;
	}

	console.log("\nApplying changes...");
	for (const file of cleanCopies) {
		copyFileSync(join(latestDir, file), join(EXT_DIR, file));
	}
	for (const { file, merged } of autoMerges) {
		writeFileSync(join(EXT_DIR, file), merged);
	}
	if (autoMerges.length > 0) {
		console.log(`Review auto-merged files with \`git diff\`: ${autoMerges.map((m) => m.file).join(", ")}`);
	}

	if (conflicts.length === 0) {
		const updatedIndex = readFileSync(INDEX_PATH, "utf8").replace(MARKER, (_m, prefix) => `${prefix}${latest}`);
		writeFileSync(INDEX_PATH, updatedIndex);
		console.log(`Updated integrated version marker to v${latest}`);
	}

	if (cleanCopies.length + autoMerges.length > 0 || conflicts.length === 0) {
		console.log("\nRunning validation...");
		execSync("bun run check", { cwd: ROOT_DIR, stdio: "inherit" });
		execSync("bun test", { cwd: ROOT_DIR, stdio: "inherit" });
	}

	if (conflicts.length === 0) {
		console.log(`\nSuccessfully upgraded to ${PACKAGE}@${latest}!`);
		return false;
	}

	console.log(`\n[!] ${conflicts.length} conflict(s) must be resolved manually. Upstream copies kept in ${workDir}`);
	for (const { file, reason, mergeable } of conflicts) {
		if (mergeable) {
			console.log(`    git merge-file extensions/${file} "${join(baseDir, file)}" "${join(latestDir, file)}"`);
		} else {
			console.log(`    ${file}: ${reason} (compare ${join(baseDir, file)} and ${join(latestDir, file)})`);
		}
	}
	console.log(`After resolving, update the marker in extensions/index.ts to v${latest} and run tests.`);
	return true;
}

function main() {
	const args = process.argv.slice(2);
	const checkOnly = args.includes("--check");
	const apply = args.includes("--apply");
	const diffArgIndex = args.indexOf("--diff");
	const diffTarget = diffArgIndex === -1 ? undefined : args[diffArgIndex + 1];
	if (diffArgIndex !== -1 && (!diffTarget || diffTarget.startsWith("--"))) fail("--diff requires a file name");

	const integrated = integratedVersion();
	const latest = latestVersion();
	const updateAvailable = isNewer(latest, integrated);
	console.log(`${PACKAGE}: integrated v${integrated}, npm latest v${latest}`);

	if (checkOnly) {
		console.log(
			updateAvailable
				? `Update available: v${integrated} -> v${latest}. Run \`bun run sync\` to inspect.`
				: "Up to date with upstream.",
		);
		return;
	}

	const workDir = mkdtempSync(join(tmpdir(), "pi-tui-sync-"));
	let keepWorkDir = false;
	try {
		// --diff always compares against the integrated version, even when an update is available
		if (!updateAvailable || diffTarget) {
			auditCurrentVersion(integrated, workDir, diffTarget);
		} else {
			keepWorkDir = handleUpgrade(integrated, latest, apply, workDir);
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
