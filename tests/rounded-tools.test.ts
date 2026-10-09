import { beforeAll, describe, expect, test } from "bun:test";
import { createEditToolDefinition, initTheme } from "@earendil-works/pi-coding-agent";
import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { wrapRenderers } from "../extensions/rounded-tools.ts";

const WIDTH = 40;
const ANSI = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g;
const plain = (lines: string[]) => lines.map((line) => line.replace(ANSI, "").trimEnd());

type Context = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
type Theme = Parameters<NonNullable<ToolRenderers["renderCall"]>>[1];

// Renderers get an unstyled theme; pi's diff renderer still reads the global one set up by initTheme.
const theme = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text } as unknown as Theme;

/** One tool row: shared renderer state plus the components pi hands back as lastComponent. */
function toolRow(def: ToolRenderers, args: Record<string, unknown>) {
	const state = {};
	let call: Component | undefined;
	let result: Component | undefined;
	const context = (lastComponent: Component | undefined, extra: Partial<Context>): Context =>
		({
			args, state, lastComponent, cwd: "/tmp", toolCallId: "1", invalidate() {},
			executionStarted: true, argsComplete: true, isPartial: false, isError: false,
			expanded: false, showImages: false, durationMs: undefined, outputPad: 1, ...extra,
		}) as Context;

	return {
		renderCall(extra: Partial<Context> = {}) {
			call = def.renderCall!(args as never, theme, context(call, extra));
		},
		renderResult(content: unknown, extra: Partial<Context> = {}) {
			result = def.renderResult!(content as never, { expanded: false, isPartial: false }, theme, context(result, extra));
		},
		lines: () => plain([...(call?.render(WIDTH) ?? []), ...(result?.render(WIDTH) ?? [])]),
	};
}

beforeAll(() => initTheme("dark"));

describe("rounded edit frame", () => {
	const args = { path: "a.txt", edits: [{ oldText: "x", newText: "y" }] };
	const frameEdge = (char: string) => char + "─".repeat(WIDTH - 2);

	test("pending call is a closed frame without the Box background or padding rows", () => {
		const row = toolRow(wrapRenderers(createEditToolDefinition("/tmp")), args);
		row.renderCall({ isPartial: true });
		expect(row.lines()).toEqual([
			frameEdge("╭") + "╮",
			"│ edit a.txt" + " ".repeat(WIDTH - 13) + "│",
			frameEdge("╰") + "╯",
		]);
	});

	test("result diff shows in the call frame and the result frame closes it", () => {
		const row = toolRow(wrapRenderers(createEditToolDefinition("/tmp")), args);
		row.renderCall();
		row.renderResult({ content: [], details: { diff: "-1 x\n+1 y" } });
		// pi re-renders the call after the result: edit has rebuilt its call Box in place.
		row.renderCall();
		const lines = row.lines();
		expect(lines[0]).toBe(frameEdge("╭") + "╮");
		expect(lines.slice(1, -1).every((line) => line.startsWith("│ ") && line.endsWith("│"))).toBe(true);
		expect(lines.join("\n")).toContain("+1 y");
		expect(lines.filter((line) => line.startsWith("╭"))).toHaveLength(1);
		expect(lines.at(-1)).toBe(frameEdge("╰") + "╯");
	});

	test("error text stays inside the same frame", () => {
		const row = toolRow(wrapRenderers(createEditToolDefinition("/tmp")), args);
		row.renderCall();
		row.renderResult({ content: [{ type: "text", text: "oldText not found" }] }, { isError: true });
		row.renderCall({ isError: true });
		const lines = row.lines();
		expect(lines.filter((line) => line.startsWith("╭"))).toHaveLength(1);
		expect(lines.filter((line) => line.startsWith("╰"))).toHaveLength(1);
		expect(lines.some((line) => line.includes("oldText not found"))).toBe(true);
	});
});
