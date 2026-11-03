/**
 * Rounded tool frames without a background. Every tool renders with `renderShell: "self"`, so pi
 * drops its colored shell; the call and its result join into one frame:
 *   ╭──────────────╮
 *   │ read foo.ts  │   call: open at the bottom once a result exists
 *   │ …            │   result: open at the top when the call left it open
 *   ╰──────────────╯
 * The border is `border`, `warning` while running and `error` on failure.
 */

import type { ExtensionAPI, Theme, ThemeColor, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Box, type Component, Container, Spacer, Text, type TuiMouseEvent, visibleWidth } from "@earendil-works/pi-tui";

type RenderCall = NonNullable<ToolRenderers["renderCall"]>;
type RenderResult = NonNullable<ToolRenderers["renderResult"]>;
type RenderContext = Parameters<RenderCall>[2];
type Role = "call" | "result";

const OVERHEAD = 4; // "│ " + content + " │"
const PREVIEW_LINES = 10;
const ARGS_PREVIEW_CHARS = 160;

function colorFor(ctx: RenderContext): ThemeColor {
	if (ctx.isError) return "error";
	return ctx.isPartial ? "warning" : "border";
}

/** The call and result frames of one tool row; each looks at the other to pick its edges. */
interface Row {
	call?: Frame;
	result?: Frame;
}

// Keyed by the row's renderer state, so nothing is written into state the tool owns.
const ROWS = new WeakMap<object, Row>();

function rowOf(state: object | undefined): Row {
	if (!state) return {};
	let row = ROWS.get(state);
	if (!row) ROWS.set(state, (row = {}));
	return row;
}

/** Content of a shell Box (edit's call header) without its background and padding; read fresh each pass. */
function content(inner: Component): Component {
	if (!(inner instanceof Box)) return inner;
	const box = inner;
	const view = new Container();
	view.render = (width) => box.children.flatMap((c) => c.render(width));
	view.invalidate = () => box.invalidate();
	return view;
}

class Frame implements Component {
	/** Whether the last render left the bottom open; undefined when too narrow to frame. */
	openBottom: boolean | undefined;
	private top = 0;

	constructor(
		private readonly row: Row,
		private readonly role: Role,
		public inner: Component,
		public paint: (s: string) => string,
	) {
		row[role] = this;
	}

	render(width: number): string[] {
		const body = content(this.inner);
		if (width <= OVERHEAD) {
			this.openBottom = undefined;
			return body.render(width);
		}
		// pi renders the call before the result in every pass.
		const openTop = this.role === "result" && this.row.call?.openBottom === true;
		const openBottom = this.role === "call" && this.row.result !== undefined;
		this.openBottom = openBottom;

		const inner = width - OVERHEAD;
		const rule = "─".repeat(width - 2);
		const side = this.paint("│");
		const out: string[] = [];
		if (!openTop) out.push(this.paint(`╭${rule}╮`));
		this.top = out.length;
		for (const line of body.render(inner)) {
			out.push(`${side} ${line}${" ".repeat(Math.max(0, inner - visibleWidth(line)))} ${side}`);
		}
		if (!openBottom) out.push(this.paint(`╰${rule}╯`));
		return out;
	}

	invalidate(): void {
		this.inner.invalidate();
	}

	handleMouse(event: TuiMouseEvent) {
		const inner = this.inner;
		if (inner instanceof Box || !inner.handleMouse) return undefined;
		if (this.openBottom === undefined) return inner.handleMouse(event);
		const x = event.x - 2;
		const y = event.y - this.top;
		if (x < 0 || x >= event.width - OVERHEAD || y < 0) return undefined;
		return inner.handleMouse({ ...event, x, y, width: event.width - OVERHEAD });
	}
}

/** Renderers get their own previous component back, and no padding: the frame pads. */
function innerContext(ctx: RenderContext): RenderContext {
	const last = ctx.lastComponent;
	return { ...ctx, lastComponent: last instanceof Frame ? last.inner : last, outputPad: 0 };
}

function frame(role: Role, inner: Component, theme: Theme, ctx: RenderContext): Frame {
	const color = colorFor(ctx);
	const paint = (s: string) => theme.fg(color, s);
	const last = ctx.lastComponent;
	if (!(last instanceof Frame)) return new Frame(rowOf(ctx.state as object | undefined), role, inner, paint);
	last.inner = inner;
	last.paint = paint;
	return last;
}

/** Stand-ins for pi's fallbacks, which would otherwise render outside the frame. */
function fallbackCall(toolName: string): RenderCall {
	return (args, theme, ctx) => {
		const title = theme.fg("toolTitle", theme.bold(toolName));
		if (args === undefined || (typeof args === "object" && Object.keys(args ?? {}).length === 0)) {
			return new Text(title, 0, 0);
		}
		let body = ctx.expanded ? JSON.stringify(args, null, 2) : JSON.stringify(args);
		if (!ctx.expanded && body.length > ARGS_PREVIEW_CHARS) body = `${body.slice(0, ARGS_PREVIEW_CHARS)}…`;
		return new Text(`${title} ${theme.fg("muted", body)}`, 0, 0);
	};
}

const fallbackResult: RenderResult = (result, { expanded }, theme, ctx) => {
	const box = new Container();
	const text = result.content
		.flatMap((c) => (c.type === "text" ? [c.text] : []))
		.join("\n")
		.trimEnd();
	if (!text) return box;
	const lines = text.split("\n");
	const shown = expanded ? lines : lines.slice(0, PREVIEW_LINES);
	let body = shown.map((line) => theme.fg(ctx.isError ? "error" : "toolOutput", line)).join("\n");
	const hidden = lines.length - shown.length;
	if (hidden > 0) body += `\n${theme.fg("muted", `… ${hidden} more lines, `)}${ctx.keyHint("app.tools.expand", "to expand")}`;
	box.addChild(new Spacer(1));
	box.addChild(new Text(body, 0, 0));
	return box;
};

export function registerTools(pi: ExtensionAPI, enabled: () => boolean): void {
	pi.registerToolRenderer((toolName, next) => {
		const base = next();
		if (!enabled()) return base;
		// Tools that draw their own shell keep it; edit is the built-in exception (a background Box).
		if (base?.renderShell === "self" && toolName !== "edit") return base;
		const renderCall = base?.renderCall ?? fallbackCall(toolName);
		const renderResult = base?.renderResult ?? fallbackResult;
		return {
			...base,
			renderShell: "self",
			renderCall: (args, theme, ctx) => frame("call", renderCall(args, theme, innerContext(ctx)), theme, ctx),
			renderResult: (result, options, theme, ctx) =>
				frame("result", renderResult(result, options, theme, innerContext(ctx)), theme, ctx),
		};
	});
}
