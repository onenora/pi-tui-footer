/**
 * pi-tui-footer — full TUI polish for pi: animated Pi logo header,
 * Starship-style footer, rounded editor, rounded tool frames, and turn
 * telemetry.
 *
 * Built on the work of several Pi community packages:
 *   - pi-haiku — two-line footer layout and work timer
 *   - pi-claude-code-tui — Pi logo frames and rounded editor border technique
 *   - pi-zentui — Starship-style footer, runtime detection, session
 *     lifecycle, and settings UI patterns
 *   - pi-tps — per-turn timing, stall detection, and conservative TPS math
 * Logo frames originate from the official Pi install script
 * (pi.dev/install.sh). Runtime detection and Git porcelain parsing follow
 * pi-zentui's structure.
 *
 * Security audit notes:
 *   - zero third-party runtime deps (pi core bundles + node built-ins only)
 *   - execFile runs only hardcoded git / runtime version commands (no shell
 *     injection surface); fs access limited to ~/.pi/agent/pi-tui.json
 *   - no network / eval / obfuscation / credential reads
 *
 * Rounded tool call/result frames live in rounded-tools.ts (ported from
 * npm:pi-rounded-tools@0.1.2, MIT, by OrionPax), gated behind the
 * `roundedTools` config flag (default on). See LICENSE.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type PiTuiConfig, DEFAULT_CONFIG, ensureConfigExists, loadConfig, saveConfig } from "./config.ts";
import { installEditor } from "./editor.ts";
import { installFooter } from "./footer.ts";
import { installHeader } from "./header.ts";
import { emptyGitStatus, readGitStatus } from "./git.ts";
import { readRuntimeInfo } from "./runtime.ts";
import { registerRoundedTools } from "./rounded-tools.ts";
import { SessionLifecycle } from "./session-lifecycle.ts";
import { registerSettingsCommand } from "./settings-command.ts";
import { formatTurnTelemetry, TurnTelemetryTracker } from "./telemetry.ts";
import {
	createInitialState,
	getModelMeta,
	invalidateUsageCache,
	type FooterState,
} from "./state.ts";

type PendingUiChange = "install" | "uninstall";

export function getPendingUiChange(enabled: boolean, active: boolean): PendingUiChange | undefined {
	if (enabled === active) return undefined;
	return enabled ? "install" : "uninstall";
}

function isTuiContext(ctx: ExtensionContext): boolean {
	try {
		const mode = (ctx as ExtensionContext & { mode?: string }).mode;
		return ctx.hasUI && (mode === undefined || mode === "tui");
	} catch {
		return false;
	}
}

export default function (pi: ExtensionAPI) {
	const sessionLifecycle = new SessionLifecycle();
	const state: FooterState = createInitialState();
	const turnTelemetry = new TurnTelemetryTracker();

	let config: PiTuiConfig = structuredClone(DEFAULT_CONFIG);
	let active = false;
	let lastCtx: ExtensionContext | undefined;
	let requestFooterRender: (() => void) | undefined;
	let workingTimer: ReturnType<typeof setInterval> | undefined;
	let cleanupHeader: (() => void) | undefined;
	let cleanupFooter: (() => void) | undefined;
	let cleanupEditor: ReturnType<typeof installEditor> | undefined;
	let pendingUiChange: PendingUiChange | undefined;

	const getThinkingLevel = () => (sessionLifecycle.isCurrent() ? pi.getThinkingLevel() : "off");

	const applyUi = (ctx: ExtensionContext) => {
		if (!isTuiContext(ctx)) return;
		if (!config.enabled) {
			uninstallUi(ctx);
			return;
		}
		if (!active) {
			cleanupHeader = installHeader(pi, ctx);
			cleanupFooter = installFooter(
				ctx,
				() => state,
				() => config,
				() => getModelMeta(ctx, getThinkingLevel),
				{
					setRequestRender: (fn) => {
						requestFooterRender = fn ?? undefined;
					},
					scheduleGitRefresh: () => {
						void scheduleGitRefresh(ctx);
					},
				},
			);
			cleanupEditor = installEditor(pi, ctx, config.cursorStyle, config.fullscreen.wheelScrollLines);
			// pi's built-in working spinner ticks every 80ms and triggers a full
			// TUI re-render (wrapped in synchronized output) each tick. While a
			// modal dialog (e.g. safety-guard) holds an agent run open, that
			// re-render loop shows as constant flicker. The pi-tui footer
			// already shows "working" feedback, so a slow tick is enough.
			// Use { frames: [] } to hide the spinner entirely.
			ctx.ui.setWorkingIndicator({
				frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"].map((f) => ctx.ui.theme.fg("accent", f)),
				intervalMs: 1000,
			});
			active = true;
		}
	};

	const uninstallUi = (ctx: ExtensionContext) => {
		if (!isTuiContext(ctx)) return;
		if (active) {
			cleanupHeader?.();
			cleanupFooter?.();
			cleanupEditor?.cleanup();
			cleanupHeader = undefined;
			cleanupFooter = undefined;
			cleanupEditor = undefined;
			requestFooterRender = undefined;
			active = false;
		}
	};

	const scheduleGitRefresh = async (ctx: ExtensionContext) => {
		if (!sessionLifecycle.isCurrent()) return;
		const segs = config.footerSegments;
		if (!segs.gitBranch && !segs.gitStatus && !segs.gitCommit) {
			state.git = emptyGitStatus();
			requestFooterRender?.();
			return;
		}
		const generation = sessionLifecycle.currentGeneration();
		const cwd = ctx.cwd;
		const git = await readGitStatus(cwd, {
			readCommit: true,
			readTag: segs.gitCommit,
			readCounts: segs.gitStatus,
		});
		if (!sessionLifecycle.isCurrent(generation)) return;
		state.git = git;
		requestFooterRender?.();
	};

	const refreshRuntime = async (ctx: ExtensionContext) => {
		if (!sessionLifecycle.isCurrent()) return;
		const generation = sessionLifecycle.currentGeneration();
		const cwd = ctx.cwd;
		const runtime = await readRuntimeInfo(cwd);
		if (!sessionLifecycle.isCurrent(generation)) return;
		state.runtime = runtime;
		requestFooterRender?.();
	};

	const applyRoundedTools = (ctx: ExtensionContext) => {
		const want = config.enabled && config.roundedTools;
		registerRoundedTools(pi, want, ctx.cwd);
	};

	// Register rounded tool renderers at load time (before session_start) so a
	// /reload transcript rebuild — which pi runs BEFORE emitting session_start —
	// constructs historical tool-call components with the wrapped renderers.
	// session_start re-registers with the real session cwd afterwards, which
	// corrects the execute closure for relative-path tools. Toggling the
	// setting re-registers for new components; already-rendered historical
	// components keep their current frames until the next transcript rebuild
	// (compaction / resume / tree navigation / thinking-block toggle).
	const initialConfig = loadConfig();
	config = initialConfig;
	registerRoundedTools(pi, initialConfig.enabled && initialConfig.roundedTools, process.cwd());

	const refreshInteractiveState = (ctx: ExtensionContext, project = false) => {
		if (!sessionLifecycle.isCurrent() || !ctx.hasUI) return;
		if (project) {
			void scheduleGitRefresh(ctx);
			void refreshRuntime(ctx);
		}
		requestFooterRender?.();
	};

	const startWorkingTimer = () => {
		stopWorkingTimer();
		const tick = () => {
			if (!sessionLifecycle.isCurrent() || !active) return;
			requestFooterRender?.();
		};
		tick();
		workingTimer = setInterval(tick, 250);
		workingTimer.unref?.();
	};

	const stopWorkingTimer = () => {
		if (workingTimer) {
			clearInterval(workingTimer);
			workingTimer = undefined;
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		sessionLifecycle.start();
		lastCtx = ctx;
		state.sessionStartEpoch = Date.now();
		state.workingSince = undefined;
		state.lastDoneIn = undefined;
		invalidateUsageCache();

		ensureConfigExists();
		config = loadConfig((msg, level) => ctx.ui.notify(msg, level));

		applyUi(ctx);
		applyRoundedTools(ctx);

		refreshInteractiveState(ctx, true);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		sessionLifecycle.shutdown();
		stopWorkingTimer();
		if (active) {
			uninstallUi(ctx);
		}
		lastCtx = undefined;
	});

	pi.on("agent_start", (event, _ctx) => {
		turnTelemetry.handle(event);
		if (!sessionLifecycle.isCurrent()) return;
		state.workingSince = Date.now();
		state.lastDoneIn = undefined;
		startWorkingTimer();
	});

	pi.on("agent_end", (_event, _ctx) => {
		if (!sessionLifecycle.isCurrent()) return;
		stopWorkingTimer();
		if (state.workingSince !== undefined) {
			state.lastDoneIn = Date.now() - state.workingSince;
			state.workingSince = undefined;
		}
		requestFooterRender?.();
	});

	pi.on("turn_start", (event) => {
		turnTelemetry.handle(event);
	});

	pi.on("message_start", (event) => {
		turnTelemetry.handle(event);
	});

	pi.on("message_update", (event) => {
		turnTelemetry.handle(event);
	});

	pi.on("tool_execution_start", (event) => {
		turnTelemetry.handle(event);
	});

	pi.on("turn_end", (event) => {
		turnTelemetry.handle(event);
	});

	pi.on("agent_settled", (event, ctx) => {
		const telemetry = turnTelemetry.handle(event);
		if (telemetry && config.enabled && config.telemetry.enabled && isTuiContext(ctx)) {
			const message = formatTurnTelemetry(telemetry, ctx.ui.theme, config.telemetry, config.icons.mode);
			if (message) ctx.ui.notify(message, "info");
		}
	});

	pi.on("model_select", (_event, ctx) => {
		refreshInteractiveState(ctx);
	});

	pi.on("thinking_level_select", (_event, ctx) => {
		refreshInteractiveState(ctx);
	});

	pi.on("message_end", (event, ctx) => {
		turnTelemetry.handle(event);
		if (!sessionLifecycle.isCurrent()) return;
		invalidateUsageCache();
		refreshInteractiveState(ctx);
	});

	pi.on("tool_execution_end", (_event, ctx) => {
		refreshInteractiveState(ctx);
	});

	pi.on("session_compact", (_event, ctx) => {
		if (!sessionLifecycle.isCurrent()) return;
		invalidateUsageCache();
		refreshInteractiveState(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		if (!sessionLifecycle.isCurrent()) return;
		invalidateUsageCache();
		refreshInteractiveState(ctx);
	});

	registerSettingsCommand(pi, {
		getConfig: () => config,
		onConfigChanged: (newConfig) => {
			const wasEnabled = config.enabled;
			const wasRoundedTools = config.roundedTools;
			const cursorStyleChanged = config.cursorStyle !== newConfig.cursorStyle;
			const wheelScrollLinesChanged = config.fullscreen.wheelScrollLines !== newConfig.fullscreen.wheelScrollLines;
			saveConfig(newConfig);
			config = newConfig;
			if (cursorStyleChanged && active && cleanupEditor) {
				cleanupEditor.setCursorStyle(newConfig.cursorStyle);
			}
			if (wheelScrollLinesChanged && active && cleanupEditor) {
				cleanupEditor.setWheelScrollLines(newConfig.fullscreen.wheelScrollLines);
			}
			if (lastCtx) {
				pendingUiChange = getPendingUiChange(newConfig.enabled, active);
			}
			if (lastCtx && (wasRoundedTools !== newConfig.roundedTools || wasEnabled !== newConfig.enabled)) {
				applyRoundedTools(lastCtx);
			}
			const gitNeeded = newConfig.footerSegments.gitBranch || newConfig.footerSegments.gitStatus || newConfig.footerSegments.gitCommit;
			if (lastCtx && gitNeeded) {
				void scheduleGitRefresh(lastCtx);
			} else {
				state.git = emptyGitStatus();
			}
			requestFooterRender?.();
		},
		onOverlayClosed: () => {
			if (!lastCtx || pendingUiChange === undefined) return;
			const change = pendingUiChange;
			pendingUiChange = undefined;
			if (!config.enabled || change === "uninstall") {
				uninstallUi(lastCtx);
			} else {
				applyUi(lastCtx);
			}
		},
	});
}
