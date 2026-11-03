/**
 * Sent messages without the `userMessageBg` block, pushed to the right edge as one block
 * (lines keep their left alignment inside it, so lists and code stay intact). pi offers no
 * hook for this, so the shared UserMessageComponent prototype is patched once.
 * A /reload re-runs this module against the same prototype: it swaps the switch, never wraps twice.
 */

import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

const PATCH = Symbol.for("pi-tui-footer.plainUserMessages");
// 40–47, 100–107, 48;5;n, 48;2;r;g;b and the 49 reset Theme.bg emits.
const BACKGROUND = /\x1b\[(?:4[0-7]|10[0-7]|48;[\d;]+|49)m/g;
// Trailing padding, possibly interleaved with SGR codes; the codes are kept.
const TAIL = /(?: |\x1b\[[\d;]*m)+$/;
const SGR = /\x1b\[[\d;]*m/g;
// The OSC 133 prompt-zone marks pi puts in front of the first and last line.
const LEAD = /^(?:\x1b\][^\x07]*\x07)*/;

type Render = (this: UserMessageComponent, width: number) => string[];
type Patch = { original: Render; enabled: () => boolean };
type Proto = { render: Render; outputPad?: number; [PATCH]?: Patch };

const trimEnd = (line: string) => line.replace(TAIL, (tail) => tail.match(SGR)?.join("") ?? "");

function alignRight(lines: string[], width: number, pad: number): string[] {
	const trimmed = lines.map(trimEnd);
	const widest = Math.max(0, ...trimmed.map((line) => visibleWidth(line)));
	const shift = Math.max(0, width - widest - pad);
	if (shift === 0) return trimmed;
	const indent = " ".repeat(shift);
	return trimmed.map((line) => {
		if (visibleWidth(line) === 0) return line;
		const lead = line.match(LEAD)?.[0] ?? "";
		return lead + indent + line.slice(lead.length);
	});
}

export function plainUserMessages(enabled: () => boolean): void {
	const proto = UserMessageComponent.prototype as unknown as Proto;
	const existing = proto[PATCH];
	if (existing) {
		existing.enabled = enabled;
		return;
	}
	const patch: Patch = { original: proto.render, enabled };
	proto[PATCH] = patch;
	proto.render = function (width) {
		const lines = patch.original.call(this, width);
		if (!patch.enabled()) return lines;
		const pad = (this as unknown as Proto).outputPad ?? 1;
		return alignRight(lines.map((line) => line.replace(BACKGROUND, "")), width, pad);
	};
}
