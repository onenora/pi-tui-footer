/**
 * Rounded tool frames — rounded frames for tool calls and results.
 *
 * Re-registers built-in tools (read, write, bash, powershell, grep, find, ls)
 * with `renderShell: "self"` and wraps each tool call / result in a frame
 * drawn with Unicode rounded-corner characters (╭ ╮ ╰ ╯ ─ │).
 *
 * Tools that already render their own shell (e.g. `edit` in modern Pi versions)
 * are preserved as-is to avoid duplicate nesting and UI glitches.
 *
 * Border color follows `theme.fg("border", ...)` so it adapts to your theme,
 * using warning (yellow) during pending/streaming execution and error (red) on failure.
 *
 * Non-default tools (grep, find, ls, powershell) preserve `defaultActive: false`
 * to avoid polluting the model's active toolset.
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
//   - "closed"      → ╭ ── ╮ / │ x │ / ╰ ── ╯ (standalone box / pending call)
//   - "open-bottom" → ╭ ── ╮ / │ x │        (top of a stacked frame)
//   - "open-top"    →        │ x │ / ╰ ── ╯ (bottom of a stacked frame)

export type FrameMode = "closed" | "open-bottom" | "open-top";

export class RoundedFrame implements Component {
	private cachedWidth: number | undefined;
	private cachedInnerLines: string[] | undefined;
	private cachedLines: string[] | undefined;

	constructor(
		private inner: Component,
		private border: (text: string) => string,
		private mode: FrameMode = "closed",
	) {}

	getInner(): Component {
		return this.inner;
	}

	getMode(): FrameMode {
		return this.mode;
	}

	setMode(mode: FrameMode): void {
		if (this.mode !== mode) {
			this.mode = mode;
			this.invalidate();
		}
	}

	update(inner: Component, border: (text: string) => string, mode: FrameMode): this {
		if (this.inner !== inner || this.mode !== mode) {
			this.inner = inner;
			this.mode = mode;
			this.invalidate();
		}
		this.border = border;
		return this;
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
}

const frame = (
	inner: Component,
	theme: { fg: (color: string, text: string) => string },
	mode: FrameMode = "closed",
	colorKey: string = "border",
): RoundedFrame => new RoundedFrame(inner, (t) => theme.fg(colorKey, t), mode);

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

function unwrapInner(component: unknown): Component | undefined {
	if (component instanceof RoundedFrame) {
		return component.getInner();
	}
	return component as Component | undefined;
}

export function wrapBuiltin(def: ToolDef): ToolDef {
	// Tools that already manage their own shell (e.g. edit) should remain untouched.
	if (def.renderShell === "self") {
		return def;
	}

	return {
		...def,
		renderShell: "self" as const,
		renderCall: (args: any, theme: any, context: any) => {
			const unwrapped = unwrapInner(context?.lastComponent);
			const inner: Component = def.renderCall
				? def.renderCall(args, theme, { ...context, lastComponent: unwrapped })
				: EMPTY_COMPONENT;

			// If the tool is still pending/streaming and no result has arrived yet,
			// close the bottom border so it renders as a complete box instead of an open frame.
			const isPendingWithoutResult = Boolean(context?.isPartial && !context?.state?.__hasResult);
			const mode: FrameMode = def.renderResult && !isPendingWithoutResult ? "open-bottom" : "closed";
			const borderFn = (t: string) => theme.fg(borderColorFor(context), t);

			let callFrame: RoundedFrame;
			if (context?.lastComponent instanceof RoundedFrame) {
				callFrame = context.lastComponent.update(inner, borderFn, mode);
			} else {
				callFrame = frame(inner, theme, mode, borderColorFor(context));
			}

			if (context?.state) {
				context.state.__callFrame = callFrame;
			}
			return callFrame;
		},
		renderResult: (result: any, options: any, theme: any, context: any) => {
			if (context?.state) {
				context.state.__hasResult = true;
				// Connect seamlessly with the call frame by opening its bottom border.
				const callFrame = context.state.__callFrame;
				if (callFrame instanceof RoundedFrame && callFrame.getMode() !== "open-bottom") {
					callFrame.setMode("open-bottom");
				}
			}

			const unwrapped = unwrapInner(context?.lastComponent);
			const inner: Component = def.renderResult
				? def.renderResult(result, options, theme, { ...context, lastComponent: unwrapped })
				: EMPTY_COMPONENT;
			const borderFn = (t: string) => theme.fg(borderColorFor(context), t);

			if (context?.lastComponent instanceof RoundedFrame) {
				return context.lastComponent.update(inner, borderFn, "open-top");
			}
			return frame(inner, theme, "open-top", borderColorFor(context));
		},
	};
}

export function registerRoundedTools(
	target: ExtensionAPI | ((tool: ToolDef) => void),
	enabled: boolean,
	cwd: string,
	_captured?: Map<string, ToolDef>,
): void {
	const register = typeof target === "function" ? target : target.registerTool.bind(target);

	let settings: any;
	if (typeof target !== "function" && target.getSettings) {
		try {
			settings = target.getSettings();
		} catch {
			// runtime not initialized yet during early load
		}
	}
	const autoResizeImages = settings?.images?.autoResize ?? true;
	const shellCommandPrefix = settings?.shellCommandPrefix;
	const shellPath = settings?.shellPath;

	let activeToolNames: Set<string> | undefined;
	if (typeof target !== "function" && target.getActiveTools) {
		try {
			const active = target.getActiveTools();
			if (Array.isArray(active) && active.length > 0) {
				activeToolNames = new Set(active);
			}
		} catch {
			// runtime not initialized yet during early load
		}
	}
	const defaultActiveNames = activeToolNames ?? new Set(["read", "bash", "edit", "write"]);

	const builtins: Record<string, () => ToolDef> = {
		read: () => createReadToolDefinition(cwd, { autoResizeImages }),
		write: () => createWriteToolDefinition(cwd),
		edit: () => createEditToolDefinition(cwd),
		bash: () => createBashToolDefinition(cwd, { commandPrefix: shellCommandPrefix, shellPath }),
		powershell: () => createPowerShellToolDefinition(cwd, { shellPath }),
		ls: () => createLsToolDefinition(cwd),
		grep: () => createGrepToolDefinition(cwd),
		find: () => createFindToolDefinition(cwd),
	};

	for (const [name, factory] of Object.entries(builtins)) {
		const rawDef = factory();
		// Skip tools that already manage their own shell framing (e.g. edit)
		if (rawDef.renderShell === "self") {
			continue;
		}

		const shouldBeActive = defaultActiveNames.has(name);
		const baseDef: ToolDef = {
			...rawDef,
			defaultActive: shouldBeActive,
		};

		register(enabled ? wrapBuiltin(baseDef) : baseDef);
	}
}

export class RoundedToolsManager {
	private enabled = false;

	constructor(private readonly pi: ExtensionAPI) {}

	/** Register initial tools before session_start with fallback cwd. */
	init(enabled: boolean, cwd = process.cwd()): void {
		this.enabled = enabled;
		registerRoundedTools(this.pi, enabled, cwd);
	}

	/** Apply tools with current session cwd. */
	apply(enabled: boolean, cwd: string): void {
		this.enabled = enabled;
		registerRoundedTools(this.pi, enabled, cwd);
	}
}
