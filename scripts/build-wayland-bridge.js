const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (process.platform !== "linux") process.exit(0);

const root = path.join(__dirname, "..");
const sourceDirectory = path.join(root, "src", "native", "platform", "linux", "wayland");
const outputDirectory = path.join(root, "build", "native");
const interposeOutput = path.join(outputDirectory, "wayland-interpose.so");
const addonOutput = path.join(outputDirectory, "wayland-drag-bridge.node");
fs.mkdirSync(outputDirectory, { recursive: true });

const compiler = process.env.CC || "cc";
const interposeResult = spawnSync(compiler, [
  "-shared", "-fPIC", "-O2", "-Wall", "-Wextra",
  ...["wayland-buffer.c", "wayland-interpose.c"].map(name => path.join(sourceDirectory, name)),
  "-o", interposeOutput,
  "-ldl", "-lpthread", "-lwayland-client"
], { stdio: "inherit" });

if (interposeResult.error) throw interposeResult.error;
if (interposeResult.status !== 0) process.exit(interposeResult.status ?? 1);

const addonResult = spawnSync(compiler, [
  "-shared", "-fPIC", "-O2", "-Wall", "-Wextra",
  "-I/usr/include/node",
  path.join(sourceDirectory, "addon.c"),
  "-o", addonOutput
], { stdio: "inherit" });

if (addonResult.error) throw addonResult.error;
process.exit(addonResult.status ?? 1);
