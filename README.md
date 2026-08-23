# AsterPet

AsterPet 是配置驱动、跨平台的透明 Electron + Spine 4.1 桌面伴侣。运行器不绑定具体人物、动作、语音或游戏安装目录；人物内容通过独立 `.asterpet` 包导入。

## 功能

- 从图形界面导入、更新人物包。
- 将人物资源安装到当前用户的 `~/.asterpet/content`。
- 支持 Spine 动画与图片序列场景。
- 透明像素穿透、人物拖动、缩放和动态窗口裁切。
- 场景、动画、统一外观变体、道具分类与逐项显示控制。
- 资源驱动的待机状态图、动作表情配方与外部 AI Talk 叠加。
- 通过可插拔外部 AI Driver 显示会话状态、权限申请与结构化问题；内置 DSH Driver。
- 对话框支持可安装、可切换的 `.asterpet-theme` 皮肤包。

## 人物包

右键人物打开工具栏，点击“导入”并选择 `.asterpet` 文件。AsterPet 会检查包格式、路径安全、文件数与解压体积，然后原子安装到：

```text
~/.asterpet/
├── content/   # 已安装人物包
├── .staging/  # 导入临时目录
└── logs/      # 运行日志
```

人物包格式见 [docs/character-package.md](docs/character-package.md)。人物包发布者必须拥有包内模型、贴图、音频和其他内容的再分发权。

## 开发运行

需要 Node.js 22 或更高版本，以及 pnpm 11：

```bash
pnpm install
pnpm start
```

如果 Electron 二进制曾因下载中断而缺失，可运行 `pnpm repair:electron` 后重新启动。

Windows 使用同一条 `pnpm start` 命令启动；仓库不依赖额外的启动脚本。

## Linux

```bash
pnpm pack:linux
```

产物位于 `dist/AsterPet-linux-x64/`。项目不绑定 GitHub Actions 或 Ubuntu runner，发行构建由本机环境直接控制。

X11 是完整支持目标；Wayland 的兼容范围和 XWayland 启动方式见 [docs/linux.md](docs/linux.md)。

## 外部 AI

AsterPet 的领域层只依赖通用外部 AI Driver。内置 DSH Driver 默认连接 `http://127.0.0.1:3080`，也可在工具栏的“AI”面板中设置地址。DSH 不存在时人物功能仍可独立运行；`DEEPSEEK_HARNESS_URL` 仍可设置默认地址。

桌宠控制端默认只监听 `127.0.0.1:18741`。`POST /state` 更新外部 AI 状态，`POST /action` 可用 `{ "action": "damage" }` 直接触发当前人物包声明的动作。即使设置了 `DESKTOP_PET_CONTROL_HOST`，非回环地址也必须额外设置 `DESKTOP_PET_CONTROL_ALLOW_REMOTE=1` 才会生效；不要把控制端暴露到局域网或公网。

## 配置与多实例

用户配置统一保存在 `~/.asterpet/config.json`，其中 `ui.selectedScene` 保存当前场景，`ui.propVisibility` 保存每个场景的图层启用状态，`ui.favoriteSceneIds` 保存收藏的可播放场景，`ui.appearanceByScene` 保存场景内 Spine skin 外观选择；外部 AI 和对话皮肤选择也保存在同一个文件中。Renderer 不再把运行状态作为最终数据写入 Chromium `localStorage`，旧版本遗留的键只在首次启动时迁移一次。

请使用项目提供的 `pnpm start` 启动。程序使用单实例锁，重复启动只会唤醒已经运行的实例，不会创建第二份互相覆盖状态的窗口。测试启动请使用 `PET_TEST=1 pnpm start`，测试状态不会写入正式配置。

代码按 `main`、`preload`、`renderer` 和 `native` 分层；外部 AI、人物包和对话皮肤分别通过 Driver、Repository 和 Service 接入。对话皮肤格式见 [docs/dialog-theme.md](docs/dialog-theme.md)。

提交前可执行：

```bash
pnpm check
```

## 发布边界

发行构建与 Git 忽略规则会排除：

- `content/` 和所有本地人物资源；
- 本地场景导出配置，仅保留 `resources/scenes/layer-rules.json`；
- 测试缓存、截图、日志和 `.asterpet` 文件；
- 本机专用脚本与绝对路径包装器。

## 许可证

AsterPet 自有代码采用 [Apache License 2.0](LICENSE)。该许可证不覆盖导入的人物包、游戏资源或第三方组件。

Spine Player 与 Spine Runtimes 适用 Esoteric Software 的独立许可证。源码仓库不替代该许可证；任何发布包含 Spine Runtime 的安装包前，发布者必须自行确认其 Spine Editor/Runtime 授权及再分发条件，并保留 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 `licenses/SPINE-RUNTIMES-LICENSE.txt`。源码公开不代表已经获得该授权；在确认前不得向他人提供包含 Spine Runtime 的二进制、安装包或 CI Artifact。当前 CI 永久只做构建验证，不上传二进制 Artifact。
