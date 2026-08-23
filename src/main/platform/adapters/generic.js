function configureGenericPlatform({ detected }) {
  return { ...detected, nativeWayland: false, waylandBridge: undefined };
}

module.exports = { configureGenericPlatform };
