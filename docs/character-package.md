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

`window.adaptiveToContent` 开启时，程序会预先采样 idle 和交互动作。为避免大型特效把窗口无限撑大，可配置相对 idle 的最大扩展比例：

```json
{
  "viewport": {
    "padding": "4%",
    "maxInteractiveExpansion": 0.35
  }
}
```

默认值为 `0.35`，表示窗口每个方向最多比 idle 多预留 35%。互动场景或启用动作图时，窗口尺寸和镜头范围独立处理：待机按自身完整循环的可见范围铺满可用窗口，切换动作的范围不缩小待机。各动作组按基础姿态与组内片段的完整可见范围确定镜头，同组分段共用镜头；结束返回待机时恢复同一待机镜头，窗口尺寸不随分段变化。其他普通场景仍使用共享的固定镜头，超过预留范围的部分允许裁切。

## 手动调整镜头与窗口

在人物上滚动鼠标滚轮，以鼠标位置为中心缩放窗口内的镜头（10%–1000%）；按住右键拖动可平移画面。右键单击仍开关工具栏，左键拖动仍移动原生窗口。镜头调整不改变骨骼或动画，切换动作时保留用户的缩放和平移，每个场景单独保存镜头设置。

工具栏加减仅调整窗口大小，窗口比例允许至少 20%–400%（资源声明更宽的范围仍有效）。程序启动或切换场景时，窗口比例从 100% 开始。比例数字显示窗口比例，悬停可查看镜头比例；点击“复位”按钮恢复当前场景的镜头缩放与位置，也可点击比例数字复位。镜头调整同时适用于 Spine 和图片序列。

打开工具栏时，场景、图层、资源与 AI 设置面板显示在人物画布左侧的独立区域，工具栏显示在画布下方。原生窗口会为这些控件增加空间，人物画布尺寸、镜头比例与桌面位置保持不变；关闭工具栏时收回控件区域。人物与图片的显示和命中检测都限制在画布内，镜头放大或平移后不会覆盖左侧面板。

工具栏“固定”开关可防止人物点击改变当前动作。开启后显示“已固定”，屏蔽人物左键单击、双击和中键动作切换，并取消尚未执行的延迟单击。资源自身的动态 idle 继续播放，窗口拖动、镜头调整、面板操作与工具栏选动作仍可使用。再次点击解除固定；切换资源场景时自动解除。

## 管理已安装资源包

打开桌宠工具栏中的“资源”，可以查看当前已安装的人物包及其场景数量。用户导入的包支持勾选后批量删除；项目内置包会标记为“内置”并不可删除。正在使用的当前场景所属包需要先切换到其他场景，才能删除。

“批量导入”支持在文件选择器中同时选中多个 `.asterpet` 文件。导入过程中单个文件失败不会阻塞其他文件，完成后界面会分别提示成功和失败数量。

## 多姿态与分段动画

### 过场与分镜

Spine 资源包含 `loop`/`*_idle` 和 `cut`/`ALL` 动画时，播放器按实际动画结构识别过场，不依赖包的 `category` 标签。标为人物或互动的旧包也能联动播放；已有编号互动动作图优先。工具栏“完整过场”优先播放作者提供的 `ALL`、`All_cut` 或 `cut_all`；没有整段动画时按主分镜的名称顺序播放。数字子片段按自然顺序排列，同一分镜的 `_all` 优先于其数字片段。备用版本和局部特效不加入默认整段演出，仍可在工具栏单独选择。

`A_cut → A_cut_idle` 这样的明确配对及原生关键帧匹配用于识别循环状态关系。工具栏将配对片段合成一个“分镜 · cut → loop”选项。选择分镜或通过人物点击切换分镜，会先播放 cut，再进入对应的资源原生循环；保留 cut 最后的未设关键帧的姿态、镜头取景和已播放完成的镜头轨道。通过端点推断的循环从匹配的原生相位开始。自动播放完整过场会依次切镜，结束后接对应循环。

显式选择“原始片段”或工具栏“完整过场”时，在当前最后一个片段的末尾约 4 帧内慢速往返循环（一个往返约 2.4 秒，折返处平滑减速），使用资源导出的 FPS（没有时按 30 FPS），并限制在最后一个分镜区间。没有可靠配对循环的分镜也使用该尾部循环。保持当前选择和取景，选项标为“末帧循环”。尾部循环直接使用资源原始时间线，不生成呼吸或晃动，不重复动作完成回调和结尾事件。修改版的名称不能保证存在唯一的故事顺序，自动关系是基于资源数据的推断。

手动模式下左键下一个主分镜、中键上一个；自动模式下左键播放完整过场。双击切换循环状态，有对应 cut 时先播放 cut；“固定”仍可屏蔽人物动作点击。

分镜的附件与缩放关键帧决定视角切换，每个分镜区间分别取景，零缩放隐藏的备用网格不参与取景。区间内保留资源自带的位移、缩放和镜头抖动；小型独立 `*_camera` 动画的原生变换/约束通道会随对应分镜播放，不附加清空人物的附件通道。用户的镜头缩放和平移保留，原生窗口尺寸不随分镜变化。资源的透明度、附件和缩放时间线控制显隐与交叉淡化，不使用编号互动场景的视角屏蔽规则。

维护者可运行 `node scripts/audit-cinematic-animations.mjs <content-directory>`，检查 JSON/二进制资源的整段顺序、原生循环衔接和镜头关键帧。

### 编号互动动作

加载具有编号 `idleN` 和 `mixN_G_P` 的模型时，播放器自动建立动作图。JSON 与二进制骨骼使用同一套规则，已有和以后导入的互动资源都适用。同组数字片段按编号排序，`_end` 放在末尾；`_org`、`_long`、`_loop` 等变体单独展示，不拼进普通动作组。`motion` 的目标姿态通过末帧与各 idle 的关键帧姿态比较识别；无法区分时播放一次并回到源姿态，选择其它待机或动作组仍能直接进入正确的基础姿态。

发布者也可通过 `behavior.animationGraph` 明确覆盖自动识别结果。基础姿态持续占用 track 0；同一动作组的局部片段在 track 1 上按顺序播放一次，最后释放附加轨道。切换片段也播放一次，随后进入声明的目标姿态。手动切换动作会清理上一动作的轨道与局部姿态。

```json
{
  "behavior": {
    "animationGraph": {
      "format": "asterpet.animation-graph/v1",
      "states": ["idle1", "idle2", "idle3"],
      "transitions": [
        { "animation": "motion1_9", "from": "idle1", "to": "idle2" },
        { "animation": "motion2_1", "from": "idle2", "to": "idle3" },
        { "animation": "motion3_0", "from": "idle3", "to": "idle2" }
      ],
      "sequences": [
        {
          "id": "mix3_1",
          "base": "idle3",
          "animations": ["mix3_1_1", "mix3_1_2"]
        }
      ]
    }
  }
}
```

工具栏展示完整动作组和姿态切换。选择动作组时，程序先沿已声明的切换边进入其基础姿态，再连续播放片段。无可用路径时直接设置所选基础姿态。`sequences` 可选 `compatibleBases` 数组用于声明同一组片段适用的其它基础姿态，默认仅适用 `base`。

编号互动场景支持直接操作人物，默认使用手动模式：左键单击播放当前基础姿态下的下一个普通动作组，中键单击播放上一个，首尾循环。每次播放一个完整动作组，组内分段自动衔接；动作结束后仍记住当前位置，下一次点击继续前进或后退。播放中点击可立即切换动作，基础 idle 不重启。工具栏的“手动／自动”按钮切换模式，并记住选择；自动模式下左键单击连续播放当前基础姿态适用的普通动作组，组内及组间连续衔接，播放中再次左键单击不会重启系列，暂停中的系列会继续播放。中键在两种模式下都取消剩余队列并播放上一个动作组。切回手动时保留当前动作并清除后续队列。动作结束后保持同一基础姿态。双击切换到下一个编号待机姿态，有已知 motion 路径时播放过渡，没有路径时直接切换；双击会取消正在播放的动作系列。两种手势都不调用包内固定的 touch/cutIn。没有同姿态动作的场景保持当前姿态。基础 idle 的播放时间在动作结束后保留。未明确配置 `agentStates` 时，AI 状态通知仅更新状态显示，不自动触发身体动作；明确配置的映射仍生效。

工具栏（下拉选择和左右箭头）明确选择动作时，动作组只播放一次，结束后保留动作姿态、当前选择和视角。部分资源在动作末尾内置了恢复基础 idle 的收尾：运行器依据原资源 attachment 关键帧，识别后半段同时恢复至少四个基础图层的复位点，保留复位前一个资源帧的姿态。多段组末尾只恢复基础图层的 `_end` 分段会在这个模式下跳过；没有识别到复位点时，使用原动作末尾。人物手势仍完整播放原收尾。对应资源的基础 idle 仍在底层循环，已完成动作在上层循环结束点之前的约 4 个资源帧（慢速平滑往返）：动作占用的通道播放这段原生末尾时间线，其余通道继续播放资源自身的待机动态。明确选择 motion 时保留其末态，并以资源中已知目标待机作为动态底层；明确选择 idle 时继续播放这个资源的原生循环。这里不生成呼吸、晃动或骨骼变形。没有兼容基础 idle 的完整 cut 等动画也循环自身末尾几帧，不叠加其他视角或编造动态。单击、中键和双击可以继续离开保留的编号动作末态，手势播放仍按原有结束规则处理。

独立视角按当前待机隔离：当不同编号 idle 分别主要控制两套独立骨骼时，仅显示当前状态所属的骨骼及共享组件。视图骨骼可以位于根节点下，也可以嵌套在共享的 `all` 节点下。所有权依据原生骨骼动画的主要控制关系识别，setup 附件、复制到所有姿态的正向 attachment 关键帧和少量其他视图复位键不会激活整套视角。多个编号 idle 可以共用同一视图，骨骼名称中的 idle 编号不强制对应待机编号。额外的同名视角组件跟随该视图实际所属的状态集合。mix 沿用当前基础状态的视角，motion 保留末态时使用目标状态的视角。独立 loop 等额外视图按其原生骨骼控制关系隔离，复制到编号待机的附件不会激活它；确实主要控制额外视图的编号动作使用该视图，并隐藏其他姿态。正常共享一套骨骼的多种姿态继续共用该骨骼。原有 cut 视角与额外 Master 图层的隔离规则同时生效。



片段名称的数字只是资源提供者的命名约定。发布者应从首尾关键帧核对 `from`、`to` 和 `animations` 顺序；明确声明的动作图优先于自动识别。缺少对应编号 idle 的修改版会比较可用 idle 来选择基础姿态，原资源缺失的数据不会因此恢复。启用动作图时，旧的自动待机表情和动作表情推断暂停，避免附加轨道冲突。视口采样包含基础姿态与局部片段的组合。同一骨骼中内嵌的其它镜头会按骨骼分支的动画归属控制可见性：互动动作隐藏独立 cut 分支，选择 cut 动画时隐藏未参与的互动分支。编号互动动作同时隐藏资源中名为 `Master` 的额外整个人物图层。共享骨骼和没有动画控制的静态图层保留。

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
