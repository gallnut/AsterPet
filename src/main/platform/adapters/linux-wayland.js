const path = require("node:path");

function appendDisabledFeature(app, feature) {
  const disabledFeatures = new Set(
    String(app.commandLine.getSwitchValue("disable-features") || "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean)
  );
  disabledFeatures.add(feature);
  app.commandLine.appendSwitch("disable-features", [...disabledFeatures].join(","));
}

function configureLinuxWayland({ app, projectRoot, environment, detected }) {
  appendDisabledFeature(app, "WaylandOverlayDelegation");
  app.commandLine.appendSwitch("in-process-gpu");
  let nativeBridge;
  try {
    const bridgePath = environment.ASTERPET_WAYLAND_BRIDGE
      || path.join(projectRoot, "build", "native", "wayland-drag-bridge.node");
    nativeBridge = require(bridgePath);
  } catch (error) {
    console.error(`Unable to load Wayland platform bridge: ${error.message}`);
  }
  return { ...detected, nativeWayland: true, waylandBridge: nativeBridge };
}

module.exports = { configureLinuxWayland };
