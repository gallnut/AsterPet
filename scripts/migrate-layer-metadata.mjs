import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  AtlasAttachmentLoader,
  FakeTexture,
  SkeletonBinary,
  SkeletonJson,
  TextureAtlas
} from "@esotericsoftware/spine-player";

const projectRoot = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { validateLayerMetadata } = require("../src/main/layer-metadata");
const rootIndex = process.argv.indexOf("--root");
const explicitRoot = rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined;
if (rootIndex >= 0 && !explicitRoot) throw new Error("--root 需要提供内容目录");
const contentRoots = explicitRoot
  ? [path.resolve(explicitRoot)]
  : process.argv.includes("--project-only")
  ? [path.join(projectRoot, "content")]
  : [path.join(os.homedir(), ".asterpet", "content"), path.join(projectRoot, "content")];
const writeChanges = process.argv.includes("--write");
const checkOnly = process.argv.includes("--check");
const force = process.argv.includes("--force");
const sceneFilterIndex = process.argv.indexOf("--scene");
const sceneFilter = sceneFilterIndex >= 0 ? process.argv[sceneFilterIndex + 1] : undefined;
const scenesFilterIndex = process.argv.indexOf("--scenes");
const sceneFilters = new Set([
  ...(sceneFilter ? [sceneFilter] : []),
  ...(scenesFilterIndex >= 0 && process.argv[scenesFilterIndex + 1]
    ? process.argv[scenesFilterIndex + 1].split(",").filter(Boolean)
    : [])
]);
const rules = JSON.parse(fs.readFileSync(path.join(projectRoot, "resources", "scenes", "layer-rules.json"), "utf8"));

function compile(patterns) {
  return (patterns || []).map(pattern => new RegExp(pattern, "i"));
}

function safeId(label) {
  const known = {
    "背景与场景": "background",
    "房间场景": "background",
    "场景背景": "background",
    "舞台背景": "background",
    "家具与寝具": "furniture",
    "食品与餐具": "foodware",
    "体液与水迹": "fluids",
    "液体与痕迹": "fluids",
    "服装与配饰": "clothing",
    "玩具": "toys",
    "武器与装备": "equipment",
    "机械与设备": "devices",
    "自然与生物": "nature",
    "生活与装饰": "decor",
    "主题装饰": "themed-decor",
    "文字与界面": "interface",
    "场景特效": "effects",
    "过场特效": "cutin-effects",
    "人物配件与特效": "effects",
    "摩托车部件": "devices",
    "其他": "other"
  };
  return known[label] || label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";
}

function groupDefaults(id) {
  if (id === "background") return { role: "background", defaultVisible: false };
  if (id === "effects") return { role: "effect", defaultVisible: true };
  if (id === "clothing") return { role: "clothing", defaultVisible: true };
  if (id === "equipment") return { role: "equipment", defaultVisible: true };
  if (id === "interface") return { role: "interface", defaultVisible: true };
  return { role: "prop", defaultVisible: true };
}

function loadSkeletonData(packageRoot, config) {
  const skeletonPath = path.join(packageRoot, config.assets.skeleton);
  const atlasPath = path.join(packageRoot, config.assets.atlas);
  const atlas = new TextureAtlas(fs.readFileSync(atlasPath, "utf8"));
  for (const page of atlas.pages) page.setTexture(new FakeTexture({ width: page.width, height: page.height }));
  const loader = new AtlasAttachmentLoader(atlas);
  if (path.extname(skeletonPath).toLowerCase() === ".json") {
    return new SkeletonJson(loader).readSkeletonData(JSON.parse(fs.readFileSync(skeletonPath, "utf8")));
  }
  return new SkeletonBinary(loader).readSkeletonData(fs.readFileSync(skeletonPath));
}

function classifyScene(sceneId, config, slotNames) {
  const override = rules.sceneOverrides?.[sceneId] || {};
  const internalPatterns = compile([
    ...(rules.internalHiddenPatterns || []),
    ...(override.internalHiddenPatterns || [])
  ]);
  const backgroundPatterns = compile([
    ...(rules.backgroundPatterns || rules.alwaysHiddenPatterns || []),
    ...(override.backgroundPatterns || override.alwaysHiddenPatterns || []),
    ...(config.layers?.alwaysHiddenPatterns || [])
  ]);
  const characterPatterns = compile([
    ...(rules.characterPatterns || []),
    ...(override.characterPatterns || [])
  ]);
  const overrideGroupRules = (override.propGroups || [])
    .map(group => ({ ...group, regex: new RegExp(group.pattern, "i") }));
  const fallbackGroupRules = [
    ...(rules.propGroups || []),
    ...(config.layers?.propGroups || [])
  ].map(group => ({ ...group, regex: new RegExp(group.pattern, "i") }));
  const characterSlots = [];
  const internalSlots = [];
  const groups = new Map();
  const addGroupSlot = (definition, slotName) => {
    const id = definition.id || safeId(definition.label);
    const defaults = groupDefaults(id);
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        label: definition.label,
        role: definition.role || defaults.role,
        defaultVisible: definition.defaultVisible ?? defaults.defaultVisible,
        slots: []
      };
      groups.set(id, group);
    }
    group.slots.push(slotName);
  };
  for (const slotName of slotNames) {
    if (internalPatterns.some(pattern => pattern.test(slotName))) {
      internalSlots.push(slotName);
      continue;
    }
    if (backgroundPatterns.some(pattern => pattern.test(slotName))) {
      addGroupSlot({ id: "background", label: "背景与场景", role: "background", defaultVisible: false }, slotName);
      continue;
    }
    const overrideGroup = overrideGroupRules.find(group => group.regex.test(slotName));
    if (overrideGroup) {
      addGroupSlot(overrideGroup, slotName);
      continue;
    }
    if (characterPatterns.some(pattern => pattern.test(slotName))) {
      characterSlots.push(slotName);
      continue;
    }
    const matched = fallbackGroupRules.find(group => group.regex.test(slotName));
    addGroupSlot(matched || { id: "other", label: "其他", role: "prop", defaultVisible: true }, slotName);
  }
  return {
    format: "asterpet.layers/v1",
    characterSlots,
    internalSlots,
    groups: [...groups.values()].filter(group => group.slots.length > 0),
    defaultPropsVisible: true,
    defaultVisibleSlots: []
  };
}

function auditLayerMetadata(layers, slotNames, label) {
  validateLayerMetadata(layers, label);
  if (layers?.format !== "asterpet.layers/v1") throw new Error(`${label} 缺少标准图层元数据`);
  const knownSlots = new Set(slotNames);
  const owners = new Map();
  const unknown = [];
  const claim = (slotName, owner) => {
    if (!knownSlots.has(slotName)) {
      unknown.push(slotName);
      return;
    }
    const previous = owners.get(slotName);
    if (previous) throw new Error(`${label} 中 slot “${slotName}” 同时属于 ${previous} 和 ${owner}`);
    owners.set(slotName, owner);
  };
  for (const slotName of layers.characterSlots || []) claim(slotName, "characterSlots");
  for (const slotName of layers.internalSlots || []) claim(slotName, "internalSlots");
  for (const group of layers.groups || []) {
    for (const slotName of group.slots || []) claim(slotName, `分组 ${group.id}`);
  }
  for (const group of layers.groups || []) {
    if (!group.pattern) continue;
    const regex = new RegExp(group.pattern, "i");
    for (const slotName of slotNames) {
      if (!owners.has(slotName) && regex.test(slotName)) owners.set(slotName, `分组 ${group.id}`);
    }
  }
  const missing = slotNames.filter(slotName => !owners.has(slotName));
  if (unknown.length > 0 || missing.length > 0) {
    const details = [
      unknown.length > 0 ? `不存在的 slot: ${unknown.slice(0, 10).join(", ")}` : undefined,
      missing.length > 0 ? `未分类 slot: ${missing.slice(0, 10).join(", ")}` : undefined
    ].filter(Boolean).join("；");
    throw new Error(`${label} 不完整（${details}）`);
  }
  return { classified: owners.size };
}

function normalizeActions(config, skeletonData, replaceExisting = false) {
  const names = skeletonData.animations.map(animation => animation.name);
  if (names.length === 0) throw new Error(`场景 ${config.id} 不包含动画`);
  const byLowercase = new Map(names.map(name => [name.toLowerCase(), name]));
  const choose = (current, preferred, fallback) => {
    if (names.includes(current)) return current;
    for (const candidate of preferred) {
      const exactMatch = byLowercase.get(candidate);
      if (exactMatch) return exactMatch;
      const prefixMatch = names.find(name => name.toLowerCase().startsWith(candidate));
      if (prefixMatch) return prefixMatch;
    }
    return fallback;
  };
  const idle = choose(replaceExisting ? undefined : config.actions?.idle?.animation, ["idle", "loop", "animation", "motion", "action"], names[0]);
  const touch = choose(replaceExisting ? undefined : config.actions?.touch?.animation, ["motion", "touch", "action", "smile", "animation", "idle"], idle);
  config.actions = {
    ...(config.actions || {}),
    idle: { ...(config.actions?.idle || {}), animation: idle, loop: true },
    touch: { ...(config.actions?.touch || {}), animation: touch, loop: false }
  };
}

function sceneEntries() {
  const entries = [];
  for (const contentRoot of contentRoots) {
    if (!fs.existsSync(contentRoot)) continue;
    for (const packageName of fs.readdirSync(contentRoot)) {
      const packageRoot = path.join(contentRoot, packageName);
      const manifestPath = path.join(packageRoot, "asterpet.package.json");
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      for (const scene of manifest.scenes || []) {
        entries.push({ packageRoot, scene, configPath: path.join(packageRoot, scene.config) });
      }
    }
  }
  return entries;
}

let migrated = 0;
let failed = 0;
let totalGroups = 0;
let totalOther = 0;
let preserved = 0;
const largestOtherGroups = [];
const otherPrefixes = new Map();
for (const entry of sceneEntries()) {
  try {
    if (sceneFilters.size > 0 && !sceneFilters.has(entry.scene.id)) continue;
    const config = JSON.parse(fs.readFileSync(entry.configPath, "utf8"));
    if (config.type !== "spine") continue;
    const skeletonData = loadSkeletonData(entry.packageRoot, config);
    normalizeActions(config, skeletonData, force);
    const slotNames = skeletonData.slots.map(slot => slot.name);
    if (checkOnly || (config.layers?.format === "asterpet.layers/v1" && !force)) {
      auditLayerMetadata(config.layers, slotNames, `场景 ${entry.scene.id} layers`);
      preserved += 1;
      console.log(`${checkOnly ? "valid" : "preserved"}\t${entry.scene.id}\tslots=${slotNames.length}`);
      continue;
    }
    const layers = classifyScene(entry.scene.id, config, slotNames);
    config.layers = layers;
    totalGroups += layers.groups.length;
    const otherSlots = layers.groups.find(group => group.id === "other")?.slots || [];
    totalOther += otherSlots.length;
    largestOtherGroups.push({ sceneId: entry.scene.id, totalSlots: skeletonData.slots.length, otherSlots });
    for (const slotName of otherSlots) {
      const prefix = slotName.toLowerCase().replace(/^\d+[_-]*/, "").split(/[_\s-]/, 1)[0] || slotName.toLowerCase();
      otherPrefixes.set(prefix, (otherPrefixes.get(prefix) || 0) + 1);
    }
    if (writeChanges) fs.writeFileSync(entry.configPath, `${JSON.stringify(config, null, 2)}\n`);
    migrated += 1;
    console.log(`${writeChanges ? "updated" : "planned"}\t${entry.scene.id}\tslots=${skeletonData.slots.length}\tgroups=${layers.groups.length}\tother=${layers.groups.find(group => group.id === "other")?.slots.length || 0}`);
  } catch (error) {
    failed += 1;
    console.error(`failed\t${entry.scene.id}\t${error.message || error}`);
  }
}

console.log(JSON.stringify({ writeChanges, checkOnly, force, migrated, preserved, failed, totalGroups, totalOther }));
console.log(`largest-other\t${JSON.stringify(largestOtherGroups.sort((left, right) => right.otherSlots.length - left.otherSlots.length).slice(0, 20).map(item => ({ sceneId: item.sceneId, totalSlots: item.totalSlots, otherCount: item.otherSlots.length, sample: item.otherSlots.slice(0, 20) })))}`);
console.log(`other-prefixes\t${JSON.stringify([...otherPrefixes.entries()].sort((left, right) => right[1] - left[1]).slice(0, 80))}`);
if (failed > 0) process.exitCode = 1;
