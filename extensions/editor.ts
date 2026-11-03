/**
 * Rounded editor frame with the working status in the top border (pi-tui-footer 1.4.8 look):
 *   ╭── ⠋ Working… ─────────────────────────────╮
 *   │ prompt text                                │
 *   ╰────────────────────────────────────────────╯
 */

import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
	type EditorTheme,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { CursorStyle } from "./config.ts";

type StatusIndicator = Parameters<CustomEditor["setWorkingStatusIndicator"]>[0];

const CURSOR_SEQ: Record<CursorStyle, string> = { block: "\x1b[2 q", bar: "\x1b[6 q", underline: "\x1b[4 q" };
export const CURSOR_RESET = "\x1b[0 q";

/** Rounded border row, as pi-tui-footer 1.4.8 draws it: status after `╭── `, scroll label centred. */
function roundedBorder(
	width: number,
	kind: "top" | "bottom",
	hidden: number,
	paint: (s: string) => string,
	status?: StatusIndicator,
): string {
	const [l, r] = kind === "top" ? ["╭", "╮"] : ["╰", "╯"];
	const inner = width - 2;
	const scroll = hidden > 0 ? `${kind === "top" ? "↑" : "↓"} ${hidden} more` : undefined;

	if (status) {
		let text = status.renderInBorder(Math.max(1, inner - 5));
		let w = visibleWidth(text);
		if (w > 0) {
			const label = scroll ? ` ${scroll} ` : undefined;
			const labelW = label ? visibleWidth(label) : 0;
			const labelAt = Math.floor((inner - labelW) / 2);
			const fits = () => label !== undefined && labelW + 2 <= inner && labelAt - (3 + w + 1) >= 1;
			if (label && !fits()) {
				text = status.renderSpinnerInBorder(inner);
				w = visibleWidth(text);
			}
			if (fits()) {
				const lead = 3 + w + 1;
				return `${paint(`${l}── `)}${text}${paint(` ${"─".repeat(labelAt - lead)}${label}${"─".repeat(inner - labelAt - labelW)}${r}`)}`;
			}
			if (inner >= w + 5) return `${paint(`${l}── `)}${text}${paint(` ${"─".repeat(inner - w - 4)}${r}`)}`;
			text = status.renderSpinnerInBorder(inner);
			w = visibleWidth(text);
			const lead = Math.min(3, Math.max(0, inner - w));
			return `${paint(`${l}${"─".repeat(lead)}`)}${text}${paint(`${"─".repeat(Math.max(0, inner - lead - w))}${r}`)}`;
		}
	}
	if (scroll && visibleWidth(` ${scroll} `) + 2 <= inner) {
		const label = `─── ${scroll} `;
		return paint(`${l}${label}${"─".repeat(Math.max(0, inner - visibleWidth(label)))}${r}`);
	}
	return paint(`${l}${"─".repeat(Math.max(0, inner))}${r}`);
}

const FRAME = 4; // "│ " + body + " │"
// pi-tui's painted cursor (FAKE_CURSOR_START/END, not exported); truncation can drop the end marker.
const FAKE_CURSOR = /\x1b_pi:fc\x07([\s\S]*?)(?:\x1b_pi:\/fc\x07|$)/g;
const fill = (line: string, width: number) => {
	const cut = truncateToWidth(line, width, "");
	return cut + " ".repeat(Math.max(0, width - visibleWidth(cut)));
};

export class RoundedEditor extends CustomEditor {
	private status: StatusIndicator;
	private appliedCursor: CursorStyle | undefined;
	/** Full width of the current pass; Editor itself renders inside the frame, so its borders get the inner width. */
	private outer = 0;
	private bottom = "";

	constructor(
		private readonly host: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly cursorStyle: () => CursorStyle,
	) {
		super(host, theme, keybindings, { embedWorkingStatus: true, paddingX: 0 });
	}

	/** The frame supplies the horizontal padding. */
	override setPaddingX(_padding: number): void {
		super.setPaddingX(0);
	}

	override setWorkingStatusIndicator(indicator: StatusIndicator): void {
		this.status = indicator;
		super.setWorkingStatusIndicator(indicator);
	}

	protected override renderTopBorder(width: number, hiddenLineCount: number): string {
		if (!this.framed()) return super.renderTopBorder(width, hiddenLineCount);
		return roundedBorder(this.outer, "top", hiddenLineCount, this.borderColor, this.status);
	}

	protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
		if (!this.framed()) return super.renderBottomBorder(width, hiddenLineCount);
		this.bottom = roundedBorder(this.outer, "bottom", hiddenLineCount, this.borderColor);
		return this.bottom;
	}

	private framed(): boolean {
		return this.outer > FRAME + 2;
	}

	override render(width: number): string[] {
		this.applyCursor();
		this.outer = width;
		const base = (w: number) => {
			const lines = super.render(w);
			return this.cursorStyle() === "block" ? lines : lines.map((line) => line.replace(FAKE_CURSOR, "$1"));
		};
		if (!this.framed()) return base(width);
		const inner = width - FRAME;
		const lines = base(inner);
		// [top border, body…, bottom border, autocomplete…]
		const found = lines.indexOf(this.bottom, 1);
		const end = found === -1 ? lines.length : found;
		const rail = this.borderColor("│");
		// Autocomplete rows stay as the inner render left them.
		return lines.map((line, i) =>
			truncateToWidth(i === 0 || i >= end ? line : `${rail} ${fill(line, inner)} ${rail}`, width, ""),
		);
	}

	override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (!this.framed()) return super.handleMouse(event);
		return super.handleMouse({ ...event, x: Math.max(0, event.x - 2), width: event.width - FRAME });
	}

	/** Bar and underline come from the terminal's hardware cursor; pi's painted block is dropped above. */
	private applyCursor(): void {
		const style = this.cursorStyle();
		if (style !== "block" && !this.host.getShowHardwareCursor()) this.host.setShowHardwareCursor(true);
		if (style === this.appliedCursor) return;
		this.host.terminal.write(style === "block" ? CURSOR_RESET : CURSOR_SEQ[style]);
		this.appliedCursor = style;
	}
}
