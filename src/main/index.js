const path = require("node:path");
const { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, protocol, screen } = require("electron");
const { DshDriver } = require("./ai/drivers/dsh/dsh-driver");
const { ExternalAiService } = require("./ai/external-ai-service");
const { ControlServer } = require("./control-server");
const { registerIpc } = require("./ipc");
const { createLogger } = require("./logger");
const { configurePlatform } = require("./platform");
const { SceneRepository } = require("./scene-repository");
const { SettingsStore } = require("./settings-store");
const { DialogThemeRepository } = require("./themes/dialog-theme-repository");
const { DialogThemeService } = require("./themes/dialog-theme-service");
const { WindowManager } = require("./window-manager");

const projectRoot = path.resolve(__dirname, "../..");
const { nativeWayland, waylandBridge, x11Bridge } = configurePlatform(app, projectRoot);

protocol.registerSchemesAsPrivileged([{
  scheme: "asterpet",
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}]);
app.setName("AsterPet");
const hasSingleInstanceLock = app.requestSingleInstanceLock();

const asterPetHome = path.join(app.getPath("home"), ".asterpet");
const log = createLogger(asterPetHome);
const settings = new SettingsStore(asterPetHome, log);
const windows = new WindowManager({
  app,
  BrowserWindow,
  screen,
  projectRoot,
  nativeWayland,
  waylandBridge,
  x11Bridge,
  log
});
const dshDriver = new DshDriver({
  config: {},
  defaultEndpoint: process.env.DEEPSEEK_HARNESS_URL || "http://127.0.0.1:3080",
  log
});
const externalAi = new ExternalAiService({
  settings,
  drivers: [dshDriver],
  log,
  onContext: context => windows.publishContext(context),
  onAgentState: state => windows.sendAgentState(state)
});
const dialogThemes = new DialogThemeService({
  repository: new DialogThemeRepository({ projectRoot, asterPetHome, log }),
  settings,
  log,
  onChanged: theme => windows.applyDialogTheme(theme)
});
windows.applyDialogTheme(dialogThemes.current);
const scenes = new SceneRepository({ projectRoot, asterPetHome, protocol, net, log });
const controlServer = new ControlServer({ externalAi, windows, log });

windows.currentAgentState = externalAi.currentAgentState;
windows.currentContext = externalAi.getContext();
registerIpc({
  app,
  ipcMain,
  dialog,
  windows,
  externalAi,
  dialogThemes,
  scenes,
  settings,
  log
});

log(`Process started; PET_TEST=${process.env.PET_TEST ?? "unset"}`);
log(`Settings path: ${settings.settingsPath}`);
log(`Display backend: ${nativeWayland ? "native-wayland" : "mouse-passthrough-capable"}`);

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) {
    log("Another AsterPet instance is already running; exiting");
    app.quit();
    return;
  }
  log("App ready");
  scenes.registerProtocol();
  windows.create();
  const recallRegistered = globalShortcut.register("CommandOrControl+Alt+P", () => windows.showPet());
  log(`Recall shortcut Ctrl/Cmd+Alt+P: ${recallRegistered ? "ready" : "unavailable"}`);
  controlServer.start();
  externalAi.start();
});

app.on("second-instance", () => {
  windows.showPet();
});
app.on("activate", () => windows.showPet());

let shutdownStarted = false;
app.on("before-quit", event => {
  if (shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  globalShortcut.unregisterAll();
  externalAi.stop();
  controlServer.stop();
  waylandBridge?.shutdown?.();
  windows.shutdown().finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (!shutdownStarted) app.quit();
});
