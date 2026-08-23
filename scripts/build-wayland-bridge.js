const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (process.platform !== "linux") process.exit(0);

const root = path.join(__dirname, "..");
const sourceDirectory = path.join(root, "src", "native", "platform", "linux", "wayland");
const sources = ["wayland-buffer.c", "wayland-interpose.c", "addon.c"].map(name => path.join(sourceDirectory, name));
const outputDirectory = path.join(root, "build", "native");
const output = path.join(outputDirectory, "wayland-drag-bridge.node");
fs.mkdirSync(outputDirectory, { recursive: true });

const result = spawnSync(process.env.CC || "cc", [
  "-shared", "-fPIC", "-O2", "-Wall", "-Wextra",
  "-I/usr/include/node",
  ...sources,
  "-o", output,
  "-ldl", "-lpthread"
], { stdio: "inherit" });

if (result.error) throw result.error;
process.exit(result.status ?? 1);
