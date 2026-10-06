const animationSelect = document.getElementById("animations");
const interactionModeButton = document.getElementById("interaction-mode");
const stateLockButton = document.getElementById("state-lock");
const appearanceSelect = document.getElementById("appearances");
const propsPanel = document.getElementById("props-panel");
const propsList = document.getElementById("props-list");
const layerSearchInput = document.getElementById("layer-search-input");
const layerSearchCount = document.getElementById("layer-search-count");
const layerSearchEmpty = document.getElementById("layer-search-empty");
const layerSearchEnable = document.getElementById("layer-search-enable");
const layerSearchDisable = document.getElementById("layer-search-disable");
const scenePanel = document.getElementById("scene-panel");
const sceneList = document.getElementById("scene-list");
const sceneFilter = document.getElementById("scene-filter");
const sceneMessage = document.getElementById("scene-message");
const aiPanel = document.getElementById("ai-panel");
const packagesPanel = document.getElementById("packages-panel");
const packagesList = document.getElementById("packages-list");
const aiEndpoint = document.getElementById("ai-endpoint");
const aiMessage = document.getElementById("ai-message");
const zoomLabel = document.getElementById("zoom-label");
const status = document.getElementById("status");
const playerElement = document.getElementById("interaction-layer");
const embeddedStatus = document.getElementById("embedded-status");

document.body.classList.toggle("native-wayland", window.desktopPet.nativeWayland);
document.body.classList.toggle("macos", window.desktopPet.platform === "darwin");
document.body.classList.toggle("side-tools", !window.desktopPet.nativeWayland);

let scene;
let sceneManifest;
let sceneCatalog;
let globalLayerRules;
let uiState = { mirrored: false, propVisibility: {}, favoriteSceneIds: [], appearanceByScene: {}, variantSceneByFamily: {} };
let uiStateInitialized = false;
let player;
let animationNames = [];
let backgroundPatterns = [];
let internalHiddenPatterns = [];
let characterPatterns = [];
let propGroups = [];
let explicitCharacterSlots = new Set();
let explicitInternalSlots = new Set();
let hiddenLayerSlotIndices = [];
let currentAudio;
let baseViewport;
let animationViewports = {};
const cinematicViewports = new Map();
let appearanceOptions = new Map();
let activeViewportAnimation;
let sceneScale;
const initialWindowScale = 1;
let adaptiveWindowSize;
let sequenceImage;
let sequenceTimer;
let enabledPropSlots = new Set();
let currentAgentState = "idle";
let currentAgentPayload = { state: "idle" };
let toolsVisible = false;
let toolbarAnimationActive = false;
let stateLocked = false;
let mirrored = false;
let disposing = false;
let shutdownPrepared = false;
let sceneGeneration = 0;
let embeddedStatusLayoutSignature = "";
const spinePlayerHost = new window.AsterPet.SpinePlayerHost({
  spineRuntime: spine,
  parentId: "player",
  stableSurface: window.desktopPet.nativeWayland,
  initialSurfaceWidth: 390,
  initialSurfaceHeight: 540
});
const renderScheduler = new window.AsterPet.SpineRenderScheduler({
  getFrameRate: () => {
    const currentAnimation = player?.animationState?.getCurrent(0)?.animation?.name;
    const idleAnimation = scene?.actions?.idle?.animation;
    const configuredRate = currentAnimation === idleAnimation
      ? scene?.render?.idleFps
      : scene?.render?.activeFps;
    return Math.max(15, Math.min(60, Number(configuredRate) || 60));
  },
  onMetrics: metrics => petLog(`Spine rendering: ${metrics.fps.toFixed(1)} FPS, ${metrics.averageRenderTime.toFixed(2)} ms/frame`)
});
const portraitComposer = new window.AsterPet.PortraitAnimationComposer({
  getPlayer: () => player,
  getScene: () => scene,
  spineRuntime: spine
});
const behaviorDirector = new window.AsterPet.AmbientBehaviorDirector({
  getPlayer: () => player,
  getScene: () => scene,
  getAnimationNames: () => animationNames,
  isFullPoseAnimation: animationName => isFullPoseAnimation(animationName),
  isOverlayAnimation: animationName => portraitComposer.isOverlay(animationName),
  getOverlayAnimation: animationName => getOverlayAnimation(animationName),
  canPlay: () => {
    if (disposing || toolbarAnimationActive || currentAgentState !== "idle") return false;
    const currentAnimation = player?.animationState?.getCurrent(0)?.animation?.name;
    return currentAnimation === scene?.actions?.idle?.animation;
  },
  onAnimation: animationName => {
    portraitComposer.noteOverlay(animationName);
    actionChoreographer.refreshAgentOverlay();
    petLog(`Ambient overlay: ${animationName}`);
  },
  log: message => petLog(message)
});
const actionChoreographer = new window.AsterPet.ActionChoreographer({
  getPlayer: () => player,
  getScene: () => scene,
  getAnimationNames: () => animationNames,
  getOverlayAnimation: animationName => getOverlayAnimation(animationName),
  resolveAgentAnimation: animationName => portraitComposer.talkingAnimation(animationName),
  onAnimation: animationName => {
    portraitComposer.noteOverlay(animationName);
    petLog(`Action overlay: ${animationName}`);
  },
  log: message => petLog(message)
});
const animationGraphPlayer = new window.AsterPet.AnimationGraphPlayer({
  getPlayer: () => player,
  getScene: () => scene,
  spineRuntime: spine,
  onAnimation: animationName => setAnimationViewport(animationName),
  onSelection: selection => { animationSelect.value = selection; },
  log: message => petLog(message)
});
animationGraphPlayer.setInteractionMode(localStorage.getItem("interactionPlaybackMode"));
function updateInteractionModeButton() {
  const automatic = animationGraphPlayer.interactionMode === "auto";
  interactionModeButton.hidden = !animationGraphPlayer.enabled;
  document.body.classList.toggle("interaction-graph", animationGraphPlayer.enabled);
  interactionModeButton.textContent = automatic ? "自动" : "手动";
  interactionModeButton.title = automatic
    ? "自动：左键连续播放，中键上一个动作；点击切换手动播放"
    : "手动：左键下一个动作，中键上一个动作；点击切换自动播放";
}
interactionModeButton.addEventListener("click", () => {
  animationGraphPlayer.setInteractionMode(animationGraphPlayer.interactionMode === "auto" ? "manual" : "auto");
  localStorage.setItem("interactionPlaybackMode", animationGraphPlayer.interactionMode);
  updateInteractionModeButton();
});
const geometryInput = new window.AsterPet.GeometryInputController({
  desktopPet: window.desktopPet,
  spineRuntime: spine,
  getScene: () => scene,
  getPlayer: () => player,
  getSequenceImage: () => sequenceImage,
  getMirrored: () => mirrored,
  embeddedStatus,
  controlElements: () => [document.getElementById("toolbar"), propsPanel, scenePanel, packagesPanel, aiPanel],
  statusElement: status,
  log: message => window.desktopPet.log(message)
});
const petInteraction = new window.AsterPet.PetInteractionController({
  desktopPet: window.desktopPet,
  element: playerElement,
  geometryInput,
  getScene: () => scene,
  getAnimationGraphEnabled: () => animationGraphPlayer.enabled,
  getStateLocked: () => stateLocked,
  getToolsVisible: () => toolsVisible,
  setToolsVisible: visible => setToolsVisible(visible),
  playAction: action => playAction(action),
  playInteraction: gesture => animationGraphPlayer.interact(gesture),
  zoomView: (factor, x, y) => zoomCamera(factor, x, y),
  panView: (dx, dy) => panCamera(dx, dy),
  log: message => petLog(message)
});
const toolbarController = new window.AsterPet.ToolbarController({
  desktopPet: window.desktopPet,
  elements: {
    animationSelect,
    appearanceSelect,
    propsPanel,
    layerSearchInput,
    scenePanel,
    aiPanel,
    packagesPanel,
    packagesList,
    packagesToggle: document.getElementById("packages-toggle"),
    packageImport: document.getElementById("package-import"),
    packageDelete: document.getElementById("package-delete"),
    packageSelectAll: document.getElementById("package-select-all"),
    packagesMessage: document.getElementById("packages-message"),
    aiEndpoint,
    aiMessage,
    aiDriver: document.getElementById("ai-driver"),
    dialogTheme: document.getElementById("dialog-theme"),
    status,
    propsToggle: document.getElementById("props-toggle"),
    sceneToggle: document.getElementById("scene-toggle"),
    aiSettings: document.getElementById("ai-settings"),
    windowMenu: document.getElementById("window-menu"),
    aiSave: document.getElementById("ai-save"),
    aiCancel: document.getElementById("ai-cancel"),
    importDialogTheme: document.getElementById("import-dialog-theme"),
    chatToggle: document.getElementById("chat-toggle"),
    importPackage: document.getElementById("import-package"),
    previous: document.getElementById("previous"),
    next: document.getElementById("next"),
    zoomOut: document.getElementById("zoom-out"),
    zoomIn: document.getElementById("zoom-in"),
    mirror: document.getElementById("mirror"),
    minimize: document.getElementById("minimize"),
    close: document.getElementById("close")
  },
  getScene: () => scene,
  getActiveSceneId: () => scene?.id,
  onPackagesChanged: async () => {
    [sceneManifest, sceneCatalog] = await Promise.all([
      window.desktopPet.getSceneManifest(),
      window.desktopPet.getSceneCatalog()
    ]);
    if (scene) buildSceneList();
  },
  setToolsVisible: visible => setToolsVisible(visible),
  setMousePassthrough: enabled => setMousePassthrough(enabled),
  playAnimation: name => playAnimation(name, { holdFinal: true }),
  changeScale: delta => changeSceneScale(delta),
  toggleMirrored: () => { void toggleMirrored(); },
  getAnimationNames: () => animationGraphPlayer.enabled ? animationGraphPlayer.choices().map(choice => choice.id) : animationNames,
  selectAppearance: optionId => selectAppearance(optionId)
});

function applyEmbeddedStatusLayout(layout) {
  if (!window.desktopPet.nativeWayland || !layout) return;
  const signature = [
    layout.reserveWidth,
    layout.petWidth,
    layout.petHeight,
    layout.left,
    layout.top,
    layout.width,
    layout.height,
    Boolean(layout.visible)
  ].join(":");
  if (signature === embeddedStatusLayoutSignature) return;
  embeddedStatusLayoutSignature = signature;
  const values = {
    "--pet-pane-left": layout.reserveWidth,
    "--pet-pane-width": layout.petWidth,
    "--pet-pane-height": layout.petHeight,
    "--embedded-status-left": layout.left,
    "--embedded-status-top": layout.top,
    "--embedded-status-width": layout.width,
    "--embedded-status-height": layout.height
  };
  for (const [property, value] of Object.entries(values)) {
    document.documentElement.style.setProperty(property, `${Math.max(0, Math.round(Number(value) || 0))}px`);
  }
  spinePlayerHost.setSurfaceSize(layout.petWidth, layout.petHeight);
  spinePlayerHost.setContentRect(layout.reserveWidth, 0, layout.petWidth, layout.petHeight);
  embeddedStatus.hidden = !layout.visible;
  document.body.classList.toggle("embedded-status-visible", Boolean(layout.visible));
  requestAnimationFrame(() => geometryInput.reportInputShape());
}

function setToolsVisible(visible) {
  toolsVisible = visible;
  document.body.classList.toggle("tools-visible", visible);
  window.desktopPet.setToolbarVisible(visible);
  if (visible) setMousePassthrough(false);
  if (!visible) {
    propsPanel.hidden = true;
    scenePanel.hidden = true;
    aiPanel.hidden = true;
    packagesPanel.hidden = true;
  }
  geometryInput.requestVisualBoundsUpdate();
  requestAnimationFrame(() => geometryInput.reportInputShape());
}

const defaultAgentStateActions = {
  idle: "idle",
  thinking: "idle",
  streaming: "idle",
  working: "idle",
  waiting: "idle",
  success: "touch",
  error: "touch",
  cancelled: "idle",
  blocked: "idle"
};

function petLog(message) {
  window.desktopPet.log(message);
}

function setMousePassthrough(enabled) {
  petInteraction.setMousePassthrough(enabled);
}

async function disposeScene({ shutdown = false } = {}) {
  if (disposing) return;
  disposing = true;
  sceneGeneration += 1;
  clearTimeout(petInteraction.touchTimer);
  setStateLocked(false);
  if (shutdown) {
    petInteraction.dispose();
    geometryInput.stop();
  }
  if (sequenceTimer) clearInterval(sequenceTimer);
  sequenceTimer = undefined;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.removeAttribute("src");
    currentAudio.load();
    currentAudio = undefined;
  }
  actionChoreographer.stop();
  behaviorDirector.stop();
  animationGraphPlayer.stop();
  portraitComposer.stop();
  toolbarAnimationActive = false;
  updateInteractionModeButton();
  renderScheduler.stop();
  spinePlayerHost.clear();
  player = undefined;
  sequenceImage?.remove();
  sequenceImage = undefined;
  animationNames = [];
  backgroundPatterns = [];
  internalHiddenPatterns = [];
  characterPatterns = [];
  propGroups = [];
  explicitCharacterSlots = new Set();
  explicitInternalSlots = new Set();
  hiddenLayerSlotIndices = [];
  enabledPropSlots = new Set();
  fullPoseAnimationCache.clear();
  overlayAnimationCache.clear();
  baseViewport = undefined;
  animationViewports = {};
  cinematicViewports.clear();
  activeViewportAnimation = undefined;
  adaptiveWindowSize = undefined;
  animationSelect.replaceChildren();
  appearanceSelect.replaceChildren();
  appearanceOptions.clear();
  propsList.replaceChildren();
  geometryInput.resetScene();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  spinePlayerHost.release({ destroy: shutdown });
  disposing = false;
}

function findPropGroup(slotName) {
  return propGroups.find(group => group.slotNames?.has(slotName) || group.regex?.test(slotName));
}

function isCharacterSlot(slotName) {
  if (explicitCharacterSlots.has(slotName)) return true;
  if (propGroups.some(group => group.source === "package" && group.slotNames?.has(slotName))) return false;
  return characterPatterns.some(pattern => pattern.test(slotName));
}

function isInternalSlot(slotName) {
  if (explicitInternalSlots.has(slotName)) return true;
  if (explicitCharacterSlots.has(slotName)
    || propGroups.some(group => group.source === "package" && group.slotNames?.has(slotName))) return false;
  return internalHiddenPatterns.some(pattern => pattern.test(slotName));
}

function isLayoutDecorationSlot(slotName) {
  const group = findPropGroup(slotName);
  if (["background", "effect", "interface", "internal"].includes(group?.role)) return true;
  return backgroundPatterns.some(pattern => pattern.test(slotName));
}

function resolveSlotStagePrefix(slot) {
  const slotPrefix = slot?.data?.name?.match(/^(?:\(sh\))?([ABCS])_/i)?.[1];
  if (slotPrefix) return slotPrefix.toUpperCase();
  for (let bone = slot?.bone; bone; bone = bone.parent) {
    const bonePrefix = bone.data?.name?.match(/^([ABCS])_/i)?.[1];
    if (bonePrefix) return bonePrefix.toUpperCase();
  }
  return undefined;
}

function resolveAnimationStagePrefix(targetSkeleton, animationName) {
  const stageMatch = String(animationName || "").match(/^(?:idle|motion|mix)(\d+)(?:_|$)/i);
  if (!stageMatch) return undefined;
  const stageCounts = new Map();
  for (const slot of targetSkeleton?.slots || []) {
    const prefix = resolveSlotStagePrefix(slot);
    if (prefix) stageCounts.set(prefix, (stageCounts.get(prefix) || 0) + 1);
  }
  const stages = ["A", "B", "C", "S"].filter(prefix => (stageCounts.get(prefix) || 0) >= 10);
  if (stages.length < 2) return undefined;
  return stages[Number(stageMatch[1]) - 1];
}

const fullPoseAnimationCache = new Map();
const overlayAnimationCache = new Map();

function isFullPoseAnimation(animationName) {
  if (portraitComposer.isOverlay(animationName)) return false;
  if (!animationName || !player?.skeleton?.data) return false;
  if (fullPoseAnimationCache.has(animationName)) return fullPoseAnimationCache.get(animationName);
  const animation = player.skeleton.data.findAnimation(animationName);
  if (!animation) return false;
  const slotCount = player.skeleton.slots.length;
  const attachmentSlots = new Set();
  for (const timeline of animation.timelines || []) {
    if (Array.isArray(timeline.attachmentNames) && Number.isInteger(timeline.slotIndex)) {
      attachmentSlots.add(timeline.slotIndex);
    }
  }
  const fullPose = attachmentSlots.size >= Math.max(24, Math.ceil(slotCount * 0.2));
  fullPoseAnimationCache.set(animationName, fullPose);
  return fullPose;
}

function getOverlayAnimation(animationName) {
  const portraitOverlay = portraitComposer.overlay(animationName);
  if (portraitOverlay) return portraitOverlay;
  if (!animationName || !player?.skeleton?.data) return undefined;
  if (overlayAnimationCache.has(animationName)) return overlayAnimationCache.get(animationName);
  const source = player.skeleton.data.findAnimation(animationName);
  if (!source || !isFullPoseAnimation(animationName)) {
    overlayAnimationCache.set(animationName, source);
    return source;
  }
  const expressionSlot = /(?:face|eye|eyeboll|eyebrow|brow|lash|mouth|lip|blush|nose|tongue|pupil|emotion)/i;
  const timelines = source.timelines.filter(timeline => {
    if (!Array.isArray(timeline.attachmentNames) || !Number.isInteger(timeline.slotIndex)) return true;
    const slotName = player.skeleton.slots[timeline.slotIndex]?.data?.name || "";
    return expressionSlot.test(slotName);
  });
  const overlay = timelines.length === source.timelines.length
    ? source
    : new spine.Animation(`${source.name}__overlay`, timelines, source.duration);
  overlayAnimationCache.set(animationName, overlay);
  return overlay;
}

function getStoredPropVisibility(sceneId = scene?.id) {
  const value = uiState.propVisibility?.[sceneId];
  if (Array.isArray(value)) return { legacy: true, visibleSlots: new Set(value) };
  if (value?.version === 2 && Array.isArray(value.visibleSlots)) {
    return { legacy: false, visibleSlots: new Set(value.visibleSlots) };
  }
  return undefined;
}

async function persistUiState(values) {
  uiState = await window.desktopPet.updateUiState(values);
}

function applyMirroredState() {
  const mirrorButton = document.getElementById("mirror");
  document.body.classList.toggle("pet-mirrored", mirrored);
  mirrorButton.setAttribute("aria-pressed", String(mirrored));
  mirrorButton.title = mirrored ? "恢复原始方向" : "水平镜像";
  applyCameraView();
  geometryInput.mirrorChanged();
}

async function toggleMirrored() {
  mirrored = !mirrored;
  applyMirroredState();
  await persistUiState({ mirrored });
}

async function initializeUiState() {
  if (uiStateInitialized) return;
  uiStateInitialized = true;
  uiState = await window.desktopPet.getUiState();
  if (!uiState || typeof uiState !== "object") uiState = { propVisibility: {} };
  if (!uiState.propVisibility || typeof uiState.propVisibility !== "object") uiState.propVisibility = {};
  if (!Array.isArray(uiState.favoriteSceneIds)) uiState.favoriteSceneIds = [];
  if (!uiState.appearanceByScene || typeof uiState.appearanceByScene !== "object") uiState.appearanceByScene = {};
  if (!uiState.variantSceneByFamily || typeof uiState.variantSceneByFamily !== "object") uiState.variantSceneByFamily = {};
  mirrored = uiState.mirrored === true;
  applyMirroredState();
  let migrated = false;
  try {
    if (window.desktopPet.testMode) return;
    const legacyScene = localStorage.getItem("selectedScene");
    if (!uiState.selectedScene && legacyScene) {
      uiState.selectedScene = legacyScene;
      migrated = true;
    }
    if (legacyScene) localStorage.removeItem("selectedScene");
  } catch (error) {
    petLog(`Unable to read legacy UI state: ${error}`);
  }
  if (migrated) await persistUiState({ selectedScene: uiState.selectedScene });
}

async function migrateLegacyPropVisibility(sceneId) {
  if (window.desktopPet.testMode) return;
  const key = `prop-visibility:${sceneId}`;
  try {
    const value = JSON.parse(localStorage.getItem(key));
    if (!getStoredPropVisibility(sceneId)
      && (Array.isArray(value) || (value?.version === 2 && Array.isArray(value.visibleSlots)))) {
      uiState.propVisibility[sceneId] = value;
      await persistUiState({ propVisibility: uiState.propVisibility });
    }
    localStorage.removeItem(key);
  } catch (error) {
    petLog(`Unable to migrate legacy layer visibility: ${error}`);
  }
}

function readPersistedPropSlots() {
  return getStoredPropVisibility();
}

function persistPropSlots() {
  if (!scene?.id) return;
  uiState.propVisibility[scene.id] = { version: 2, visibleSlots: [...enabledPropSlots] };
  void persistUiState({ propVisibility: uiState.propVisibility });
}

function addUnclassifiedPropGroup() {
  const materializedGroups = new Map();
  const characterGroup = {
    id: "character",
    label: "人物本体",
    role: "character",
    defaultVisible: true
  };
  const internalGroup = {
    id: "internal",
    label: "技术与遮罩",
    role: "internal",
    defaultVisible: false
  };
  const addSlot = (group, slotName) => {
    const key = group.id || group.label || "other";
    let target = materializedGroups.get(key);
    if (!target) {
      target = { ...group, id: key, slotNames: new Set(), regex: undefined };
      materializedGroups.set(key, target);
    }
    target.slotNames.add(slotName);
  };
  for (const slot of player.skeleton.slots) {
    const slotName = slot.data.name;
    if (backgroundPatterns.some(pattern => pattern.test(slotName))) {
      addSlot({ id: "background", label: "背景与场景", role: "background", defaultVisible: false }, slotName);
      continue;
    }
    const packageGroup = propGroups.find(group => group.source === "package"
      && (group.slotNames?.has(slotName) || group.regex?.test(slotName)));
    if (packageGroup) {
      addSlot(packageGroup, slotName);
      continue;
    }
    if (explicitCharacterSlots.has(slotName)) {
      addSlot(characterGroup, slotName);
      continue;
    }
    if (explicitInternalSlots.has(slotName)) {
      addSlot(internalGroup, slotName);
      continue;
    }
    const sceneGroup = propGroups.find(group => group.source === "scene-rule"
      && (group.slotNames?.has(slotName) || group.regex?.test(slotName)));
    if (sceneGroup) {
      addSlot(sceneGroup, slotName);
      continue;
    }
    if (isCharacterSlot(slotName)) {
      addSlot(characterGroup, slotName);
      continue;
    }
    if (isInternalSlot(slotName)) {
      addSlot(internalGroup, slotName);
      continue;
    }
    const inferredGroup = findPropGroup(slotName);
    addSlot(inferredGroup || { id: "other", label: "其他", role: "prop" }, slotName);
  }
  propGroups = [...materializedGroups.values()].filter(group => group.slotNames.size > 0);

  const owners = new Map();
  for (const group of propGroups) {
    for (const slotName of group.slotNames) {
      const previous = owners.get(slotName);
      if (previous) throw new Error(`图层 “${slotName}” 同时属于 “${previous}” 和 “${group.label}”`);
      owners.set(slotName, group.label);
    }
  }
  const missingSlots = player.skeleton.slots
    .map(slot => slot.data.name)
    .filter(slotName => !owners.has(slotName));
  if (missingSlots.length > 0) throw new Error(`图层分类遗漏：${missingSlots.join(", ")}`);
  petLog(`Materialized all ${owners.size} slots into ${propGroups.length} layer groups`);
}

function normalizeLayerSearchText(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase();
}

function fuzzyLayerMatch(value, query) {
  const candidate = normalizeLayerSearchText(value);
  if (candidate.includes(query)) return true;
  let queryIndex = 0;
  for (const character of candidate) {
    if (character === query[queryIndex]) queryIndex += 1;
    if (queryIndex === query.length) return true;
  }
  return false;
}

function updateLayerGroupStates() {
  for (const section of propsList.querySelectorAll(".prop-group")) {
    const groupCheckbox = section.querySelector(".prop-group-header input");
    const checkboxes = [...section.querySelectorAll(".prop-option input")];
    const checkedCount = checkboxes.filter(checkbox => checkbox.checked).length;
    groupCheckbox.checked = checkedCount === checkboxes.length;
    groupCheckbox.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
  }
}

function filterLayerControls() {
  const tokens = normalizeLayerSearchText(layerSearchInput.value).split(/\s+/).filter(Boolean);
  const searching = tokens.length > 0;
  let visibleSlots = 0;
  let totalSlots = 0;
  for (const section of propsList.querySelectorAll(".prop-group")) {
    const groupMatches = searching && tokens.every(token => fuzzyLayerMatch(section.dataset.searchText, token));
    let groupVisibleSlots = 0;
    for (const option of section.querySelectorAll(".prop-option")) {
      totalSlots += 1;
      const visible = !searching || groupMatches
        || tokens.every(token => fuzzyLayerMatch(option.dataset.searchText, token));
      option.hidden = !visible;
      if (visible) groupVisibleSlots += 1;
    }
    section.hidden = groupVisibleSlots === 0;
    if (searching && groupVisibleSlots > 0) section.open = true;
    visibleSlots += groupVisibleSlots;
  }
  layerSearchCount.textContent = searching ? `${visibleSlots}/${totalSlots}` : `${totalSlots} 项`;
  layerSearchEnable.disabled = !searching || visibleSlots === 0;
  layerSearchDisable.disabled = !searching || visibleSlots === 0;
  layerSearchEmpty.hidden = visibleSlots > 0;
}

function setFilteredLayerVisibility(visible) {
  const matchingCheckboxes = [...propsList.querySelectorAll(".prop-option:not([hidden]) input[data-slot-name]")];
  if (matchingCheckboxes.length === 0) return;
  for (const checkbox of matchingCheckboxes) checkbox.checked = visible;
  updateLayerGroupStates();
  applyLayerVisibility();
  persistPropSlots();
  fitSkeletonToWindow();
}

function buildPropControls() {
  propsList.replaceChildren();
  const defaultVisible = new Set(scene.layers?.defaultVisibleSlots || []);
  const persistedVisibility = readPersistedPropSlots();
  for (const group of propGroups) {
    const slots = player.skeleton.slots.filter(slot => findPropGroup(slot.data.name) === group);
    if (slots.length === 0) continue;

    const section = document.createElement("details");
    section.className = "prop-group";
    section.dataset.searchText = group.label;
    const header = document.createElement("summary");
    header.className = "prop-group-header";
    const groupCheckbox = document.createElement("input");
    groupCheckbox.type = "checkbox";
    const groupName = document.createElement("span");
    groupName.textContent = `${group.label} (${slots.length})`;
    header.append(groupCheckbox, groupName);
    const items = document.createElement("div");
    items.className = "prop-group-items";

    const updateGroupState = () => {
      const checkboxes = [...items.querySelectorAll("input")];
      const checkedCount = checkboxes.filter(checkbox => checkbox.checked).length;
      groupCheckbox.checked = checkedCount === checkboxes.length;
      groupCheckbox.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
    };

    for (const slot of slots) {
      const label = document.createElement("label");
      label.className = "prop-option";
      label.dataset.searchText = `${group.label} ${slot.data.name}`;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.slotName = slot.data.name;
      const defaultChecked = defaultVisible.has(slot.data.name)
        || group.defaultVisible === true
        || (group.defaultVisible === undefined && scene.layers?.defaultPropsVisible === true);
      checkbox.checked = persistedVisibility
        ? persistedVisibility.legacy && (group.role === "character" || group.role === "internal")
          ? defaultChecked
          : persistedVisibility.visibleSlots.has(slot.data.name)
        : defaultVisible.has(slot.data.name)
        || group.defaultVisible === true
        || (group.defaultVisible === undefined && scene.layers?.defaultPropsVisible === true);
      checkbox.addEventListener("change", () => {
        updateGroupState();
        applyLayerVisibility();
        persistPropSlots();
        fitSkeletonToWindow();
      });
      label.append(checkbox, document.createTextNode(slot.data.name));
      items.append(label);
    }

    groupCheckbox.addEventListener("change", () => {
      for (const checkbox of items.querySelectorAll("input")) checkbox.checked = groupCheckbox.checked;
      groupCheckbox.indeterminate = false;
      applyLayerVisibility();
      persistPropSlots();
      fitSkeletonToWindow();
    });
    groupCheckbox.addEventListener("click", event => event.stopPropagation());
    updateGroupState();
    section.append(header, items);
    propsList.append(section);
  }
  filterLayerControls();
}

layerSearchInput.addEventListener("input", filterLayerControls);
layerSearchEnable.addEventListener("click", () => setFilteredLayerVisibility(true));
layerSearchDisable.addEventListener("click", () => setFilteredLayerVisibility(false));
layerSearchInput.addEventListener("keydown", event => {
  if (event.key !== "Escape" || !layerSearchInput.value) return;
  layerSearchInput.value = "";
  filterLayerControls();
});

function buildSceneList() {
  const previousScrollTop = scenePanel.scrollTop;
  const openGroupIds = new Set(
    [...sceneList.querySelectorAll(".scene-group[open]")]
      .map(group => group.dataset.groupId)
      .filter(Boolean)
  );
  sceneList.replaceChildren();
  const allSceneIds = new Set(Object.keys(sceneManifest.scenes));
  const favoriteSceneIds = new Set(uiState.favoriteSceneIds.filter(sceneId => allSceneIds.has(sceneId)));
  if (favoriteSceneIds.size !== uiState.favoriteSceneIds.length) {
    uiState.favoriteSceneIds = [...favoriteSceneIds];
    void persistUiState({ favoriteSceneIds: uiState.favoriteSceneIds });
  }
  const favoritesOnly = sceneFilter.value === "favorites";
  const categoryLabels = { interaction: "互动", character: "角色", cg: "CG" };
  const groups = new Map();
  const families = window.AsterPet.resolveSceneFamilies(sceneCatalog);
  for (const family of families) {
    const familySceneIds = family.entries.map(entry => entry.sceneId);
    const isFavorite = familySceneIds.some(sceneId => favoriteSceneIds.has(sceneId));
    if (favoritesOnly && !isFavorite) continue;
    const groupId = family.characterId || "其他";
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push({ family, isFavorite });
  }
  const sortedGroups = [...groups.entries()].sort(([left], [right]) =>
    left === "其他" ? 1 : right === "其他" ? -1 : left.localeCompare(right, undefined, { numeric: true })
  );
  sceneMessage.hidden = sortedGroups.length > 0;
  sceneMessage.textContent = favoritesOnly ? "还没有收藏场景。" : "暂无可用场景。";
  for (const [groupId, entries] of sortedGroups) {
    const group = document.createElement("details");
    group.className = "scene-group";
    group.dataset.groupId = groupId;
    group.open = favoritesOnly || openGroupIds.has(groupId) || entries.some(entry => entry.family.entries.some(item => item.sceneId === scene.id));
    const summary = document.createElement("summary");
    summary.textContent = `${entries[0]?.family.characterLabel || groupId} (${entries.length})`;
    group.append(summary);
    entries.sort((left, right) => {
      const order = { interaction: 0, character: 1, cg: 2 };
      return (order[left.family.category] ?? 9) - (order[right.family.category] ?? 9)
        || left.family.label.localeCompare(right.family.label, undefined, { numeric: true });
    });
    for (const { family, isFavorite } of entries) {
      const activeSceneId = family.entries.some(item => item.sceneId === scene.id) ? scene.id
        : uiState.variantSceneByFamily?.[family.id];
      const targetSceneId = family.entries.some(item => item.sceneId === activeSceneId)
        ? activeSceneId : family.entries[0]?.sceneId;
      const row = document.createElement("div");
      row.className = "scene-option-row";
      const button = document.createElement("button");
      button.className = "scene-option";
      button.textContent = family.label;
      button.title = `${categoryLabels[family.category] || "场景"} · ${family.characterLabel} · ${family.label}`;
      button.classList.toggle("active", family.entries.some(item => item.sceneId === scene.id));
      button.addEventListener("click", () => {
        if (family.entries.some(item => item.sceneId === scene.id)) {
          scenePanel.hidden = true;
          return;
        }
        petLog(`Scene family clicked: ${family.id} -> ${targetSceneId}`);
        void persistUiState({ selectedScene: targetSceneId, variantSceneByFamily: { ...uiState.variantSceneByFamily, [family.id]: targetSceneId } });
        setMousePassthrough(false);
        window.desktopPet.switchScene(targetSceneId);
      });
      const favorite = document.createElement("button");
      favorite.type = "button";
      favorite.className = "scene-favorite";
      favorite.textContent = isFavorite ? "★" : "☆";
      favorite.title = isFavorite ? "取消收藏场景" : "收藏场景";
      favorite.setAttribute("aria-label", favorite.title);
      favorite.setAttribute("aria-pressed", String(isFavorite));
      favorite.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        void toggleSceneFavorite(family);
      });
      row.append(button, favorite);
      group.append(row);
    }
    sceneList.append(group);
  }
  requestAnimationFrame(() => { scenePanel.scrollTop = previousScrollTop; });
}

async function toggleSceneFavorite(sceneId) {
  const family = typeof sceneId === "string" ? window.AsterPet.resolveSceneFamilies(sceneCatalog)
    .find(candidate => candidate.entries.some(entry => entry.sceneId === sceneId)) : sceneId;
  if (!family) return;
  const favoriteSceneIds = new Set(uiState.favoriteSceneIds);
  const familySceneIds = family.entries.map(entry => entry.sceneId);
  const isFavorite = familySceneIds.some(candidate => favoriteSceneIds.has(candidate));
  for (const candidate of familySceneIds) favoriteSceneIds.delete(candidate);
  if (!isFavorite) favoriteSceneIds.add(family.entries.find(entry => entry.sceneId === scene.id)?.sceneId || family.entries[0].sceneId);
  uiState = await window.desktopPet.updateUiState({ favoriteSceneIds: [...favoriteSceneIds] });
  buildSceneList();
}

sceneFilter.addEventListener("change", buildSceneList);

function applyConfiguredLayerVisibility(targetSkeleton, animationName) {
  const activeAnimation = animationName
    || (targetSkeleton === player?.skeleton
      ? animationGraphPlayer.viewportAnimation || player.animationState?.getCurrent(0)?.animation?.name : undefined);
  const activeStagePrefix = animationGraphPlayer.enabled ? undefined : resolveAnimationStagePrefix(targetSkeleton, activeAnimation);
  for (const slotIndex of animationGraphPlayer.getHiddenRigSlots(activeAnimation)) {
    const slot = targetSkeleton.slots[slotIndex];
    slot.color.a = 0;
    slot.setAttachment(null);
  }
  for (const slotIndex of hiddenLayerSlotIndices) {
    const slot = targetSkeleton.slots[slotIndex];
    if (!slot) continue;
    slot.color.a = 0;
    slot.setAttachment(null);
  }
  if (!activeStagePrefix) return;
  for (const slot of targetSkeleton.slots) {
    const stagePrefix = resolveSlotStagePrefix(slot);
    const unscopedStageShadow = /^\(sh\)(?![ABCS]_)/i.test(slot.data.name);
    if ((!stagePrefix || stagePrefix === activeStagePrefix) && !unscopedStageShadow) continue;
    slot.color.a = 0;
    slot.setAttachment(null);
  }
}

function rebuildLayerVisibilityCache() {
  hiddenLayerSlotIndices = player.skeleton.slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => findPropGroup(slot.data.name) && !enabledPropSlots.has(slot.data.name))
    .map(({ index }) => index);
}

function applyLayerVisibility(resetSlots = true) {
  if (resetSlots) {
    cinematicViewports.clear();
    activeViewportAnimation = undefined;
    enabledPropSlots = new Set(
      [...propsList.querySelectorAll("input[data-slot-name]:checked")]
        .map(input => input.dataset.slotName)
    );
    player.skeleton.setSlotsToSetupPose();
    rebuildLayerVisibilityCache();
    player.animationState.apply(player.skeleton);
  }
  applyConfiguredLayerVisibility(player.skeleton);
  if (resetSlots) {
    renderScheduler.renderNow();
    requestAnimationFrame(() => window.desktopPet.invalidate());
  }
}

function enforceLayerVisibilityAfterAnimation() {
  const animationState = player.animationState;
  const originalApply = animationState.apply.bind(animationState);
  animationState.apply = skeleton => {
    const animationName = animationGraphPlayer.enabled
      ? animationGraphPlayer.viewportAnimation
      : animationState.getCurrent(0)?.animation?.name;
    if (animationName) {
      setAnimationViewport(animationName);
      const selection = animationGraphPlayer.enabled ? animationGraphPlayer.selection : portraitComposer.toolbarSelection || animationName;
      if (selection && animationSelect.value !== selection) animationSelect.value = selection;
    }
    const result = originalApply(skeleton);
    applyLayerVisibility(false);
    return result;
  };
}

function playVoice(poolName) {
  const voices = scene.voices?.[poolName];
  if (!voices?.length || !scene.assets.audioTemplate) return;
  if (currentAudio) currentAudio.pause();
  const voice = voices[Math.floor(Math.random() * voices.length)];
  currentAudio = new Audio(scene.assets.audioTemplate.replace("{voice}", voice));
  currentAudio.volume = scene.audioVolume ?? 0.8;
  currentAudio.play().catch(error => petLog(`Audio failed: ${error}`));
}

function normalizedAnimationName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/^\d+[\s_-]*/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function resolveAnimationName(requestedName, actionName) {
  if (!animationNames.length) return undefined;
  if (animationNames.includes(requestedName)) return requestedName;
  const requestedLower = String(requestedName || "").toLowerCase();
  const caseInsensitive = animationNames.find(name => name.toLowerCase() === requestedLower);
  if (caseInsensitive) return caseInsensitive;
  const normalizedRequested = normalizedAnimationName(requestedName);
  const normalizedMatch = animationNames.find(name => normalizedAnimationName(name) === normalizedRequested);
  if (normalizedMatch) return normalizedMatch;
  const actionCandidates = {
    idle: ["idle", "inact", "stand", "wait"],
    touch: ["touch", "tap", "pat"],
    cutIn: ["cutin", "attack", "skill"],
    damage: ["damage", "hurt", "hit"],
    dead: ["dead", "death", "die"]
  }[actionName] || [];
  return animationNames.find(name => {
    const semanticName = normalizedAnimationName(name).replace(/\d+$/, "");
    return actionCandidates.some(candidate => semanticName.startsWith(candidate) || semanticName.endsWith(candidate));
  });
}

function normalizeSceneActions() {
  scene.actions = scene.actions || {};
  const configuredIdleName = scene.actions.idle?.animation;
  const preferredIdleName = animationNames.find(name => /^(?:idle|inact|stand|wait)(?:\d|_|$)/i.test(name));
  if (scene.category !== "cg" && /^loop$/i.test(configuredIdleName) && preferredIdleName) {
    scene.actions.idle = { ...scene.actions.idle, animation: preferredIdleName, loop: true };
    petLog(`Scene idle upgraded: ${configuredIdleName} -> ${preferredIdleName}`);
  }
  const inferredActions = {
    damage: { loop: false },
    dead: { loop: false, holdMs: 200 }
  };
  for (const [actionName, defaults] of Object.entries(inferredActions)) {
    const alreadyDeclared = Object.keys(scene.actions).some(name => name.toLowerCase() === actionName);
    if (alreadyDeclared) continue;
    const animation = resolveAnimationName(undefined, actionName);
    if (!animation) continue;
    scene.actions[actionName] = { animation, ...defaults };
    petLog(`Scene action inferred: ${actionName} -> ${animation}`);
  }
  for (const [actionName, action] of Object.entries(scene.actions)) {
    if (!action || typeof action !== "object") continue;
    const resolvedName = resolveAnimationName(action.animation, actionName);
    if (!resolvedName) {
      petLog(`Scene action unavailable: ${actionName} requested ${action.animation || "<empty>"}`);
      continue;
    }
    if (resolvedName !== action.animation) {
      petLog(`Scene action remapped: ${actionName} ${action.animation || "<empty>"} -> ${resolvedName}`);
      action.animation = resolvedName;
    }
  }
  if (!scene.actions.idle || !animationNames.includes(scene.actions.idle.animation)) {
    const idleAnimation = resolveAnimationName(scene.actions.idle?.animation, "idle") || animationNames[0];
    scene.actions.idle = { ...scene.actions.idle, animation: idleAnimation, loop: true };
    petLog(`Scene idle fallback: ${idleAnimation}`);
  }
}

function playAction(actionName) {
  const requestedAction = typeof actionName === "string" ? actionName.trim() : "";
  if (!requestedAction || !scene) return false;
  if (scene.type === "image-sequence") {
    if (requestedAction === "autoplay") toggleSequencePlayback();
    else if (requestedAction === "next") showSequenceFrame((animationSelect.selectedIndex + 1) % animationNames.length);
    else return false;
    return true;
  }
  if (!player?.animationState) return false;
  const resolvedActionName = Object.keys(scene.actions).find(name => name.toLowerCase() === requestedAction.toLowerCase());
  const action = scene.actions[resolvedActionName];
  if (!action || !animationNames.includes(action.animation)) {
    petLog(`Scene action unavailable: ${requestedAction}`);
    return false;
  }
  toolbarAnimationActive = false;
  window.AsterPet.releaseAnimationPose(player);
  const actionAnimation = player.skeleton.data.findAnimation(action.animation);
  if (animationGraphPlayer.enabled) {
    const animation = resolvedActionName === "idle" ? animationGraphPlayer.currentState : action.animation;
    actionChoreographer.interrupt();
    if (animationGraphPlayer.play(animation)) {
      if (action.voicePool) playVoice(action.voicePool);
      petLog(`Playing graph action ${resolvedActionName}: ${animation}`);
      return true;
    }
  }
  const configuredHoldMs = Number(action.holdMs);
  const defaultHoldMs = resolvedActionName.toLowerCase() === "dead" ? 200 : 0;
  const holdMs = Number.isFinite(configuredHoldMs) ? Math.max(0, configuredHoldMs) : defaultHoldMs;
  const actionDurationMs = (actionAnimation?.duration || 0) * 1000 + holdMs;
  behaviorDirector.noteActivity(actionDurationMs);
  portraitComposer.toolbarSelection = undefined;
  animationSelect.value = action.animation;
  if (portraitComposer.play(action.animation)) {
    portraitComposer.toolbarSelection = undefined;
    if (action.voicePool) playVoice(action.voicePool);
    return true;
  }
  portraitComposer.ensureExpression();
  player.animationState.setAnimation(0, action.animation, Boolean(action.loop));
  setAnimationViewport(action.animation);
  const returnToIdle = action.returnToIdle !== false;
  if (!action.loop && returnToIdle) {
    const idle = scene.actions.idle;
    const returnDelay = holdMs > 0 ? (actionAnimation?.duration || 0) + holdMs / 1000 : 0;
    player.animationState.addAnimation(0, idle.animation, true, returnDelay);
  }
  actionChoreographer.playAction(resolvedActionName, actionDurationMs);
  player.config.animation = action.animation;
  player.play();
  if (action.voicePool) playVoice(action.voicePool);
  petLog(`Playing action ${resolvedActionName}: ${action.animation}`);
  return true;
}

function applyAgentState(payload) {
  currentAgentPayload = payload;
  currentAgentState = payload.state;
  document.documentElement.dataset.agentState = currentAgentState;
  if (!scene || (scene.type === "image-sequence" ? !sequenceImage : !player?.animationState)) return;
  const configured = scene.agentStates?.[currentAgentState];
  if (typeof configured === "string") {
    if (scene.actions?.[configured]) playAction(configured);
    else playAnimation(configured);
  } else if (configured?.action) {
    playAction(configured.action);
  } else if (configured?.animation) {
    playAnimation(configured.animation);
  } else if (!toolbarAnimationActive && !window.AsterPet.preservesInteractionSelection(scene, animationGraphPlayer.enabled)) {
    playAction(defaultAgentStateActions[currentAgentState] || "idle");
    petLog(`Applied agent state ${currentAgentState}`);
  }
  if (scene.type !== "image-sequence" && !toolbarAnimationActive) actionChoreographer.setAgentState(currentAgentState);
}


function playAnimation(animationName, { holdFinal = false } = {}) {
  if (scene.type === "image-sequence") {
    showSequenceFrame(animationNames.indexOf(animationName));
    return;
  }
  if (animationGraphPlayer.enabled) {
    actionChoreographer.interrupt();
    if (animationGraphPlayer.play(animationName, { holdFinal })) {
      toolbarAnimationActive = holdFinal;
      return;
    }
  }
  if (!animationNames.includes(animationName)) return;
  toolbarAnimationActive = holdFinal;
  const animation = player.skeleton.data.findAnimation(animationName);
  behaviorDirector.noteActivity((animation?.duration || 0) * 1000);
  actionChoreographer.interrupt();
  if (portraitComposer.play(animationName)) {
    animationSelect.value = animationName;
    return;
  }
  window.AsterPet.releaseAnimationPose(player);
  portraitComposer.toolbarSelection = undefined;
  player.animationState.clearTracks();
  portraitComposer.ensureExpression();
  const loop = !holdFinal || animationName === scene.actions.idle.animation;
  const entry = player.animationState.setAnimation(0, animationName, loop);
  if (holdFinal && !loop) entry.listener = { complete: () => {
    if (!toolbarAnimationActive || player.animationState.getCurrent(0) !== entry) return;
    window.AsterPet.holdAnimationPose(player);
  } };
  setAnimationViewport(animationName);
  player.config.animation = animationName;
  player.play();
}

function applySceneScale() {
  if (scene.type === "image-sequence") {
    window.desktopPet.resize({
      scale: sceneScale,
      baseWidth: scene.window.baseWidth,
      baseHeight: scene.window.baseHeight,
      minActualWidth: scene.window.minActualWidth
    });
    zoomLabel.textContent = `${Math.round(sceneScale * 100)}%`;
    applyCameraView();
    return;
  }
  if (!player || !baseViewport) return;
  const padding = scene.viewport?.padding ?? "4%";
  player.config.viewport = {
    ...baseViewport,
    padLeft: padding,
    padRight: padding,
    padTop: padding,
    padBottom: padding,
    transitionTime: 0,
    animations: Object.fromEntries(Object.entries(animationViewports).map(([animation, viewport]) => [animation, {
      ...viewport,
      padLeft: padding,
      padRight: padding,
      padTop: padding,
      padBottom: padding
    }]))
  };
  const currentAnimation = animationGraphPlayer.viewportAnimation
    || player.animationState?.getCurrent(0)?.animation?.name || scene.actions.idle.animation;
  activeViewportAnimation = undefined;
  setAnimationViewport(currentAnimation);
  player.previousViewport = undefined;
  const targetBaseWidth = adaptiveWindowSize?.width ?? scene.window.baseWidth;
  const targetWidth = Math.max(scene.window.minActualWidth ?? 0, Math.round(targetBaseWidth * sceneScale));
  const targetHeight = Math.round((adaptiveWindowSize?.height ?? scene.window.baseHeight) * sceneScale);
  spinePlayerHost.initializeSurface(targetWidth, targetHeight);
  window.desktopPet.resize({
    scale: sceneScale,
    baseWidth: targetBaseWidth,
    baseHeight: adaptiveWindowSize?.height ?? scene.window.baseHeight,
    minActualWidth: scene.window.minActualWidth
  });
  zoomLabel.textContent = `${Math.round(sceneScale * 100)}%`;
  applyCameraView();
  setTimeout(() => geometryInput.requestVisualBoundsUpdate(), 80);
}

function changeSceneScale(delta) {
  const minimum = Math.min(scene.window.minScale ?? 0.5, 0.2);
  const maximum = Math.max(scene.window.maxScale ?? 1.4, 4);
  sceneScale = Math.min(maximum, Math.max(minimum, Math.round((sceneScale + delta) * 100) / 100));
  applySceneScale();
}

// Camera preferences use fractions of the pet pane so window resizing preserves composition.
function cameraStorageKey() {
  return `cameraView:${scene.id}`;
}

function restoreCameraView() {
  let view;
  try { view = JSON.parse(localStorage.getItem(cameraStorageKey())); } catch { /* Use the default view. */ }
  spinePlayerHost.setView(view);
}

function cameraPaneBounds() {
  return playerElement.getBoundingClientRect();
}

function applyCameraView() {
  spinePlayerHost.applyStableViewport();
  const view = spinePlayerHost.view;
  if (sequenceImage) {
    const bounds = cameraPaneBounds();
    sequenceImage.style.transform = `translate(${view.panX * bounds.width * (mirrored ? -1 : 1)}px, ${view.panY * bounds.height}px) scale(${view.zoom * (mirrored ? -1 : 1)}, ${view.zoom})`;
  }
  zoomLabel.title = `窗口 ${Math.round((sceneScale || 1) * 100)}% · 镜头 ${Math.round(view.zoom * 100)}%｜点击复位镜头；滚轮缩放，右键拖动画面`;
  geometryInput.requestVisualBoundsUpdate();
}

function saveCameraView(view) {
  spinePlayerHost.setView(view);
  applyCameraView();
  try { localStorage.setItem(cameraStorageKey(), JSON.stringify(spinePlayerHost.view)); } catch { /* Viewing still works without storage. */ }
}

function zoomCamera(factor, clientX, clientY) {
  if (!scene) return;
  const bounds = cameraPaneBounds();
  if (!bounds.width || !bounds.height) return;
  const view = spinePlayerHost.view;
  const zoom = Math.min(10, Math.max(0.1, view.zoom * factor));
  const ratio = zoom / view.zoom;
  const anchorX = ((clientX - bounds.left) / bounds.width - 0.5) * (mirrored ? -1 : 1);
  const anchorY = (clientY - bounds.top) / bounds.height - 0.5;
  saveCameraView({ zoom, panX: anchorX - (anchorX - view.panX) * ratio, panY: anchorY - (anchorY - view.panY) * ratio });
}

function panCamera(dx, dy) {
  const bounds = cameraPaneBounds();
  if (!scene || !bounds.width || !bounds.height) return;
  const view = spinePlayerHost.view;
  saveCameraView({ ...view, panX: view.panX + dx / bounds.width * (mirrored ? -1 : 1), panY: view.panY + dy / bounds.height });
}

zoomLabel.addEventListener("click", () => saveCameraView({ zoom: 1, panX: 0, panY: 0 }));
document.getElementById("camera-reset").addEventListener("click", () => saveCameraView({ zoom: 1, panX: 0, panY: 0 }));

function setStateLocked(locked) {
  stateLocked = Boolean(locked);
  clearTimeout(petInteraction.touchTimer);
  petInteraction.touchTimer = undefined;
  stateLockButton.setAttribute("aria-pressed", String(stateLocked));
  stateLockButton.textContent = stateLocked ? "已固定" : "固定";
  stateLockButton.title = stateLocked
    ? "当前动作已固定：人物单击、双击和中键不会切换动作；点击解除固定"
    : "固定当前动作，防止人物点击切换动作";
}

stateLockButton.addEventListener("click", () => setStateLocked(!stateLocked));

function setAnimationViewport(animationName) {
  if (!player || !animationName) return;
  const cinematic = animationGraphPlayer.cinematic;
  const segment = cinematic?.cameraSegment(animationName) ?? 0;
  const viewportKey = cinematic ? `${animationName}:${segment}` : animationName;
  if (activeViewportAnimation === viewportKey) return;
  try {
    if (cinematic) {
      if (!cinematicViewports.has(animationName)) cinematicViewports.set(animationName, calculateCinematicViewports(animationName));
      const viewport = cinematicViewports.get(animationName)?.[segment];
      if (viewport) {
        animationViewports[animationName] = viewport;
        const padding = scene.viewport?.padding ?? "4%";
        player.config.viewport.animations[animationName] = {
          ...viewport, padLeft: padding, padRight: padding, padTop: padding, padBottom: padding
        };
      }
    }
    if (!animationViewports[animationName]) {
      const viewportAnimations = animationGraphPlayer.getViewportAnimations(animationName);
      const sampled = calculateAnimationVisibleBounds(viewportAnimations)?.animations;
      const bounds = mergeViewportBounds(Object.values(sampled || {}));
      if (bounds) {
        const viewport = { x: bounds.offset.x, y: bounds.offset.y, width: bounds.size.x, height: bounds.size.y };
        if (isValidViewport(viewport)) {
          const padding = scene.viewport?.padding ?? "4%";
          for (const name of viewportAnimations) {
            if (name !== animationName && name === animationGraphPlayer.getBaseAnimation(animationName)) continue;
            animationViewports[name] = viewport;
            player.config.viewport.animations[name] = {
              ...viewport,
              padLeft: padding,
              padRight: padding,
              padTop: padding,
              padBottom: padding
            };
          }
        }
      }
    }
    player.setViewport(animationName);
    activeViewportAnimation = viewportKey;
  } catch (error) {
    petLog(`Animation viewport unavailable: ${animationName}: ${error.message || error}`);
  }
}

function calculateCinematicViewports(animationName) {
  const cinematic = animationGraphPlayer.cinematic;
  const data = player.skeleton.data;
  const animation = data.findAnimation(animationName);
  const skeleton = new spine.Skeleton(data);
  if (player.skeleton.skin) skeleton.setSkin(player.skeleton.skin);
  skeleton.scaleX = player.skeleton.scaleX;
  skeleton.scaleY = player.skeleton.scaleY;
  skeleton.x = player.skeleton.x;
  skeleton.y = player.skeleton.y;
  const baseName = cinematic.baseFor(animationName);
  const base = baseName && data.findAnimation(baseName);
  const times = cinematic.cameraTimes(animationName);
  try {
    return times.map((start, index) => {
      const end = times[index + 1] ?? animation.duration;
      const bounds = [];
      const count = Math.max(2, Math.min(60, Math.ceil((end - start) * 30)));
      for (let sample = 0; sample < count; sample += 1) {
        // Do not include the next shot's first frame in this shot's bounds.
        const time = start + Math.max(0, end - start - (index + 1 < times.length ? 0.001 : 0)) * sample / (count - 1);
        skeleton.setToSetupPose();
        base?.apply(skeleton, base.duration, base.duration, false, [], 1, spine.MixBlend.first, spine.MixDirection.mixIn);
        animation.apply(skeleton, time, time, false, [], 1, spine.MixBlend.replace, spine.MixDirection.mixIn);
        cinematic.cameraFor(animationName)?.apply(skeleton, time, time, true, [], 1, spine.MixBlend.replace, spine.MixDirection.mixIn);
        skeleton.updateWorldTransform();
        applyConfiguredLayerVisibility(skeleton, animationName);
        const visible = getVisibleSkeletonBounds(skeleton);
        if (visible) bounds.push(visible);
      }
      const merged = mergeViewportBounds(bounds);
      return merged && { x: merged.offset.x, y: merged.offset.y, width: merged.size.x, height: merged.size.y };
    });
  } finally { skeleton.dispose?.(); }
}

function getVisibleSkeletonBounds(targetSkeleton = player?.skeleton) {
  if (!targetSkeleton) return undefined;
  const skeleton = targetSkeleton;
  const vertices = [];
  const clipper = new spine.SkeletonClipping();
  const color = new spine.Color(1, 1, 1, 1);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const slot of skeleton.drawOrder) {
    if (!slot.bone.active) { clipper.clipEndWithSlot(slot); continue; }
    const attachment = slot.getAttachment();
    if (attachment instanceof spine.ClippingAttachment) {
      clipper.clipStart(slot, attachment);
      continue;
    }
    const alpha = skeleton.color.a * slot.color.a * (attachment?.color?.a ?? 1);
    if (!attachment || alpha <= 0.02 || isLayoutDecorationSlot(slot.data.name)) {
      clipper.clipEndWithSlot(slot);
      continue;
    }
    vertices.length = attachment instanceof spine.RegionAttachment
      ? 8
      : attachment instanceof spine.MeshAttachment
        ? attachment.worldVerticesLength
        : 0;
    if (vertices.length === 0) { clipper.clipEndWithSlot(slot); continue; }
    if (attachment instanceof spine.RegionAttachment) attachment.computeWorldVertices(slot, vertices, 0, 2);
    else attachment.computeWorldVertices(slot, 0, vertices.length, vertices, 0, 2);
    let visibleVertices = vertices;
    let stride = 2;
    if (clipper.isClipping()) {
      const triangles = attachment instanceof spine.RegionAttachment ? [0, 1, 2, 2, 3, 0] : attachment.triangles;
      clipper.clipTriangles(vertices, vertices.length, triangles, triangles.length, attachment.uvs, color, color, false);
      visibleVertices = clipper.clippedVertices;
      stride = 8;
    }
    let left = Infinity, bottom = Infinity, right = -Infinity, top = -Infinity;
    for (let index = 0; index < visibleVertices.length; index += stride) {
      left = Math.min(left, visibleVertices[index]); bottom = Math.min(bottom, visibleVertices[index + 1]);
      right = Math.max(right, visibleVertices[index]); top = Math.max(top, visibleVertices[index + 1]);
    }
    // Authors often hide an entire alternate rig by scaling its bones to zero.
    // Its collapsed vertices must not enlarge the visible shot's framing.
    if (right - left > 0.001 && top - bottom > 0.001) {
      minX = Math.min(minX, left); minY = Math.min(minY, bottom);
      maxX = Math.max(maxX, right); maxY = Math.max(maxY, top);
    }
    clipper.clipEndWithSlot(slot);
  }
  clipper.clipEnd();
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || maxX <= minX || maxY <= minY) return undefined;
  return {
    offset: new spine.Vector2(minX, minY),
    size: new spine.Vector2(maxX - minX, maxY - minY)
  };
}

function calculateAnimationVisibleBounds(animationNamesToSample) {
  if (!player?.skeleton || typeof spine.Skeleton !== "function") return undefined;
  const sourceSkeleton = player.skeleton;
  const sampledSkeleton = new spine.Skeleton(sourceSkeleton.data);
  if (sourceSkeleton.skin) sampledSkeleton.setSkin(sourceSkeleton.skin);
  sampledSkeleton.scaleX = sourceSkeleton.scaleX;
  sampledSkeleton.scaleY = sourceSkeleton.scaleY;
  sampledSkeleton.x = sourceSkeleton.x;
  sampledSkeleton.y = sourceSkeleton.y;

  let idleUnion;
  const animationUnions = new Map();
  const idleAnimationName = scene?.actions?.idle?.animation;
  const configuredViewportActions = Array.isArray(scene?.viewport?.actions)
    ? scene.viewport.actions
    : ["idle", scene?.gestures?.click];
  const cutInActionName = Object.keys(scene?.actions || {})
    .find(actionName => normalizedAnimationName(actionName) === "cutin") || "cutIn";
  const cutInAnimationName = scene?.actions?.[cutInActionName]?.animation;
  const referencedActionNames = new Set(configuredViewportActions
    .filter(actionName => typeof actionName === "string")
    .filter(actionName => actionName !== cutInActionName)
    .filter(actionName => !cutInAnimationName || scene?.actions?.[actionName]?.animation !== cutInAnimationName));
  const interactiveAnimationNames = new Set([...referencedActionNames]
    .map(actionName => scene?.actions?.[actionName]?.animation || actionName)
    .filter(animationName => typeof animationName === "string")
    .filter(animationName => animationName !== cutInAnimationName));
  interactiveAnimationNames.add(idleAnimationName);
  const sampledAnimationNames = animationNamesToSample
    ? new Set(animationNamesToSample)
    : interactiveAnimationNames;
  const mergeBounds = (target, bounds) => {
    const minX = bounds.offset.x;
    const minY = bounds.offset.y;
    const maxX = minX + bounds.size.x;
    const maxY = minY + bounds.size.y;
    if (!target) return { minX, minY, maxX, maxY };
    target.minX = Math.min(target.minX, minX);
    target.minY = Math.min(target.minY, minY);
    target.maxX = Math.max(target.maxX, maxX);
    target.maxY = Math.max(target.maxY, maxY);
    return target;
  };
  const toBounds = target => target && target.maxX > target.minX && target.maxY > target.minY
    ? {
      offset: new spine.Vector2(target.minX, target.minY),
      size: new spine.Vector2(target.maxX - target.minX, target.maxY - target.minY)
    }
    : undefined;
  try {
    const animations = sourceSkeleton.data.animations;
    for (const animation of animations) {
      if (!sampledAnimationNames.has(animation.name)) continue;
      const baseAnimationName = animationGraphPlayer.getBaseAnimation(animation.name);
      const baseAnimation = baseAnimationName && sourceSkeleton.data.findAnimation(baseAnimationName);
      const sampleCount = Math.max(24, Math.min(120, Math.ceil(animation.duration * 60)));
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const time = animation.duration > 0
          ? animation.duration * sample / (sampleCount - 1 || 1)
          : 0;
        sampledSkeleton.setToSetupPose();
        const baseTime = animationGraphPlayer.cinematic ? baseAnimation?.duration : time;
        baseAnimation?.apply(sampledSkeleton, baseTime, baseTime, !animationGraphPlayer.cinematic, [], 1, spine.MixBlend.first, spine.MixDirection.mixIn);
        animation.apply(sampledSkeleton, time, time, false, [], 1,
          baseAnimation ? spine.MixBlend.replace : spine.MixBlend.setup, spine.MixDirection.mixIn);
        portraitComposer.overlay(portraitComposer.neutral?.name)?.apply(sampledSkeleton, time, time, false, [], 1, spine.MixBlend.replace, spine.MixDirection.mixIn);
        animationGraphPlayer.cinematic?.cameraFor(animation.name)?.apply(sampledSkeleton, time, time, true, [], 1, spine.MixBlend.replace, spine.MixDirection.mixIn);
        sampledSkeleton.updateWorldTransform();
        applyConfiguredLayerVisibility(sampledSkeleton, animation.name);
        const bounds = getVisibleSkeletonBounds(sampledSkeleton);
        if (!bounds) continue;
        animationUnions.set(animation.name, mergeBounds(animationUnions.get(animation.name), bounds));
        if (animation.name === idleAnimationName) idleUnion = mergeBounds(idleUnion, bounds);
      }
    }
  } catch (error) {
    petLog(`Animation bounds sampling failed: ${error.message || error}`);
    return undefined;
  } finally {
    sampledSkeleton.dispose?.();
  }
  const idle = toBounds(idleUnion);
  const animations = Object.fromEntries([...animationUnions.entries()]
    .filter(([animationName]) => sampledAnimationNames.has(animationName))
    .map(([animationName, target]) => {
      const bounds = toBounds(target);
      return [animationName, bounds];
    })
    .filter(([, bounds]) => bounds));
  return { idle, animations, interactiveAnimationNames };
}

function calculateAdaptiveWindowSize(bounds, viewportBounds = bounds) {
  if (!bounds?.size?.x || !bounds.size.y) return undefined;
  const chromeHeight = 0;
  const maxWidth = scene.window.baseWidth;
  const maxContentHeight = scene.window.baseHeight - chromeHeight;
  const contentAspect = bounds.size.x / bounds.size.y;
  let width;
  let contentHeight;
  if (contentAspect >= maxWidth / maxContentHeight) {
    width = maxWidth;
    contentHeight = width / contentAspect;
  } else {
    contentHeight = maxContentHeight;
    width = contentHeight * contentAspect;
  }
  const worldUnitsPerPixel = Math.max(bounds.size.x / width, bounds.size.y / contentHeight);
  width = Math.max(width, viewportBounds.size.x / worldUnitsPerPixel);
  contentHeight = Math.max(contentHeight, viewportBounds.size.y / worldUnitsPerPixel);
  return {
    width: Math.max(scene.window.minWidth ?? 360, Math.ceil(width)),
    height: Math.max(scene.window.minHeight ?? 260, Math.ceil(contentHeight + chromeHeight))
  };
}

function mergeViewportBounds(boundsList) {
  const validBounds = boundsList.filter(Boolean);
  if (validBounds.length === 0) return undefined;
  const minX = Math.min(...validBounds.map(bounds => bounds.offset.x));
  const minY = Math.min(...validBounds.map(bounds => bounds.offset.y));
  const maxX = Math.max(...validBounds.map(bounds => bounds.offset.x + bounds.size.x));
  const maxY = Math.max(...validBounds.map(bounds => bounds.offset.y + bounds.size.y));
  return {
    offset: new spine.Vector2(minX, minY),
    size: new spine.Vector2(maxX - minX, maxY - minY)
  };
}

function limitViewportExpansion(idleBounds, candidateBounds, configuredRatio = 0.35) {
  if (!idleBounds || !candidateBounds) return candidateBounds;
  const ratio = Math.max(0, Math.min(2, Number(configuredRatio) || 0.35));
  const idleLeft = idleBounds.offset.x;
  const idleTop = idleBounds.offset.y;
  const idleRight = idleLeft + idleBounds.size.x;
  const idleBottom = idleTop + idleBounds.size.y;
  const minX = Math.max(candidateBounds.offset.x, idleLeft - idleBounds.size.x * ratio);
  const minY = Math.max(candidateBounds.offset.y, idleTop - idleBounds.size.y * ratio);
  const maxX = Math.min(candidateBounds.offset.x + candidateBounds.size.x, idleRight + idleBounds.size.x * ratio);
  const maxY = Math.min(candidateBounds.offset.y + candidateBounds.size.y, idleBottom + idleBounds.size.y * ratio);
  if (maxX <= minX || maxY <= minY) return idleBounds;
  return {
    offset: new spine.Vector2(minX, minY),
    size: new spine.Vector2(maxX - minX, maxY - minY)
  };
}

function isValidViewport(viewport) {
  return Boolean(viewport)
    && Number.isFinite(viewport.x)
    && Number.isFinite(viewport.y)
    && Number.isFinite(viewport.width)
    && Number.isFinite(viewport.height)
    && viewport.width > 0
    && viewport.height > 0;
}

function fitSkeletonToWindow() {
  player.skeleton.updateWorldTransform();
  const sampledBounds = calculateAnimationVisibleBounds();
  const idleBounds = sampledBounds?.idle || getVisibleSkeletonBounds();
  if (!idleBounds) return;
  const stableViewportBounds = scene.window.adaptiveToContent
    ? mergeViewportBounds([
      idleBounds,
      ...Object.values(sampledBounds?.animations || {})
        .map(bounds => limitViewportExpansion(idleBounds, bounds, scene.viewport?.maxInteractiveExpansion))
    ])
    : idleBounds;
  // The window may reserve room for large actions, but its camera should fit
  // the selected pose instead of shrinking the idle into that whole envelope.
  const fitCurrentPose = animationGraphPlayer.enabled || scene.category === "interaction";
  const { offset, size } = fitCurrentPose ? idleBounds : stableViewportBounds;
  const idleViewport = { x: offset.x, y: offset.y, width: size.x, height: size.y };
  if (!isValidViewport(idleViewport)) {
    petLog(`Invalid sampled viewport: ${JSON.stringify(idleViewport)}`);
    return;
  }
  baseViewport = idleViewport;
  animationViewports = fitCurrentPose
    ? { [scene.actions.idle.animation]: idleViewport }
    : Object.fromEntries(
      [...(sampledBounds?.interactiveAnimationNames || [scene.actions.idle.animation])]
        .map(animationName => [animationName, idleViewport])
    );
  if (scene.window.adaptiveToContent && idleBounds.size.x > 0 && idleBounds.size.y > 0) {
    const idleWindowSize = calculateAdaptiveWindowSize(idleBounds, stableViewportBounds);
    adaptiveWindowSize = {
      width: idleWindowSize.width,
      height: idleWindowSize.height
    };
  } else {
    adaptiveWindowSize = undefined;
  }
  applySceneScale();
}

function buildAppearanceSelector(availableSkinNames = []) {
  const state = window.AsterPet.resolveAppearanceVariants({
    sceneId: scene.id,
    sceneCatalog,
    availableSkinNames,
    selectedSkin: uiState.appearanceByScene?.[scene.id]
  });
  appearanceOptions = new Map(state.options.map(option => [option.id, option]));
  appearanceSelect.replaceChildren(...state.options.map(option => new Option(option.label, option.id)));
  appearanceSelect.value = state.selectedId || "";
  appearanceSelect.hidden = state.options.length <= 1;
  appearanceSelect.disabled = state.options.length <= 1;
  appearanceSelect.title = state.options.length > 1 ? "选择角色外观" : "当前角色没有其他外观";
  return appearanceOptions.get(state.selectedId) || appearanceOptions.values().next().value;
}

async function selectAppearance(optionId) {
  const option = appearanceOptions.get(optionId);
  if (!option || !scene) return;
  if (option.driver === "scene") {
    const appearanceByScene = { ...uiState.appearanceByScene };
    if (option.skin) appearanceByScene[option.sceneId] = option.skin;
    const variantSceneByFamily = { ...uiState.variantSceneByFamily, [option.familyId]: option.sceneId };
    await persistUiState({ selectedScene: option.sceneId, appearanceByScene, variantSceneByFamily });
    setMousePassthrough(false);
    if (option.sceneId !== scene.id) window.desktopPet.switchScene(option.sceneId);
    return;
  }
  if (!option.skin || !player?.skeleton?.data?.findSkin(option.skin)) return;
  player.skeleton.setSkinByName(option.skin);
  player.skeleton.setSlotsToSetupPose();
  portraitComposer.refreshSkin();
  uiState.appearanceByScene[scene.id] = option.skin;
  void persistUiState({ appearanceByScene: uiState.appearanceByScene });
  applyLayerVisibility();
  fitSkeletonToWindow();
}

async function initializePlayer() {
  const generation = sceneGeneration;
  const sceneLayerRules = globalLayerRules.sceneOverrides?.[scene.id] || {};
  const explicitGroups = Array.isArray(scene.layers?.groups) ? scene.layers.groups : [];
  explicitCharacterSlots = new Set(scene.layers?.characterSlots || []);
  explicitInternalSlots = new Set(scene.layers?.internalSlots || []);
  internalHiddenPatterns = [
    ...(globalLayerRules.internalHiddenPatterns || []),
    ...(sceneLayerRules.internalHiddenPatterns || [])
  ].map(pattern => new RegExp(pattern, "i"));
  backgroundPatterns = [
    ...(globalLayerRules.backgroundPatterns || globalLayerRules.alwaysHiddenPatterns || []),
    ...(sceneLayerRules.backgroundPatterns || sceneLayerRules.alwaysHiddenPatterns || []),
    ...(scene.layers?.alwaysHiddenPatterns || [])
  ].map(pattern => new RegExp(pattern, "i"));
  characterPatterns = [
    ...(globalLayerRules.characterPatterns || []),
    ...(sceneLayerRules.characterPatterns || [])
  ].map(pattern => new RegExp(pattern, "i"));
  propGroups = [
    ...explicitGroups.map(group => ({ ...group, source: "package" })),
    ...(sceneLayerRules.propGroups || []).map(group => ({ ...group, source: "scene-rule" })),
    ...(globalLayerRules.propGroups || []).map(group => ({ ...group, source: "builtin-rule" })),
    ...(scene.layers?.propGroups || []).map(group => ({ ...group, source: "legacy-package" }))
  ].map(group => ({
    ...group,
    slotNames: new Set(group.slots || group.slotNames || []),
    regex: group.pattern ? new RegExp(group.pattern, "i") : undefined,
    exact: group.pattern ? /^\^.+\$$/.test(group.pattern) : true
  }));
  sceneScale = initialWindowScale;
  document.title = scene.title;
  status.textContent = `正在加载 ${scene.title}…`;
  window.desktopPet.configure(scene.title);

  spinePlayerHost.setVisible(true);
  try {
    const skeletonSource = scene.assets.skeleton.toLowerCase().endsWith(".json")
      ? { jsonUrl: scene.assets.skeleton }
      : { skelUrl: scene.assets.skeleton };
    const loadedPlayer = await spinePlayerHost.load({
      ...skeletonSource,
      atlasUrl: scene.assets.atlas,
      alpha: true,
      backgroundColor: "00000000",
      premultipliedAlpha: scene.assets.premultipliedAlpha !== false,
      showControls: false,
      showLoading: false,
      preserveDrawingBuffer: false
    });
    if (generation !== sceneGeneration) return;
    player = loadedPlayer;
    player.animationState.clearTracks();
    animationNames = player.skeleton.data.animations.map(animation => animation.name);
    normalizeSceneActions();
    const skinNames = player.skeleton.data.skins.map(skin => skin.name).filter(name => name !== "default");
    const selectedAppearance = buildAppearanceSelector(skinNames);
    if (selectedAppearance?.skin && player.skeleton.data.findSkin(selectedAppearance.skin)) {
      player.skeleton.setSkinByName(selectedAppearance.skin);
      player.skeleton.setSlotsToSetupPose();
    }
    animationGraphPlayer.start(animationNames);
    if (!animationGraphPlayer.enabled) portraitComposer.start();
    updateInteractionModeButton();
    const animationChoices = animationGraphPlayer.enabled
      ? animationGraphPlayer.choices()
      : animationNames.map(id => ({ id, label: id }));
    for (const choice of animationChoices) {
      const option = document.createElement("option");
      option.value = choice.id;
      option.textContent = choice.label;
      animationSelect.append(option);
    }
    addUnclassifiedPropGroup();
    buildPropControls();
    buildSceneList();
    applyLayerVisibility();
    enforceLayerVisibilityAfterAnimation();
    if (!animationGraphPlayer.enabled) {
      behaviorDirector.start();
      actionChoreographer.start();
    }
    fitSkeletonToWindow();
    renderScheduler.start(player);
    playAction("idle");
    applyAgentState(currentAgentPayload);
    setTimeout(() => geometryInput.requestVisualBoundsUpdate(), 120);
    status.hidden = true;
    petLog(`Loaded scene ${scene.id}: ${animationNames.join(", ")}`);
  } catch (error) {
    if (generation !== sceneGeneration) return;
    status.textContent = `场景加载失败：${error.message || error}`;
    petLog(`Scene load failed: ${error.stack || error}`);
    throw error;
  }
}

function showSequenceFrame(index) {
  if (index < 0 || !scene.assets.frames[index]) return;
  animationSelect.selectedIndex = index;
  sequenceImage.src = scene.assets.frames[index].url;
}

function toggleSequencePlayback() {
  if (sequenceTimer) {
    clearInterval(sequenceTimer);
    sequenceTimer = undefined;
    return;
  }
  sequenceTimer = setInterval(() => {
    showSequenceFrame((animationSelect.selectedIndex + 1) % animationNames.length);
  }, scene.assets.frameDuration || 1200);
}

function initializeImageSequence() {
  sceneScale = initialWindowScale;
  animationNames = scene.assets.frames.map(frame => frame.name);
  document.title = scene.title;
  window.desktopPet.configure(scene.title);
  sequenceImage = document.createElement("img");
  sequenceImage.className = "cg-frame";
  sequenceImage.draggable = false;
  spinePlayerHost.setVisible(false);
  document.getElementById("player").append(sequenceImage);
  buildAppearanceSelector();
  for (const name of animationNames) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    animationSelect.append(option);
  }
  buildSceneList();
  propsPanel.hidden = true;
  showSequenceFrame(0);
  applyAgentState(currentAgentPayload);
  applySceneScale();
  status.hidden = true;
  petLog(`Loaded CG scene ${scene.id}: ${animationNames.join(", ")}`);
}

async function loadScene(requestedScene) {
  if (!sceneManifest || requestedScene) {
    [sceneManifest, globalLayerRules, sceneCatalog] = await Promise.all([
      window.desktopPet.getSceneManifest(),
      window.desktopPet.getLayerRules(),
      window.desktopPet.getSceneCatalog()
    ]);
  }
  await initializeUiState();
  const queryScene = new URLSearchParams(location.search).get("scene");
  const savedScene = uiState.selectedScene;
  let selectedScene = requestedScene || queryScene || savedScene || sceneManifest.defaultScene;
  if (selectedScene && !sceneManifest.scenes[selectedScene]) {
    selectedScene = sceneManifest.defaultScene;
    void persistUiState({ selectedScene });
  }
  if (!selectedScene || Object.keys(sceneManifest.scenes).length === 0) {
    status.hidden = false;
    status.textContent = "右键打开工具栏，导入 .asterpet 人物包";
    setToolsVisible(true);
    setMousePassthrough(false);
    return;
  }
  const scenePath = sceneManifest.scenes[selectedScene];
  if (!scenePath) throw new Error(`Unknown scene: ${selectedScene}`);
  scene = await window.desktopPet.getSceneConfig(selectedScene);
  restoreCameraView();
  await migrateLegacyPropVisibility(scene.id);
  if (scene.type === "image-sequence") initializeImageSequence();
  else await initializePlayer();
  window.desktopPet.setActiveScene(scene.id);
}

async function switchScene(selectedScene) {
  await disposeScene();
  status.hidden = false;
  status.textContent = "正在切换场景…";
  try {
    await loadScene(selectedScene);
    return { ok: true };
  } catch (error) {
    status.hidden = false;
    status.textContent = `场景配置加载失败：${error.message}`;
    petLog(error.stack || error.message);
    return { ok: false, error: error.message };
  }
}

window.desktopPet.onAgentState(applyAgentState);
window.desktopPet.onPlayAction(action => playAction(action));
window.desktopPet.onEmbeddedStatusLayout(applyEmbeddedStatusLayout);
window.desktopPet.onPrepareSceneSwitch(async (requestId, selectedScene) => {
  const result = await switchScene(selectedScene);
  window.desktopPet.sceneSwitchReady(requestId, result);
});
window.desktopPet.onPrepareShutdown(async () => {
  shutdownPrepared = true;
  petLog("Preparing renderer shutdown");
  await disposeScene({ shutdown: true });
  window.desktopPet.shutdownWaylandBridge?.();
  window.desktopPet.shutdownReady();
});
window.addEventListener("beforeunload", () => {
  if (!disposing && !shutdownPrepared) void disposeScene({ shutdown: true });
});
window.addEventListener("resize", () => {
  applyCameraView();
  requestAnimationFrame(() => geometryInput.reportInputShape());
});
embeddedStatus.addEventListener("load", () => requestAnimationFrame(() => geometryInput.reportInputShape()));
geometryInput.start();
petInteraction.bind();
toolbarController.bind();

loadScene().catch(error => {
  status.textContent = `场景配置加载失败：${error.message}`;
  petLog(error.stack || error.message);
});
