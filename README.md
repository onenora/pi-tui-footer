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
pi install git:github.com/onenora/pi-tui-footer@v1.2.0
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

## 致谢

本项目是以下两个开源项目的深度融合集成：

- [pi-open-tui](https://github.com/OldSuns/pi-open-tui) — 头部、底部、编辑器、遥测和设置界面的整体结构
- [pi-rounded-tools](https://github.com/orionpax1997/pi-rounded-tools) — 圆角工具调用/结果框

## 结构

- `extensions/` — 全部插件源码（TypeScript，pi 直接加载）
- `LICENSE` — MIT 许可证

仅依赖 pi 内置模块（`@earendil-works/pi-*` peer）与 Node 内置模块，无第三方运行时依赖。

## License

[MIT](LICENSE)
