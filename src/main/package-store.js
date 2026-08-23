const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const extract = require("extract-zip");
const { LAYER_FORMAT, validateLayerMetadata } = require("./layer-metadata");

const PACKAGE_FORMAT = "asterpet.character/v1";
const MANIFEST_NAME = "asterpet.package.json";
const MAX_FILES = 20000;
const MAX_UNPACKED_BYTES = 8 * 1024 * 1024 * 1024;

function safeSegment(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    throw new Error(`${label} 只能包含字母、数字、点、下划线和短横线`);
  }
  return value;
}

function safeRelative(value, label) {
  if (typeof value !== "string" || !value || path.isAbsolute(value)) throw new Error(`${label} 必须是相对路径`);
  const normalized = value.replaceAll("\\", "/");
  if (normalized.split("/").some(part => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} 包含不安全路径`);
  }
  return normalized;
}

function validateManifest(manifest, packageRoot, { validateSceneConfigs = false } = {}) {
  if (!manifest || manifest.format !== PACKAGE_FORMAT) throw new Error(`不支持的人物包格式，应为 ${PACKAGE_FORMAT}`);
  const id = safeSegment(manifest.id, "包 ID");
  if (!Array.isArray(manifest.scenes) || manifest.scenes.length === 0) throw new Error("人物包至少需要一个场景");
  const sceneIds = new Set();
  const scenes = manifest.scenes.map((scene, index) => {
    const sceneId = safeSegment(scene?.id, `场景 ${index + 1} ID`);
    if (sceneIds.has(sceneId)) throw new Error(`场景 ID 重复：${sceneId}`);
    sceneIds.add(sceneId);
    const config = safeRelative(scene.config, `场景 ${sceneId} 配置`);
    if (packageRoot) {
      const configPath = path.join(packageRoot, config);
      if (!fs.existsSync(configPath)) throw new Error(`缺少场景配置：${config}`);
      if (validateSceneConfigs) {
        const sceneConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
        validateLayerMetadata(sceneConfig.layers, `场景 ${sceneId} layers`);
        if (sceneConfig.type === "spine" && sceneConfig.layers?.format !== LAYER_FORMAT) {
          throw new Error(`场景 ${sceneId} 必须由资源包提供 ${LAYER_FORMAT} 图层声明`);
        }
      }
    }
    return { id: sceneId, category: scene.category || "character", config };
  });
  return {
    format: PACKAGE_FORMAT,
    id,
    version: String(manifest.version || "1.0.0"),
    ...(manifest.author ? { author: String(manifest.author) } : {}),
    ...(manifest.license ? { license: String(manifest.license) } : {}),
    ...(manifest.source ? { source: String(manifest.source) } : {}),
    characterId: safeSegment(manifest.characterId || id, "人物 ID"),
    title: String(manifest.title || id).trim() || id,
    scenes
  };
}

function readManifest(packageRoot, allowLegacy = false, options = {}) {
  const manifestPath = path.join(packageRoot, MANIFEST_NAME);
  if (fs.existsSync(manifestPath)) {
    return validateManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")), packageRoot, options);
  }
  if (!allowLegacy) throw new Error(`人物包根目录缺少 ${MANIFEST_NAME}`);
  const legacyPath = path.join(packageRoot, "package.json");
  if (!fs.existsSync(legacyPath)) return undefined;
  const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
  return validateManifest({ format: PACKAGE_FORMAT, version: "legacy", ...legacy }, packageRoot, options);
}

function listPackages(contentRoots) {
  const packages = [];
  const seen = new Set();
  for (const root of contentRoots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packageRoot = path.join(root, entry.name);
      try {
        const manifest = readManifest(packageRoot, true);
        if (!manifest || seen.has(manifest.id)) continue;
        seen.add(manifest.id);
        packages.push({ root: packageRoot, manifest });
      } catch {}
    }
  }
  return packages;
}

function hashDirectory(directory, excludedRelativePaths = new Set()) {
  const digest = crypto.createHash("sha256");
  const visit = (current, relativeRoot = "") => {
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = path.posix.join(relativeRoot, entry.name);
      if (excludedRelativePaths.has(relativePath)) continue;
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        digest.update(relativePath);
        digest.update("\0");
        digest.update(fs.readFileSync(absolutePath));
        digest.update("\0");
      }
    }
  };
  visit(directory);
  return digest.digest("hex");
}

function sceneResourceDigest(packageRoot, scene) {
  const config = safeRelative(scene.config, `场景 ${scene.id} 配置`);
  const sceneRoot = path.dirname(path.join(packageRoot, config));
  const configName = path.basename(config);
  return hashDirectory(sceneRoot, new Set([configName]));
}

function mergePackage(stagingRoot, destination, incomingManifest) {
  const installedManifest = readManifest(destination, true, { validateSceneConfigs: true });
  if (installedManifest.id !== incomingManifest.id || installedManifest.characterId !== incomingManifest.characterId) {
    throw new Error(`包 ${incomingManifest.id} 与已安装人物不匹配，不能增量合并`);
  }

  const installedById = new Map(installedManifest.scenes.map(scene => [scene.id, scene]));
  const installedDigests = new Map(
    installedManifest.scenes.map(scene => [sceneResourceDigest(destination, scene), scene.id])
  );
  const addedScenes = [];
  const skippedScenes = [];
  for (const incomingScene of incomingManifest.scenes) {
    const digest = sceneResourceDigest(stagingRoot, incomingScene);
    const installedScene = installedById.get(incomingScene.id);
    if (installedScene) {
      const installedDigest = sceneResourceDigest(destination, installedScene);
      if (installedDigest !== digest) throw new Error(`场景 ID 冲突但资源不同：${incomingScene.id}`);
      skippedScenes.push({ id: incomingScene.id, duplicateOf: installedScene.id });
      continue;
    }
    const duplicateOf = installedDigests.get(digest);
    if (duplicateOf) {
      skippedScenes.push({ id: incomingScene.id, duplicateOf });
      continue;
    }
    installedDigests.set(digest, incomingScene.id);
    addedScenes.push(incomingScene);
  }

  if (addedScenes.length === 0) {
    return { manifest: installedManifest, destination, addedScenes, skippedScenes, merged: true };
  }

  const mergeRoot = path.join(path.dirname(stagingRoot), `merge-${crypto.randomUUID()}`);
  fs.cpSync(destination, mergeRoot, { recursive: true, errorOnExist: true });
  try {
    for (const scene of addedScenes) {
      const relativeSceneRoot = path.dirname(scene.config);
      const source = path.join(stagingRoot, relativeSceneRoot);
      const target = path.join(mergeRoot, relativeSceneRoot);
      if (fs.existsSync(target)) throw new Error(`新增场景目录冲突：${relativeSceneRoot}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(source, target, { recursive: true, errorOnExist: true });
    }
    const mergedManifest = {
      ...installedManifest,
      version: incomingManifest.version || installedManifest.version,
      scenes: [...installedManifest.scenes, ...addedScenes]
    };
    fs.writeFileSync(
      path.join(mergeRoot, MANIFEST_NAME),
      `${JSON.stringify(mergedManifest, null, 2)}\n`,
      "utf8"
    );
    const validatedManifest = readManifest(mergeRoot, false, { validateSceneConfigs: true });
    return { manifest: validatedManifest, destination, mergeRoot, addedScenes, skippedScenes, merged: true };
  } catch (error) {
    fs.rmSync(mergeRoot, { recursive: true, force: true });
    throw error;
  }
}

function removePackage(packageId, asterPetHome) {
  const id = safeSegment(packageId, "包 ID");
  const contentRoot = path.resolve(asterPetHome, "content");
  const packageRoot = path.resolve(contentRoot, id);
  if (path.dirname(packageRoot) !== contentRoot) throw new Error("不允许删除包存储目录之外的内容");
  if (!fs.existsSync(packageRoot)) throw new Error(`人物包不存在：${id}`);
  const stats = fs.lstatSync(packageRoot);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`人物包目录无效：${id}`);
  const manifest = readManifest(packageRoot, true);
  if (!manifest || manifest.id !== id) throw new Error(`人物包清单与目录不匹配：${id}`);
  fs.rmSync(packageRoot, { recursive: true, force: false });
  return { packageId: id, manifest };
}

async function installPackage(archivePath, asterPetHome) {
  if (path.extname(archivePath).toLowerCase() !== ".asterpet") throw new Error("请选择 .asterpet 人物包");
  const contentRoot = path.join(asterPetHome, "content");
  const stagingRoot = path.join(asterPetHome, ".staging", crypto.randomUUID());
  fs.mkdirSync(stagingRoot, { recursive: true });
  let fileCount = 0;
  let unpackedBytes = 0;
  try {
    await extract(archivePath, {
      dir: stagingRoot,
      onEntry: entry => {
        safeRelative(entry.fileName.replace(/\/$/, ""), "压缩包条目");
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
        if ((unixMode & 0o170000) === 0o120000) throw new Error("人物包不能包含符号链接");
        fileCount += 1;
        unpackedBytes += Number(entry.uncompressedSize) || 0;
        if (fileCount > MAX_FILES) throw new Error(`人物包文件数超过 ${MAX_FILES}`);
        if (unpackedBytes > MAX_UNPACKED_BYTES) throw new Error("人物包解压体积超过 8 GiB");
      }
    });
    const manifest = readManifest(stagingRoot, false, { validateSceneConfigs: true });
    fs.mkdirSync(contentRoot, { recursive: true });
    const destination = path.join(contentRoot, manifest.id);
    const backup = `${destination}.backup-${crypto.randomUUID()}`;
    const mergeResult = fs.existsSync(destination)
      ? mergePackage(stagingRoot, destination, manifest)
      : {
          manifest,
          destination,
          mergeRoot: stagingRoot,
          addedScenes: manifest.scenes,
          skippedScenes: [],
          merged: false
        };
    if (!mergeResult.mergeRoot) return mergeResult;
    if (fs.existsSync(destination)) fs.renameSync(destination, backup);
    try {
      fs.renameSync(mergeResult.mergeRoot, destination);
      if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      if (fs.existsSync(mergeResult.mergeRoot)) fs.rmSync(mergeResult.mergeRoot, { recursive: true, force: true });
      if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
      if (fs.existsSync(backup)) fs.renameSync(backup, destination);
      throw error;
    }
    return { ...mergeResult, destination };
  } finally {
    if (fs.existsSync(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

module.exports = { PACKAGE_FORMAT, MANIFEST_NAME, installPackage, listPackages, removePackage, readManifest, validateManifest };
