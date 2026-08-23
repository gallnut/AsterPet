# AsterPet 人物包格式

人物包是扩展名为 `.asterpet` 的 ZIP 文件。清单和所有资源必须直接位于压缩包根目录，导入后由 AsterPet 安装到 `~/.asterpet/content/<包ID>`。

## 根清单

根目录必须包含 `asterpet.package.json`：

```json
{
  "format": "asterpet.character/v1",
  "id": "sample-character",
  "version": "1.0.0",
  "author": "Package Author",
  "license": "License identifier or custom terms",
  "source": "https://example.com/source",
  "characterId": "sample-character",
  "title": "Sample Character",
  "scenes": [
    {
      "id": "sample-idle",
      "category": "character",
      "config": "idle/scene.json"
    }
  ]
}
```

`id`、`characterId` 和场景 `id` 只能包含字母、数字、点、下划线与短横线。`config` 和场景配置内的资源路径必须是包内相对路径。`author`、`license` 和 `source` 用于陈述资源来源与授权，不会改变 AsterPet 自身的 Apache-2.0 许可证。

## 目录示例

```text
sample-character.asterpet
├── asterpet.package.json
└── idle
    ├── scene.json
    └── assets
        ├── model.atlas
        ├── model.png
        └── model.skel
```

## 导入安全

AsterPet 在解压前检查路径穿越，并限制单包最多 20,000 个条目、解压体积最多 8 GiB。安装使用同一缓存目录内的临时目录和原子替换；覆盖失败时恢复旧版本。

人物包是资源分发单元。创建和分享人物包前，发布者必须确认拥有模型、贴图、音频及其他内容的再分发权。

## Spine 图层分类

Spine 场景必须在 `scene.json` 中提供 `layers`，让人物包自行声明哪些 slot 属于人物、内部技术层和可切换配件。标准格式为 `asterpet.layers/v1`。导入器会拒绝缺少该声明的 Spine 发布包；这样资源专属命名和细分不会进入 AsterPet 的通用规则：

```json
{
  "layers": {
    "format": "asterpet.layers/v1",
    "characterSlots": ["body", "eye_L", "eye_R", "hair_front"],
    "internalSlots": ["MASK", "body_shadow"],
    "groups": [
      {
        "id": "background",
        "label": "背景与场景",
        "role": "background",
        "defaultVisible": false,
        "slots": ["BG", "floor", "window"]
      },
      {
        "id": "furniture",
        "label": "家具与寝具",
        "role": "prop",
        "defaultVisible": true,
        "slots": ["chair", "table"]
      },
      {
        "id": "other",
        "label": "其他",
        "role": "prop",
        "defaultVisible": true,
        "slots": ["package_specific_accessory"]
      }
    ],
    "defaultPropsVisible": true,
    "defaultVisibleSlots": []
  }
}
```

发布包应提供精确的 `slots` 清单。`pattern` 正则仍可用于规则稳定的批量命名，但它更适合作为制作阶段的便利功能，不建议用来代替最终清单。AsterPet 的内置分类只负责兼容开发阶段的未迁移资源，且只包含通用背景、家具、服装、特效等规则；资源特有的部件和细分必须由资源包声明。

内置规则不包含具体人物、场景编号或资源专属命名。资源作者应把这类分类写入自己的 `scene.json`，而不是修改 AsterPet 的全局规则文件；这样资源可以独立演进，程序本体也不会携带某个资源的专属分类词表。

每个 Spine slot 必须且只能属于以下三种归属之一，并且三种归属都会显示在“图层与组件”面板中：

- `characterSlots`：人物本体，显示在“人物本体”组中并默认启用。
- `internalSlots`：遮罩、马赛克和渲染辅助层，显示在“技术与遮罩”组中并默认关闭。
- `groups[].slots`：用户可以启用或屏蔽的背景、配件和特效。

分类只决定 slot 在面板中的分组，绝不决定它是否加载。任何规则都不得丢弃 slot；无法准确判断的 slot 必须放入 `other` 分组。建议将分类维持在人物本体、技术与遮罩、背景与场景、家具与寝具、食品与餐具、服装与配饰、玩具、武器与装备、机械与设备、自然与生物、生活与装饰、主题装饰、文字与界面、场景特效和其他这些稳定大类；不要为单个 slot 创建一个分类。

支持的 `role` 为 `background`、`prop`、`effect`、`clothing`、`equipment`、`interface`、`character` 和 `internal`。`id` 在同一场景中必须唯一，显式 slot 不能跨 `characterSlots`、`internalSlots` 或不同分组重复。导入时会校验这些约束。

维护者可以先预览自动迁移结果，再写入现有资源：

```bash
pnpm migrate:layers
pnpm migrate:layers -- --write
pnpm validate:layers
```

迁移器会读取 Spine 骨骼中的完整 slot 列表，使用内置规则生成精确清单，并将所有未识别项归入“其他”。已有标准元数据默认保留，只有显式传入 `--force` 才会重新生成。`validate:layers` 会检查每个 Spine slot 是否恰好拥有一个归属，并报告不存在或遗漏的 slot。自动迁移是整理旧包的起点；发布前仍应由资源作者检查人物部件和模型特有配件的归属。

## 统一外观变体

AsterPet 把用户眼中的服装、造型和阶段统一称为“外观变体”，但允许资源采用两种底层实现：

- 多场景实现：每套外观使用独立 Spine 骨骼文件。相同 `characterId`、相同 `category` 且声明相同 `appearance.id`（旧资源则标题相同）的场景，会聚合为一张逻辑场景卡，并在该卡的外观选择器中作为变体，适合 BD 一类资源。
- Spine skin 实现：同一骨骼内使用多个 skin。适合 H 一类包含 `LV1`、`LV2` 等 skin 的资源。

工具栏只展示一个“外观”选择器。多场景外观会切换场景，skin 外观只切换当前骨骼的 skin；用户不需要理解资源内部采用哪种方式。场景可在 `scene.json` 中使用 `asterpet.appearance/v1` 提供稳定 ID 和可读名称。

独立场景外观只需声明本场景的外观身份。若同一逻辑外观由多个独立场景文件组成，可在每个文件中声明相同的 `appearance.id`，并用 `variant` 声明工具栏中的变体名称：

```json
{
  "appearance": {
    "format": "asterpet.appearance/v1",
    "id": "nightmare",
    "label": "惊悚之梦"
  }
}
```

```json
{
  "appearance": {
    "format": "asterpet.appearance/v1",
    "id": "nightmare",
    "label": "惊悚之梦",
    "variant": { "id": "palette-1", "label": "变体 1" }
  }
}
```

同一骨骼包含多个 skin 时，在同一声明中建立显式映射：

```json
{
  "appearance": {
    "format": "asterpet.appearance/v1",
    "id": "standard",
    "label": "标准造型",
    "defaultVariant": "level-1",
    "variants": [
      { "id": "level-1", "label": "阶段 1", "skin": "LV1" },
      { "id": "level-1-m", "label": "阶段 1 · M", "skin": "LV1_M" },
      { "id": "level-2", "label": "阶段 2", "skin": "LV2" }
    ]
  }
}
```

`appearance.id` 和 `variants[].id` 是资源内稳定标识，`label` 是面向用户的名称，`skin` 必须与 Spine 文件中的 skin 名完全一致。同一人物包中，如果多份技术场景只是同一外观的不同编码或贴图组合，应声明相同的 `appearance.id`，选择器会把它们聚合成一个外观；真正不同的造型必须使用不同 ID。

未声明 `appearance` 的旧资源仍可运行：程序会从场景标题推断并聚合同名的多场景外观，同时直接使用 Spine skin 原名；正式发布的新资源应显式声明，避免把 `LV1` 或哈希场景 ID 暴露给用户。

场景面板展示逻辑场景，而不是底层文件。逻辑场景卡的收藏会覆盖族内全部变体；工具栏外观选择器才展示该场景族的变体。

## 动作视口上限

`window.adaptiveToContent` 开启时，程序会预先采样 idle 和交互动作并使用固定相机。为避免大型特效把窗口无限撑大，可配置相对 idle 的最大扩展比例：

```json
{
  "viewport": {
    "padding": "4%",
    "maxInteractiveExpansion": 0.35
  }
}
```

默认值为 `0.35`，表示每个方向最多比 idle 多预留 35%；超过部分允许裁切，不会在动作期间缩放人物或切换相机。

## 管理已安装资源包

打开桌宠工具栏中的“资源”，可以查看当前已安装的人物包及其场景数量。用户导入的包支持勾选后批量删除；项目内置包会标记为“内置”并不可删除。正在使用的当前场景所属包需要先切换到其他场景，才能删除。

“批量导入”支持在文件选择器中同时选中多个 `.asterpet` 文件。导入过程中单个文件失败不会阻塞其他文件，完成后界面会分别提示成功和失败数量。

## 自然行为循环

Spine 场景可以通过 `behavior` 声明待机状态图、动作表情配方和外部状态叠加。运行器始终让身体动作留在 `track 0`，默认把表情放在独立的 `track 1`，只修改表情动画实际打关键帧的属性，不会把整套姿态切走。用户动作优先于待机表情；动作结束后才恢复持续的外部状态叠加。

```json
{
  "behavior": {
    "initialDelayMs": 5000,
    "minIntervalMs": 7000,
    "maxIntervalMs": 16000,
    "mixDuration": 0.22,
    "agentTrack": 2,
    "ambient": [
      { "animation": "90_Emo1_normal", "weight": 3, "track": 1, "holdMs": 2400 },
      { "animation": "90_Emo4_happy", "weight": 2, "track": 1, "holdMs": 2400 },
      { "animation": "90_Emo9_eyeclose", "weight": 2, "track": 1, "holdMs": 700 },
      { "animation": "99_sleep", "weight": 1.2, "mode": "base", "holdMs": 2400 },
      { "animation": "99_dizzy", "weight": 0.8, "mode": "base" }
    ],
    "actionRecipes": {
      "touch": ["90_Emo4_happy", "90_Emo6_shame", "90_Emo8_worry"],
      "damage": ["90_Emo5_panic", "90_Emo3_sad"],
      "dead": ["90_Emo9_eyeclose", "90_Emo3_sad"],
      "cutIn": ["90_Emo2_angry", "90_Emo7_serious"]
    },
    "agentOverlays": {
      "streaming": { "animation": "91_Emo_talk", "loop": true }
    }
  }
}
```

`ambient` 可以使用动画名字符串，也可以使用带 `weight`、`track`、`mode`、`holdMs` 的对象。表情轨道至少保留 `max(动画完整时长, holdMs)`，因此单帧表情不会一闪而过，正常动画也不会被提前截断。完整身体动作必须使用 `mode: "base"`；它会从 Idle 进入并完整返回 Idle。未提供 `behavior.ambient` 时，运行器只自动推断 `dizzy`、`yawn`、`stretch` 等低频身体状态；`sleep` 不会自动加入，因为旧资源中它经常只是静态姿态。确实需要自动播放睡眠动作的资源，必须在 `behavior.ambient` 中显式声明。`agentTrack` 默认为 `2`，用于外部 AI 的说话叠加。

自动编排会根据资源动画结构使用不同轨道：轨道 0 保留 idle、motion 和完整身体待机变体；轨道 1 播放 `_faceN`、表情和眨眼等表情；轨道 2 预留给 `_faceN_talk` 或其他说话叠加。表情轨道结束后保持最后一个有效表情，不清空回 setup pose，避免资源没有在 idle 中重复设置面部 attachment 时出现脸部消失。`_faceN_talk` 不会被当成随机表情，避免说话口型在无人说话时持续播放。资源提供 `behavior` 时，以资源声明为准。

`actionRecipes` 为身体动作选择语义匹配的表情轨道，候选项支持字符串或带 `animation`、`weight`、`track`、`holdMs`、`mixDuration` 的对象；同一动作会避免连续选择相同表情。未配置时，运行器按 happy/shame/worry、panic/sad、angry/serious 等名称为 Touch、Damage、Dead、CutIn 自动建立配方。`agentOverlays` 把外部 AI 状态映射到持续叠加动画，默认将 `streaming` 和 `speaking` 映射到名称包含 `talk` 的动画。所有选择与恢复都发生在动作边界并使用定时器，不增加逐帧计算。

## 动作语义与外部触发

场景可把 Spine 动画声明为有语义的动作。`damage` 和 `dead` 都会完整播放一次，结束后默认回到 `idle`。`dead` 默认额外保持末帧 200ms，避免混合过早造成动作尚未结束的观感；可通过 `holdMs` 调整。设置 `returnToIdle: false` 可永久保持结束姿态。它们不会进入自然行为随机循环。

```json
{
  "actions": {
    "idle": { "animation": "00_Idle", "loop": true },
    "touch": { "animation": "04_Touch" },
    "damage": { "animation": "02_Damage" },
    "dead": { "animation": "03_Dead", "holdMs": 200 }
  },
  "gestures": {
    "click": "touch",
    "clickCycle": ["touch", "damage", "dead"],
    "doubleClick": "cutIn"
  }
}
```

未显式声明时，运行器会按 `damage`/`hurt`/`hit` 和 `dead`/`death`/`die` 名称自动补全这两个标准动作。单击人物默认在当前场景实际存在的 `touch → damage → dead` 动作间循环，双击始终触发 `gestures.doubleClick`（通常是 `cutIn`）。人物包可通过 `gestures.clickCycle` 调整单击顺序或移除不需要的动作。

外部程序也可直接调用本机控制接口：

```bash
curl -X POST http://127.0.0.1:18741/action \
  -H 'content-type: application/json' \
  -d '{"action":"dead"}'
```

同一接口可传 `damage`、`idle` 或人物包声明的其他动作名。动作名匹配不区分大小写。
