/**
 * Status footer, laid out like pi-tui-footer 1.4.8 (ASCII glyphs shown):
 *   @ ~/path * main [!2 ?1] node 22.1.0 + done 3s       # [##--------] 12.0% · 24k/200k
 *   M · Anthropic · Claude Opus · ~ high        ↑ 3.1M (U 405k + R 2.7M) | ↓ 16k | $ $0.305
 *   & extension statuses
 */

import { hostname } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	ReadonlyFooterDataProvider,
	Theme,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Config } from "./config.ts";
import { fmtTokens } from "./format.ts";
import { type FooterGlyphs, footerGlyphs, type Glyphs, glyphsFor, resolveIcons, runtimeSymbol, spaceIcon } from "./icons.ts";
import { type GitStatus, NO_GIT, readGit, readRuntime, type Runtime, sumUsage, type Totals } from "./info.ts";
import type { Telemetry } from "./telemetry.ts";

// ---------------------------------------------------------------------------------------------
// Text helpers

function formatCwd(cwd: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (!home) return cwd;
	const rel = relative(resolve(home), resolve(cwd));
	const inside = rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
	if (!inside) return cwd;
	return rel === "" ? "~" : `~${sep}${rel}`;
}

const basenamePath = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/** Branches lose their tail so prefixes like `fix/` stay visible. */
function truncateBranch(branch: string, max: number): string {
	if (branch.length <= max) return branch;
	return max <= 3 ? "...".slice(0, max) : `${branch.slice(0, max - 3)}...`;
}

/** Keeps the first segment (`~`) and as many trailing segments as fit, in display columns. */
function truncatePath(path: string, max: number): string {
	if (visibleWidth(path) <= max) return path;
	if (max <= 3) return "...".slice(0, max);
	const sepChar = path.includes("/") ? "/" : "\\";
	const parts = path.split(/[\\/]/);
	if (parts.length <= 2) return truncateToWidth(path, max, "...");
	const tail: string[] = [];
	let used = 0;
	for (let i = parts.length - 1; i >= 1; i--) {
		const w = visibleWidth(parts[i]!);
		if (used + w + 4 > max) break;
		tail.unshift(parts[i]!);
		used += w + 1;
	}
	const result = `${parts[0]}${sepChar}...${sepChar}${tail.join(sepChar)}`;
	return visibleWidth(result) > max ? truncateToWidth(result, max, "...") : result;
}

function formatDuration(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	if (total < 60) return `${total}s`;
	const s = total % 60;
	const minutes = Math.floor(total / 60);
	if (minutes < 60) return `${minutes}m ${s}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${s}s`;
}

function formatInput(uncached: number, cacheRead: number): string {
	const total = fmtTokens(uncached + cacheRead);
	return cacheRead > 0 ? `${total} (U ${fmtTokens(uncached)} + R ${fmtTokens(cacheRead)})` : total;
}

function alignRight(left: string, right: string, width: number, theme: Theme): string {
	if (visibleWidth(right) > width) right = truncateToWidth(right, width, theme.fg("dim", "..."));
	const rightW = visibleWidth(right);
	const pad = width - visibleWidth(left) - rightW;
	if (pad >= 1) return left + " ".repeat(pad) + right;
	const room = Math.max(0, width - rightW - 1);
	const fitted = room > 0 ? truncateToWidth(left, room, theme.fg("dim", "...")) : "";
	return fitted ? `${fitted} ${right}` : right;
}

interface Segment {
	text: string;
	/** Higher survives longer. */
	priority: number;
	/** Swapped in before anything is truncated or dropped. */
	compact?: string;
	truncate?: (maxWidth: number, ellipsis: string) => string;
}

/**
 * Packs space-separated segments into `maxW`: compact forms first, then the lowest priority
 * shrinks and goes. Returns one text per segment, "" for dropped ones.
 */
function fitSegments(segs: readonly Segment[], maxW: number, ellipsis: string): string[] {
	const items = segs.map((s) => ({ ...s, w: visibleWidth(s.text) }));
	const total = () => {
		const live = items.filter((it) => it.text);
		return live.reduce((a, it) => a + it.w, 0) + Math.max(0, live.length - 1);
	};
	const lowest = () => {
		let at = -1;
		for (let i = 0; i < items.length; i++) {
			if (items[i]!.text && (at === -1 || items[i]!.priority < items[at]!.priority)) at = i;
		}
		return at;
	};
	if (total() > maxW) {
		for (const it of items) {
			if (it.compact === undefined || visibleWidth(it.compact) >= it.w) continue;
			it.text = it.compact;
			it.w = visibleWidth(it.text);
			if (total() <= maxW) break;
		}
	}
	// A truncate that cannot shrink must not spin: no progress drops the lowest segment.
	let last = Infinity;
	while (total() > maxW) {
		const now = total();
		const target = lowest();
		if (target === -1) break;
		const it = items[target]!;
		if (now >= last) {
			it.text = "";
			it.w = 0;
			continue;
		}
		last = now;
		const others = items.filter((o, i) => i !== target && o.text);
		const otherW = others.reduce((a, o) => a + o.w, 0) + Math.max(0, others.length - 1);
		const avail = maxW - otherW - (others.length > 0 ? 1 : 0);
		if (avail <= visibleWidth(ellipsis)) {
			it.text = "";
			it.w = 0;
		} else if (avail < it.w) {
			it.text = it.truncate ? it.truncate(avail, ellipsis) : truncateToWidth(it.text, avail, ellipsis);
			it.w = visibleWidth(it.text);
		} else break;
	}
	return items.map((it) => it.text);
}

const stressColor = (pct: number): ThemeColor => (pct >= 90 ? "error" : pct >= 70 ? "warning" : "accent");
const cacheHitColor = (pct: number): ThemeColor => (pct < 30 ? "error" : pct < 70 ? "warning" : "success");

function providerColor(provider: string): ThemeColor {
	switch (provider.toLowerCase()) {
		case "anthropic":
			return "accent";
		case "openai":
		case "openai-codex":
			return "success";
		case "google":
		case "google-vertex":
			return "warning";
		case "amazon-bedrock":
			return "thinkingHigh";
		case "github-copilot":
			return "mdLink";
		case "deepseek":
			return "thinkingLow";
		case "xai":
		case "groq":
			return "error";
		default:
			return "muted";
	}
}

const EFFORT_COLOR: Record<string, ThemeColor> = {
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
};

// SGR carries colours and stays; every other escape or control character becomes a space.
const STATUS_TOKEN =
	/(?:\x1b\[|\x9b)[0-?]*[ -/]*m|(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|(?:\x1bP|\x90|\x1bX|\x98|\x1b\^|\x9e|\x1b_|\x9f)[\s\S]*?(?:\x1b\\|\x9c|$)|(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c|$)|\x1b[@-Z\\_]|[\u0000-\u001f\u007f-\u009f]/g;
const SGR_TOKEN = /^(?:\x1b\[|\x9b)[0-9;:]*m$/;
const SGR = /(?:\x1b\[|\x9b)[0-9;:]*m/;

const cleanStatus = (text: string) =>
	text
		.replace(STATUS_TOKEN, (t) => (SGR_TOKEN.test(t) ? t : " "))
		.replace(/ {2,}/g, " ")
		.trim();

// ---------------------------------------------------------------------------------------------
// Segments

function gitSegment(theme: Theme, git: GitStatus, g: FooterGlyphs, on: Config["footerSegments"]): string {
	const parts: string[] = [];
	if (on.gitBranch) {
		if (git.branch) {
			parts.push(theme.fg("mdLink", g.git), theme.fg("mdLink", truncateBranch(git.branch, 20)));
		} else if (git.detached) {
			parts.push(theme.fg("warning", g.git), theme.fg("warning", "HEAD"));
			const { oid, tag } = git.detached;
			if (oid) parts.push(theme.fg("dim", `${oid.slice(0, 7)}${tag ? ` ${tag}` : ""}`));
		}
	}
	if (on.gitStatus) {
		const icons: string[] = [];
		const add = (n: number, glyph: string, color: ThemeColor) => {
			if (n > 0) icons.push(theme.fg(color, `${glyph}${n}`));
		};
		add(git.conflicted, g.conflicted, "error");
		add(git.deleted, g.deleted, "error");
		add(git.modified, g.modified, "warning");
		add(git.renamed, g.renamed, "warning");
		add(git.staged, g.staged, "success");
		add(git.untracked, g.untracked, "muted");
		add(git.stashed, g.stashed, "muted");
		if (git.ahead > 0 && git.behind > 0) icons.push(theme.fg("warning", `${g.diverged}${git.ahead}/${git.behind}`));
		else if (git.ahead > 0) icons.push(theme.fg("success", `${g.ahead}${git.ahead}`));
		else if (git.behind > 0) icons.push(theme.fg("warning", `${g.behind}${git.behind}`));
		if (icons.length) parts.push(`${theme.fg("dim", "[")}${icons.join(" ")}${theme.fg("dim", "]")}`);
	}
	return parts.join(" ");
}

/** Full context bar, and the icon + percentage form it falls back to. */
function contextSegment(
	theme: Theme,
	ctx: ExtensionContext,
	width: number,
	g: FooterGlyphs,
	ascii: boolean,
): { full: string; compact: string } | undefined {
	const usage = ctx.getContextUsage();
	const window = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	// Shown at 0% once the window is known, so the right side never collapses.
	if (window <= 0) return undefined;
	const pct = usage?.percent ?? 0;
	const color = stressColor(pct);
	const icon = theme.fg(color, g.context);
	const pctText = theme.fg(color, `${pct.toFixed(1)}%`);
	const size = `${theme.fg("text", fmtTokens(usage?.tokens ?? 0))}${theme.fg("dim", "/")}${theme.fg("text", fmtTokens(window))}`;
	// The bar gives way before the left segments are squeezed.
	const reserved = visibleWidth(icon) + visibleWidth(pctText) + visibleWidth(size) + 7;
	const barWidth = Math.max(4, Math.min(12, width - reserved));
	const filled = Math.max(0, Math.min(barWidth, Math.round((pct / 100) * barWidth)));
	// ▪/▫ sit at the height of the brackets, unlike full blocks.
	const bar =
		theme.fg("dim", "[") +
		theme.fg(color, (ascii ? "#" : "▪").repeat(filled)) +
		theme.fg("dim", (ascii ? "-" : "▫").repeat(barWidth - filled)) +
		theme.fg("dim", "]");
	return {
		full: `${icon} ${bar} ${pctText} ${theme.fg("dim", "·")} ${size}`,
		compact: `${icon} ${pctText}`,
	};
}

function statsBlock(theme: Theme, t: Totals, g: FooterGlyphs, on: Config["footerSegments"]): string {
	const stats: string[] = [];
	if (on.tokens) {
		stats.push(theme.fg("accent", `${g.input} ${formatInput(t.input, t.cacheRead)}`));
		stats.push(theme.fg("success", `${g.output} ${fmtTokens(t.output)}`));
		// No cache tokens at all means the provider has no prompt cache; a "0%" would mislead.
		if ((t.cacheRead > 0 || t.cacheWrite > 0) && t.latestCacheHitRate !== undefined) {
			stats.push(theme.fg(cacheHitColor(t.latestCacheHitRate), `${g.cacheHit} ${t.latestCacheHitRate.toFixed(1)}%`));
		}
	}
	if (on.cost) stats.push(theme.fg("warning", `${g.cost} $${t.cost.toFixed(3)}`));
	return stats.join(` ${theme.fg("dim", "|")} `);
}

// ---------------------------------------------------------------------------------------------

export class FooterInfo {
	data: ReadonlyFooterDataProvider | undefined;
	runStart: number | undefined;
	lastRunMs: number | undefined;
	private git: GitStatus = NO_GIT;
	private runtime: Runtime | null = null;
	private totalsCache: { key: string; totals: Totals } | undefined;
	private gitBusy = false;
	private gitQueued: string | undefined;

	constructor(
		private readonly pi: ExtensionAPI,
		private readonly config: () => Config,
		private readonly telemetry: Telemetry,
		private readonly redraw: () => void,
	) {}

	reset(): void {
		this.totalsCache = undefined;
		this.runStart = undefined;
		this.lastRunMs = undefined;
	}

	// A request that arrives mid-flight runs once more afterwards, so the last change always lands.
	async refreshGit(cwd: string): Promise<void> {
		if (this.gitBusy) {
			this.gitQueued = cwd;
			return;
		}
		this.gitBusy = true;
		try {
			const on = this.config().footerSegments;
			this.git = await readGit(this.pi, cwd, {
				counts: on.gitStatus,
				commit: on.gitBranch,
				tag: on.gitBranch && on.gitCommit,
			});
		} finally {
			this.gitBusy = false;
		}
		this.redraw();
		const next = this.gitQueued;
		this.gitQueued = undefined;
		if (next !== undefined) await this.refreshGit(next);
	}

	async refreshRuntime(cwd: string): Promise<void> {
		this.runtime = await readRuntime(this.pi, cwd);
		this.redraw();
	}

	// Entries are append-only and every append moves the leaf, so session + leaf identify the totals.
	private totals(ctx: ExtensionContext): Totals {
		const sm = ctx.sessionManager;
		const key = `${sm.getSessionId()}:${sm.getLeafId() ?? ""}`;
		if (this.totalsCache?.key !== key) this.totalsCache = { key, totals: sumUsage(ctx) };
		return this.totalsCache.totals;
	}

	/** Glyphs for the header and the run summary. */
	glyphs(): Glyphs {
		return glyphsFor(resolveIcons(this.config()).mode);
	}

	render(ctx: ExtensionContext, theme: Theme, width: number): string[] {
		if (width <= 0) return [""];
		const config = this.config();
		const on = config.footerSegments;
		const { mode, spaced } = resolveIcons(config);
		const g = footerGlyphs(mode, spaced);
		const ellipsis = theme.fg("dim", "...");

		// Line 1: where, git, runtime, timer; context bar on the right.
		const left: Segment[] = [];
		if (on.cwd) {
			const cwd = formatCwd(ctx.cwd);
			const prefix = `${theme.fg("mdLink", g.cwd)} `;
			const path = (text: string) => prefix + theme.fg("accent", text);
			const max = Math.min(30, Math.max(10, Math.floor(width * 0.4)));
			left.push({
				text: path(truncatePath(cwd, max)),
				compact: path(truncatePath(basenamePath(cwd), max)),
				priority: 4,
				truncate: (maxWidth, ell) => {
					const room = maxWidth - visibleWidth(prefix);
					if (room <= visibleWidth(ell)) return truncateToWidth(path(basenamePath(cwd)), maxWidth, ell);
					return path(truncatePath(basenamePath(cwd), room));
				},
			});
		}
		if (on.hostname) {
			const host = hostname().split(".")[0];
			if (host) left.push({ text: `${theme.fg("dim", g.host)} ${theme.fg("accent", host)}`, priority: 3 });
		}
		const name = on.sessionName ? this.pi.getSessionName() : undefined;
		if (name) {
			left.push({
				text: `${theme.fg("dim", g.session)} ${theme.fg("text", truncateToWidth(name, 24, ellipsis))}`,
				priority: 2,
			});
		}
		const git = gitSegment(theme, this.git, g, on);
		if (git) left.push({ text: git, priority: 1 });
		if (on.runtime && this.runtime) {
			const glyph = runtimeSymbol(this.runtime.name, mode);
			const symbol = theme.fg("success", spaced ? spaceIcon(glyph) : glyph);
			const version = this.runtime.version ? theme.fg("muted", this.runtime.version) : "";
			left.push({ text: [symbol, version].filter(Boolean).join(" "), priority: 0 });
		}
		let timer = "";
		if (this.runStart !== undefined) {
			timer = `${theme.fg("accent", g.working)} ${theme.fg("dim", "working")} ${theme.fg("accent", formatDuration(Date.now() - this.runStart))}`;
		} else if (this.lastRunMs !== undefined) {
			timer = `${theme.fg("success", g.done)} ${theme.fg("success", "done")} ${theme.fg("text", formatDuration(this.lastRunMs))}`;
		}
		if (timer) {
			const tps = this.runStart !== undefined && on.liveTps ? this.telemetry.liveTps() : undefined;
			const text = tps
				? `${timer} ${theme.fg("dim", "·")} ${theme.fg(tps.stale ? "dim" : "accent", `${g.speed} ~${Math.round(tps.tps)} tok/s`)}`
				: timer;
			// Narrow widths shed the live TPS before the timer.
			left.push({ text, compact: tps ? timer : undefined, priority: 3 });
		}

		const context = on.context ? contextSegment(theme, ctx, width, g, mode === "ascii") : undefined;
		const all = [...left];
		if (context) {
			const compact = visibleWidth(context.compact) < visibleWidth(context.full) ? context.compact : undefined;
			// Goes with the runtime, before git, session, host, timer and cwd.
			all.push({ text: context.full, compact, priority: 0 });
		}
		const fitted = fitSegments(all, width, ellipsis);
		const right = context ? (fitted.pop() ?? "") : "";
		const line1 = alignRight(fitted.filter(Boolean).join(" "), right, width, theme);

		// Line 2: model on the left, usage on the right; the model gives way first.
		const model = ctx.model;
		const provider = on.provider && model?.provider
			? model.provider.charAt(0).toUpperCase() + model.provider.slice(1)
			: undefined;
		const modelParts = [theme.fg("mdLink", g.model)];
		if (provider) modelParts.push(theme.fg(providerColor(model?.provider ?? ""), provider));
		modelParts.push(theme.fg("text", model?.name ?? model?.id ?? "no-model"));
		const effort = model?.reasoning ? this.pi.getThinkingLevel() : undefined;
		if (effort && effort !== "off") {
			modelParts.push(theme.fg(EFFORT_COLOR[effort] ?? "thinkingMedium", `${g.thinking} ${effort}`));
		}
		const modelBlock = modelParts.join(theme.fg("dim", " · "));
		let stats = statsBlock(theme, this.totals(ctx), g, on);
		let modelFit = "";
		if (visibleWidth(stats) > width) stats = truncateToWidth(stats, width, ellipsis);
		else if (width - visibleWidth(stats) - 1 > 0) {
			modelFit = truncateToWidth(modelBlock, width - visibleWidth(stats) - 1, ellipsis);
		}
		const line2 = alignRight(modelFit, stats, width, theme);

		const lines = [line1, line2].map((line) => truncateToWidth(line, width, ellipsis));

		if (on.extensionStatuses) {
			const statuses = [...(this.data?.getExtensionStatuses().entries() ?? [])]
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => cleanStatus(text))
				.filter(Boolean)
				// Plain text stays muted; a trailing reset keeps a status's own style from leaking.
				.map((text) => (SGR.test(text) ? `${text}\x1b[0m` : theme.fg("muted", text)));
			if (statuses.length) {
				lines.push(...wrapTextWithAnsi(`${theme.fg("mdLink", g.extensions)} ${statuses.join(` ${theme.fg("dim", "|")} `)}`, width));
			}
		}
		return lines;
	}
}
