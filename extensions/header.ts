/**
 * Static header: pi's own pixel logo, drawn at twice its built-in size, beside the pi version,
 * model, cwd and a line of tips.
 */

import { type ExtensionAPI, type ExtensionContext, type Theme, VERSION } from "@earendil-works/pi-coding-agent";
import { foregroundAnsi, rgbColor, truncateToWidth } from "@earendil-works/pi-tui";
import { fmtPath } from "./format.ts";
import type { Glyphs } from "./icons.ts";

// pi's brand colours; like pi's own logo they stay fixed across themes.
const BRAND = { c: rgbColor(228, 138, 122), b: rgbColor(79, 142, 179), y: rgbColor(234, 182, 93) };

// The pi logo pixel grid (c coral, b blue, y yellow). Each pixel is two cells wide and one row
// tall, which is square; quadrant blocks shave every outer corner so the shapes read as rounded.
const PIXELS = ["ccc.", "b.c.", "bb.y", "b..y"];
const LOGO_WIDTH = PIXELS[0]!.length * 2;
const GAP = 3;

// Claude Code style hints: "<key> for <action>", the key slightly brighter than the rest.
const TIPS: [string, string][] = [
	["/", "for commands"],
	["!", "for shell"],
	["@", "for files"],
	["esc", "to interrupt"],
	["/pi-tui", "for settings"],
];

const tips = (theme: Theme) =>
	TIPS.map(([key, label]) => `${theme.fg("muted", key)} ${theme.fg("dim", label)}`).join(theme.fg("dim", " · "));

// Cell glyph by which corner quadrants are cut: [top cut, bottom cut] for the left and right cell.
const LEFT: Record<string, string> = { "00": "█", "10": "▟", "01": "▜", "11": "▐" };
const RIGHT: Record<string, string> = { "00": "█", "10": "▙", "01": "▛", "11": "▌" };

function logo(theme: Theme): string[] {
	const mode = theme.getColorMode();
	const at = (r: number, c: number) => PIXELS[r]?.[c] ?? ".";
	return PIXELS.map((row, r) =>
		[...row]
			.map((p, c) => {
				if (p === ".") return "  ";
				// A corner is outer when both pixels beside it are empty; touching pieces stay square.
				const free = (dr: number, dc: number) => (at(r + dr, c) === "." && at(r, c + dc) === "." ? "1" : "0");
				const cells = LEFT[free(-1, -1) + free(1, -1)]! + RIGHT[free(-1, 1) + free(1, 1)]!;
				return `${foregroundAnsi(BRAND[p as keyof typeof BRAND], mode)}${cells}\x1b[39m`;
			})
			.join(""),
	);
}

export function renderHeader(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	theme: Theme,
	g: Glyphs,
	width: number,
): string[] {
	const level = pi.getThinkingLevel();
	const model = [ctx.model?.name ?? ctx.model?.id ?? "no model"];
	if (ctx.model?.reasoning && level !== "off") model.push(level);
	// Like Claude Code's welcome: bold name and version, then model and cwd in quieter text.
	const info = [
		theme.bold(theme.fg("text", "pi")) + theme.fg("dim", ` v${VERSION}`),
		theme.fg("muted", model.join(" · ")),
		theme.fg("dim", fmtPath(ctx.cwd, false)),
		tips(theme),
	];
	const room = width - 1 - LOGO_WIDTH - GAP;
	const lines =
		room >= 24
			? logo(theme).map((row, i) => ` ${row}${" ".repeat(GAP)}${truncateToWidth(info[i]!, room, g.ellipsis)}`)
			: info.map((line) => truncateToWidth(` ${line}`, width, g.ellipsis));
	return ["", ...lines, ""];
}
