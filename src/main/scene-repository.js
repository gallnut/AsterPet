const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { installPackage, listPackages, removePackage } = require("./package-store");
const { validateLayerMetadata } = require("./layer-metadata");

class SceneRepository {
  constructor({ projectRoot, asterPetHome, protocol, net, log }) {
    this.projectRoot = projectRoot;
    this.asterPetHome = asterPetHome;
    this.protocol = protocol;
    this.net = net;
    this.log = log;
    this.assetRoots = new Map();
    this.index = undefined;
  }

  registerProtocol() {
    this.protocol.handle("asterpet", request => {
      const url = new URL(request.url);
      if (url.hostname !== "assets") return new Response("Not found", { status: 404 });
      const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      const token = segments.shift();
      const root = this.assetRoots.get(token);
      if (!root || segments.length === 0) return new Response("Not found", { status: 404 });
      const absolutePath = path.resolve(root, ...segments);
      const relative = path.relative(root, absolutePath);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        return new Response("Forbidden", { status: 403 });
      }
      return this.net.fetch(pathToFileURL(absolutePath).href);
    });
  }

  refresh() {
    const contentRoots = [
      path.join(this.asterPetHome, "content"),
      path.join(this.projectRoot, "content")
    ];
    const index = { manifest: { defaultScene: undefined, scenes: {} }, catalog: {}, configs: {}, packages: {} };
    for (const { root: packageDirectory, manifest } of listPackages(contentRoots)) {
      const packageId = manifest.id;
      const source = path.resolve(packageDirectory).startsWith(path.resolve(this.asterPetHome, "content") + path.sep)
        ? "user"
        : "builtin";
      index.packages[packageId] = {
        id: packageId,
        title: manifest.title,
        version: manifest.version,
        author: manifest.author,
        source,
        canDelete: source === "user",
        scenes: manifest.scenes.map(scene => ({ id: scene.id, category: scene.category }))
      };
      for (const scene of manifest.scenes || []) {
        index.manifest.scenes[scene.id] = scene.config;
        index.catalog[scene.id] = {
          characterId: manifest.characterId,
          category: scene.category,
          title: manifest.title,
          packageId
        };
        index.configs[scene.id] = {
          packageDirectory,
          configPath: path.join(packageDirectory, scene.config)
        };
      }
    }
    index.manifest.defaultScene = Object.keys(index.manifest.scenes)[0];
    this.index = index;
    return index;
  }

  getIndex() {
    return this.index || this.refresh();
  }

  getManifest() {
    return this.refresh().manifest;
  }

  getCatalog() {
    return this.getIndex().catalog;
  }

  getPackages() {
    return Object.values(this.getIndex().packages);
  }

  getLayerRules() {
    return JSON.parse(fs.readFileSync(path.join(this.projectRoot, "resources", "scenes", "layer-rules.json"), "utf8"));
  }

  getScene(sceneId) {
    const packageScene = this.getIndex().configs[sceneId];
    if (packageScene) {
      const config = JSON.parse(fs.readFileSync(packageScene.configPath, "utf8"));
      validateLayerMetadata(config.layers, `场景 ${sceneId} layers`);
      this.resolveSceneAssets(config, packageScene.packageDirectory);
      return config;
    }

    const manifestPath = path.join(this.projectRoot, "resources", "scenes", "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const relativePath = manifest.scenes[sceneId];
    if (!relativePath) throw new Error(`Unknown scene: ${sceneId}`);
    return JSON.parse(fs.readFileSync(path.join(this.projectRoot, relativePath), "utf8"));
  }

  async install(archivePath) {
    const installed = await installPackage(archivePath, this.asterPetHome);
    this.refresh();
    this.log(`Imported package ${installed.manifest.id} ${installed.manifest.version}`);
    return installed;
  }

  removePackages(packageIds, activeSceneId) {
    if (!Array.isArray(packageIds) || packageIds.length === 0) {
      return { removed: [], failed: [], packages: this.getPackages() };
    }
    const uniqueIds = [...new Set(packageIds)];
    const removed = [];
    const failed = [];
    for (const packageId of uniqueIds) {
      try {
        const packageInfo = this.getIndex().packages[packageId];
        if (!packageInfo) throw new Error(`人物包不存在：${packageId}`);
        if (!packageInfo.canDelete) throw new Error("内置人物包不能删除");
        if (activeSceneId && packageInfo.scenes.some(scene => scene.id === activeSceneId)) {
          throw new Error("当前场景正在使用此人物包，请先切换场景");
        }
        removePackage(packageId, this.asterPetHome);
        removed.push(packageId);
        this.refresh();
        this.log(`Removed package ${packageId}`);
      } catch (error) {
        failed.push({ packageId, error: error.message || String(error) });
      }
    }
    this.refresh();
    return { removed, failed, packages: this.getPackages() };
  }

  resolveSceneAssets(config, packageDirectory) {
    if (config.type === "image-sequence") {
      for (const frame of config.assets.frames || []) {
        frame.url = this.resolveAsset(packageDirectory, frame.url);
      }
      return;
    }
    config.assets.skeleton = this.resolveAsset(packageDirectory, config.assets.skeleton);
    config.assets.atlas = this.resolveAsset(packageDirectory, config.assets.atlas);
    config.assets.audioTemplate = this.resolveAsset(packageDirectory, config.assets.audioTemplate);
  }

  resolveAsset(packageDirectory, assetPath) {
    if (!assetPath || /^(file:|https?:)/i.test(assetPath)) return assetPath;
    const token = crypto.createHash("sha256").update(packageDirectory).digest("hex").slice(0, 24);
    this.assetRoots.set(token, packageDirectory);
    const encodedPath = assetPath.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/");
    return `asterpet://assets/${token}/${encodedPath}`.replace(/%7B/gi, "{").replace(/%7D/gi, "}");
  }
}

module.exports = { SceneRepository };
