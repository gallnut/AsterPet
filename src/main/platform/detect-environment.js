function detectDesktopEnvironment(environment = process.env, platform = process.platform) {
  const ozoneHint = (environment.ELECTRON_OZONE_PLATFORM_HINT || "").toLowerCase();
  const sessionType = (environment.XDG_SESSION_TYPE || "").toLowerCase();
  const desktop = (environment.XDG_CURRENT_DESKTOP || environment.DESKTOP_SESSION || "").toLowerCase();
  // GNOME constrains xdg_toplevel.move to keep the window's top onscreen.
  // Use XWayland for freely positioned pet windows when it is available.
  const gnomeFreePositioning = !ozoneHint && desktop.includes("gnome") && environment.DISPLAY;
  const displayProtocol = platform === "linux"
    ? ozoneHint === "x11" || gnomeFreePositioning ? "x11" : (ozoneHint === "wayland" || (sessionType === "wayland" && environment.WAYLAND_DISPLAY) ? "wayland" : "x11")
    : undefined;
  return {
    platform,
    displayProtocol,
    desktopEnvironment: desktop.includes("gnome") ? "gnome" : desktop.includes("kde") ? "kde" : "generic"
  };
}

module.exports = { detectDesktopEnvironment };
