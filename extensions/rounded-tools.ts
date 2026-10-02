/**
 * Rounded tool frames (merged port) — rounded frames for tool calls and results.
 *
 * Merged 2026-08 from the standalone local extension rounded-tools.ts (a
 * localized copy of npm:pi-rounded-tools@0.1.3, MIT, by OrionPax,
 * https://github.com/orionpax1997/pi-rounded-tools), integrated into pi-tui
 * (based on https://github.com/OldSuns/pi-open-tui v0.3.11, MIT, by
 * OldSun) and gated behind `roundedTools` in pi-tui config
 * (~/.pi/agent/pi-tui.json, default on).
 *
 * Re-registers the built-in tools (read, write, edit, bash, grep, find, ls)
 * with `renderShell: "self"` and wraps each tool call / result in a frame
 * drawn with Unicode rounded-corner characters (╭ ╮ ╰ ╯ ─ │).
 *
 * No left color bar, no theme matching — just the corners.
 * Border color follows `theme.fg("border", …)` so it adapts to your theme.
 *
 * Implementation note: we don't reimplement the inner rendering — we just
 * call the built-in `renderCall` / `renderResult` and wrap the returned
 * component in a `RoundedFrame`. That way bash's preview, read's syntax
 * highlighting, edit's diff stats, etc. all stay exactly as pi ships them.
 *
 * Disabling registers the plain built-in definitions again, restoring stock
 * rendering in the current session without a /reload.
 */

import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createPowerShellToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";

// ─── Rounded-corner frame ────────────────────────────────────────────────
//
// Three modes let call + result stack into one continuous frame:
//   - "closed"      → ╭ ── ╮ / │ x │ / ╰ ── ╯ (standalone box)
//   - "open-bottom" → ╭ ── ╮ / │ x │        (top of a stacked frame)
//   - "open-top"    →        │ x │ / ╰ ── ╯ (bottom of a stacked frame)

type FrameMode = "closed" | "open-bottom" | "open-top";

class RoundedFrame implements Component {
	constructor(
		private readonly inner: Component,
		private readonly border: (text: string) => string,
		private readonly mode: FrameMode = "closed",
	) {}

	getInner(): Component {
		return this.inner;
	}

	invalidate(): void {
		this.inner.invalidate?.();
		this.cachedWidth = undefined;
		this.cachedInnerLines = undefined;
		this.cachedLines = undefined;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (!this.inner.handleMouse) return undefined;

		const width = this.cachedWidth ?? event.width;
		if (width < 4) {
			return this.inner.handleMouse(event);
		}

		const innerWidth = Math.max(1, width - 4);
		const paddingTop = this.mode !== "open-top" ? 1 : 0;
		const contentX = event.x - 2;
		const contentY = event.y - paddingTop;
		const innerHeight = this.cachedInnerLines?.length ?? 0;

		if (contentX < 0 || contentX >= innerWidth || contentY < 0 || contentY >= innerHeight) {
			return undefined;
		}

		return this.inner.handleMouse({
			...event,
			x: contentX,
			y: contentY,
			width: innerWidth,
		});
	}

	// pi's built-in tool renderers cache the previously-returned component
	// via `context.lastComponent` and call mutating methods on it
	// (`Text.setText`, `Container.clear`/`addChild`, `invalidate`) so they
	// can re-render in place during streaming. Once we wrap the inner in a
	// RoundedFrame, pi hands our wrapper back to the inner renderer on the
	// next render — but pi's try/catch around `callRenderer(...)` falls
	// back to a plain `createCallFallback()` text node if the inner
	// renderer throws, which would make the border vanish on every
	// Ctrl+O toggle. Forward these methods to the inner so the original
	// renderers work unchanged; calls on a wrapper whose inner lacks the
	// method are no-ops thanks to optional chaining.
	setText(text: string): void {
		(this.inner as any).setText?.(text);
	}

	clear(): void {
		(this.inner as any).clear?.();
	}

	addChild(child: any): void {
		(this.inner as any).addChild?.(child);
	}

	render(width: number): string[] {
		if (width < 4) {
			return this.inner.render(width);
		}

		const innerWidth = Math.max(1, width - 4); // │ + space + content + space + │
		const innerLines = this.inner.render(innerWidth);

		// pi's TUI re-renders every transcript component on every render
		// cycle (each keystroke), but built-in components below us (e.g.
		// `Text`, `Box`) cache their rendered line arrays and return the
		// same array reference when content and width haven't changed.
		// Without a cache here, every keystroke re-runs `visibleWidth()`
		// (ANSI parsing) and string building for every line of every
		// framed tool entry — O(N_session) per keypress, visible as input
		// lag on long sessions.
		//
		// Cache key: `width` plus the array reference returned by
		// `inner.render()`. Built-in Text/Box return the same reference on
		// cache hits and a fresh array whenever their content changes
		// (e.g. Ctrl+O expand), so reference equality is a reliable change
		// signal. `invalidate()` (theme changes etc.) clears the cache
		// explicitly, and so does an actual `width` change.
		if (
			this.cachedLines &&
			this.cachedWidth === width &&
			this.cachedInnerLines === innerLines
		) {
			return this.cachedLines;
		}

		const horizontal = "─".repeat(Math.max(0, width - 2));
		const side = this.border("│");

		const out: string[] = [];

		if (this.mode !== "open-top") {
			out.push(this.border("╭" + horizontal + "╮"));
		}

		if (innerLines.length > 0) {
			for (const line of innerLines) {
				const vis = visibleWidth(line);
				const pad = " ".repeat(Math.max(0, innerWidth - vis));
				out.push(side + " " + line + pad + " " + side);
			}
		} else if (this.mode === "closed") {
			// Standalone closed frame with no content: draw a placeholder row
			// so the box still has visual presence. Skipped for open-top /
			// open-bottom since they pair with another half-frame and a fake
			// empty row would show up as a stray blank line in the middle.
			out.push(side + " ".repeat(width - 2) + side);
		}

		if (this.mode !== "open-bottom") {
			out.push(this.border("╰" + horizontal + "╯"));
		}
		this.cachedWidth = width;
		this.cachedInnerLines = innerLines;
		this.cachedLines = out;
		return out;
	}

	private cachedWidth: number | undefined;
	private cachedInnerLines: string[] | undefined;
	private cachedLines: string[] | undefined;
}

const frame = (
	inner: Component,
	theme: { fg: (color: string, text: string) => string },
	mode: FrameMode = "closed",
	colorKey: string = "border",
): Component => new RoundedFrame(inner, (t) => theme.fg(colorKey, t), mode);

/**
 * Pick a border color key based on the tool's runtime state.
 *
 *   - still running (`context.isPartial`) → warning (yellow)
 *   - finished with an error (`context.isError`) → error (red)
 *   - finished successfully → border (theme default)
 *
 * Both `renderCall` and `renderResult` go through this picker, so when
 * they stack into one continuous frame, the borders match. pi re-renders
 * the whole component on every state transition (args streaming → done,
 * partial → final), and `context.isPartial` flips accordingly, so call
 * and result always pick the same color at any given moment.
 *
 * Mirrors pi's own 3-state scheme (`toolPendingBg` / `toolSuccessBg` /
 * `toolErrorBg`) — see `theme.js`.
 */
function borderColorFor(
	context: { isPartial?: boolean; isError?: boolean } | undefined,
): string {
	if (context?.isError) return "error";
	if (context?.isPartial) return "warning";
	return "border";
}

// ─── Helpers ─────────────────────────────────────────────────────────────

type ToolDef = ToolDefinition<any, any, any>;

const EMPTY_COMPONENT: Component = { render: () => [], invalidate: () => {} };

/**
 * Unwrap inner component from a RoundedFrame if context.lastComponent is wrapped,
 * allowing underlying renderers (e.g. edit, bash, read) to preserve their component
 * cache across renders instead of recreating on every tick.
 */
function unwrapInner(component: unknown): Component | undefined {
	if (component instanceof RoundedFrame) {
		return component.getInner();
	}
	return component as Component | undefined;
}

/**
 * Wrap a tool definition in rounded frames.
 *
 * Preserves all metadata (promptSnippet, promptGuidelines, parameters, etc.)
 * while wrapping renderCall and renderResult with rounded borders.
 * Uses closed mode for tools without renderResult to avoid open bottom borders.
 */
function wrapBuiltin(def: ToolDef) {
	const callMode: FrameMode = def.renderResult ? "open-bottom" : "closed";
	return {
		...def,
		renderShell: "self" as const,
		renderCall: (args: any, theme: any, context: any) => {
			const unwrapped = unwrapInner(context?.lastComponent);
			const inner: Component = def.renderCall
				? def.renderCall(args, theme, { ...context, lastComponent: unwrapped })
				: EMPTY_COMPONENT;
			return frame(inner, theme, callMode, borderColorFor(context));
		},
		renderResult: (result: any, options: any, theme: any, context: any) => {
			const unwrapped = unwrapInner(context?.lastComponent);
			const inner: Component = def.renderResult
				? def.renderResult(result, options, theme, { ...context, lastComponent: unwrapped })
				: EMPTY_COMPONENT;
			return frame(inner, theme, "open-top", borderColorFor(context));
		},
	};
}

/**
 * Register built-in tools (read, write, edit, bash, powershell, grep, find, ls),
 * either with rounded frames (`enabled`) or with stock definitions (`!enabled`).
 *
 * If a third-party extension has already replaced a built-in tool (e.g. pi-fff
 * overriding grep/find), that tool is skipped here to prevent clobbering.
 */
export function registerRoundedTools(
	target: ExtensionAPI | ((tool: ToolDef) => void),
	enabled: boolean,
	cwd: string,
	captured?: Map<string, ToolDef>,
): void {
	const register = typeof target === "function" ? target : target.registerTool.bind(target);

	const builtins: Record<string, () => ToolDef> = {
		read: () => createReadToolDefinition(cwd),
		write: () => createWriteToolDefinition(cwd),
		edit: () => createEditToolDefinition(cwd),
		bash: () => createBashToolDefinition(cwd),
		powershell: () => createPowerShellToolDefinition(cwd),
		ls: () => createLsToolDefinition(cwd),
		grep: () => createGrepToolDefinition(cwd),
		find: () => createFindToolDefinition(cwd),
	};

	for (const [name, factory] of Object.entries(builtins)) {
		if (!captured?.has(name)) {
			register(enabled ? wrapBuiltin(factory()) : factory());
		}
	}
}

/**
 * Manager class encapsulating rounded tools registration and lifecycle updates.
 *
 * In addition to wrapping built-in tools, it installs a `pi.registerTool` proxy
 * so that any tool registered by third-party extensions (e.g. pi-fff's ffgrep,
 * fffind, fff-multi-grep, or overridden grep/find) automatically receives rounded
 * frames when `roundedTools` is enabled, without maintaining a fragile hardcoded
 * name whitelist.
 *
 * Load-order note: For extensions that register tools at load time, place
 * `pi-tui-footer` before those packages in `~/.pi/agent/settings.json` so the
 * proxy is active when they load.
 */
export class RoundedToolsManager {
	private enabled = false;
	private proxyInstalled = false;
	/** The real `pi.registerTool` before we installed the proxy. */
	private originalRegisterTool!: (tool: ToolDef) => void;
	/** Original (unwrapped) definitions captured from third-party tools. */
	private readonly captured = new Map<string, ToolDef>();

	constructor(private readonly pi: ExtensionAPI) {
		this.installProxy();
	}

	/** Register initial tools before session_start with fallback cwd. */
	init(enabled: boolean, cwd = process.cwd()): void {
		this.enabled = enabled;
		this.installProxy();
		registerRoundedTools(this.originalRegisterTool, enabled, cwd, this.captured);
		this.reRegisterCaptured();
	}

	/** Apply tools with current session cwd. */
	apply(enabled: boolean, cwd: string): void {
		this.enabled = enabled;
		this.installProxy();
		registerRoundedTools(this.originalRegisterTool, enabled, cwd, this.captured);
		this.reRegisterCaptured();
	}

	/**
	 * Install a one-time proxy on `pi.registerTool` to intercept third-party
	 * tool registrations.
	 */
	private installProxy(): void {
		if (this.proxyInstalled) return;
		this.proxyInstalled = true;

		this.originalRegisterTool = this.pi.registerTool.bind(this.pi);
		const original = this.originalRegisterTool;
		const self = this;

		this.pi.registerTool = function proxyRegisterTool(tool: ToolDef) {
			// Don't intercept tools that already render their own shell
			if (tool.renderShell === "self") {
				original(tool);
				return;
			}

			// Capture the unwrapped original definition
			self.captured.set(tool.name, tool);
			original(self.enabled ? wrapBuiltin(tool) : tool);
		};
	}

	/**
	 * Re-register all captured third-party tools with or without rounded
	 * frames based on the current `enabled` state.
	 */
	private reRegisterCaptured(): void {
		for (const def of this.captured.values()) {
			this.originalRegisterTool(this.enabled ? wrapBuiltin(def) : def);
		}
	}
}

