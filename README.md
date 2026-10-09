# pi-tui-footer

[pi](https://github.com/earendil-works/pi) 的 TUI 增强扩展：头部、Starship 风格底栏、圆角编辑器、思考预览、回合遥测和圆角工具框。仅依赖 pi 内置模块与 Node 内置模块，无第三方运行时依赖。

## 特性

- **头部**：Logo、版本、模型与思考强度、工作目录、命令提示
- **底栏**：路径、Git、环境、计时、上下文用量、Token 与费用
- **编辑器**：圆角边框、内嵌工作状态、可选光标样式
- **工具框**：圆角边框，颜色随执行状态变化
- **遥测与思考**：每轮 TPS、TTFT、耗时统计，隐藏思考时预览末尾内容

## 安装

```bash
pi install npm:pi-tui-footer
```

更新：

```bash
pi update --extensions
```

## 配置

运行 `/pi-tui` 打开设置菜单，改动即时生效。

也可以编辑 `~/.pi/agent/pi-tui.json`，只写需要修改的字段：

```json
{
  "inlineFooter": true,
  "cursorStyle": "bar",
  "icons": { "mode": "unicode" },
  "thinkingPeek": { "lines": 2 }
}
```

全部配置项见 [`extensions/config.ts`](extensions/config.ts)。

## 致谢

- [pi-open-tui](https://github.com/OldSuns/pi-open-tui)
- [pi-rounded-tools](https://github.com/orionpax1997/pi-rounded-tools)

## 许可

[MIT](LICENSE)
