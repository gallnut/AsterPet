const { spawn } = require("node:child_process");
const path = require("node:path");
const { prepareFontconfigRuntime } = require("./fontconfig-runtime");

const root = path.join(__dirname, "..");
const electronPath = require("electron");
const bridgePath = path.join(root, "build", "native", "wayland-drag-bridge.node");
const environment = { ...process.env };

if (process.platform === "linux") {
  if (!environment.ELECTRON_OZONE_PLATFORM_HINT) {
    environment.ELECTRON_OZONE_PLATFORM_HINT = environment.XDG_SESSION_TYPE === "wayland" && environment.WAYLAND_DISPLAY
      ? "wayland"
      : "x11";
  }
  environment.ASTERPET_WAYLAND_BRIDGE = bridgePath;
  Object.assign(environment, prepareFontconfigRuntime({
    root: path.join(root, "build", "runtime", "fontconfig-root"),
    configSource: path.join(root, "resources", "fontconfig", "fonts.conf")
  }));
  environment.LD_PRELOAD = environment.LD_PRELOAD
    ? `${bridgePath}:${environment.LD_PRELOAD}`
    : bridgePath;
}

const electronFlags = environment.ELECTRON_REMOTE_DEBUGGING_PORT
  ? [`--remote-debugging-port=${environment.ELECTRON_REMOTE_DEBUGGING_PORT}`]
  : [];
if (process.platform === "linux"
    && environment.XDG_SESSION_TYPE === "wayland"
    && environment.WAYLAND_DISPLAY
    && environment.ELECTRON_OZONE_PLATFORM_HINT !== "x11") {
  electronFlags.push("--in-process-gpu");
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
