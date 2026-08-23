function applyKdePolicy(platform) {
  return {
    ...platform,
    desktopPolicy: {
      id: "kde",
      nativeWindowMenu: platform.displayProtocol === "wayland",
      alwaysOnTopStrategy: "electron"
    }
  };
}

module.exports = { applyKdePolicy };
