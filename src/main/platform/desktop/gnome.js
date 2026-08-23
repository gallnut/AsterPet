function applyGnomePolicy(platform) {
  return {
    ...platform,
    desktopPolicy: {
      id: "gnome",
      nativeWindowMenu: platform.displayProtocol === "wayland",
      alwaysOnTopStrategy: "electron"
    }
  };
}

module.exports = { applyGnomePolicy };
