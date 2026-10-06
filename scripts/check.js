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

run(process.execPath, [path.join(projectRoot, "scripts", "check-animation-graph.mjs")]);
run(process.execPath, [path.join(projectRoot, "scripts", "check-cinematic-player.mjs")]);
run(process.execPath, [path.join(projectRoot, "scripts", "check-animation-tail-loop.mjs")]);
run(process.execPath, [path.join(projectRoot, "scripts", "check-portrait-animations.mjs")]);
run(process.execPath, [path.join(projectRoot, "scripts", "check-pet-interaction.mjs")]);
run(process.execPath, [path.join(projectRoot, "scripts", "check-window-drag.js")]);
run(process.execPath, [path.join(projectRoot, "scripts", "check-camera-view.mjs")]);

run(process.execPath, [path.join(projectRoot, "scripts", "migrate-layer-metadata.mjs"), "--check"]);
run(process.execPath, [path.join(projectRoot, "scripts", "check-licenses.js")]);

const { resolveControlHost } = require(path.join(projectRoot, "src", "main", "control-server.js"));
const { validateAppearanceMetadata } = require(path.join(projectRoot, "src", "main", "appearance-metadata.js"));
const appearance = validateAppearanceMetadata({
  format: "asterpet.appearance/v1",
  id: "standard",
  label: "标准造型",
  defaultVariant: "level-1",
  variants: [{ id: "level-1", label: "阶段 1", skin: "LV1" }]
});
if (appearance.variants[0].skin !== "LV1") throw new Error("Appearance metadata validation failed");
const { resolveSceneFamilies, resolveAppearanceVariants } = require(path.join(projectRoot, "src", "renderer", "pet", "appearance-variants.js"));
const hAppearances = resolveAppearanceVariants({
  sceneId: "character-h",
  sceneCatalog: {
    "character-h": { characterId: "h", category: "character", title: "H 动态角色", characterTitle: "H" },
    "interaction-h": { characterId: "h", category: "interaction", title: "H 互动场景", characterTitle: "H" }
  },
  availableSkinNames: ["LV1", "LV2"]
});
if (hAppearances.options.length !== 2 || hAppearances.options.some(option => option.driver !== "spine-skin")) {
  throw new Error("Spine skin appearances were not unified");
}
const sceneAppearances = resolveAppearanceVariants({
  sceneId: "costume-a-json",
  sceneCatalog: {
    "costume-a-json": { characterId: "character", category: "character", title: "角色 · 服装 A", characterTitle: "角色" },
    "costume-a-skel": { characterId: "character", category: "character", title: "角色 · 服装 A", characterTitle: "角色" },
    "costume-b": { characterId: "character", category: "character", title: "角色 · 服装 B", characterTitle: "角色" }
  }
});
if (sceneAppearances.options.length !== 2 || sceneAppearances.options.map(option => option.label).join(",") !== "变体 1,变体 2") {
  throw new Error("Scene variants were not grouped inside the logical scene");
}
const sceneFamilies = resolveSceneFamilies({
  "costume-a-json": { characterId: "character", category: "character", title: "角色 · 服装 A", characterTitle: "角色" },
  "costume-a-skel": { characterId: "character", category: "character", title: "角色 · 服装 A", characterTitle: "角色" },
  "costume-b": { characterId: "character", category: "character", title: "角色 · 服装 B", characterTitle: "角色" }
});
if (sceneFamilies.length !== 2 || sceneFamilies.find(family => family.label === "服装 A")?.entries.length !== 2) {
  throw new Error("Logical scene families were not resolved");
}
const versionedFamilies = resolveSceneFamilies({
  "example-v1": { packageId: "example-character", characterId: "example-character", category: "character", title: "Example Costume standing示例角色 示例服装 立绘", characterTitle: "示例角色" },
  "example-v2": { packageId: "example-character", characterId: "example-character", category: "character", title: "Example Costume standing示例角色 示例服装 立绘v2", characterTitle: "示例角色" }
});
if (versionedFamilies.length !== 1 || versionedFamilies[0].entries.length !== 2) {
  throw new Error("Versioned legacy scenes were not grouped as variants");
}
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
