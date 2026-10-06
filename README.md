# pi-tui-footer

pi 插件：TUI 美化套件 — 动画 Pi logo 头部、Starship 风格底部状态栏、圆角编辑器、圆角工具框、回合遥测（TPS/TTFT/耗时/token/费用）。

## 安装

```bash
pi install npm:pi-tui-footer
```

或通过 Git：

```bash
pi install git:github.com/onenora/pi-tui-footer
```

固定版本：

```bash
pi install git:github.com/onenora/pi-tui-footer@v1.3.0
```

更新：

```bash
pi update --extensions
```

## 配置

配置文件位于 `~/.pi/agent/pi-tui.json`，示例：

```json
{
  "enabled": true,
  "roundedTools": true,
  "settingsLanguage": "zh",
  "cursorStyle": "underline",
  "fullscreen": { "wheelScrollLines": 4 },
  "icons": { "mode": "nerd" }
}
```

也可在 pi 内通过 `/pi-tui` 命令调整。

### 圆角工具框

需要 pi >= 1.0.4（依赖 `pi.registerToolRenderer()`）。旧版本不会报错，但圆角工具框不生效。

`roundedTools` 通过渲染器解析器包装工具调用/结果的显示，不重新注册工具，不改变工具定义、执行逻辑和激活状态。覆盖范围：

- 内置工具：read、write、bash、powershell、grep、find、ls（edit 自带外框，保持原样）
- pi-fff 工具：ffgrep、fffind、fff-multi-grep

按工具名匹配，与扩展加载顺序无关。其他第三方工具不会自动添加圆角边框；需要时将工具名加入 `extensions/rounded-tools.ts` 的 `ROUNDED_TOOL_NAMES`。

切换 `roundedTools` 后，新的工具调用立即生效，已渲染的历史记录在下次重建（`/reload`、恢复会话、压缩）时更新。

## 致谢

本项目can以下两个开源项目的集成：

- [pi-open-tui](https://github.com/OldSuns/pi-open-tui) — 头部、底部、编辑器、遥测和设置界面的整体结构
- [pi-rounded-tools](https://github.com/orionpax1997/pi-rounded-tools) — 圆角工具调用/结果框

## 结构

- `extensions/` — 全部插件源码（TypeScript，pi 直接加载）
- `LICENSE` — MIT 许可证

仅依赖 pi 内置模块（`@earendil-works/pi-*` peer）与 Node 内置模块，无第三方运行时依赖。

## License

[MIT](LICENSE)
