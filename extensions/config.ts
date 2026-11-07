/**
 * Settings in <agentDir>/pi-tui.json. Files written by 1.x load as-is: known keys are
 * validated, retired ones are ignored on read and kept on write.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type Language = "zh" | "en";
export type CursorStyle = "block" | "bar" | "underline";
export type IconMode = "nerd" | "ascii";
/** "auto" picks Nerd Font on a local UTF-8 terminal and ASCII elsewhere. */
export type IconSetting = "auto" | IconMode;
/** "auto" adds the space on terminals that draw a Nerd icon across the next cell. */
export type Spacing = "auto" | boolean;

export const SEGMENTS = [
	"cwd",
	"hostname",
	"sessionName",
	"gitBranch",
	"gitStatus",
	"gitCommit",
	"runtime",
	"context",
	"contextBar",
	"tokens",
	"cost",
	"liveTps",
	"extensionStatuses",
	"provider",
] as const;
export type Segment = (typeof SEGMENTS)[number];

export interface Config {
	enabled: boolean;
	header: boolean;
	roundedTools: boolean;
	settingsLanguage: Language;
	cursorStyle: CursorStyle;
	icons: { mode: IconSetting };
	footerSegments: Record<Segment, boolean> & { nerdIconSpacing: Spacing };
	telemetry: { enabled: boolean };
	thinkingPeek: { lines: 0 | 1 };
}

export const DEFAULTS: Config = {
	enabled: true,
	header: true,
	roundedTools: true,
	settingsLanguage: "zh",
	cursorStyle: "block",
	icons: { mode: "auto" },
	footerSegments: {
		cwd: true,
		hostname: false,
		sessionName: false,
		gitBranch: true,
		gitStatus: true,
		gitCommit: false,
		runtime: true,
		context: true,
		contextBar: true,
		tokens: true,
		cost: true,
		liveTps: true,
		extensionStatuses: true,
		provider: true,
		nerdIconSpacing: "auto",
	},
	telemetry: { enabled: true },
	thinkingPeek: { lines: 1 },
};

type Raw = Record<string, unknown>;

const path = () => join(getAgentDir(), "pi-tui.json");
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
	options.includes(v as T) ? (v as T) : fallback;

let raw: Raw = {};

export function loadConfig(): Config {
	try {
		raw = obj(JSON.parse(readFileSync(path(), "utf8")));
	} catch {
		raw = {};
	}
	const d = DEFAULTS;
	const segments = obj(raw.footerSegments);
	const peekLines = obj(raw.thinkingPeek).lines;
	return {
		enabled: bool(raw.enabled, d.enabled),
		header: bool(raw.header, d.header),
		roundedTools: bool(raw.roundedTools, d.roundedTools),
		settingsLanguage: oneOf(raw.settingsLanguage, ["zh", "en"], d.settingsLanguage),
		cursorStyle: oneOf(raw.cursorStyle, ["block", "bar", "underline"], d.cursorStyle),
		// 1.x also had "auto" and "unicode"; both rendered icons, so they map to nerd.
		// 1.x "unicode" also drew icons, so it maps to nerd.
		icons: { mode: oneOf(obj(raw.icons).mode === "unicode" ? "nerd" : obj(raw.icons).mode, ["auto", "nerd", "ascii"], d.icons.mode) },
		footerSegments: {
			...(Object.fromEntries(SEGMENTS.map((key) => [key, bool(segments[key], d.footerSegments[key])])) as Record<Segment, boolean>),
			nerdIconSpacing: typeof segments.nerdIconSpacing === "boolean" ? segments.nerdIconSpacing : d.footerSegments.nerdIconSpacing,
		},
		telemetry: { enabled: bool(obj(raw.telemetry).enabled, d.telemetry.enabled) },
		thinkingPeek: { lines: peekLines === undefined ? d.thinkingPeek.lines : peekLines === 0 ? 0 : 1 },
	};
}

export function saveConfig(config: Config): void {
	const merged: Raw = {
		...raw,
		...config,
		footerSegments: { ...obj(raw.footerSegments), ...config.footerSegments },
		telemetry: { ...obj(raw.telemetry), ...config.telemetry },
	};
	try {
		writeFileSync(path(), `${JSON.stringify(merged, null, 2)}\n`);
		raw = merged;
	} catch {
		// Read-only agent dir: the change still applies to this session.
	}
}
