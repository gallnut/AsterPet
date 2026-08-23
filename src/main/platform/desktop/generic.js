function applyGenericDesktopPolicy(platform) {
  return {
    ...platform,
    desktopPolicy: {
      id: "generic",
      nativeWindowMenu: false,
      alwaysOnTopStrategy: "electron"
    }
  };
}

module.exports = { applyGenericDesktopPolicy };
