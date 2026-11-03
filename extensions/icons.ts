/** Nerd Font and ASCII glyph sets. Glyphs carry their own trailing space where they need one. */

import type { Config, IconMode } from "./config.ts";

export interface Glyphs {
	cwd: string;
	session: string;
	git: string;
	staged: string;
	modified: string;
	untracked: string;
	model: string;
	thinking: string;
	working: string;
	done: string;
	speed: string;
	latency: string;
	stall: string;
	input: string;
	output: string;
	cost: string;
	context: string;
	sep: string;
	ellipsis: string;
}

const NERD: Glyphs = {
	cwd: " ",
	session: " ",
	git: " ",
	staged: "+",
	modified: "!",
	untracked: "?",
	model: " ",
	thinking: " ",
	working: " ",
	done: " ",
	speed: "\u{F04C5} ",
	latency: " ",
	stall: " ",
	input: " ",
	output: " ",
	cost: " ",
	context: " ",
	sep: " · ",
	ellipsis: "…",
};

const ASCII: Glyphs = {
	cwd: "@ ",
	session: "s ",
	git: "* ",
	staged: "A",
	modified: "!",
	untracked: "?",
	model: "M ",
	thinking: "~",
	working: "o ",
	done: "+ ",
	speed: "> ",
	latency: "~",
	stall: "! ",
	input: "↑",
	output: "↓",
	cost: "$",
	context: "# ",
	sep: " | ",
	ellipsis: "...",
};

export function glyphsFor(mode: IconMode): Glyphs {
	return mode === "nerd" ? NERD : ASCII;
}

/** Footer glyphs, kept identical to pi-tui-footer 1.4.8. */
export interface FooterGlyphs {
	cwd: string;
	host: string;
	session: string;
	git: string;
	working: string;
	done: string;
	context: string;
	model: string;
	thinking: string;
	input: string;
	output: string;
	cacheHit: string;
	cost: string;
	speed: string;
	extensions: string;
	ahead: string;
	behind: string;
	diverged: string;
	conflicted: string;
	stashed: string;
	modified: string;
	staged: string;
	untracked: string;
	renamed: string;
	deleted: string;
}

const FOOTER_NERD: FooterGlyphs = {
	cwd: "",
	host: "",
	session: "",
	git: "",
	working: "",
	done: "",
	context: "",
	model: "",
	thinking: "",
	input: "",
	output: "",
	cacheHit: "",
	cost: "",
	speed: "\u{F04C5}",
	extensions: "",
	ahead: "↑",
	behind: "↓",
	diverged: "⇕",
	conflicted: "=",
	stashed: "$",
	modified: "!",
	staged: "+",
	untracked: "?",
	renamed: "»",
	deleted: "✘",
};

const FOOTER_ASCII: FooterGlyphs = {
	cwd: "@",
	host: "h",
	session: "s",
	git: "*",
	working: "o",
	done: "+",
	context: "#",
	model: "M",
	thinking: "~",
	input: "↑",
	output: "↓",
	cacheHit: "c",
	cost: "$",
	speed: ">",
	extensions: "&",
	ahead: "^",
	behind: "v",
	diverged: "^v",
	conflicted: "=",
	stashed: "S",
	modified: "!",
	staged: "A",
	untracked: "?",
	renamed: "r",
	deleted: "x",
};

const PRIVATE_USE = /[-\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u;

/** Kitty draws a wide Nerd icon into the blank cell after it; `spaced` reserves that cell. */
export function spaceIcon(glyph: string): string {
	return PRIVATE_USE.test(glyph) ? `${glyph} ` : glyph;
}

export function footerGlyphs(mode: IconMode, spaced: boolean): FooterGlyphs {
	const base = mode === "nerd" ? FOOTER_NERD : FOOTER_ASCII;
	if (!spaced) return base;
	return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, spaceIcon(v)])) as unknown as FooterGlyphs;
}

const RUNTIME_NERD: Record<string, string> = {
	nodejs: "",
	rust: "",
	go: "",
	python: "",
	ruby: "",
	java: "",
	cpp: "",
	c: "",
	swift: "",
	kotlin: "",
	deno: "",
	bun: "",
	php: "",
	elixir: "",
	dart: "",
	zig: "",
};

const RUNTIME_ASCII: Record<string, string> = {
	nodejs: "node",
	rust: "rs",
	python: "py",
	ruby: "rb",
	kotlin: "kt",
	cpp: "c++",
	elixir: "ex",
};

export function runtimeSymbol(name: string, mode: IconMode): string {
	if (mode !== "nerd") return RUNTIME_ASCII[name] ?? name;
	return RUNTIME_NERD[name] ?? "";
}

// Fonts live in the terminal that draws the screen, so these are the only signals available.
function nerdCapable(): boolean {
	const env = process.env;
	if (env.TERM === "dumb" || process.stdout.isTTY !== true) return false;
	// Over SSH the font sits on the client device, which rarely has a Nerd Font.
	if (env.SSH_TTY || env.SSH_CONNECTION) return false;
	const locale = env.LC_ALL || env.LC_CTYPE || env.LANG;
	return !locale || /utf-?8/i.test(locale);
}

/** Kitty and Ghostty draw a wide Nerd icon across the blank cell that follows it. */
function iconsSpill(): boolean {
	const env = process.env;
	return Boolean(env.KITTY_WINDOW_ID) || /kitty|ghostty/i.test(env.TERM ?? "") || env.TERM_PROGRAM === "ghostty";
}

/** Icon set and spacing after "auto" is resolved. */
export function resolveIcons(config: Config): { mode: IconMode; spaced: boolean } {
	const setting = config.icons.mode;
	const mode: IconMode = setting === "auto" ? (nerdCapable() ? "nerd" : "ascii") : setting;
	const spacing = config.footerSegments.nerdIconSpacing;
	return { mode, spaced: mode === "nerd" && (spacing === "auto" ? iconsSpill() : spacing) };
}
