# pi-tui-footer

为 [pi](https://github.com/earendil-works/pi) 定制的终端界面：头部、底栏、圆角编辑器与工具框。只依赖 pi 公开的扩展 API。

```
 ▟████▙     pi v1.5.0
 ██  ▜▛     Claude Opus 5.5 · high
 ███▌  ▟▙   ~/demo
 ▜▛    ▜▛   / for commands · ! for shell · @ for files · esc to interrupt

╭─────────────────────────────────────────────────────────────────────╮
│ prompt                                                              │
╰─────────────────────────────────────────────────────────────────────╯
@ ~/demo * main [!2 ?1] node 22.1.0 + done 3s     # [#-------] 12.6% · 126k/1.0M
M · Anthropic · Claude Opus · ~ high  ↑ 3.1M (U 405k + R 2.7M) | ↓ 16k | $ $0.305
```

- **头部**：pi Logo、版本、模型、目录与快捷提示
- **底栏**：目录、Git、运行时、计时、TPS、上下文、Token 与费用，各段可开关
- **编辑器**：圆角边框，状态与思考预览嵌在边框上
- **消息与工具**：去掉背景色块，消息靠右，工具调用与结果合成一个圆角框
- **遥测**：每轮结束提示速度、耗时、Token 与费用
- **图标**：自动选用 Nerd Font，不支持时回退 ASCII

## 安装

```bash
pi install npm:pi-tui-footer
```

## 配置

运行 `/pi-tui` 打开设置，改动即时生效，保存在 `~/.pi/agent/pi-tui.json`。全部字段见 [`extensions/config.ts`](extensions/config.ts)。

## 许可

[MIT](LICENSE)
