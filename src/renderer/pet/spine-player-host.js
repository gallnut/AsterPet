(function registerSpinePlayerHost() {
  class SpinePlayerHost {
    constructor({ spineRuntime, parentId, stableSurface = false, initialSurfaceWidth = 0, initialSurfaceHeight = 0 }) {
      this.spineRuntime = spineRuntime;
      this.parentId = parentId;
      this.stableSurface = stableSurface;
      this.player = undefined;
      this.generation = 0;
      this.view = { zoom: 1, panX: 0, panY: 0 };
      this.contentWidth = 0;
      this.contentHeight = 0;
      this.contentLeft = 0;
      this.contentTop = 0;
      this.surfaceWidth = Math.max(0, Math.round(Number(initialSurfaceWidth) || 0));
      this.surfaceHeight = Math.max(0, Math.round(Number(initialSurfaceHeight) || 0));
      this.surfaceInitialized = this.surfaceWidth > 0 && this.surfaceHeight > 0;
      this.appliedSurfaceWidth = 0;
      this.appliedSurfaceHeight = 0;
      this.appliedViewportWidth = 0;
      this.appliedViewportHeight = 0;
      this.appliedDevicePixelRatio = 0;
    }

    load(config) {
      const generation = ++this.generation;
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = loadedPlayer => {
          if (settled || generation !== this.generation) return;
          this.configureStableSurface(loadedPlayer);
          settled = true;
          resolve(loadedPlayer);
        };
        const fail = reason => {
          if (settled || generation !== this.generation) return;
          settled = true;
          reject(reason instanceof Error ? reason : new Error(String(reason)));
        };
        const playerConfig = {
          ...config,
          success: finish,
          error: (_player, reason) => fail(reason)
        };

        if (!this.player) {
          try {
            this.player = this.createPlayer(playerConfig);
          } catch (error) {
            fail(error);
          }
          return;
        }

        this.reload(playerConfig, generation).catch(fail);
      });
    }

    createPlayer(config) {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function getOptimizedContext(type, attributes) {
        if (type !== "webgl" && type !== "webgl2") return originalGetContext.call(this, type, attributes);
        return originalGetContext.call(this, type, {
          ...attributes,
          alpha: true,
          premultipliedAlpha: true,
          antialias: false,
          depth: false,
          preserveDrawingBuffer: false
        });
      };
      try {
        const player = new this.spineRuntime.SpinePlayer(this.parentId, config);
        if (player.dom) player.dom.style.backgroundColor = "transparent";
        if (player.canvas) player.canvas.style.backgroundColor = "transparent";
        return player;
      } finally {
        HTMLCanvasElement.prototype.getContext = originalGetContext;
      }
    }

    async reload(config, generation) {
      const player = this.player;
      player.stopRendering?.();
      player.pause?.();
      player.assetManager?.dispose();
      player.skeleton = null;
      player.animationState = null;
      player.currentViewport = {};
      player.previousViewport = undefined;
      player.viewport = {};
      player.asterPetLogicalViewport = undefined;
      player.playTime = 0;
      player.selectedBones = [];
      player.error = false;
      player.dom?.querySelector(".spine-player-error")?.remove();
      player.validateConfig(config);
      player.config = config;
      player.bg.setFromString(config.backgroundColor);
      player.bgFullscreen.setFromString(config.fullScreenBackgroundColor);
      if (player.dom) player.dom.style.backgroundColor = "transparent";
      if (player.canvas) player.canvas.style.backgroundColor = "transparent";
      this.clearCanvas();
      player.assetManager = new this.spineRuntime.AssetManager(player.context, "", config.downloader);
      this.loadAssets(player, config);
      await player.assetManager.loadAll();
      if (generation !== this.generation) return;
      player.loadSkeleton();
    }

    loadAssets(player, config) {
      if (config.rawDataURIs) {
        for (const [assetPath, dataUri] of Object.entries(config.rawDataURIs)) {
          player.assetManager.setRawDataURI(assetPath, dataUri);
        }
      }
      if (config.jsonUrl) player.assetManager.loadJson(config.jsonUrl);
      else player.assetManager.loadBinary(config.binaryUrl);
      player.assetManager.loadTextureAtlas(config.atlasUrl);
      if (config.backgroundImage) player.assetManager.loadTexture(config.backgroundImage.url);
    }

    clear({ destroy = false } = {}) {
      this.generation += 1;
      if (!this.player) return;
      this.player.stopRendering?.();
      this.player.pause?.();
      this.player.animationState?.clearTracks?.();
      this.clearCanvas();
      if (destroy) {
        this.release({ destroy: true });
      }
    }

    release({ destroy = false } = {}) {
      if (!this.player) return;
      const gl = this.player.context?.gl;
      if (gl && !gl.isContextLost()) gl.finish();
      this.player.assetManager?.dispose();
      this.player.skeleton = null;
      this.player.animationState = null;
      if (!destroy) return;
      this.player.dispose();
      this.player = undefined;
    }

    setVisible(visible) {
      if (this.player?.dom) this.player.dom.hidden = !visible;
    }

    setContentSize(width, height) {
      this.contentWidth = Math.max(1, Math.round(Number(width) || 1));
      this.contentHeight = Math.max(1, Math.round(Number(height) || 1));
      this.surfaceWidth = Math.max(this.surfaceWidth, this.contentWidth);
      this.surfaceHeight = Math.max(this.surfaceHeight, this.contentHeight);
      this.applyStableSurfaceSize();
      this.applyStableViewport();
    }

    setContentRect(left, top, width, height) {
      this.contentLeft = Math.round(Number(left) || 0);
      this.contentTop = Math.round(Number(top) || 0);
      this.setContentSize(width, height);
    }

    setSurfaceSize(width, height) {
      if (!this.stableSurface) return;
      this.surfaceWidth = Math.max(1, Math.round(Number(width) || 1));
      this.surfaceHeight = Math.max(1, Math.round(Number(height) || 1));
      this.surfaceInitialized = true;
      this.applyStableSurfaceSize();
      this.applyStableRenderSize();
      this.applyStableViewport();
    }

    initializeSurface(width, height) {
      if (!this.stableSurface || this.surfaceInitialized || !this.player) return;
      this.contentWidth = Math.max(1, Math.round(Number(width) || 1));
      this.contentHeight = Math.max(1, Math.round(Number(height) || 1));
      this.surfaceWidth = Math.max(this.surfaceWidth, this.contentWidth);
      this.surfaceHeight = Math.max(this.surfaceHeight, this.contentHeight);
      this.surfaceInitialized = true;
      this.applyStableSurfaceSize();
      this.applyStableViewport();
    }

    configureStableSurface(player) {
      if (player.asterPetStableSurfaceConfigured) return;
      player.asterPetStableSurfaceConfigured = true;
      const originalResize = player.sceneRenderer.resize.bind(player.sceneRenderer);
      player.sceneRenderer.resize = (...args) => {
        if (this.stableSurface) this.applyStableRenderSize();
        else originalResize(...args);
        this.applyStableViewport();
      };
      const originalSetViewport = player.setViewport.bind(player);
      player.setViewport = animation => {
        const result = originalSetViewport(animation);
        player.asterPetLogicalViewport = { ...player.currentViewport };
        this.applyStableViewport();
        return result;
      };
      player.asterPetLogicalViewport = { ...player.currentViewport };
      const parent = document.getElementById(this.parentId);
      this.setContentSize(
        this.contentWidth || parent?.clientWidth || 1,
        this.contentHeight || parent?.clientHeight || 1
      );
    }

    applyStableSurfaceSize() {
      const player = this.player;
      if (!this.stableSurface || !player?.dom || this.surfaceWidth <= 0 || this.surfaceHeight <= 0) return;
      player.dom.style.width = `${this.surfaceWidth}px`;
      player.dom.style.height = `${this.surfaceHeight}px`;
    }

    applyStableRenderSize() {
      const player = this.player;
      if (!this.stableSurface || !player?.canvas || this.surfaceWidth <= 0 || this.surfaceHeight <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      const surfaceWidth = Math.max(1, Math.round(this.surfaceWidth * dpr));
      const surfaceHeight = Math.max(1, Math.round(this.surfaceHeight * dpr));
      const viewportWidth = Math.min(surfaceWidth, Math.max(1, Math.round(this.contentWidth * dpr)));
      const viewportHeight = Math.min(surfaceHeight, Math.max(1, Math.round(this.contentHeight * dpr)));
      const surfaceChanged = surfaceWidth !== this.appliedSurfaceWidth
        || surfaceHeight !== this.appliedSurfaceHeight
        || dpr !== this.appliedDevicePixelRatio;
      const viewportChanged = viewportWidth !== this.appliedViewportWidth
        || viewportHeight !== this.appliedViewportHeight
        || surfaceChanged;
      if (surfaceChanged) {
        player.canvas.width = surfaceWidth;
        player.canvas.height = surfaceHeight;
        this.appliedSurfaceWidth = surfaceWidth;
        this.appliedSurfaceHeight = surfaceHeight;
        this.appliedDevicePixelRatio = dpr;
      }
      if (viewportChanged) {
        const viewportY = Math.max(0, surfaceHeight - viewportHeight);
        player.context.gl.viewport(0, viewportY, viewportWidth, viewportHeight);
        player.sceneRenderer.camera.setViewport(viewportWidth, viewportHeight);
        this.appliedViewportWidth = viewportWidth;
        this.appliedViewportHeight = viewportHeight;
      }
      player.asterPetRenderViewport = {
        x: 0,
        y: 0,
        width: this.contentWidth,
        height: this.contentHeight
      };
      player.asterPetCanvasBounds = {
        left: this.contentLeft,
        top: this.contentTop,
        width: this.surfaceWidth,
        height: this.surfaceHeight
      };
    }

    applyStableViewport() {
      const player = this.player;
      const viewport = player?.asterPetLogicalViewport;
      if (!viewport || !Number.isFinite(viewport.width) || viewport.width <= 0 || viewport.height <= 0) return;
      const contentWidth = this.stableSurface ? this.contentWidth : player.canvas.clientWidth;
      const contentHeight = this.stableSurface ? this.contentHeight : player.canvas.clientHeight;
      if (contentWidth <= 0 || contentHeight <= 0) return;
      const padLeft = Number(viewport.padLeft) || 0;
      const padRight = Number(viewport.padRight) || 0;
      const padTop = Number(viewport.padTop) || 0;
      const padBottom = Number(viewport.padBottom) || 0;
      const width = viewport.width + padLeft + padRight;
      const height = viewport.height + padTop + padBottom;
      const worldUnitsPerPixel = Math.max(width / contentWidth, height / contentHeight) / this.view.zoom;
      const centerX = viewport.x - padLeft + width / 2 - this.view.panX * worldUnitsPerPixel * contentWidth;
      const centerY = viewport.y - padBottom + height / 2 + this.view.panY * worldUnitsPerPixel * contentHeight;
      const surfaceWorldWidth = worldUnitsPerPixel * (this.stableSurface ? this.surfaceWidth : contentWidth);
      const surfaceWorldHeight = worldUnitsPerPixel * (this.stableSurface ? this.surfaceHeight : contentHeight);
      player.currentViewport = {
        x: centerX - surfaceWorldWidth / 2,
        y: centerY - surfaceWorldHeight / 2,
        width: surfaceWorldWidth,
        height: surfaceWorldHeight,
        padLeft: 0,
        padRight: 0,
        padTop: 0,
        padBottom: 0
      };
      player.previousViewport = undefined;
    }

    setView(view) {
      const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
      this.view = {
        zoom: Math.max(0.1, Math.min(10, number(view?.zoom, 1))),
        panX: Math.max(-10, Math.min(10, number(view?.panX, 0))),
        panY: Math.max(-10, Math.min(10, number(view?.panY, 0)))
      };
      this.applyStableViewport();
      return { ...this.view };
    }

    clearCanvas() {
      const gl = this.player?.context?.gl;
      if (!gl || gl.isContextLost()) return;
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.flush();
    }
  }

  window.AsterPet = window.AsterPet || {};
  window.AsterPet.SpinePlayerHost = SpinePlayerHost;
})();
