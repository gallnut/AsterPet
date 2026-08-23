const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopPet", {
  nativeWayland: process.platform === "linux"
    && (process.env.ELECTRON_OZONE_PLATFORM_HINT || "").toLowerCase() !== "x11"
    && ((process.env.ELECTRON_OZONE_PLATFORM_HINT || "").toLowerCase() === "wayland"
      || (process.env.XDG_SESSION_TYPE === "wayland" && Boolean(process.env.WAYLAND_DISPLAY))),
  testMode: process.env.PET_TEST === "1",
  close: () => ipcRenderer.send("pet:close"),
  minimize: () => ipcRenderer.send("pet:minimize"),
  openWindowMenu: () => ipcRenderer.sendSync("pet:window-menu"),
  log: message => ipcRenderer.send("pet:log", message),
  dragStart: pointer => ipcRenderer.send("pet:drag-start", pointer),
  dragMove: pointer => ipcRenderer.send("pet:drag-move", pointer),
  dragEnd: () => ipcRenderer.send("pet:drag-end"),
  setMousePassthrough: enabled => ipcRenderer.send("pet:mouse-passthrough", enabled),
  setToolbarVisible: visible => ipcRenderer.send("pet:toolbar-visible", Boolean(visible)),
  invalidate: () => ipcRenderer.send("pet:invalidate"),
  resize: settings => ipcRenderer.send("pet:resize", settings),
  configure: title => ipcRenderer.send("pet:configure", title),
  switchScene: sceneId => ipcRenderer.invoke("pet:switch-scene", sceneId),
  onPrepareSceneSwitch: listener => {
    const handler = async (_event, requestId, sceneId) => listener(requestId, sceneId);
    ipcRenderer.on("pet:prepare-scene-switch", handler);
    return () => ipcRenderer.removeListener("pet:prepare-scene-switch", handler);
  },
  sceneSwitchReady: (requestId, result) => ipcRenderer.send("pet:scene-switch-ready", requestId, result),
  onPrepareShutdown: listener => {
    const handler = () => listener();
    ipcRenderer.on("pet:prepare-shutdown", handler);
    return () => ipcRenderer.removeListener("pet:prepare-shutdown", handler);
  },
  shutdownReady: () => ipcRenderer.send("pet:shutdown-ready"),
  importCharacterPackage: () => ipcRenderer.invoke("pet:import-character-package"),
  getPackages: () => ipcRenderer.invoke("pet:get-packages"),
  deletePackages: request => ipcRenderer.invoke("pet:delete-packages", request),
  getDialogThemes: () => ipcRenderer.invoke("pet:get-dialog-themes"),
  selectDialogTheme: id => ipcRenderer.invoke("pet:select-dialog-theme", id),
  importDialogTheme: () => ipcRenderer.invoke("pet:import-dialog-theme"),
  onDialogTheme: listener => {
    const handler = (_event, theme) => listener(theme);
    ipcRenderer.on("pet:dialog-theme-changed", handler);
    return () => ipcRenderer.removeListener("pet:dialog-theme-changed", handler);
  },
  getSceneManifest: () => ipcRenderer.invoke("pet:get-scene-manifest"),
  getLayerRules: () => ipcRenderer.invoke("pet:get-layer-rules"),
  getSceneCatalog: () => ipcRenderer.invoke("pet:get-scene-catalog"),
  getSceneConfig: sceneId => ipcRenderer.invoke("pet:get-scene-config", sceneId),
  getUiState: () => ipcRenderer.invoke("pet:get-ui-state"),
  updateUiState: values => ipcRenderer.invoke("pet:update-ui-state", values),
  onAgentState: listener => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("pet:agent-state", handler);
    return () => ipcRenderer.removeListener("pet:agent-state", handler);
  },
  onPlayAction: listener => {
    const handler = (_event, action) => listener(action);
    ipcRenderer.on("pet:play-action", handler);
    return () => ipcRenderer.removeListener("pet:play-action", handler);
  },
  onAgentContext: listener => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("pet:agent-context", handler);
    return () => ipcRenderer.removeListener("pet:agent-context", handler);
  },
  respondInteraction: response => ipcRenderer.invoke("pet:respond-interaction", response),
  cancelAgent: sessionId => ipcRenderer.invoke("pet:cancel-agent", sessionId),
  openLauncher: () => ipcRenderer.invoke("pet:open-launcher"),
  closeLauncher: () => ipcRenderer.invoke("pet:close-launcher"),
  getExternalAiSettings: () => ipcRenderer.invoke("pet:get-ai-settings"),
  setExternalAiDriverConfig: request => ipcRenderer.invoke("pet:set-ai-driver-config", request),
  getHarnessSettings: () => ipcRenderer.invoke("pet:get-harness-settings"),
  setHarnessUrl: url => ipcRenderer.invoke("pet:set-harness-url", url),
  openPopover: payload => ipcRenderer.send("pet:open-popover", payload),
  closePopover: () => ipcRenderer.send("pet:close-popover"),
  selectPopoverItem: payload => ipcRenderer.send("pet:select-popover-item", payload),
  onPopoverSelected: listener => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("pet:popover-selected", handler);
    return () => ipcRenderer.removeListener("pet:popover-selected", handler);
  },
  onPopoverData: listener => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("pet:popover-data", handler);
    return () => ipcRenderer.removeListener("pet:popover-data", handler);
  },
  startConversation: request => ipcRenderer.invoke("pet:start-conversation", request),
  prepareConversation: request => ipcRenderer.invoke("pet:prepare-conversation", request),
  resizeStatus: height => ipcRenderer.send("pet:resize-status", height),
  onStatusSide: listener => {
    const handler = (_event, side) => listener(side);
    ipcRenderer.on("pet:status-side", handler);
    return () => ipcRenderer.removeListener("pet:status-side", handler);
  },
  onStatusScale: listener => {
    const handler = (_event, scale) => listener(scale);
    ipcRenderer.on("pet:status-scale", handler);
    return () => ipcRenderer.removeListener("pet:status-scale", handler);
  },
  onEmbeddedStatusLayout: listener => {
    const handler = (_event, layout) => listener(layout);
    ipcRenderer.on("pet:embedded-status-layout", handler);
    return () => ipcRenderer.removeListener("pet:embedded-status-layout", handler);
  },
  onResetStatusView: listener => {
    const handler = () => listener();
    ipcRenderer.on("pet:reset-status-view", handler);
    return () => ipcRenderer.removeListener("pet:reset-status-view", handler);
  },
  reportVisualBounds: bounds => ipcRenderer.send("pet:visual-bounds", bounds),
  setActiveScene: sceneId => ipcRenderer.send("pet:active-scene", sceneId),
  reportInputShape: rects => ipcRenderer.send("pet:input-shape", rects)
});
