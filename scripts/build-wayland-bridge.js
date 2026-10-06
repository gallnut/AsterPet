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
if (addonResult.status !== 0) process.exit(addonResult.status ?? 1);
const x11Result = spawnSync(compiler, [
  "-shared", "-fPIC", "-O2", "-Wall", "-Wextra", "-I/usr/include/node",
  path.join(root, "src", "native", "platform", "linux", "x11", "addon.c"),
  "-o", path.join(outputDirectory, "x11-input-region.node"), "-lX11", "-lXext"
], { stdio: "inherit" });
if (x11Result.error) throw x11Result.error;
process.exit(x11Result.status ?? 1);
