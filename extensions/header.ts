/** Static header: a small logo beside the pi version, model, cwd and a line of tips. */

import { type ExtensionAPI, type ExtensionContext, type Theme, VERSION } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Language } from "./config.ts";
import { fmtPath } from "./format.ts";
import type { Glyphs } from "./icons.ts";

const LOGO = ["█▀▀█ ▀█▀", "█▄▄█  █ ", "█    ▄█▄"];

const TIPS: Record<Language, string> = {
	zh: "/ 命令  ! 执行 shell  @ 引用文件  esc 中断  /pi-tui 界面设置",
	en: "/ commands  ! run shell  @ files  esc interrupt  /pi-tui settings",
};

export function renderHeader(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	theme: Theme,
	g: Glyphs,
	language: Language,
	width: number,
): string[] {
	const level = pi.getThinkingLevel();
	const model = (ctx.model?.id ?? "no model") + (ctx.model?.reasoning && level !== "off" ? `${g.sep}${level}` : "");
	const info = [
		theme.bold(theme.fg("accent", "pi")) + theme.fg("dim", ` v${VERSION}`),
		theme.fg("muted", g.model + model),
		theme.fg("muted", g.cwd + fmtPath(ctx.cwd, false)),
	];
	const logoWidth = visibleWidth(LOGO[0]!) + 2;
	const lines =
		width >= logoWidth + 20
			? LOGO.map((row, i) => theme.fg("accent", row) + "  " + truncateToWidth(info[i]!, width - logoWidth, g.ellipsis))
			: info.map((line) => truncateToWidth(line, width, g.ellipsis));
	return ["", ...lines, truncateToWidth(theme.fg("dim", TIPS[language]), width, g.ellipsis), ""];
}
