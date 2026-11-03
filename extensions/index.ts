/**
 * pi-tui: header, rounded editor, status footer, rounded tool frames, thinking peek and run
 * telemetry, configured with `/pi-tui` and stored in <agentDir>/pi-tui.json.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Config, loadConfig, saveConfig } from "./config.ts";
import { CURSOR_RESET, RoundedEditor } from "./editor.ts";
import { FooterInfo } from "./footer.ts";
import { oneLine } from "./format.ts";
import { renderHeader } from "./header.ts";
import { openSettings } from "./settings.ts";
import { formatSummary, Telemetry } from "./telemetry.ts";
import { registerTools } from "./tools.ts";
import { plainUserMessages } from "./user-message.ts";

const PEEK_CHARS = 48;

export default function piTui(pi: ExtensionAPI): void {
	let config = loadConfig();
	let session: ExtensionContext | undefined;
	let redraw = () => {};
	let resetCursor = () => {};
	let ticker: ReturnType<typeof setInterval> | undefined;
	let thinking = "";
	let peeking = false;

	const telemetry = new Telemetry();
	const info = new FooterInfo(pi, () => config, telemetry, () => redraw());

	registerTools(pi, () => config.enabled && config.roundedTools);
	plainUserMessages(() => config.enabled);

	const install = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const ui = ctx.ui;
		if (!config.enabled) {
			resetCursor();
			ui.setHeader(undefined);
			ui.setEditorComponent(undefined);
			ui.setFooter(undefined);
			return;
		}
		ui.setFooter((tui, theme, data) => {
			const own = () => tui.requestRender();
			redraw = own;
			info.data = data;
			const offBranch = data.onBranchChange(() => void info.refreshGit(ctx.cwd));
			return {
				render: (width) => info.render(ctx, theme, width),
				invalidate() {},
				dispose() {
					offBranch();
					if (redraw === own) redraw = () => {};
				},
			};
		});
		ui.setHeader(
			config.header
				? (_tui, theme) => ({
						render: (width) => renderHeader(pi, ctx, theme, info.glyphs(), config.settingsLanguage, width),
						invalidate() {},
					})
				: undefined,
		);
		ui.setEditorComponent((tui, theme, keybindings) => {
			resetCursor = () => tui.terminal.write(CURSOR_RESET);
			return new RoundedEditor(tui, theme, keybindings, () => config.cursorStyle);
		});
	};

	const stopTicker = () => {
		if (ticker) clearInterval(ticker);
		ticker = undefined;
	};

	const stopPeek = (ctx: ExtensionContext) => {
		thinking = "";
		if (!peeking) return;
		peeking = false;
		ctx.ui.setWorkingMessage();
	};

	pi.on("session_start", (_event, ctx) => {
		session = ctx;
		info.reset();
		void info.refreshGit(ctx.cwd);
		void info.refreshRuntime(ctx.cwd);
		install(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		stopTicker();
		stopPeek(ctx);
		resetCursor();
	});

	// Every agent loop restarts the footer timer, which stops at agent_end.
	pi.on("agent_start", () => {
		telemetry.start();
		info.runStart = Date.now();
		info.lastRunMs = undefined;
		if (!ticker) ticker = setInterval(() => redraw(), 1000);
		redraw();
	});

	pi.on("message_update", (event, ctx) => {
		const e = event.assistantMessageEvent;
		if (e.type === "text_delta" || e.type === "thinking_delta" || e.type === "toolcall_delta") telemetry.delta(e.delta);
		if (e.type !== "thinking_delta") {
			if (e.type === "thinking_end" || e.type === "text_start" || e.type === "toolcall_start") stopPeek(ctx);
			return;
		}
		if (!ctx.hasUI || !config.enabled || config.thinkingPeek.lines === 0) return;
		thinking = (thinking + e.delta).slice(-1000);
		const line = oneLine(thinking.split("\n").filter((l) => l.trim()).at(-1) ?? "");
		if (!line) return;
		ctx.ui.setWorkingMessage(line.length > PEEK_CHARS ? `…${line.slice(-PEEK_CHARS)}` : line);
		peeking = true;
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		telemetry.messageEnd(event.message.usage);
		stopPeek(ctx);
	});

	pi.on("tool_execution_end", (_event, ctx) => void info.refreshGit(ctx.cwd));

	pi.on("agent_end", (_event, ctx) => {
		stopPeek(ctx);
		stopTicker();
		if (info.runStart !== undefined) info.lastRunMs = Date.now() - info.runStart;
		info.runStart = undefined;
		redraw();
		void info.refreshGit(ctx.cwd);
	});

	pi.on("agent_settled", (_event, ctx) => {
		const summary = telemetry.finish();
		if (summary && ctx.hasUI && config.enabled && config.telemetry.enabled) {
			ctx.ui.notify(formatSummary(summary, ctx.ui.theme, info.glyphs()), "info");
		}
		redraw();
	});

	pi.on("model_select", () => redraw());
	pi.on("thinking_level_select", () => redraw());

	pi.registerCommand("pi-tui", {
		description: "pi-tui settings / 界面设置",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			const before = config;
			await openSettings(
				ctx,
				() => config,
				(next: Config) => {
					config = next;
					saveConfig(next);
					redraw();
				},
			);
			if (config.enabled !== before.enabled || config.header !== before.header) install(session ?? ctx);
		},
	});
}
