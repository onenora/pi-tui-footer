/**
 * Rounded tool frames — rounded frames for tool calls and results.
 *
 * Uses `pi.registerToolRenderer()` to wrap the renderers of built-in tools
 * (read, write, bash, powershell, grep, find, ls, plus pi-fff's ffgrep, fffind,
 * fff-multi-grep) with `renderShell: "self"`
 * and a frame drawn with Unicode rounded-corner characters (╭ ╮ ╰ ╯ ─ │).
 * Tool definitions, execution and active-tool state are left untouched.
 *
 * Tools that already render their own shell (e.g. `edit`) are preserved as-is
 * to avoid duplicate nesting and UI glitches.
 *
 * Border color follows `theme.fg("border", ...)` so it adapts to your theme,
 * using warning (yellow) during pending/streaming execution and error (red) on failure.
 */

import type { ExtensionAPI, ToolRenderers } from "@earendil-works/pi-coding-agent";
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";

// ─── Rounded-corner frame ────────────────────────────────────────────────
//
// Three modes let call + result stack into one continuous frame:
//   - "closed"      → ╭ ── ╮ / │ x │ / ╰ ── ╯ (standalone box / pending call)
//   - "open-bottom" → ╭ ── ╮ / │ x │        (top of a stacked frame)
//   - "open-top"    →        │ x │ / ╰ ── ╯ (bottom of a stacked frame)

export type FrameMode = "closed" | "open-bottom" | "open-top";

// ─── Border color ────────────────────────────────────────────────────────

type RenderContext = { isPartial?: boolean; isError?: boolean };

function borderColorFor(context: RenderContext | undefined): string {
	if (context?.isError) return "error";
	if (context?.isPartial) return "warning";
	return "border";
}

// ─── RoundedFrame component ─────────────────────────────────────────────

export class RoundedFrame implements Component {
	private cachedWidth: number | undefined;
	private cachedInnerLines: string[] | undefined;
	private cachedLines: string[] | undefined;

	constructor(
		private inner: Component,
		private border: (text: string) => string,
		private mode: FrameMode = "closed",
		private colorKey: string = "border",
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

	update(
		inner: Component,
		border: (text: string) => string,
		mode: FrameMode,
		colorKey: string,
	): this {
		if (this.inner !== inner || this.mode !== mode || this.colorKey !== colorKey) {
			this.inner = inner;
			this.mode = mode;
			this.colorKey = colorKey;
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

		const horizontal = "─".repeat(width - 2);
		const side = this.border("│");
		const out: string[] = [];

		if (this.mode !== "open-top") {
			out.push(this.border("╭" + horizontal + "╮"));
		}

		if (innerLines.length > 0) {
			for (const line of innerLines) {
				const pad = " ".repeat(Math.max(0, innerWidth - visibleWidth(line)));
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

// ─── Frame factories ────────────────────────────────────────────────────

const createFrame = (
	inner: Component,
	theme: { fg: (color: string, text: string) => string },
	mode: FrameMode = "closed",
	colorKey: string = "border",
): RoundedFrame => new RoundedFrame(inner, (t) => theme.fg(colorKey, t), mode, colorKey);

const EMPTY_COMPONENT: Component = { render: () => [], invalidate: () => {} };

// ─── Tool wrapping ──────────────────────────────────────────────────────

const ROUNDED_TOOL_NAMES: ReadonlySet<string> = new Set([
	"read",
	"write",
	"bash",
	"powershell",
	"grep",
	"find",
	"ls",
	// pi-fff (@ff-labs/pi-fff) tools; resolvers match by name, so load order is irrelevant.
	"ffgrep",
	"fffind",
	"fff-multi-grep",
]);

function unwrapInner(component: unknown): Component | undefined {
	return component instanceof RoundedFrame ? component.getInner() : (component as Component | undefined);
}

export function wrapRenderers(def: ToolRenderers): ToolRenderers {
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
			const colorKey = borderColorFor(context);
			const borderFn = (t: string) => theme.fg(colorKey, t);

			let callFrame: RoundedFrame;
			if (context?.lastComponent instanceof RoundedFrame) {
				callFrame = context.lastComponent.update(inner, borderFn, mode, colorKey);
			} else {
				callFrame = createFrame(inner, theme, mode, colorKey);
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
			const colorKey = borderColorFor(context);
			const borderFn = (t: string) => theme.fg(colorKey, t);

			if (context?.lastComponent instanceof RoundedFrame) {
				return context.lastComponent.update(inner, borderFn, "open-top", colorKey);
			}
			return createFrame(inner, theme, "open-top", colorKey);
		},
	};
}

// ─── Manager ─────────────────────────────────────────────────────────────

export class RoundedToolsManager {
	private enabled = false;

	/**
	 * Install the renderer resolver once at extension load. Toggling `enabled`
	 * affects tool components created afterwards (resume / reload / new calls).
	 */
	constructor(pi: ExtensionAPI) {
		pi.registerToolRenderer?.((toolName, next) => {
			const base = next();
			if (!base || !this.enabled || !ROUNDED_TOOL_NAMES.has(toolName)) return base;
			// Nothing to frame: let pi use its own fallback rendering.
			if (!base.renderCall && !base.renderResult) return base;
			return wrapRenderers(base);
		});
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}
}
