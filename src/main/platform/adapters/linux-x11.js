const path = require("node:path");

function configureLinuxX11({ detected, projectRoot, environment }) {
  let x11Bridge;
  try {
    x11Bridge = require(environment.ASTERPET_X11_BRIDGE || path.join(projectRoot, "build", "native", "x11-input-region.node"));
  } catch (error) {
    console.error(`Unable to load X11 input region bridge: ${error.message}`);
  }
  return { ...detected, nativeWayland: false, waylandBridge: undefined, x11Bridge };
}

module.exports = { configureLinuxX11 };
