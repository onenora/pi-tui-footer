import { homedir } from "node:os";
import { basename, sep } from "node:path";

export function fmtTokens(n: number): string {
	if (n < 1000) return `${Math.round(n)}`;
	if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	return `${Math.round(n / 1_000_000)}M`;
}

export function fmtDuration(ms: number): string {
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(1)}s`;
	const m = Math.floor(s / 60);
	return m < 60 ? `${m}m${Math.floor(s % 60)}s` : `${Math.floor(m / 60)}h${m % 60}m`;
}

export function fmtPath(cwd: string, compact: boolean): string {
	if (compact) return basename(cwd) || cwd;
	const home = homedir();
	if (cwd === home) return "~";
	return cwd.startsWith(home + sep) ? `~${cwd.slice(home.length)}` : cwd;
}

export function oneLine(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}
