const animationSelect = document.getElementById("animations");
const skinSelect = document.getElementById("skins");
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

let scene;
let sceneManifest;
let sceneCatalog;
let globalLayerRules;
let uiState = { propVisibility: {}, favoriteSceneIds: [] };
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
let activeViewportAnimation;
let sceneScale;
let adaptiveWindowSize;
let sequenceImage;
let sequenceTimer;
let enabledPropSlots = new Set();
let currentAgentState = "idle";
let currentAgentPayload = { state: "idle" };
let toolsVisible = false;
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
const behaviorDirector = new window.AsterPet.AmbientBehaviorDirector({
  getPlayer: () => player,
  getScene: () => scene,
  getAnimationNames: () => animationNames,
  canPlay: () => {
    if (disposing || currentAgentState !== "idle") return false;
    const currentAnimation = player?.animationState?.getCurrent(0)?.animation?.name;
    return currentAnimation === scene?.actions?.idle?.animation;
  },
  onAnimation: animationName => petLog(`Ambient overlay: ${animationName}`),
  log: message => petLog(message)
});
const actionChoreographer = new window.AsterPet.ActionChoreographer({
  getPlayer: () => player,
  getScene: () => scene,
  getAnimationNames: () => animationNames,
  onAnimation: animationName => petLog(`Action overlay: ${animationName}`),
  log: message => petLog(message)
});
const geometryInput = new window.AsterPet.GeometryInputController({
  desktopPet: window.desktopPet,
  spineRuntime: spine,
  getScene: () => scene,
  getPlayer: () => player,
  getSequenceImage: () => sequenceImage,
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
  getScale: () => sceneScale,
  getToolsVisible: () => toolsVisible,
  setToolsVisible: visible => setToolsVisible(visible),
  playAction: action => playAction(action),
  changeScale: delta => changeSceneScale(delta),
  log: message => petLog(message)
});
const toolbarController = new window.AsterPet.ToolbarController({
  desktopPet: window.desktopPet,
  elements: {
    animationSelect,
    skinSelect,
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
  playAnimation: name => playAnimation(name),
  changeScale: delta => changeSceneScale(delta),
  getAnimationNames: () => animationNames,
  getPlayer: () => player,
  applyLayerVisibility: () => applyLayerVisibility(),
  fitSkeletonToWindow: () => fitSkeletonToWindow()
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

function positionUtilityPanels() {
  if (window.desktopPet.nativeWayland) return;
  const petRects = geometryInput.cachedPetRects;
  const petLeft = petRects.length > 0 ? Math.min(...petRects.map(rect => rect.x)) : innerWidth / 2;
  const petRight = petRects.length > 0 ? Math.max(...petRects.map(rect => rect.x + rect.width)) : innerWidth / 2;
  const leftSpace = Math.max(0, petLeft - 20);
  const rightSpace = Math.max(0, innerWidth - petRight - 20);
  const dockLeft = leftSpace >= rightSpace;
  const width = Math.max(180, Math.min(300, dockLeft ? leftSpace : rightSpace));
  document.documentElement.style.setProperty("--utility-panel-width", `${width}px`);
  document.documentElement.style.setProperty("--utility-panel-left", dockLeft ? "10px" : "auto");
  document.documentElement.style.setProperty("--utility-panel-right", dockLeft ? "auto" : "10px");
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
  positionUtilityPanels();
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
  baseViewport = undefined;
  animationViewports = {};
  activeViewportAnimation = undefined;
  adaptiveWindowSize = undefined;
  animationSelect.replaceChildren();
  skinSelect.replaceChildren();
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
  if (group?.role === "background" || group?.role === "internal") return true;
  return backgroundPatterns.some(pattern => pattern.test(slotName));
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

async function initializeUiState() {
  if (uiStateInitialized) return;
  uiStateInitialized = true;
  uiState = await window.desktopPet.getUiState();
  if (!uiState || typeof uiState !== "object") uiState = { propVisibility: {} };
  if (!uiState.propVisibility || typeof uiState.propVisibility !== "object") uiState.propVisibility = {};
  if (!Array.isArray(uiState.favoriteSceneIds)) uiState.favoriteSceneIds = [];
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
    if (backgroundPatterns.some(pattern => pattern.test(slotName))) {
      addSlot({ id: "background", label: "背景与场景", role: "background", defaultVisible: false }, slotName);
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
  for (const sceneId of Object.keys(sceneManifest.scenes)) {
    if (favoritesOnly && !favoriteSceneIds.has(sceneId)) continue;
    const metadata = sceneCatalog[sceneId] || {};
    const groupId = metadata.characterId || "其他";
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push({ sceneId, metadata });
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
    group.open = favoritesOnly || openGroupIds.has(groupId) || entries.some(entry => entry.sceneId === scene.id);
    const summary = document.createElement("summary");
    summary.textContent = `${groupId} (${entries.length})`;
    group.append(summary);
    entries.sort((left, right) => {
      const order = { interaction: 0, character: 1, cg: 2 };
      return (order[left.metadata.category] ?? 9) - (order[right.metadata.category] ?? 9)
        || left.sceneId.localeCompare(right.sceneId, undefined, { numeric: true });
    });
    for (const { sceneId, metadata } of entries) {
      const row = document.createElement("div");
      row.className = "scene-option-row";
      const button = document.createElement("button");
      button.className = "scene-option";
      button.textContent = `${categoryLabels[metadata.category] || "场景"} · ${sceneId}`;
      button.title = metadata.title || sceneId;
      button.classList.toggle("active", sceneId === scene.id);
      button.addEventListener("click", () => {
        if (sceneId === scene.id) {
          scenePanel.hidden = true;
          return;
        }
        petLog(`Scene option clicked: ${sceneId}`);
        void persistUiState({ selectedScene: sceneId });
        setMousePassthrough(false);
        window.desktopPet.switchScene(sceneId);
      });
      const favorite = document.createElement("button");
      favorite.type = "button";
      favorite.className = "scene-favorite";
      favorite.textContent = favoriteSceneIds.has(sceneId) ? "★" : "☆";
      favorite.title = favoriteSceneIds.has(sceneId) ? "取消收藏场景" : "收藏场景";
      favorite.setAttribute("aria-label", favorite.title);
      favorite.setAttribute("aria-pressed", String(favoriteSceneIds.has(sceneId)));
      favorite.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        void toggleSceneFavorite(sceneId);
      });
      row.append(button, favorite);
      group.append(row);
    }
    sceneList.append(group);
  }
  requestAnimationFrame(() => { scenePanel.scrollTop = previousScrollTop; });
}

async function toggleSceneFavorite(sceneId) {
  const favoriteSceneIds = new Set(uiState.favoriteSceneIds);
  if (favoriteSceneIds.has(sceneId)) favoriteSceneIds.delete(sceneId);
  else favoriteSceneIds.add(sceneId);
  uiState = await window.desktopPet.updateUiState({ favoriteSceneIds: [...favoriteSceneIds] });
  buildSceneList();
}

sceneFilter.addEventListener("change", buildSceneList);

function applyConfiguredLayerVisibility(targetSkeleton) {
  for (const slotIndex of hiddenLayerSlotIndices) {
    const slot = targetSkeleton.slots[slotIndex];
    if (!slot) continue;
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
    enabledPropSlots = new Set(
      [...propsList.querySelectorAll("input[data-slot-name]:checked")]
        .map(input => input.dataset.slotName)
    );
    player.skeleton.setSlotsToSetupPose();
    rebuildLayerVisibilityCache();
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
    const animationName = animationState.getCurrent(0)?.animation?.name;
    if (animationName) {
      setAnimationViewport(animationName);
      if (animationSelect.value !== animationName) animationSelect.value = animationName;
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
  const actionAnimation = player.skeleton.data.findAnimation(action.animation);
  const configuredHoldMs = Number(action.holdMs);
  const defaultHoldMs = resolvedActionName.toLowerCase() === "dead" ? 200 : 0;
  const holdMs = Number.isFinite(configuredHoldMs) ? Math.max(0, configuredHoldMs) : defaultHoldMs;
  const actionDurationMs = (actionAnimation?.duration || 0) * 1000 + holdMs;
  behaviorDirector.noteActivity(actionDurationMs);
  animationSelect.value = action.animation;
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
  } else {
    playAction(defaultAgentStateActions[currentAgentState] || "idle");
    petLog(`Applied agent state ${currentAgentState}`);
  }
  if (scene.type !== "image-sequence") actionChoreographer.setAgentState(currentAgentState);
}


function playAnimation(animationName) {
  if (scene.type === "image-sequence") {
    showSequenceFrame(animationNames.indexOf(animationName));
    return;
  }
  if (!animationNames.includes(animationName)) return;
  const animation = player.skeleton.data.findAnimation(animationName);
  behaviorDirector.noteActivity((animation?.duration || 0) * 1000);
  actionChoreographer.interrupt();
  player.animationState.setAnimation(0, animationName, true);
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
  const currentAnimation = player.animationState?.getCurrent(0)?.animation?.name || scene.actions.idle.animation;
  activeViewportAnimation = undefined;
  player.setViewport(currentAnimation);
  player.previousViewport = undefined;
  activeViewportAnimation = currentAnimation;
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
  positionUtilityPanels();
  setTimeout(() => geometryInput.requestVisualBoundsUpdate(), 80);
}

function changeSceneScale(delta) {
  sceneScale = Math.min(scene.window.maxScale, Math.max(scene.window.minScale, sceneScale + delta));
  applySceneScale();
}

function setAnimationViewport(animationName) {
  if (!player || !animationName || activeViewportAnimation === animationName) return;
  activeViewportAnimation = animationName;
  try {
    player.setViewport(animationName);
  } catch (error) {
    petLog(`Animation viewport unavailable: ${animationName}: ${error.message || error}`);
  }
}

function getVisibleSkeletonBounds(targetSkeleton = player?.skeleton) {
  if (!targetSkeleton) return undefined;
  const skeleton = targetSkeleton;
  const vertices = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const slot of skeleton.drawOrder) {
    if (isLayoutDecorationSlot(slot.data.name)) continue;
    if (!slot.bone.active) continue;
    const attachment = slot.getAttachment();
    const alpha = skeleton.color.a * slot.color.a * (attachment?.color?.a ?? 1);
    if (!attachment || alpha <= 0.02) continue;
    vertices.length = attachment instanceof spine.RegionAttachment
      ? 8
      : attachment instanceof spine.MeshAttachment
        ? attachment.worldVerticesLength
        : 0;
    if (vertices.length === 0) continue;
    if (attachment instanceof spine.RegionAttachment) attachment.computeWorldVertices(slot, vertices, 0, 2);
    else attachment.computeWorldVertices(slot, 0, vertices.length, vertices, 0, 2);
    for (let index = 0; index < vertices.length; index += 2) {
      minX = Math.min(minX, vertices[index]);
      minY = Math.min(minY, vertices[index + 1]);
      maxX = Math.max(maxX, vertices[index]);
      maxY = Math.max(maxY, vertices[index + 1]);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || maxX <= minX || maxY <= minY) return undefined;
  return {
    offset: new spine.Vector2(minX, minY),
    size: new spine.Vector2(maxX - minX, maxY - minY)
  };
}

function calculateAnimationVisibleBounds() {
  if (!player?.skeleton || typeof spine.Skeleton !== "function") return undefined;
  const sourceSkeleton = player.skeleton;
  const sampledSkeleton = new spine.Skeleton(sourceSkeleton.data);
  if (sourceSkeleton.skin) sampledSkeleton.setSkin(sourceSkeleton.skin);
  sampledSkeleton.scaleX = sourceSkeleton.scaleX;
  sampledSkeleton.scaleY = sourceSkeleton.scaleY;
  sampledSkeleton.x = sourceSkeleton.x;
  sampledSkeleton.y = sourceSkeleton.y;

  let union;
  let idleUnion;
  let interactiveUnion;
  const animationUnions = new Map();
  const idleAnimationName = scene?.actions?.idle?.animation;
  const configuredViewportActions = Array.isArray(scene?.viewport?.actions)
    ? scene.viewport.actions
    : ["idle", scene?.gestures?.click];
  const cutInActionName = scene?.gestures?.doubleClick || "cutIn";
  const cutInAnimationName = scene?.actions?.cutIn?.animation;
  const referencedActionNames = new Set(configuredViewportActions
    .filter(actionName => typeof actionName === "string")
    .filter(actionName => actionName !== "cutIn" && actionName !== cutInActionName)
    .filter(actionName => scene?.actions?.[actionName]?.animation !== cutInAnimationName));
  const interactiveAnimationNames = new Set([...referencedActionNames]
    .map(actionName => scene?.actions?.[actionName]?.animation || actionName)
    .filter(animationName => typeof animationName === "string")
    .filter(animationName => animationName !== cutInAnimationName));
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
  const expandBounds = (bounds, factor = 0.1) => {
    if (!bounds) return undefined;
    const horizontal = bounds.size.x * factor;
    const vertical = bounds.size.y * factor;
    return {
      offset: new spine.Vector2(bounds.offset.x - horizontal, bounds.offset.y - vertical),
      size: new spine.Vector2(bounds.size.x + horizontal * 2, bounds.size.y + vertical * 2)
    };
  };
  try {
    const animations = sourceSkeleton.data.animations;
    for (const animation of animations) {
      if (!interactiveAnimationNames.has(animation.name)) continue;
      const sampleCount = Math.max(24, Math.min(120, Math.ceil(animation.duration * 60)));
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const time = animation.duration > 0
          ? animation.duration * sample / (sampleCount - 1 || 1)
          : 0;
        sampledSkeleton.setToSetupPose();
        animation.apply(sampledSkeleton, time, time, false, [], 1, 0, 0);
        sampledSkeleton.updateWorldTransform();
        applyConfiguredLayerVisibility(sampledSkeleton);
        const bounds = getVisibleSkeletonBounds(sampledSkeleton);
        if (!bounds) continue;
        union = mergeBounds(union, bounds);
        animationUnions.set(animation.name, mergeBounds(animationUnions.get(animation.name), bounds));
        if (animation.name === idleAnimationName) idleUnion = mergeBounds(idleUnion, bounds);
        if (interactiveAnimationNames.has(animation.name)) interactiveUnion = mergeBounds(interactiveUnion, bounds);
      }
    }
  } catch (error) {
    petLog(`Animation bounds sampling failed: ${error.message || error}`);
    return undefined;
  } finally {
    sampledSkeleton.dispose?.();
  }
  const all = toBounds(union);
  if (!all) return undefined;
  const idle = toBounds(idleUnion) || all;
  const interactive = toBounds(interactiveUnion) || idle;
  const animations = Object.fromEntries([...animationUnions.entries()]
    .filter(([animationName]) => interactiveAnimationNames.has(animationName))
    .map(([animationName, target]) => {
      const bounds = toBounds(mergeBounds(target, idle));
      return [animationName, animationName === idleAnimationName ? bounds : expandBounds(bounds)];
    })
    .filter(([, bounds]) => bounds));
  return { all, idle, interactive, animations, interactiveAnimationNames };
}

function calculateAdaptiveWindowSize(bounds) {
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
  return {
    width: Math.max(scene.window.minWidth ?? 360, Math.ceil(width)),
    height: Math.max(scene.window.minHeight ?? 260, Math.ceil(contentHeight + chromeHeight))
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
  const idleBounds = sampledBounds?.idle || getVisibleSkeletonBounds() || sampledBounds?.all;
  if (!idleBounds) return;
  const clickActionName = scene.gestures?.click;
  const clickAnimationName = scene.actions?.[clickActionName]?.animation || clickActionName;
  const visibleBounds = sampledBounds?.animations?.[clickAnimationName] || idleBounds;
  const commonBounds = sampledBounds?.all || visibleBounds;
  const { offset, size } = commonBounds;
  const commonViewport = { x: offset.x, y: offset.y, width: size.x, height: size.y };
  if (!isValidViewport(commonViewport)) {
    petLog(`Invalid sampled viewport: ${JSON.stringify(commonViewport)}`);
    return;
  }
  baseViewport = commonViewport;
  animationViewports = sampledBounds?.animations || {};
  if (scene.window.adaptiveToContent && idleBounds.size.x > 0 && idleBounds.size.y > 0) {
    const idleWindowSize = calculateAdaptiveWindowSize(idleBounds);
    adaptiveWindowSize = {
      width: idleWindowSize.width,
      height: idleWindowSize.height
    };
  } else {
    adaptiveWindowSize = undefined;
  }
  applySceneScale();
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
  sceneScale = scene.window.defaultScale;
  document.title = scene.title;
  status.textContent = `正在加载 ${scene.title}…`;
  window.desktopPet.configure(scene.title);

  spinePlayerHost.setVisible(true);
  try {
    const loadedPlayer = await spinePlayerHost.load({
      skelUrl: scene.assets.skeleton,
      atlasUrl: scene.assets.atlas,
      alpha: true,
      backgroundColor: "00000000",
      premultipliedAlpha: true,
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
    for (const skinName of skinNames) {
      const option = document.createElement("option");
      option.value = skinName;
      option.textContent = skinName;
      skinSelect.append(option);
    }
    if (skinNames.length > 0) player.skeleton.setSkinByName(skinNames[0]);
    for (const animationName of animationNames) {
      const option = document.createElement("option");
      option.value = animationName;
      option.textContent = animationName;
      animationSelect.append(option);
    }
    addUnclassifiedPropGroup();
    buildPropControls();
    buildSceneList();
    applyLayerVisibility();
    enforceLayerVisibilityAfterAnimation();
    behaviorDirector.start();
    actionChoreographer.start();
    fitSkeletonToWindow();
    renderScheduler.start(player);
    positionUtilityPanels();
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
  sceneScale = scene.window.defaultScale;
  animationNames = scene.assets.frames.map(frame => frame.name);
  document.title = scene.title;
  window.desktopPet.configure(scene.title);
  sequenceImage = document.createElement("img");
  sequenceImage.className = "cg-frame";
  sequenceImage.draggable = false;
  spinePlayerHost.setVisible(false);
  document.getElementById("player").append(sequenceImage);
  const skinOption = document.createElement("option");
  skinOption.textContent = "CG";
  skinSelect.append(skinOption);
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
  window.desktopPet.shutdownReady();
});
window.addEventListener("beforeunload", () => {
  if (!disposing && !shutdownPrepared) void disposeScene({ shutdown: true });
});
window.addEventListener("resize", () => {
  positionUtilityPanels();
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
