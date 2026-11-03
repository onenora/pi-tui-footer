/** `/pi-tui` settings list, in Chinese or English. Every change saves and applies at once. */

import { type ExtensionCommandContext, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { type Component, matchesKey, SettingsList, truncateToWidth } from "@earendil-works/pi-tui";
import { type Config, type Language, SEGMENTS, type Segment, type Spacing } from "./config.ts";

type Choice<T> = { value: T; zh: string; en: string };

interface Option<T> {
	id: string;
	zh: string;
	en: string;
	/** One line under the list for the selected row; a fixed slot, so the page never changes height. */
	hint?: { zh: string; en: string };
	choices: Choice<T>[];
	get(c: Config): T;
	set(c: Config, v: T): void;
}

const ON_OFF: Choice<boolean>[] = [
	{ value: true, zh: "开", en: "on" },
	{ value: false, zh: "关", en: "off" },
];

const flag = (
	id: string,
	zh: string,
	en: string,
	get: (c: Config) => boolean,
	set: (c: Config, v: boolean) => void,
	hint?: Option<boolean>["hint"],
): Option<boolean> => ({ id, zh, en, hint, choices: ON_OFF, get, set });

const SEGMENT_NAMES: Record<Segment, [string, string, string?, string?]> = {
	cwd: ["工作目录", "Working directory"],
	hostname: ["主机名", "Hostname"],
	sessionName: ["会话名称", "Session name", "/name 设置的名称", "Name set with /name"],
	gitBranch: ["Git 分支", "Git branch"],
	gitStatus: ["Git 改动", "Git changes", "冲突、改动、暂存、未跟踪、stash、领先/落后", "Conflicts, changes, staged, untracked, stash, ahead/behind"],
	gitCommit: ["Git 标签（分离 HEAD）", "Git tag (detached HEAD)", "分离 HEAD 时显示提交和标签", "Show commit and tag on a detached HEAD"],
	runtime: ["运行时版本", "Runtime version", "按项目文件识别，如 node、bun、rust", "Detected from project files: node, bun, rust…"],
	context: ["上下文占用", "Context usage"],
	tokens: ["累计 token", "Token totals", "输入含未缓存与缓存读取拆分", "Input split into uncached and cache reads"],
	cost: ["累计费用", "Cost"],
	liveTps: ["实时 TPS", "Live TPS", "生成时显示输出速度", "Output rate while generating"],
	extensionStatuses: ["扩展状态", "Extension statuses", "其他扩展上报的状态", "Statuses reported by other extensions"],
	provider: ["显示供应商", "Show provider"],
};

const OPTIONS: Option<any>[] = [
	flag("enabled", "启用 pi-tui", "Enable pi-tui", (c) => c.enabled, (c, v) => (c.enabled = v), {
		zh: "关闭后恢复 pi 自带界面",
		en: "Off restores pi's own UI",
	}),
	{
		id: "settingsLanguage",
		zh: "语言",
		en: "Language",
		choices: [
			{ value: "zh", zh: "中文", en: "中文" },
			{ value: "en", zh: "English", en: "English" },
		],
		get: (c) => c.settingsLanguage,
		set: (c, v) => (c.settingsLanguage = v),
	} satisfies Option<Language>,
	flag("header", "头部", "Header", (c) => c.header, (c, v) => (c.header = v), {
		zh: "启动时的标志和提示",
		en: "Logo and tips at startup",
	}),
	flag("roundedTools", "圆角工具框", "Rounded tool frames", (c) => c.roundedTools, (c, v) => (c.roundedTools = v), {
		zh: "对之后的工具块生效",
		en: "Applies to tool blocks from now on",
	}),
	{
		id: "cursorStyle",
		zh: "光标样式",
		en: "Cursor style",
		choices: [
			{ value: "block", zh: "方块", en: "block" },
			{ value: "bar", zh: "竖线", en: "bar" },
			{ value: "underline", zh: "下划线", en: "underline" },
		],
		get: (c) => c.cursorStyle,
		set: (c, v) => (c.cursorStyle = v),
	},
	{
		id: "icons",
		zh: "图标",
		en: "Icons",
		hint: { zh: "自动：本地 UTF-8 终端用 Nerd Font，否则 ASCII", en: "Auto: Nerd Font on a local UTF-8 terminal, else ASCII" },
		choices: [
			{ value: "auto", zh: "自动", en: "auto" },
			{ value: "nerd", zh: "Nerd Font", en: "Nerd Font" },
			{ value: "ascii", zh: "ASCII", en: "ASCII" },
		],
		get: (c) => c.icons.mode,
		set: (c, v) => (c.icons.mode = v),
	},
	flag("thinkingPeek", "思考预览", "Thinking peek", (c) => c.thinkingPeek.lines === 1, (c, v) => (c.thinkingPeek.lines = v ? 1 : 0), {
		zh: "编辑器边框显示最新一行思考",
		en: "Latest thinking line in the editor border",
	}),
	flag("telemetry", "回合遥测", "Run telemetry", (c) => c.telemetry.enabled, (c, v) => (c.telemetry.enabled = v), {
		zh: "回答结束后提示速度、耗时、token 和费用",
		en: "After each run: speed, time, tokens and cost",
	}),
	...SEGMENTS.map((key) =>
		flag(
			`segment.${key}`,
			SEGMENT_NAMES[key][0],
			SEGMENT_NAMES[key][1],
			(c) => c.footerSegments[key],
			(c, v) => (c.footerSegments[key] = v),
			SEGMENT_NAMES[key][2] ? { zh: SEGMENT_NAMES[key][2]!, en: SEGMENT_NAMES[key][3]! } : undefined,
		),
	),
	{
		id: "segment.nerdIconSpacing",
		zh: "Nerd 图标后额外留空",
		en: "Extra space after Nerd icons",
		hint: { zh: "自动：Kitty、Ghostty 下开启", en: "Auto: on in Kitty and Ghostty" },
		choices: [
			{ value: "auto", zh: "自动", en: "auto" },
			{ value: true, zh: "开", en: "on" },
			{ value: false, zh: "关", en: "off" },
		],
		get: (c) => c.footerSegments.nerdIconSpacing,
		set: (c, v) => (c.footerSegments.nerdIconSpacing = v),
	} satisfies Option<Spacing>,
];

const PAGES: { zh: string; en: string; ids: (id: string) => boolean }[] = [
	{ zh: "通用", en: "General", ids: (id) => ["enabled", "settingsLanguage", "header", "roundedTools", "cursorStyle", "icons"].includes(id) },
	{ zh: "功能", en: "Features", ids: (id) => id === "thinkingPeek" || id === "telemetry" },
	{ zh: "底栏", en: "Footer", ids: (id) => id.startsWith("segment.") },
];

const TITLE = { zh: "pi-tui 设置", en: "pi-tui settings" };
const KEYS = {
	zh: "Tab/←→ 切换分页 · ↑↓ 选择 · Enter/空格 切换 · Esc 关闭",
	en: "Tab/←→ page · ↑↓ select · Enter/Space toggle · Esc close",
};

export async function openSettings(
	ctx: ExtensionCommandContext,
	config: () => Config,
	update: (next: Config) => void,
	at: { page: number; focus?: string } = { page: 0 },
): Promise<void> {
	let reopen = false;
	let page = at.page;
	await ctx.ui.custom<void>((tui, theme, _keys, done) => {
		const lang = config().settingsLanguage;
		const label = (c: { zh: string; en: string }) => c[lang];

		// The list reports which row is selected only through its label painter.
		const base = getSettingsListTheme();
		let selectedLabel = "";
		const listTheme = {
			...base,
			hint: () => "",
			label: (text: string, selected: boolean) => {
				if (selected) selectedLabel = text;
				return base.label(text, selected);
			},
		};

		const buildList = (at = page): SettingsList => {
			const options = OPTIONS.filter((o) => PAGES[at]!.ids(o.id));
			return new SettingsList(
				options.map((o) => ({
					id: o.id,
					label: label(o),
					currentValue: label(o.choices.find((ch) => ch.value === o.get(config())) ?? o.choices[0]!),
					values: o.choices.map(label),
				})),
				Math.min(options.length, 14),
				// The list's own key hint is English-only; ours sits below it.
				listTheme,
				(id, shown) => {
					const option = OPTIONS.find((o) => o.id === id);
					const choice = option?.choices.find((ch) => label(ch) === shown);
					if (!option || !choice) return;
					const next = structuredClone(config());
					option.set(next, choice.value);
					update(next);
					if (id === "settingsLanguage") {
						reopen = true;
						done();
					}
					tui.requestRender();
				},
				() => done(),
			);
		};

		let list = buildList();
		if (at.focus) list.selectItem(at.focus);
		const turn = (step: number) => {
			page = (page + step + PAGES.length) % PAGES.length;
			list = buildList();
		};

		const tabs = (width: number) =>
			truncateToWidth(
				PAGES.map((p, i) =>
					i === page ? theme.bold(theme.fg("accent", `[${label(p)}]`)) : theme.fg("muted", ` ${label(p)} `),
				).join(" "),
				width,
			);

		// Every page takes the height of the tallest one, so switching pages never moves the screen.
		let height = 0;
		const body = (width: number) => {
			// Drop the blank rows the list reserves for its own (suppressed) hint.
			const rows = (l: SettingsList) => {
				const out = l.render(width);
				while (out.length && !out.at(-1)!.trim()) out.pop();
				return out;
			};
			height ||= Math.max(...PAGES.map((_, i) => rows(buildList(i)).length));
			selectedLabel = "";
			const lines = rows(list);
			const hint = OPTIONS.find((o) => PAGES[page]!.ids(o.id) && label(o) === selectedLabel.trim())?.hint;
			return [
				...lines,
				"",
				truncateToWidth(hint ? theme.fg("muted", `  ${label(hint)}`) : "", width),
				...Array<string>(Math.max(0, height - lines.length)).fill(""),
				"",
			];
		};

		const view: Component = {
			render: (width) => [
				truncateToWidth(theme.bold(theme.fg("accent", TITLE[lang])), width),
				"",
				tabs(width),
				"",
				...body(width),
				truncateToWidth(theme.fg("dim", KEYS[lang]), width),
			],
			invalidate: () => list.invalidate(),
			handleInput: (data) => {
				if (matchesKey(data, "tab") || matchesKey(data, "right")) turn(1);
				else if (matchesKey(data, "shift+tab") || matchesKey(data, "left")) turn(-1);
				else list.handleInput(data);
				tui.requestRender();
			},
		};
		return view;
	});
	if (reopen) await openSettings(ctx, config, update, { page, focus: "settingsLanguage" });
}
