# Linux 支持

AsterPet 的运行器、人物包导入、`~/.asterpet` 缓存和 DeepSeek Harness 接口均使用跨平台 Node.js/Electron API。

## 支持级别

- 原生 Wayland：通过 Electron `BrowserWindow.setShape()` 动态更新 Spine 动画的原生输入区域，透明空白处不接收鼠标输入。
- X11/XWayland：支持透明像素穿透；窗口置顶和全局定位的具体行为仍可能受窗口管理器影响。
- 音频：使用 Chromium 支持的系统音频后端。
- Spine：WebGL 2 可用时使用 GPU 渲染；需要正常工作的 Mesa 或厂商显卡驱动。

## 运行与打包

```bash
pnpm install
pnpm start
pnpm pack:linux
```

Linux 默认使用 Ozone 自动选择当前显示后端。在 Wayland 会话中也可明确要求原生后端：

```bash
ELECTRON_OZONE_PLATFORM_HINT=wayland pnpm start
```

人物本体支持直接拖动。原生 Wayland 桥使用真实 pointer serial 调用 `xdg_toplevel.move`，由 compositor 移动窗口，同时保留左键互动、右键工具栏和滚轮缩放。

`pnpm pack:linux` 生成 `dist/AsterPet-linux-x64/` 便携目录。项目不依赖特定 Linux 发行版的 CI；应在实际发布环境中构建并验证最终产物。

如需透明像素穿透，可选择通过 XWayland 启动：

```bash
ELECTRON_OZONE_PLATFORM_HINT=x11 pnpm start
```

Linux 发行前至少应在 KDE Plasma Wayland、GNOME Wayland 和一个 X11 会话中分别验证窗口置顶、拖动、透明区域交互、缩放和音频。
