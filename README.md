# pi-tui-footer

[pi](https://github.com/earendil-works/pi) 的 TUI 增强扩展：头部、Starship 风格底栏、圆角编辑器、思考预览、回合遥测和圆角工具框。仅依赖 pi 内置模块与 Node 内置模块，无第三方运行时依赖。

## 功能

- **头部**：Pi logo、pi 版本、当前模型与思考强度、工作目录、命令提示
- **底栏**：目录、Git、运行环境、工作计时、上下文用量条、模型、Token 与费用；`inlineFooter` 可把它并入编辑器边框
- **圆角编辑器**：工作状态嵌入顶部边框，可选光标样式
- **思考预览**：pi 隐藏思考块时，显示思考内容的最后 1–2 行
- **回合遥测**：每次 agent 运行结束，提示 TPS、TTFT、耗时、Token、停顿和费用速率
- **圆角工具框**：工具调用与结果连成一个圆角框，边框颜色随执行状态变化

## 安装

```bash
pi install npm:pi-tui-footer
```

或通过 Git：`pi install git:github.com/onenora/pi-tui-footer`，末尾加 `@v1.3.1` 固定版本。更新：`pi update --extensions`。

需要 pi 的交互式 TUI 模式。圆角工具框依赖 `pi.registerToolRenderer()`，需要 pi >= 1.0.2；更早的版本不会报错，但圆角工具框不生效。

## 配置

安装即启用。`/pi-tui` 打开设置界面，改动即时生效并保存到 `~/.pi/agent/pi-tui.json`（设置了 `PI_CODING_AGENT_DIR` 时跟随该目录）。也可以直接编辑这个文件，只写想改的字段，其余取默认值，下次会话启动（`/reload`、`/new`）时生效：

```json
{
  "inlineFooter": true,
  "cursorStyle": "bar",
  "icons": { "mode": "unicode" },
  "footerSegments": { "hostname": true },
  "thinkingPeek": { "lines": 2 }
}
```

- `enabled` 是总开关，关闭后恢复 pi 默认界面；`roundedTools` 控制圆角工具框
- `cursorStyle`：`block`、`bar`、`underline`；`thinkingPeek.lines`：`0` 关闭，`1` 或 `2` 行
- `icons.mode`：`auto`、`nerd`、`unicode`、`ascii`。推荐 Nerd Font 终端，没有时用 `unicode` 或 `ascii`
- `footerSegments` 和 `telemetry` 下都是布尔开关

全部选项与默认值见 [`extensions/config.ts`](extensions/config.ts)。

### 圆角工具框

通过 `pi.registerToolRenderer()` 包装工具调用/结果的显示，不重新注册工具，不改变工具定义、执行逻辑和激活状态。

- 覆盖 `read`、`write`、`bash`、`powershell`、`grep`、`find`、`ls`，以及 pi-fff 的 `ffgrep`、`fffind`、`fff-multi-grep`；`edit` 自带外框，保持原样
- 按工具名匹配，与扩展加载顺序无关；其他工具需要时加入 `extensions/rounded-tools.ts` 的 `ROUNDED_TOOL_NAMES`
- 切换 `roundedTools` 后，新的工具调用立即生效；已渲染的历史记录在下次重建（`/reload`、恢复会话、压缩）时更新

## 致谢

- [pi-open-tui](https://github.com/OldSuns/pi-open-tui) — 头部、底栏、编辑器、遥测、设置界面（MIT）
- [pi-rounded-tools](https://github.com/orionpax1997/pi-rounded-tools) — 圆角工具框（MIT）

## 开发

源码在 `extensions/`（TypeScript，pi 直接加载）。`bun run check` 验证所有模块可以被加载。

## License

[MIT](LICENSE)
