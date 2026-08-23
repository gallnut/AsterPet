const { configureGenericPlatform } = require("./adapters/generic");
const { configureLinuxWayland } = require("./adapters/linux-wayland");
const { configureLinuxX11 } = require("./adapters/linux-x11");
const { detectDesktopEnvironment } = require("./detect-environment");
const { applyGenericDesktopPolicy } = require("./desktop/generic");
const { applyGnomePolicy } = require("./desktop/gnome");
const { applyKdePolicy } = require("./desktop/kde");

const desktopPolicies = { gnome: applyGnomePolicy, kde: applyKdePolicy, generic: applyGenericDesktopPolicy };

function configurePlatform(app, projectRoot, environment = process.env) {
  const detected = detectDesktopEnvironment(environment);
  const context = { app, projectRoot, environment, detected };
  const platform = detected.platform === "linux" && detected.displayProtocol === "wayland"
    ? configureLinuxWayland(context)
    : detected.platform === "linux"
      ? configureLinuxX11(context)
      : configureGenericPlatform(context);
  return (desktopPolicies[detected.desktopEnvironment] || applyGenericDesktopPolicy)(platform);
}

module.exports = { configurePlatform };
