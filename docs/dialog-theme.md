# 对话皮肤包

对话皮肤是扩展名为 `.asterpet-theme` 的 ZIP 文件，包内必须且只能有一个 `theme.json`。可在桌宠工具栏的“AI”面板中导入和切换。

```json
{
  "format": "asterpet.dialog-theme/v1",
  "id": "example-dark",
  "name": "Example Dark",
  "version": "1.0.0",
  "author": "Example",
  "tokens": {
    "fontFamily": "system-ui, sans-serif",
    "surface": "#202127",
    "surfaceElevated": "#383a42",
    "surfaceBorder": "rgba(255,255,255,.12)",
    "text": "#ffffff",
    "mutedText": "rgba(255,255,255,.62)",
    "accent": "rgba(75,137,224,.72)",
    "accentHover": "rgba(75,137,224,.38)",
    "radiusCard": 19,
    "radiusControl": 15,
    "shadow": "0 10px 28px rgba(0,0,0,.28)"
  },
  "layout": {
    "density": "comfortable",
    "tail": "speech"
  }
}
```

支持的布局值：

- `density`: `compact` 或 `comfortable`；
- `tail`: `speech` 或 `none`。

主题清单经过严格白名单校验。皮肤不能携带 CSS、JavaScript 或覆盖任意页面属性；未识别 token 会被忽略。用户皮肤安装到 `~/.asterpet/dialog-themes/<id>/`，当前选择保存在 `~/.asterpet/config.json`。
