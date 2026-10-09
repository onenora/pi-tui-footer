/**
 * Rounded tool frames — rounded frames for tool calls and results.
 *
 * Uses `pi.registerToolRenderer()` to wrap the renderers of built-in tools
 * (read, write, edit, bash, powershell, grep, find, ls, plus pi-fff's ffgrep, fffind,
 * fff-multi-grep) with `renderShell: "self"`
 * and a frame drawn with Unicode rounded-corner characters (╭ ╮ ╰ ╯ ─ │).
 * Tool definitions, execution and active-tool state are left untouched.
 *
 * A tool that draws its own shell as a background `Box` (e.g. `edit`) has the Box's
 * background and vertical padding dropped, so only its content sits in the frame.
 *
 * Border color follows `theme.fg("border", ...)` so it adapts to your theme,
 * using warning (yellow) during pending/streaming execution and error (red) on failure.
 */

import type { ExtensionAPI, ThemeColor, ToolRenderers } from "@earendil-works/pi-coding-agent";
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { Box, Container, visibleWidth } from "@earendil-works/pi-tui";

type CallRenderer = NonNullable<ToolRenderers["renderCall"]>;
type Theme = Parameters<CallRenderer>[1];
type RenderContext = Parameters<CallRenderer>[2];

// ─── Rounded-corner frame ────────────────────────────────────────────────
//
// Three modes let call + result stack into one continuous frame:
//   - "closed"      → ╭ ── ╮ / │ x │ / ╰ ── ╯ (standalone box / pending call)
//   - "open-bottom" → ╭ ── ╮ / │ x │        (top of a stacked frame)
//   - "open-top"    →        │ x │ / ╰ ── ╯ (bottom of a stacked frame)

export type FrameMode = "closed" | "open-bottom" | "open-top";

type Role = "call" | "result";

const FRAME_OVERHEAD = 4; // │ + space + content + space + │
const MIN_FRAMED_WIDTH = FRAME_OVERHEAD + 1; // narrower than this the content has no column: render unframed

// ─── Border color ────────────────────────────────────────────────────────

function borderColorFor(context: Pick<RenderContext, "isError" | "isPartial">): ThemeColor {
	if (context.isError) return "error";
	if (context.isPartial) return "warning";
	return "border";
}

/** Same check as pi's own Box: an inner component such as bash's Container hands out a fresh array every render. */
function sameLines(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/**
 * The call frame and the result frame of one tool row. Each resolves its mode while rendering by
 * looking at the other, instead of the renderers patching it from outside: pi's HTML export renders
 * a call and its result separately, and the call has long been drawn when the result arrives.
 */
class FrameGroup {
	call: RoundedFrame | undefined;
	result: RoundedFrame | undefined;
}

/**
 * The children of a tool's shell Box without its background and vertical padding. Reads them on every
 * pass: edit rebuilds its call Box in place, also from its result renderer.
 */
class BoxContent extends Container {
	constructor(readonly box: Box) {
		super();
	}

	override invalidate(): void {
		this.children = this.box.children;
		super.invalidate();
	}

	override handleMouse(event: TuiMouseEvent) {
		this.children = this.box.children;
		return super.handleMouse(event);
	}

	override render(width: number): string[] {
		this.children = this.box.children;
		return super.render(width);
	}
}

// ─── RoundedFrame component ─────────────────────────────────────────────

export class RoundedFrame implements Component {
	private cache:
		| { width: number; mode: FrameMode; colorKey: ThemeColor; inner: string[]; lines: string[] }
		| undefined;
	/** Mode of the latest framed render; undefined when the last render was too narrow to frame. */
	private drawn: FrameMode | undefined;

	constructor(
		private readonly group: FrameGroup,
		private readonly role: Role,
		private inner: Component,
		private border: (text: string) => string,
		private colorKey: ThemeColor,
	) {
		group[role] = this;
	}

	getInner(): Component {
		return this.inner;
	}

	/** No invalidation needed: the cache is keyed on everything its lines were built from. */
	update(inner: Component, border: (text: string) => string, colorKey: ThemeColor): this {
		this.inner = inner;
		this.border = border;
		this.colorKey = colorKey;
		return this;
	}

	invalidate(): void {
		this.inner.invalidate?.();
		this.cache = undefined;
	}

	/**
	 * The call frame stays closed until a result frame exists. The result frame joins it (open-top) only
	 * if the call frame drew itself open at the bottom, which relies on pi rendering the call component
	 * before the result component in every pass.
	 */
	private resolveMode(): FrameMode {
		if (this.role === "call") return this.group.result ? "open-bottom" : "closed";
		return this.group.call?.drawn === "open-bottom" ? "open-top" : "closed";
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const inner = this.inner;
		if (!inner.handleMouse) return undefined;
		if (this.drawn === undefined) return inner.handleMouse(event);

		const x = event.x - 2;
		const y = event.y - (this.drawn === "open-top" ? 0 : 1);
		const width = event.width - FRAME_OVERHEAD;
		const height = this.cache?.inner.length ?? 0;
		if (x < 0 || x >= width || y < 0 || y >= height) return undefined;
		return inner.handleMouse({ ...event, x, y, width, height });
	}

	render(width: number): string[] {
		if (width < MIN_FRAMED_WIDTH) {
			this.drawn = undefined;
			return this.inner.render(width);
		}

		const innerWidth = width - FRAME_OVERHEAD;
		const innerLines = this.inner.render(innerWidth);
		const mode = this.resolveMode();
		this.drawn = mode;

		const cache = this.cache;
		if (
			cache &&
			cache.width === width &&
			cache.mode === mode &&
			cache.colorKey === this.colorKey &&
			sameLines(cache.inner, innerLines)
		) {
			return cache.lines;
		}

		const horizontal = "─".repeat(width - 2);
		const side = this.border("│");
		const left = side + " ";
		const right = " " + side;
		const out: string[] = [];

		if (mode !== "open-top") {
			out.push(this.border("╭" + horizontal + "╮"));
		}

		if (innerLines.length > 0) {
			for (const line of innerLines) {
				const pad = " ".repeat(Math.max(0, innerWidth - visibleWidth(line)));
				out.push(left + line + pad + right);
			}
		} else if (mode === "closed") {
			out.push(side + " ".repeat(width - 2) + side);
		}

		if (mode !== "open-bottom") {
			out.push(this.border("╰" + horizontal + "╯"));
		}

		// Keep a copy: the inner component may reuse its array and change it in place.
		this.cache = { width, mode, colorKey: this.colorKey, inner: innerLines.slice(), lines: out };
		return out;
	}
}

// ─── Tool wrapping ──────────────────────────────────────────────────────

const ROUNDED_TOOL_NAMES: ReadonlySet<string> = new Set([
	"read",
	"write",
	"edit",
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

// Keyed by the row's renderer state, so nothing is written into the state the tool itself uses.
const GROUPS = new WeakMap<object, FrameGroup>();

function groupOf(state: object | undefined): FrameGroup {
	if (!state) return new FrameGroup();
	let group = GROUPS.get(state);
	if (!group) GROUPS.set(state, (group = new FrameGroup()));
	return group;
}

/**
 * Hand the tool its own previous component back, not the frame around it. The frame already pads its
 * content, so self-shell tools must not add outputPad on top.
 */
function innerContext(context: RenderContext): RenderContext {
	const last = context.lastComponent;
	let inner = last instanceof RoundedFrame ? last.getInner() : last;
	if (inner instanceof BoxContent) inner = inner.box;
	return { ...context, lastComponent: inner, outputPad: 0 };
}

function frameFor(role: Role, rendered: Component, theme: Theme, context: RenderContext): RoundedFrame {
	const inner = rendered instanceof Box ? new BoxContent(rendered) : rendered;
	const colorKey = borderColorFor(context);
	const border = (text: string) => theme.fg(colorKey, text);
	const last = context.lastComponent;
	return last instanceof RoundedFrame
		? last.update(inner, border, colorKey)
		: new RoundedFrame(groupOf(context.state), role, inner, border, colorKey);
}

export function wrapRenderers(def: ToolRenderers): ToolRenderers {
	const { renderCall, renderResult } = def;
	return {
		...def,
		renderShell: "self",
		// A part the tool does not define stays undefined, so pi draws its own fallback for it
		// (unframed) instead of an empty frame swallowing the call or the result text.
		renderCall:
			renderCall &&
			((args, theme, context) => frameFor("call", renderCall(args, theme, innerContext(context)), theme, context)),
		renderResult:
			renderResult &&
			((result, options, theme, context) =>
				frameFor("result", renderResult(result, options, theme, innerContext(context)), theme, context)),
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
