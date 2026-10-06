# Linux 支持

AsterPet 的运行器、人物包导入、`~/.asterpet` 缓存和 DeepSeek Harness 接口均使用跨平台 Node.js/Electron API。

## 支持级别

- 原生 Wayland：通过 Electron `BrowserWindow.setShape()` 动态更新 Spine 动画的原生输入区域，透明空白处不接收鼠标输入。
- X11/XWayland：通过 C 原生模块调用 X Shape 扩展的 `ShapeInput`，动态更新人物和工具栏的输入区域；透明空白穿透，视觉画面保持完整。窗口置顶和全局定位的具体行为仍可能受窗口管理器影响。
- 音频：使用 Chromium 支持的系统音频后端。
- Spine：WebGL 2 可用时使用 GPU 渲染；需要正常工作的 Mesa 或厂商显卡驱动。

## 运行与打包

```bash
pnpm install
pnpm start
pnpm pack:linux
```

GNOME 桌面在 XWayland 可用时默认使用 X11 后端，让人物窗口可拖出屏幕上边界（保留至少 48 像素以便拖回）。其他 Wayland 桌面默认使用原生后端。启动器在 Electron 初始化前选择后端；命令行 `--ozone-platform=x11|wayland` 和显式环境变量仍优先。可明确要求原生后端：

```bash
ELECTRON_OZONE_PLATFORM_HINT=wayland pnpm start
```

人物本体支持直接拖动。原生 Wayland 桥使用真实 pointer serial 调用 `xdg_toplevel.move`，由 compositor 移动窗口，同时保留左键互动、右键工具栏和滚轮缩放。

GNOME Mutter 将 `xdg_toplevel.move` 视作受限的标题栏拖动，要求窗口顶部留在屏幕内。XWayland 人物窗口声明为不占据屏幕保留区域的桌面浮层（dock 类型），避免普通窗口的标题栏可见性约束。默认的 XWayland 路径用鼠标位移更新真实窗口坐标，允许负坐标；透明区域通过原生 `ShapeInput` 穿透，避免使用 Linux 不支持的 `setIgnoreMouseEvents({ forward: true })` 转发。显式选择原生 Wayland 时仍遵循 compositor 的位置限制。参见 [Electron 的 Wayland 定位说明](https://www.electronjs.org/docs/latest/api/browser-window#platform-notices)及 [Mutter 标题栏可见性约束](https://github.com/GNOME/mutter/blob/main/src/core/constraints.c)。

X11/XWayland 人物和附属窗口显示在所有工作区。原生模块监听 `_NET_CURRENT_DESKTOP` 变化，在切换结束后重新映射可见窗口，处理部分 GNOME 扩展在三指手势结束时隐藏跨工作区窗口的情况；主动最小化的窗口不会自动弹出。该过程保留动作、镜头、窗口位置和输入区域。

窗口消失或最小化后，可按 **Ctrl+Alt+P** 唤起（快捷键未被其他应用占用时），也可再次从应用菜单启动 AsterPet，唤起已有窗口。

`pnpm pack:linux` 生成 `dist/AsterPet-linux-x64/` 便携目录。项目不依赖特定 Linux 发行版的 CI；应在实际发布环境中构建并验证最终产物。

如需透明像素穿透，可选择通过 XWayland 启动：

```bash
ELECTRON_OZONE_PLATFORM_HINT=x11 pnpm start
```

Linux 发行前至少应在 KDE Plasma Wayland、GNOME Wayland 和一个 X11 会话中分别验证窗口置顶、拖动、透明区域交互、缩放和音频。
