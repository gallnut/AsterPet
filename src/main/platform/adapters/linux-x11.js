function configureLinuxX11({ detected }) {
  return { ...detected, nativeWayland: false, waylandBridge: undefined };
}

module.exports = { configureLinuxX11 };
