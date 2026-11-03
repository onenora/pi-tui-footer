/**
 * Per-run telemetry: live output rate while streaming, and a summary when the run ends
 * (TPS, time to first token, duration, tokens, stalls, cost).
 */

import type { Usage } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Glyphs } from "./icons.ts";
import { fmtDuration, fmtTokens } from "./format.ts";

const STALL_MS = 1000;
const LIVE_WINDOW_MS = 2000;
// CJK runs about one token per character; Latin text and code about four characters per token.
const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿＀-￯]/g;

export interface RunSummary {
	durationMs: number;
	ttftMs?: number;
	tps?: number;
	input: number;
	output: number;
	cost: number;
	stalls: number;
	stallMs: number;
}

interface Run {
	start: number;
	firstDelta?: number;
	streamMs: number;
	input: number;
	output: number;
	cost: number;
	stalls: number;
	stallMs: number;
}

interface Message {
	first: number;
	last: number;
	stalled: boolean;
	tokens: number;
	samples: { ms: number; tokens: number }[];
}

function estimateTokens(text: string): number {
	const cjk = text.match(CJK)?.length ?? 0;
	return cjk + (text.length - cjk) / 4;
}

export class Telemetry {
	private run: Run | undefined;
	private message: Message | undefined;
	private lastTps: number | undefined;

	/** A run spans every agent loop until pi settles, so a second start before finish() is a no-op. */
	start(now = Date.now()): void {
		if (this.run) return;
		this.run = { start: now, streamMs: 0, input: 0, output: 0, cost: 0, stalls: 0, stallMs: 0 };
		this.message = undefined;
		this.lastTps = undefined;
	}

	delta(text: string, now = Date.now()): void {
		const run = this.run;
		if (!run || !text) return;
		run.firstDelta ??= now;
		const tokens = estimateTokens(text);
		const m = this.message;
		if (!m) {
			this.message = { first: now, last: now, stalled: false, tokens, samples: [{ ms: now, tokens }] };
			return;
		}
		const gap = now - m.last;
		if (gap >= STALL_MS) {
			if (!m.stalled) run.stalls++;
			run.stallMs += gap;
		}
		m.stalled = gap >= STALL_MS;
		m.last = now;
		m.tokens += tokens;
		m.samples.push({ ms: now, tokens: m.tokens });
		// Keep one sample older than the window as the baseline.
		while (m.samples.length > 2 && m.samples[1]!.ms <= now - LIVE_WINDOW_MS) m.samples.shift();
	}

	messageEnd(usage: Usage | undefined, now = Date.now()): void {
		const run = this.run;
		if (!run) return;
		if (this.message) {
			run.streamMs += now - this.message.first;
			this.lastTps = this.windowTps(now) ?? this.lastTps;
		}
		this.message = undefined;
		if (!usage) return;
		run.input += (usage.input ?? 0) + (usage.cacheWrite ?? 0);
		run.output += usage.output ?? 0;
		run.cost += usage.cost?.total ?? 0;
	}

	/**
	 * Estimated tokens/s over the last two seconds of the streaming message. Between messages
	 * of a run (tools, waiting for the first token) the previous rate comes back as `stale`.
	 */
	liveTps(now = Date.now()): { tps: number; stale: boolean } | undefined {
		const tps = this.windowTps(now);
		if (tps !== undefined) return { tps, stale: false };
		return this.lastTps === undefined ? undefined : { tps: this.lastTps, stale: true };
	}

	private windowTps(now: number): number | undefined {
		const samples = this.message?.samples;
		if (!samples || samples.length < 2) return undefined;
		if (now - samples.at(-1)!.ms >= LIVE_WINDOW_MS) return 0;
		const elapsed = (now - samples[0]!.ms) / 1000;
		return elapsed > 0 ? Math.round(((samples.at(-1)!.tokens - samples[0]!.tokens) / elapsed) * 10) / 10 : undefined;
	}

	finish(now = Date.now()): RunSummary | undefined {
		const run = this.run;
		this.run = undefined;
		this.message = undefined;
		this.lastTps = undefined;
		if (!run || run.firstDelta === undefined) return undefined;
		return {
			durationMs: now - run.start,
			ttftMs: run.firstDelta - run.start,
			tps: run.output > 0 && run.streamMs > 0 ? run.output / (run.streamMs / 1000) : undefined,
			input: run.input,
			output: run.output,
			cost: run.cost,
			stalls: run.stalls,
			stallMs: run.stallMs,
		};
	}
}

export function formatSummary(s: RunSummary, theme: Theme, g: Glyphs): string {
	const parts = [
		theme.fg("accent", `${g.speed}${s.tps === undefined ? "—" : s.tps.toFixed(1)} tok/s`),
		theme.fg("text", `${g.latency}TTFT ${fmtDuration(s.ttftMs ?? 0)}`),
		theme.fg("success", g.done + fmtDuration(s.durationMs)),
		theme.fg("muted", `${g.input}${fmtTokens(s.input)} ${g.output}${fmtTokens(s.output)}`),
	];
	if (s.stalls > 0) parts.push(theme.fg("warning", `${g.stall}${s.stalls}× ${fmtDuration(s.stallMs)}`));
	if (s.cost > 0) parts.push(theme.fg("warning", g.cost + s.cost.toFixed(4)));
	return parts.join(theme.fg("dim", g.sep));
}
