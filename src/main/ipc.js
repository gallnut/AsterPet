function registerIpc({ app, ipcMain, dialog, windows, externalAi, dialogThemes, scenes, settings, log }) {
  ipcMain.on("pet:close", () => app.quit());
  ipcMain.on("pet:minimize", () => windows.minimize());
  ipcMain.on("pet:window-menu", event => { event.returnValue = windows.requestWindowMenu(); });
  ipcMain.on("pet:log", (_event, message) => log(`[pet] ${message}`));
  ipcMain.on("pet:drag-start", (_event, pointer) => windows.startDrag(pointer));
  ipcMain.on("pet:drag-move", (_event, pointer) => windows.moveDrag(pointer));
  ipcMain.on("pet:drag-end", () => windows.endDrag());
  ipcMain.on("pet:mouse-passthrough", (_event, enabled) => windows.setMousePassthrough(enabled));
  ipcMain.on("pet:toolbar-visible", (_event, visible) => windows.setToolbarVisible(visible));
  ipcMain.on("pet:invalidate", () => windows.invalidate());
  ipcMain.on("pet:input-shape", (_event, shape) => windows.setInputShape(shape));
  ipcMain.on("pet:open-popover", (_event, payload) => windows.openPopover(payload));
  ipcMain.on("pet:close-popover", () => windows.closePopover());
  ipcMain.on("pet:select-popover-item", (_event, payload) => windows.selectPopoverItem(payload));
  ipcMain.on("pet:resize", (_event, settings) => windows.resizePet(settings));
  ipcMain.on("pet:configure", (_event, title) => windows.configure(title));
  ipcMain.handle("pet:switch-scene", (_event, sceneId) => windows.switchScene(sceneId));
  ipcMain.on("pet:scene-switch-ready", (_event, requestId, result) => windows.completeSceneCleanup(requestId, result));
  ipcMain.on("pet:shutdown-ready", () => windows.completeShutdown());
  ipcMain.on("pet:resize-status", (_event, height) => windows.resizeStatus(height));
  ipcMain.on("pet:visual-bounds", (_event, bounds) => windows.setVisualBounds(bounds));
  ipcMain.on("pet:active-scene", (_event, sceneId) => windows.setActiveScene(sceneId));
  ipcMain.handle("pet:get-ui-state", () => settings.readUiState());
  ipcMain.handle("pet:update-ui-state", (_event, values = {}) => {
    const persist = process.env.PET_TEST !== "1";
    return settings.updateUiState(values, persist);
  });

  ipcMain.handle("pet:import-character-package", async () => {
    const selection = await dialog.showOpenDialog(windows.petWindow, {
      title: "导入 AsterPet 人物包",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "AsterPet 人物包", extensions: ["asterpet"] }]
    });
    if (selection.canceled || selection.filePaths.length === 0) return { canceled: true };
    const installed = [];
    const failed = [];
    for (const archivePath of selection.filePaths) {
      try {
        const result = await scenes.install(archivePath);
        installed.push({
          packageId: result.manifest.id,
          title: result.manifest.title,
          sceneId: result.manifest.scenes[0]?.id,
          cacheDirectory: result.destination
        });
      } catch (error) {
        failed.push({ filePath: archivePath, error: error.message || String(error) });
        log(`Package import failed (${archivePath}): ${error.stack || error}`);
      }
    }
    if (failed.length > 0) {
      await dialog.showMessageBox(windows.petWindow, {
        type: installed.length > 0 ? "warning" : "error",
        title: installed.length > 0 ? "部分人物包导入失败" : "人物包导入失败",
        message: failed.map(item => `${item.filePath.split(/[\\/]/).pop()}：${item.error}`).join("\n")
      });
    }
    return {
      canceled: false,
      installed,
      failed,
      packageId: installed[0]?.packageId,
      title: installed[0]?.title,
      sceneId: installed[0]?.sceneId,
      cacheDirectory: installed[0]?.cacheDirectory
    };
  });

  ipcMain.handle("pet:get-packages", () => scenes.getPackages());
  ipcMain.handle("pet:delete-packages", (_event, request = {}) => {
    request = request || {};
    return scenes.removePackages(request.packageIds, windows.activeSceneId || request.activeSceneId);
  });

  ipcMain.handle("pet:get-dialog-themes", () => dialogThemes.getState());
  ipcMain.handle("pet:select-dialog-theme", (_event, id) => dialogThemes.select(id));
  ipcMain.handle("pet:import-dialog-theme", async () => {
    const selection = await dialog.showOpenDialog(windows.petWindow, {
      title: "导入 AsterPet 对话皮肤",
      properties: ["openFile"],
      filters: [{ name: "AsterPet 对话皮肤", extensions: ["asterpet-theme", "zip"] }]
    });
    if (selection.canceled || selection.filePaths.length === 0) return { canceled: true };
    return dialogThemes.import(selection.filePaths[0]);
  });

  ipcMain.handle("pet:respond-interaction", (_event, response) => externalAi.respond(response));
  ipcMain.handle("pet:cancel-agent", (_event, sessionId) => externalAi.cancel(sessionId));
  ipcMain.handle("pet:open-launcher", () => externalAi.openLauncher());
  ipcMain.handle("pet:close-launcher", () => {
    windows.closePopover();
    return externalAi.closeLauncher();
  });
  ipcMain.handle("pet:get-ai-settings", () => externalAi.getSettings());
  ipcMain.handle("pet:set-ai-driver-config", (_event, request) => externalAi.setDriverConfig(request));
  ipcMain.handle("pet:get-harness-settings", () => externalAi.getSettings());
  ipcMain.handle("pet:set-harness-url", (_event, value) => externalAi.setUrl(value));
  ipcMain.handle("pet:start-conversation", (_event, request) => externalAi.startConversation(request));
  ipcMain.handle("pet:prepare-conversation", (_event, request) => externalAi.prepareConversation(request));
  ipcMain.handle("pet:get-scene-manifest", () => scenes.getManifest());
  ipcMain.handle("pet:get-layer-rules", () => scenes.getLayerRules());
  ipcMain.handle("pet:get-scene-catalog", () => scenes.getCatalog());
  ipcMain.handle("pet:get-scene-config", (_event, sceneId) => scenes.getScene(sceneId));
}

module.exports = { registerIpc };
