# pi-tui-footer

pi 插件：TUI 美化套件 — 动画 Pi logo 头部、Starship 风格底部状态栏、圆角编辑器、圆角工具框、回合遥测（TPS/TTFT/耗时/token/费用）。

## 安装

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

本项目基于多个 Pi 社区包的工作：

- [pi-haiku](https://github.com/nnocte/pi-haiku) — 双行底栏结构和工作计时器
- [pi-claude-code-tui](https://github.com/Phoobobo/pi-claude-code-tui) — Pi Logo 帧与圆角编辑器边框技术
- [pi-zentui](https://github.com/lmilojevicc/pi-zentui) — Starship 风格底栏、运行环境检测、会话生命周期和设置界面模式
- [pi-tps](https://github.com/summertime-wu/pi-tps) — 单轮计时、停顿检测和保守的 TPS 计算方式
- [pi-open-tui](https://github.com/OldSuns/pi-open-tui) — 头部、底部、编辑器、遥测和设置界面的整体结构
- [pi-rounded-tools](https://github.com/orionpax1997/pi-rounded-tools) — 圆角工具调用/结果框

Logo 帧源自 Pi 官方安装脚本（[pi.dev/install.sh](https://pi.dev/install.sh)）。运行环境检测和 Git porcelain 解析借鉴了 pi-zentui 的结构。

## 结构

- `extensions/` — 全部插件源码（TypeScript，pi 直接加载）
- `LICENSE` — MIT 许可证

仅依赖 pi 内置模块（`@earendil-works/pi-*` peer）与 Node 内置模块，无第三方运行时依赖。

## License

[MIT](LICENSE)
