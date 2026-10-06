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

type ToolDef = ToolDefinition<any, any, any>;

function unwrapInner(component: unknown): Component | undefined {
	return component instanceof RoundedFrame ? component.getInner() : (component as Component | undefined);
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

// ─── Built-in tool factories ─────────────────────────────────────────────

type BuiltinFactory = (cwd: string, opts: BuiltinFactoryOpts) => ToolDef;
interface BuiltinFactoryOpts {
	autoResizeImages?: boolean;
	commandPrefix?: string;
	shellPath?: string;
}

const BUILTIN_FACTORIES: ReadonlyMap<string, BuiltinFactory> = new Map<string, BuiltinFactory>([
	["read", (cwd, opts) => createReadToolDefinition(cwd, { autoResizeImages: opts.autoResizeImages })],
	["write", (cwd) => createWriteToolDefinition(cwd)],
	["edit", (cwd) => createEditToolDefinition(cwd)],
	["bash", (cwd, opts) => createBashToolDefinition(cwd, { commandPrefix: opts.commandPrefix, shellPath: opts.shellPath })],
	["powershell", (cwd) => createPowerShellToolDefinition(cwd)],
	["ls", (cwd) => createLsToolDefinition(cwd)],
	["grep", (cwd) => createGrepToolDefinition(cwd)],
	["find", (cwd) => createFindToolDefinition(cwd)],
]);

const DEFAULT_ACTIVE_TOOLS = new Set(["read", "bash", "edit", "write"]);

// ─── Registration ────────────────────────────────────────────────────────

export function registerRoundedTools(
	target: ExtensionAPI | ((tool: ToolDef) => void),
	enabled: boolean,
	cwd: string,
	opts?: BuiltinFactoryOpts,
	activeToolNames?: Set<string>,
): void {
	const register = typeof target === "function" ? target : target.registerTool.bind(target);
	const defaultActiveNames = activeToolNames ?? DEFAULT_ACTIVE_TOOLS;

	for (const [name, factory] of BUILTIN_FACTORIES) {
		const rawDef = factory(cwd, opts ?? {});
		// Skip tools that already manage their own shell framing (e.g. edit)
		if (rawDef.renderShell === "self") continue;

		const baseDef: ToolDef = {
			...rawDef,
			defaultActive: defaultActiveNames.has(name),
		};

		register(enabled ? wrapBuiltin(baseDef) : baseDef);
	}
}

// ─── Manager ─────────────────────────────────────────────────────────────

export class RoundedToolsManager {
	private factoryOpts: BuiltinFactoryOpts = {};
	private activeToolNames: Set<string> = DEFAULT_ACTIVE_TOOLS;

	constructor(private readonly pi: ExtensionAPI) {}

	/** Re-read settings and active tools; keeps previous values if the runtime is not ready. */
	private refreshSettings(): void {
		try {
			const settings = this.pi.getSettings?.();
			this.factoryOpts = {
				autoResizeImages: settings?.images?.autoResize ?? true,
				commandPrefix: settings?.shellCommandPrefix,
				shellPath: settings?.shellPath,
			};
		} catch {
			// runtime not initialized yet during early load
		}
		try {
			const active = this.pi.getActiveTools?.();
			if (Array.isArray(active)) this.activeToolNames = new Set(active);
		} catch {
			// runtime not initialized yet during early load
		}
	}

	/** Register tools with the given cwd (initial load uses process.cwd() before session_start). */
	apply(enabled: boolean, cwd: string): void {
		this.refreshSettings();
		registerRoundedTools(this.pi, enabled, cwd, this.factoryOpts, this.activeToolNames);
	}

	init(enabled: boolean, cwd = process.cwd()): void {
		this.apply(enabled, cwd);
	}
}
