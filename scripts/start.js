const { spawn } = require("node:child_process");
const path = require("node:path");
const { prepareFontconfigRuntime } = require("./fontconfig-runtime");
const { detectDesktopEnvironment } = require("../src/main/platform/detect-environment");

const root = path.join(__dirname, "..");
const electronPath = require("electron");
const bridgeAddonPath = path.join(root, "build", "native", "wayland-drag-bridge.node");
const bridgeLibraryPath = path.join(root, "build", "native", "wayland-interpose.so");
const environment = { ...process.env };

if (process.platform === "linux") {
  environment.ELECTRON_OZONE_PLATFORM_HINT ||= detectDesktopEnvironment(environment).displayProtocol;
  environment.ASTERPET_WAYLAND_BRIDGE = bridgeAddonPath;
  Object.assign(environment, prepareFontconfigRuntime({
    root: path.join(root, "build", "runtime", "fontconfig-root"),
    configSource: path.join(root, "resources", "fontconfig", "fonts.conf")
  }));
  environment.LD_PRELOAD = environment.LD_PRELOAD
    ? `${bridgeLibraryPath}:${environment.LD_PRELOAD}`
    : bridgeLibraryPath;
}

const electronFlags = environment.ELECTRON_REMOTE_DEBUGGING_PORT
  ? [`--remote-debugging-port=${environment.ELECTRON_REMOTE_DEBUGGING_PORT}`]
  : [];
if (process.platform === "linux" && !process.argv.slice(2).some(value => value.startsWith("--ozone-platform"))) {
  electronFlags.push(`--ozone-platform=${environment.ELECTRON_OZONE_PLATFORM_HINT}`);
}
const child = spawn(electronPath, [...electronFlags, root, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: environment
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
