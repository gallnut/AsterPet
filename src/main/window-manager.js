const fs = require("node:fs");
const path = require("node:path");

class WindowManager {
  constructor({ app, BrowserWindow, screen, projectRoot, nativeWayland, waylandBridge, x11Bridge, log }) {
    this.app = app;
    this.BrowserWindow = BrowserWindow;
    this.screen = screen;
    this.projectRoot = projectRoot;
    this.nativeWayland = nativeWayland;
    this.waylandBridge = waylandBridge;
    this.x11Bridge = x11Bridge;
    this.log = log;
    this.petWindow = undefined;
    this.statusWindow = undefined;
    this.popoverWindow = undefined;
    this.dragOrigin = undefined;
    this.visualBounds = undefined;
    this.inputShapeLogged = false;
    this.statusWindowHeight = 150;
    this.petUiScale = 1;
    this.petContentWidth = 520;
    this.petContentHeight = 720;
    this.petSurfaceWidth = this.nativeWayland ? 520 + 380 : 520;
    this.petSurfaceHeight = 720;
    this.embeddedStatusVisible = false;
    this.embeddedStatusBaseWidth = 380;
    this.utilityReserveWidth = 320;
    this.toolbarVisible = false;
    this.toolbarHeight = 122;
    this.currentContext = { state: "idle" };
    this.currentAgentState = { state: "idle" };
    this.activeSceneId = undefined;
    this.currentDialogTheme = undefined;
    this.lastEmbeddedLayoutSignature = "";
    this.sceneCleanupWaiters = new Map();
    this.sceneSwitchPromise = Promise.resolve();
    this.shutdownWaiter = undefined;
  }

  keepVisibleOnWorkspaces(window) {
    if (process.platform === "darwin") {
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      window.setFullScreenable(false);
    } else if (process.platform === "linux" && !this.nativeWayland) {
      window.setVisibleOnAllWorkspaces(true);
    }
  }

  watchWorkspaceVisibility() {
    if (process.platform !== "linux" || this.nativeWayland || !this.x11Bridge?.watchWorkspaceChanges) return;
    const watching = this.x11Bridge.watchWorkspaceChanges(() => {
      if (this.shuttingDown) return;
      // GNOME gesture effects/extensions can hide the compositor actor while
      // the X11 window still reports visible. Remap after the gesture settles.
      clearTimeout(this.workspaceRestoreTimer);
      this.workspaceRestoreTimer = setTimeout(() => {
        this.workspaceRestoreTimer = undefined;
        if (this.shuttingDown) return;
        this.refreshVisibleWindows();
      }, 350);
    });
    this.log(`Native workspace visibility watcher: ${watching ? "ready" : "unavailable"}`);
  }

  refreshVisibleWindows() {
    const visible = [this.petWindow, this.statusWindow, this.popoverWindow]
      .filter(window => window && !window.isDestroyed() && !window.isMinimized() && window.isVisible());
    for (const window of visible) this.remapWindow(window);
  }

  remapWindow(window) {
    if (process.platform === "linux" && !this.nativeWayland) window.hide();
    this.keepVisibleOnWorkspaces(window);
    window.showInactive();
    window.moveTop();
    window.webContents.invalidate();
  }

  showPet() {
    const window = this.petWindow;
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    this.remapWindow(window);
    window.focus();
    this.positionStatusWindow();
    this.log("Pet window recalled");
  }

  create() {
    this.log("Creating window");
    this.petWindow = new this.BrowserWindow({
      width: this.petSurfaceWidth,
      height: this.petSurfaceHeight,
      transparent: true,
      backgroundColor: "#00000000",
      frame: false,
      resizable: false,
      ...(process.platform === "linux" && !this.nativeWayland ? { type: "dock" } : {}),
      ...(process.platform === "darwin" ? { type: "panel", enableLargerThanScreen: true } : {}),
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: { preload: path.join(this.projectRoot, "src", "preload", "index.js") }
    });
    this.petWindow.setBackgroundColor("#00000000");
    this.petWindow.setAlwaysOnTop(true, "screen-saver");
    this.keepVisibleOnWorkspaces(this.petWindow);

    if (!this.nativeWayland) this.createStatusWindows();
    this.bindPetWindowEvents();
    this.loadPetWindow();
    this.watchWorkspaceVisibility();
  }

  createStatusWindows() {
    this.statusWindow = new this.BrowserWindow({
      parent: this.petWindow,
      width: 320,
      height: 150,
      transparent: true,
      backgroundColor: "#00000000",
      frame: false,
      resizable: false,
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: { preload: path.join(this.projectRoot, "src", "preload", "index.js") }
    });
    this.statusWindow.setBackgroundColor("#00000000");
    this.statusWindow.setAlwaysOnTop(true, "screen-saver");
    this.keepVisibleOnWorkspaces(this.statusWindow);
    this.statusWindow.loadFile(path.join(this.projectRoot, "src", "renderer", "status", "index.html"));
    this.statusWindow.webContents.on("did-finish-load", () => {
      this.publishContext(this.currentContext);
      this.statusWindow?.webContents.send("pet:status-scale", this.petUiScale);
      this.statusWindow?.webContents.send("pet:dialog-theme-changed", this.currentDialogTheme);
    });

    this.popoverWindow = new this.BrowserWindow({
      parent: this.statusWindow,
      width: 240,
      height: 120,
      transparent: true,
      backgroundColor: "#00000000",
      frame: false,
      resizable: false,
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: { preload: path.join(this.projectRoot, "src", "preload", "index.js") }
    });
    this.popoverWindow.setBackgroundColor("#00000000");
    this.popoverWindow.setAlwaysOnTop(true, "screen-saver");
    this.keepVisibleOnWorkspaces(this.popoverWindow);
    this.popoverWindow.loadFile(path.join(this.projectRoot, "src", "renderer", "popover", "index.html"));
    this.popoverWindow.on("blur", () => this.popoverWindow?.hide());
  }

  bindPetWindowEvents() {
    this.petWindow.on("move", () => this.positionStatusWindow());
    this.petWindow.on("resize", () => this.positionStatusWindow());
    this.petWindow.webContents.on("console-message", details => {
      this.log(`[renderer:${details.level}] ${details.message}`);
    });
    this.petWindow.webContents.on("did-fail-load", (_event, code, description) => {
      console.error(`Page load failed (${code}): ${description}`);
    });
    this.petWindow.webContents.on("did-finish-load", () => {
      this.lastEmbeddedLayoutSignature = "";
      this.sendAgentState(this.currentAgentState);
      this.publishContext(this.currentContext);
      this.petWindow?.webContents.send("pet:dialog-theme-changed", this.currentDialogTheme);
    });
    this.petWindow.webContents.on("enter-html-full-screen", event => {
      event.preventDefault();
      this.petWindow.setFullScreen(false);
    });
  }

  loadPetWindow() {
    const options = process.env.PET_TEST === "1" ? {
      query: {
        testControls: "1",
        ...(process.env.PET_START_SCENE ? { scene: process.env.PET_START_SCENE } : {})
      }
    } : undefined;
    this.petWindow.loadFile(path.join(this.projectRoot, "src", "renderer", "pet", "index.html"), options);
    this.log("Requested pet renderer");
    if (process.env.PET_TEST === "1") this.scheduleTestHarness();
  }

  scheduleTestHarness() {
    this.petWindow.webContents.once("did-finish-load", () => {
      this.log("Page finished loading");
      if (process.env.PET_SWITCH_TEST === "1") {
        const targets = (process.env.PET_SWITCH_TARGETS || process.env.PET_SWITCH_TARGET || "")
          .split(",").map(target => target.trim()).filter(Boolean);
        targets.forEach((target, index) => {
          setTimeout(() => {
            this.switchScene(target).catch(error => this.log(`Switch test failed: ${error.stack || error}`));
          }, 900 + index * 850);
        });
      }
      if (process.env.PET_DUMP_SLOTS === "1") {
        setTimeout(() => {
          this.petWindow.webContents.executeJavaScript(`
            window.desktopPet.log("Slots: " + JSON.stringify(
              player.skeleton.slots.map(slot => ({ slot: slot.data.name, attachment: slot.attachment?.name || null }))
            ));
          `).catch(error => this.log(`Slot dump failed: ${error.stack || error}`));
        }, 1500);
      }
      if (process.env.PET_LAUNCHER_TEST === "1") {
        setTimeout(() => {
          this.petWindow.webContents.executeJavaScript(`document.getElementById("chat-toggle").click()`)
            .catch(error => this.log(`Launcher test failed: ${error.stack || error}`));
        }, 1000);
      }
      if (process.env.PET_INTERACTION_TEST === "1") {
        setTimeout(() => {
          this.petWindow.webContents.executeJavaScript(`
            (() => {
              const rect = geometryInput.cachedPetRects.reduce((largest, candidate) =>
                !largest || candidate.width * candidate.height > largest.width * largest.height ? candidate : largest, null);
              if (!rect) throw new Error("No pet input rectangle available");
              const clientX = rect.x + rect.width / 2;
              const clientY = rect.y + rect.height / 2;
              playerElement.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX, clientY }));
              playerElement.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX, clientY, deltaY: -100 }));
            })();
          `).catch(error => this.log(`Interaction test failed: ${error.stack || error}`));
        }, 1400);
      }
      if (process.env.PET_PROPS_TEST === "1") {
        setTimeout(() => {
          this.petWindow.webContents.executeJavaScript(`
            document.body.classList.add("tools-visible");
            document.getElementById("props-toggle").click();
          `).catch(error => this.log(`Props panel test failed: ${error.stack || error}`));
        }, 1400);
      }
      if (process.env.PET_HIDE_PROP_GROUP) {
        setTimeout(() => {
          const label = JSON.stringify(process.env.PET_HIDE_PROP_GROUP);
          this.petWindow.webContents.executeJavaScript(`
            new Promise((resolve, reject) => {
              const deadline = performance.now() + 2500;
              const selectGroup = () => {
                const section = [...document.querySelectorAll(".prop-group")]
                  .find(candidate => candidate.querySelector(".prop-group-header span")?.textContent.startsWith(${label}));
                const checkbox = section?.querySelector(".prop-group-header input");
                if (checkbox) {
                  checkbox.checked = false;
                  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
                  resolve();
                } else if (performance.now() >= deadline) {
                  reject(new Error("Prop group not found: " + ${label}));
                } else {
                  requestAnimationFrame(selectGroup);
                }
              };
              selectGroup();
            });
          `).catch(error => this.log(`Prop group test failed: ${error.stack || error}`));
        }, 900);
      }
      if (process.env.PET_LAUNCHER_TEST === "1") {
        setTimeout(() => {
          this.petWindow.webContents.executeJavaScript(`
            (() => {
              const frame = document.getElementById("embedded-status");
              const card = frame?.contentDocument?.getElementById("card");
              const rect = frame?.getBoundingClientRect();
              return {
                hidden: frame?.hidden,
                frame: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                card: card ? { text: card.innerText.slice(0, 160), height: card.scrollHeight } : null,
                bodyClass: frame?.contentDocument?.body?.className || ""
              };
            })();
          `).then(snapshot => this.log(`Launcher visual state: ${JSON.stringify(snapshot)}`))
            .catch(error => this.log(`Launcher visual inspection failed: ${error.stack || error}`));
        }, 3200);
      }
      const switchTestDuration = process.env.PET_SWITCH_TEST === "1"
        ? (process.env.PET_SWITCH_TARGETS || process.env.PET_SWITCH_TARGET || "").split(",").filter(target => target.trim()).length * 850
        : 0;
      const testHoldDuration = Math.max(0, Number(process.env.PET_TEST_HOLD_MS) || 0);
      setTimeout(async () => {
        let image = await this.petWindow.capturePage();
        const screenshotPath = path.join(this.app.getPath("temp"), "asterpet-test-screenshot.png");
        fs.writeFileSync(screenshotPath, image.toPNG());
        image = undefined;
        if (this.statusWindow?.isVisible()) {
          let statusImage = await this.statusWindow.capturePage();
          fs.writeFileSync(path.join(this.app.getPath("temp"), "asterpet-test-status-screenshot.png"), statusImage.toPNG());
          statusImage = undefined;
        }
        if (this.waylandBridge?.debugState) {
          this.log(`Native Wayland bridge state: ${JSON.stringify(this.waylandBridge.debugState())}`);
        }
        this.log(`Saved test screenshot: ${screenshotPath}`);
        await this.petWindow.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
          .catch(() => undefined);
        await new Promise(resolve => setTimeout(resolve, 750));
        this.app.quit();
      }, Math.max(5000, 1800 + switchTestDuration + testHoldDuration));
    });
  }

  sendAgentState(state) {
    this.currentAgentState = state;
    this.petWindow?.webContents.send("pet:agent-state", state);
  }

  playAction(action) {
    if (!this.petWindow || this.petWindow.isDestroyed() || this.petWindow.webContents.isDestroyed()) return false;
    this.petWindow.webContents.send("pet:play-action", action);
    return true;
  }

  applyDialogTheme(theme) {
    this.currentDialogTheme = theme;
    for (const window of [this.petWindow, this.statusWindow, this.popoverWindow]) {
      if (window && !window.isDestroyed()) window.webContents.send("pet:dialog-theme-changed", theme);
    }
  }

  minimize() {
    this.petWindow?.minimize();
  }

  invalidate() {
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    this.petWindow.webContents.invalidate();
  }

  configure(title) {
    this.petWindow?.setTitle(title);
  }

  publishContext(context) {
    this.currentContext = context;
    this.petWindow?.webContents.send("pet:agent-context", context);
    this.statusWindow?.webContents.send("pet:agent-context", context);
    const visible = context.state !== "idle" || Boolean(context.interaction);
    if (this.nativeWayland) {
      this.embeddedStatusVisible = visible;
      this.syncEmbeddedStatusWindow();
    } else if (!visible) {
      this.statusWindow?.hide();
    } else {
      this.positionStatusWindow();
      this.statusWindow?.showInactive();
      this.statusWindow?.moveTop();
    }
  }

  statusWindowWidth() {
    const interaction = this.currentContext.interaction;
    const baseWidth = interaction?.kind?.startsWith("launcher")
      ? 380
      : interaction
        ? 300
        : 270;
    return Math.round(baseWidth * this.petUiScale);
  }

  statusWindowHeightLimit() {
    return Math.round(320 * this.petUiScale);
  }

  getEmbeddedLayout() {
    const reserveWidth = Math.round(this.embeddedStatusBaseWidth * this.petUiScale);
    const width = this.statusWindowWidth();
    const height = Math.max(Math.round(74 * this.petUiScale), Math.min(this.statusWindowHeightLimit(), this.statusWindowHeight));
    const windowHeight = this.petContentHeight + (this.toolbarVisible ? this.toolbarHeight : 0);
    const petTop = 0;
    const visibleTop = Number.isFinite(this.visualBounds?.top) ? this.visualBounds.top : petTop;
    const visibleBottom = Number.isFinite(this.visualBounds?.bottom) ? this.visualBounds.bottom : this.petContentHeight;
    const visibleLeft = Number.isFinite(this.visualBounds?.left) ? this.visualBounds.left : reserveWidth;
    const attachmentX = Math.max(width, Math.min(reserveWidth + this.petContentWidth, Math.round(visibleLeft + 2 * this.petUiScale)));
    const preferredTop = visibleTop + Math.max(0, visibleBottom - visibleTop) * 0.18;
    const top = Math.max(0, Math.min(windowHeight - height, Math.round(preferredTop)));
    return {
      visible: this.embeddedStatusVisible,
      reserveWidth,
      width,
      height,
      left: attachmentX - width,
      top,
      petWidth: this.petContentWidth,
      petHeight: this.petContentHeight,
      windowWidth: reserveWidth + this.petContentWidth,
      windowHeight
    };
  }

  syncEmbeddedStatusWindow() {
    if (!this.nativeWayland || !this.petWindow || this.petWindow.isDestroyed()) return;
    const layout = this.getEmbeddedLayout();
    const current = this.petWindow.getBounds();
    this.petSurfaceWidth = Math.max(1, Math.round(layout.windowWidth));
    this.petSurfaceHeight = Math.max(1, Math.round(layout.windowHeight));
    if (current.width !== this.petSurfaceWidth || current.height !== this.petSurfaceHeight) {
      this.petWindow.setBounds({
        x: current.x,
        y: current.y,
        width: this.petSurfaceWidth,
        height: this.petSurfaceHeight
      }, false);
    }
    if (!this.petWindow.webContents.isDestroyed()) {
      const payload = {
        ...layout,
        windowWidth: this.petSurfaceWidth,
        windowHeight: this.petSurfaceHeight
      };
      const signature = JSON.stringify(payload);
      if (signature !== this.lastEmbeddedLayoutSignature) {
        this.lastEmbeddedLayoutSignature = signature;
        this.petWindow.webContents.send("pet:embedded-status-layout", payload);
        this.petWindow.webContents.send("pet:status-side", "right");
        this.petWindow.webContents.send("pet:status-scale", this.petUiScale);
      }
    }
  }

  positionStatusWindow() {
    if (!this.petWindow) return;
    if (this.nativeWayland) {
      this.syncEmbeddedStatusWindow();
      return;
    }
    if (!this.statusWindow) return;
    this.popoverWindow?.hide();
    const width = this.statusWindowWidth();
    const height = Math.max(Math.round(74 * this.petUiScale), Math.min(this.statusWindowHeightLimit(), this.statusWindowHeight));
    const petBounds = this.petWindow.getBounds();
    const visible = this.visualBounds || { left: petBounds.width * 0.2, top: 0, right: petBounds.width * 0.8, bottom: petBounds.height * 0.85 };
    const visibleLeft = petBounds.x + visible.left;
    const visibleRight = petBounds.x + visible.right;
    const visibleTop = petBounds.y + visible.top;
    const visibleBottom = petBounds.y + visible.bottom;
    const display = this.screen.getDisplayMatching(petBounds).workArea;
    const leftSpace = visibleLeft - display.x;
    const rightSpace = display.x + display.width - visibleRight;
    const overlap = Math.round(5 * this.petUiScale);
    const side = rightSpace >= leftSpace ? "left" : "right";
    let x = side === "right" ? visibleLeft - width + overlap : visibleRight - overlap;
    let y = visibleTop + Math.round((visibleBottom - visibleTop) * 0.18);
    if (y + height > display.y + display.height) y = visibleBottom - height - Math.round(16 * this.petUiScale);
    x = Math.max(display.x, Math.min(display.x + display.width - width, x));
    y = Math.max(display.y, Math.min(display.y + display.height - height, y));
    this.statusWindow.setBounds({ x: Math.round(x), y: Math.round(y), width, height }, false);
    if (this.statusWindow.isVisible()) this.statusWindow.moveTop();
    this.statusWindow.webContents.send("pet:status-side", side);
  }

  resizeStatus(height) {
    const targetHeight = Math.max(Math.round(74 * this.petUiScale), Math.min(this.statusWindowHeightLimit(), Math.ceil(Number(height) || 74)));
    this.statusWindowHeight = targetHeight;
    if (this.nativeWayland) {
      this.syncEmbeddedStatusWindow();
      return;
    }
    if (!this.statusWindow) return;
    const current = this.statusWindow.getBounds();
    const width = this.statusWindowWidth();
    if (current.width !== width || current.height !== targetHeight) this.statusWindow.setSize(width, targetHeight, false);
    this.positionStatusWindow();
  }

  resizePet(settings) {
    if (!this.petWindow) return;
    this.petUiScale = Math.max(0.65, Math.min(1.15, Number(settings.scale) || 1));
    this.petContentWidth = Math.max(settings.minActualWidth ?? 0, Math.round(settings.baseWidth * settings.scale));
    this.petContentHeight = Math.round(settings.baseHeight * settings.scale);
    if (this.nativeWayland) {
      this.syncEmbeddedStatusWindow();
      return;
    }
    const current = this.petWindow.getBounds();
    const reserveWidth = this.toolbarVisible ? this.utilityReserveWidth : 0;
    const desiredWidth = this.petContentWidth + reserveWidth;
    const desiredHeight = this.petContentHeight + (this.toolbarVisible ? this.toolbarHeight : 0);
    const desiredX = Math.round(current.x + (current.width - reserveWidth - this.petContentWidth) / 2);
    const desiredY = current.y + current.height - desiredHeight;
    this.petWindow.setBounds({
      x: desiredX,
      y: desiredY,
      width: desiredWidth,
      height: desiredHeight
    }, false);
    this.statusWindow?.webContents.send("pet:status-scale", this.petUiScale);
    this.positionStatusWindow();
  }

  syncToolsWindow() {
    if (this.nativeWayland || !this.petWindow || this.petWindow.isDestroyed()) return;
    const current = this.petWindow.getBounds();
    const width = this.petContentWidth + (this.toolbarVisible ? this.utilityReserveWidth : 0);
    const height = this.petContentHeight + (this.toolbarVisible ? this.toolbarHeight : 0);
    if (current.width === width && current.height === height) return;
    this.petWindow.setBounds({
      x: current.x + current.width - width,
      y: current.y,
      width,
      height
    }, false);
    this.positionStatusWindow();
  }

  setToolbarVisible(visible) {
    const next = Boolean(visible);
    if (this.toolbarVisible === next) return;
    this.toolbarVisible = next;
    this.syncEmbeddedStatusWindow();
    this.syncToolsWindow();
  }

  completeShutdown() {
    this.log("Renderer shutdown cleanup ready");
    this.shutdownWaiter?.();
  }

  closeWindowAndWait(window, label) {
    if (!window || window.isDestroyed()) return Promise.resolve();
    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        this.log(`Window close timed out: ${label}`);
        if (!window.isDestroyed()) window.destroy();
        finish();
      }, 3000);
      window.once("closed", finish);
      window.close();
      if (window.isDestroyed()) finish();
    });
  }

  async shutdown() {
    this.shuttingDown = true;
    clearTimeout(this.workspaceRestoreTimer);
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    await new Promise(resolve => {
      const timeout = setTimeout(() => {
        this.log("Renderer shutdown cleanup timed out");
        this.shutdownWaiter = undefined;
        resolve();
      }, 2000);
      this.shutdownWaiter = () => {
        clearTimeout(timeout);
        this.shutdownWaiter = undefined;
        resolve();
      };
      this.log("Requested renderer shutdown cleanup");
      this.petWindow.webContents.send("pet:prepare-shutdown");
    });
    await this.closeWindowAndWait(this.popoverWindow, "popover");
    await this.closeWindowAndWait(this.statusWindow, "status");
    await this.closeWindowAndWait(this.petWindow, "pet");
    this.popoverWindow = undefined;
    this.statusWindow = undefined;
    this.petWindow = undefined;
    this.log("Closed application windows after renderer cleanup");
  }

  setVisualBounds(bounds) {
    if (!bounds || ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite)) return;
    this.visualBounds = bounds;
    this.positionStatusWindow();
  }

  startDrag(pointer) {
    if (!this.petWindow) return;
    if (this.nativeWayland) {
      const started = Boolean(this.waylandBridge?.beginMove());
      this.log(`Native Wayland drag ${started ? "started" : "unavailable"}`);
      if (!started && this.waylandBridge?.debugState) {
        this.log(`Native Wayland drag state: ${JSON.stringify(this.waylandBridge.debugState())}`);
      }
      return;
    }
    const bounds = this.petWindow.getBounds();
    this.dragOrigin = {
      relative: Boolean(pointer?.relative),
      pointerX: Number(pointer?.x) || 0,
      pointerY: Number(pointer?.y) || 0,
      windowX: bounds.x,
      windowY: bounds.y,
      width: bounds.width,
      height: bounds.height
    };
    this.log(`Drag start; bounds=${JSON.stringify(bounds)}`);
  }

  moveDrag(pointer) {
    if (this.nativeWayland || !this.petWindow || !this.dragOrigin) return;
    const x = this.dragOrigin.relative
      ? this.dragOrigin.windowX + Number(pointer?.deltaX)
      : this.dragOrigin.windowX + Number(pointer?.x) - this.dragOrigin.pointerX;
    const y = this.dragOrigin.relative
      ? this.dragOrigin.windowY + Number(pointer?.deltaY)
      : this.dragOrigin.windowY + Number(pointer?.y) - this.dragOrigin.pointerY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const displays = this.screen.getAllDisplays().map(display => display.workArea);
    const minimumX = Math.min(...displays.map(display => display.x)) - this.dragOrigin.width + 48;
    const maximumX = Math.max(...displays.map(display => display.x + display.width)) - 48;
    const minimumY = Math.min(...displays.map(display => display.y)) - this.dragOrigin.height + 48;
    const maximumY = Math.max(...displays.map(display => display.y + display.height)) - 48;
    this.petWindow.setBounds({
      x: Math.round(Math.max(minimumX, Math.min(maximumX, x))),
      y: Math.round(Math.max(minimumY, Math.min(maximumY, y))),
      width: this.dragOrigin.width,
      height: this.dragOrigin.height
    }, false);
    this.positionStatusWindow();
  }

  endDrag() {
    if (this.petWindow) this.log(`Drag end; bounds=${JSON.stringify(this.petWindow.getBounds())}`);
    this.dragOrigin = undefined;
  }

  setMousePassthrough(enabled) {
    if (!this.petWindow) return;
    if (process.platform === "linux") {
      // Linux has no forwarding while ignored. Native input regions preserve
      // events on the pet without toggling the entire window off and on.
      return;
    }
    this.petWindow.setIgnoreMouseEvents(enabled, { forward: true });
  }

  setInputShape(inputShape) {
    if (!this.petWindow || (!this.nativeWayland && !this.x11Bridge) || !inputShape || !Array.isArray(inputShape.rects)) return;
    const bounds = this.petWindow.getContentBounds();
    const normalize = inputRects => inputRects.map(rect => {
      const x = Math.max(0, Math.min(bounds.width - 1, Math.round(Number(rect?.x) || 0)));
      const y = Math.max(0, Math.min(bounds.height - 1, Math.round(Number(rect?.y) || 0)));
      return {
        x,
        y,
        width: Math.max(1, Math.min(bounds.width - x, Math.round(Number(rect?.width) || 0))),
        height: Math.max(1, Math.min(bounds.height - y, Math.round(Number(rect?.height) || 0)))
      };
    });
    const rawPetRects = Array.isArray(inputShape.petRects) ? inputShape.petRects : inputShape.rects;
    const rawControlRects = Array.isArray(inputShape.controlRects) ? inputShape.controlRects : [];
    const rects = [...normalize(rawPetRects.slice(0, 2048)), ...normalize(rawControlRects)];
    if (rects.length === 0) return;
    try {
      if (!this.nativeWayland) {
        const applied = this.x11Bridge.setInputRegion(this.petWindow.getNativeWindowHandle(), rects);
        if (!applied) throw new Error("X11 input region unavailable");
        if (!this.inputShapeLogged) {
          this.inputShapeLogged = true;
          this.log(`X11 native input region applied with ${rawPetRects.length} pet rectangles and ${rawControlRects.length} control rectangles`);
        }
        return;
      }
      const rawEnabled = process.env.ASTERPET_DISABLE_RAW_INPUT_REGION !== "1";
      const nativeApplied = Boolean(rawEnabled && this.waylandBridge?.setInputRegion?.(rects));
      if (!nativeApplied) this.petWindow.setShape(rects);
      if (!this.inputShapeLogged && rawPetRects.length > 0) {
        this.inputShapeLogged = true;
        this.log(`Native input region ${nativeApplied ? "applied" : "fell back to setShape"} with ${rawPetRects.length} pet rectangles and ${rawControlRects.length} control rectangles`);
        setTimeout(() => {
          if (this.waylandBridge?.debugState) this.log(`Wayland input region state: ${JSON.stringify(this.waylandBridge.debugState())}`);
        }, 500);
      }
    } catch (error) {
      this.log(`Unable to set native input shape: ${error.stack || error}`);
    }
  }

  requestWindowMenu() {
    const opened = Boolean(this.nativeWayland && this.waylandBridge?.requestWindowMenu?.());
    this.log(`Native Wayland window menu ${opened ? "requested" : "unavailable"}`);
    return opened;
  }

  openPopover(payload) {
    if (!this.popoverWindow || !payload?.items?.length) return;
    const scale = Math.max(0.65, Math.min(1.15, Number(payload.scale) || 1));
    const width = Math.max(Math.round(90 * scale), Math.min(Math.round(300 * scale), Math.ceil(payload.width || 220 * scale)));
    const height = Math.min(Math.round(190 * scale), Math.round(payload.items.length * 34 * scale + 12 * scale));
    const display = this.screen.getDisplayNearestPoint({ x: payload.x, y: payload.y }).workArea;
    const x = Math.max(display.x + 4, Math.min(payload.x, display.x + display.width - width - 4));
    let y = payload.placement === "below" ? payload.y + payload.height + 6 : payload.y - height - 6;
    y = Math.max(display.y + 4, Math.min(y, display.y + display.height - height - 4));
    this.popoverWindow.setBounds({ x: Math.round(x), y: Math.round(y), width, height }, false);
    this.popoverWindow.webContents.send("pet:dialog-theme-changed", this.currentDialogTheme);
    this.popoverWindow.webContents.send("pet:popover-data", { selectId: payload.selectId, items: payload.items, scale });
    this.popoverWindow.show();
    this.popoverWindow.moveTop();
  }

  closePopover() {
    this.popoverWindow?.hide();
  }

  selectPopoverItem(payload) {
    this.statusWindow?.webContents.send("pet:popover-selected", payload);
    this.popoverWindow?.hide();
  }

  completeSceneCleanup(requestId, result) {
    const resolve = this.sceneCleanupWaiters.get(requestId);
    if (!resolve) return;
    this.sceneCleanupWaiters.delete(requestId);
    resolve(result);
  }

  setActiveScene(sceneId) {
    this.activeSceneId = typeof sceneId === "string" ? sceneId : undefined;
  }

  requestSceneSwitch(sceneId) {
    if (!this.petWindow || this.petWindow.webContents.isDestroyed()) return Promise.resolve({ ok: false, error: "window-unavailable" });
    const requestId = `scene-cleanup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        this.sceneCleanupWaiters.delete(requestId);
        resolve({ ok: false, error: "renderer-timeout" });
      }, 15000);
      this.sceneCleanupWaiters.set(requestId, result => {
        clearTimeout(timeout);
        resolve(result);
      });
      this.petWindow.webContents.send("pet:prepare-scene-switch", requestId, sceneId);
    });
  }

  switchScene(sceneId) {
    this.sceneSwitchPromise = this.sceneSwitchPromise.then(() => this.performSceneSwitch(sceneId));
    return this.sceneSwitchPromise;
  }

  async performSceneSwitch(sceneId) {
    if (!this.petWindow) return { ok: false, error: "window-unavailable" };
    this.log(`Switch scene requested: ${sceneId}`);
    const result = await this.requestSceneSwitch(sceneId);
    if (!result?.ok) {
      this.log(`Switch scene failed: ${result?.error || "unknown renderer error"}`);
      return result || { ok: false, error: "unknown-renderer-error" };
    }
    this.visualBounds = undefined;
    this.inputShapeLogged = false;
    this.petWindow.setIgnoreMouseEvents(false);
    (this.nativeWayland ? this.petWindow : this.statusWindow)?.webContents.send("pet:reset-status-view");
    this.log(`Switch scene loaded in renderer: ${sceneId}`);
    return result;
  }

  getStatusSnapshot() {
    return {
      petBounds: this.petWindow?.getBounds(),
      visualBounds: this.visualBounds,
      statusBounds: this.nativeWayland ? this.getEmbeddedLayout() : this.statusWindow?.getBounds(),
      statusVisible: this.nativeWayland ? this.embeddedStatusVisible : this.statusWindow?.isVisible() || false,
      embeddedStatus: this.nativeWayland
    };
  }
}

module.exports = { WindowManager };
