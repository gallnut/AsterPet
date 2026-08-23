const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");

function collectJavaScriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectJavaScriptFiles(absolute));
    else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

for (const file of [...collectJavaScriptFiles(path.join(projectRoot, "src")), ...collectJavaScriptFiles(path.join(projectRoot, "scripts"))]) {
  run(process.execPath, ["--check", file]);
}

for (const relativePath of ["package.json", "resources/scenes/layer-rules.json", "resources/dialog-themes/aster-dark/theme.json"]) {
  JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

run(process.execPath, [path.join(projectRoot, "scripts", "migrate-layer-metadata.mjs"), "--check"]);
run(process.execPath, [path.join(projectRoot, "scripts", "check-licenses.js")]);

const { resolveControlHost } = require(path.join(projectRoot, "src", "main", "control-server.js"));
if (resolveControlHost({ DESKTOP_PET_CONTROL_HOST: "0.0.0.0" }) !== "127.0.0.1") {
  throw new Error("Control server must reject remote binding by default");
}
if (resolveControlHost({
  DESKTOP_PET_CONTROL_HOST: "0.0.0.0",
  DESKTOP_PET_CONTROL_ALLOW_REMOTE: "1"
}) !== "0.0.0.0") {
  throw new Error("Control server remote opt-in is not working");
}
console.log("AsterPet checks passed");
