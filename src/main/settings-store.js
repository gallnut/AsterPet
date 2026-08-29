const fs = require("node:fs");
const path = require("node:path");

class SettingsStore {
  constructor(asterPetHome, log) {
    this.settingsPath = path.join(asterPetHome, "config.json");
    this.log = log;
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.settingsPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") this.log(`Unable to read settings: ${error.message}`);
      return {};
    }
  }

  update(values) {
    const settings = { ...this.read(), ...values };
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    const temporaryPath = `${this.settingsPath}.${process.pid}.tmp`;
    const serialized = `${JSON.stringify(settings, null, 2)}\n`;
    fs.writeFileSync(temporaryPath, serialized, { mode: 0o600 });
    try {
      fs.renameSync(temporaryPath, this.settingsPath);
    } catch (error) {
      if (process.platform !== "win32") throw error;
      fs.copyFileSync(temporaryPath, this.settingsPath);
      fs.rmSync(temporaryPath, { force: true });
    }
    return settings;
  }

  readUiState() {
    const settings = this.read();
    return {
      selectedScene: typeof settings.ui?.selectedScene === "string" ? settings.ui.selectedScene : undefined,
      mirrored: settings.ui?.mirrored === true,
      propVisibility: settings.ui?.propVisibility && typeof settings.ui.propVisibility === "object"
        ? settings.ui.propVisibility
        : {},
      favoriteSceneIds: Array.isArray(settings.ui?.favoriteSceneIds)
        ? [...new Set(settings.ui.favoriteSceneIds.filter(value => typeof value === "string"))]
        : [],
      appearanceByScene: settings.ui?.appearanceByScene && typeof settings.ui.appearanceByScene === "object"
        ? Object.fromEntries(Object.entries(settings.ui.appearanceByScene)
          .filter(([sceneId, skin]) => typeof sceneId === "string" && typeof skin === "string"))
        : {},
      variantSceneByFamily: settings.ui?.variantSceneByFamily && typeof settings.ui.variantSceneByFamily === "object"
        ? Object.fromEntries(Object.entries(settings.ui.variantSceneByFamily)
          .filter(([familyId, sceneId]) => typeof familyId === "string" && typeof sceneId === "string"))
        : {}
    };
  }

  updateUiState(values, persist = true) {
    const current = this.readUiState();
    const next = {
      ...current,
      ...values,
      mirrored: values.mirrored === undefined ? current.mirrored : Boolean(values.mirrored),
      propVisibility: values.propVisibility === undefined
        ? current.propVisibility
        : values.propVisibility,
      favoriteSceneIds: values.favoriteSceneIds === undefined
        ? current.favoriteSceneIds
        : Array.isArray(values.favoriteSceneIds)
          ? [...new Set(values.favoriteSceneIds.filter(value => typeof value === "string"))]
          : current.favoriteSceneIds,
      appearanceByScene: values.appearanceByScene === undefined
        ? current.appearanceByScene
        : values.appearanceByScene && typeof values.appearanceByScene === "object"
          ? Object.fromEntries(Object.entries(values.appearanceByScene)
            .filter(([sceneId, skin]) => typeof sceneId === "string" && typeof skin === "string"))
          : current.appearanceByScene,
      variantSceneByFamily: values.variantSceneByFamily === undefined
        ? current.variantSceneByFamily
        : values.variantSceneByFamily && typeof values.variantSceneByFamily === "object"
          ? Object.fromEntries(Object.entries(values.variantSceneByFamily)
            .filter(([familyId, sceneId]) => typeof familyId === "string" && typeof sceneId === "string"))
          : current.variantSceneByFamily
    };
    if (persist) this.update({ ui: next });
    return next;
  }
}

module.exports = { SettingsStore };
