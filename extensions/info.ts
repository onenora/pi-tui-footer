/** Data the footer shows that pi does not hand over directly: git changes, project runtime, usage totals. */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface GitStatus {
	branch: string | undefined;
	/** Set for a detached HEAD; `oid` and `tag` only when requested. */
	detached: { oid?: string; tag?: string } | undefined;
	ahead: number;
	behind: number;
	conflicted: number;
	deleted: number;
	modified: number;
	renamed: number;
	staged: number;
	untracked: number;
	stashed: number;
}

export interface Runtime {
	name: string;
	version?: string;
}

export interface Totals {
	/** Uncached input: fresh input plus cache writes, as /session counts it. */
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	/** Cache-read share of the latest assistant prompt, in percent. */
	latestCacheHitRate: number | undefined;
}

export const NO_GIT: GitStatus = {
	branch: undefined,
	detached: undefined,
	ahead: 0,
	behind: 0,
	conflicted: 0,
	deleted: 0,
	modified: 0,
	renamed: 0,
	staged: 0,
	untracked: 0,
	stashed: 0,
};

const git = async (pi: ExtensionAPI, cwd: string, args: string[]): Promise<string | undefined> => {
	const res = await pi.exec("git", args, { cwd, timeout: 2000 }).catch(() => undefined);
	return res?.code === 0 ? res.stdout : undefined;
};

export async function readGit(
	pi: ExtensionAPI,
	cwd: string,
	want: { counts: boolean; commit: boolean; tag: boolean },
): Promise<GitStatus> {
	const out = await git(pi, cwd, ["status", "--porcelain=v1", "--branch"]);
	if (out === undefined) return NO_GIT;
	const s: GitStatus = { ...NO_GIT };
	for (const line of out.split("\n")) {
		if (line.startsWith("## ")) {
			const head = line.slice(3);
			if (head.startsWith("HEAD (no branch)")) {
				s.detached = {};
				continue;
			}
			const m = head.match(/^(\S+?)(?:\.\.\.(\S+))?(?:\s+\[(.*)\])?$/);
			if (!m) continue;
			s.branch = m[1];
			s.ahead = Number(m[3]?.match(/\bahead (\d+)\b/)?.[1] ?? 0);
			s.behind = Number(m[3]?.match(/\bbehind (\d+)\b/)?.[1] ?? 0);
			continue;
		}
		if (!want.counts || line.length < 3) continue;
		const x = line[0]!;
		const y = line[1]!;
		if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) s.conflicted++;
		else if (x === "?" && y === "?") s.untracked++;
		else if (x === "R") {
			s.renamed++;
			if (y === "M") s.modified++;
			else if (y === "D") s.deleted++;
		} else if (x === "D" || y === "D") s.deleted++;
		else {
			if (x !== " ") s.staged++;
			if (y === "M") s.modified++;
		}
	}
	if (want.counts) {
		const stashes = await git(pi, cwd, ["stash", "list", "--format=%H"]);
		if (stashes !== undefined) s.stashed = stashes.split("\n").filter((l) => l.trim()).length;
	}
	if (s.detached && want.commit) {
		s.detached.oid = (await git(pi, cwd, ["rev-parse", "HEAD"]))?.trim() || undefined;
		if (want.tag) s.detached.tag = (await git(pi, cwd, ["describe", "--tags", "--exact-match", "HEAD"]))?.trim() || undefined;
	}
	return s;
}

/** First match wins: a bun project also has package.json. */
const RUNTIMES: { name: string; files: string[]; cmd?: [string, ...string[]]; version?: RegExp }[] = [
	{ name: "bun", files: ["bun.lock", "bun.lockb"], cmd: ["bun", "--version"], version: /(\d+\.\d+\.\d+)/ },
	// `-p process.version` also answers when `node` is bun in disguise.
	{ name: "nodejs", files: ["package.json", ".nvmrc", ".node-version"], cmd: ["node", "-p", "process.version"], version: /v(\d+\.\d+\.\d+)/ },
	{ name: "rust", files: ["Cargo.toml"], cmd: ["rustc", "--version"], version: /rustc\s+(\d+\.\d+\.\d+)/ },
	{ name: "go", files: ["go.mod"], cmd: ["go", "version"], version: /go(\d+\.\d+\.\d+)/ },
	{ name: "python", files: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile", ".python-version"], cmd: ["python3", "--version"], version: /Python\s+(\d+\.\d+\.\d+)/ },
	{ name: "ruby", files: ["Gemfile", ".ruby-version"], cmd: ["ruby", "--version"], version: /ruby\s+(\d+\.\d+\.\d+)/ },
	{ name: "java", files: ["pom.xml", "build.gradle", "build.gradle.kts", ".java-version"], cmd: ["java", "-version"], version: /version\s+"(\d+\.\d+[.\d]*)"/ },
	{ name: "swift", files: ["Package.swift"], cmd: ["swift", "--version"], version: /Swift\s+(\d+\.\d+)/ },
	{ name: "kotlin", files: ["build.gradle.kts", "settings.gradle.kts"] },
	{ name: "cpp", files: ["CMakeLists.txt", "Makefile"] },
	{ name: "deno", files: ["deno.json", "deno.jsonc", "deno.lock"], cmd: ["deno", "--version"], version: /deno\s+(\d+\.\d+\.\d+)/ },
	{ name: "php", files: ["composer.json"], cmd: ["php", "--version"], version: /PHP\s+(\d+\.\d+\.\d+)/ },
	{ name: "elixir", files: ["mix.exs"], cmd: ["elixir", "--version"], version: /Elixir\s+(\d+\.\d+\.\d+)/ },
	{ name: "dart", files: ["pubspec.yaml"], cmd: ["dart", "--version"], version: /Dart\s+SDK\s+version:\s+(\d+\.\d+\.\d+)/ },
	{ name: "zig", files: ["build.zig"], cmd: ["zig", "version"], version: /(\d+\.\d+\.\d+)/ },
];

const runtimeCache = new Map<string, Runtime | null>();

export async function readRuntime(pi: ExtensionAPI, cwd: string): Promise<Runtime | null> {
	if (runtimeCache.has(cwd)) return runtimeCache.get(cwd) ?? null;
	const def = RUNTIMES.find((r) => r.files.some((f) => existsSync(join(cwd, f))));
	let runtime: Runtime | null = null;
	if (def) {
		runtime = { name: def.name };
		if (def.cmd && def.version) {
			const [cmd, ...args] = def.cmd;
			const res = await pi.exec(cmd, args, { cwd, timeout: 2500 }).catch(() => undefined);
			// java prints its version to stderr.
			runtime.version = `${res?.stdout ?? ""}\n${res?.stderr ?? ""}`.match(def.version)?.[1];
		}
	}
	runtimeCache.set(cwd, runtime);
	return runtime;
}

/** Usage across the whole session file, as pi bills it: every branch, tool calls and compactions. */
export function sumUsage(ctx: ExtensionContext): Totals {
	const t: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, latestCacheHitRate: undefined };
	const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
	for (const entry of ctx.sessionManager.getEntries()) {
		const source: object = entry.type === "message" ? entry.message : entry;
		const usage = "usage" in source ? (source.usage as Usage | undefined) : undefined;
		if (!usage) continue;
		const input = num(usage.input);
		const cacheRead = num(usage.cacheRead);
		const cacheWrite = num(usage.cacheWrite);
		t.input += input + cacheWrite;
		t.output += num(usage.output);
		t.cacheRead += cacheRead;
		t.cacheWrite += cacheWrite;
		t.cost += num(usage.cost?.total);
		if (entry.type === "message" && entry.message.role === "assistant") {
			const prompt = input + cacheRead + cacheWrite;
			t.latestCacheHitRate = prompt > 0 ? (cacheRead / prompt) * 100 : undefined;
		}
	}
	return t;
}
