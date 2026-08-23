(function registerPetInteractionController() {
  class PetInteractionController {
    constructor({ desktopPet, element, geometryInput, getScene, getScale, getToolsVisible, setToolsVisible, playAction, changeScale, log }) {
      this.desktopPet = desktopPet;
      this.element = element;
      this.geometryInput = geometryInput;
      this.getScene = getScene;
      this.getScale = getScale;
      this.getToolsVisible = getToolsVisible;
      this.setToolsVisible = setToolsVisible;
      this.playAction = playAction;
      this.changeScale = changeScale;
      this.log = log;
      this.pointerStart = undefined;
      this.pointerWasDragged = false;
      this.touchTimer = undefined;
      this.clickCycleScene = undefined;
      this.clickCycleIndex = 0;
      this.mousePassthrough = false;
      this.lastHitTestTime = 0;
      this.listeners = [];
    }

    setMousePassthrough(enabled) {
      const next = Boolean(enabled && !this.getToolsVisible());
      if (this.mousePassthrough === next) return;
      this.mousePassthrough = next;
      this.desktopPet.setMousePassthrough(next);
    }

    isPetPoint(event) {
      return this.geometryInput.isOpaquePoint(event.clientX, event.clientY);
    }

    updateMousePassthrough(event) {
      if (this.pointerStart) {
        this.setMousePassthrough(false);
        return;
      }
      const now = performance.now();
      if (now - this.lastHitTestTime < 24) return;
      this.lastHitTestTime = now;
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const overControls = Boolean(element?.closest("#toolbar, #props-panel, #scene-panel, #packages-panel, #ai-panel"));
      this.setMousePassthrough(!overControls && !this.isPetPoint(event));
    }

    beginDrag(event) {
      if (event.button !== 0 || !this.isPetPoint(event)) return;
      event.preventDefault();
      event.stopPropagation();
      this.pointerStart = { x: event.screenX, y: event.screenY };
      this.pointerWasDragged = false;
      this.setMousePassthrough(false);
      if (!this.desktopPet.nativeWayland) this.element.setPointerCapture(event.pointerId);
      this.desktopPet.dragStart({ x: event.screenX, y: event.screenY });
    }

    moveDrag(event) {
      if (!this.pointerStart) return;
      const distance = Math.hypot(event.screenX - this.pointerStart.x, event.screenY - this.pointerStart.y);
      if (distance < this.getScene().gestures.dragThreshold) return;
      this.pointerWasDragged = true;
      if (this.desktopPet.nativeWayland) return;
      event.preventDefault();
      event.stopPropagation();
      this.desktopPet.dragMove({ x: event.screenX, y: event.screenY });
    }

    endDrag(event) {
      event?.stopPropagation();
      this.pointerStart = undefined;
      if (!this.desktopPet.nativeWayland) this.desktopPet.dragEnd();
    }

    handleClick(event) {
      if (!this.isPetPoint(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (this.pointerWasDragged) {
        this.pointerWasDragged = false;
        return;
      }
      clearTimeout(this.touchTimer);
      const scene = this.getScene();
      this.touchTimer = setTimeout(() => {
        if (scene.type === "image-sequence") {
          this.playAction("next");
          return;
        }
        this.playAction(this.nextClickAction(scene));
      }, 240);
    }

    nextClickAction(scene) {
      if (this.clickCycleScene !== scene) {
        this.clickCycleScene = scene;
        this.clickCycleIndex = 0;
      }
      const configuredCycle = Array.isArray(scene.gestures?.clickCycle)
        ? scene.gestures.clickCycle
        : [scene.gestures?.click || "touch", "damage", "dead"];
      const availableActions = new Set(Object.keys(scene.actions || {}).map(name => name.toLowerCase()));
      const cycle = [...new Set(configuredCycle
        .filter(action => typeof action === "string" && action.trim())
        .map(action => action.trim()))]
        .filter(action => availableActions.has(action.toLowerCase()));
      const fallback = scene.gestures?.click || "touch";
      if (cycle.length === 0) return fallback;
      const action = cycle[this.clickCycleIndex % cycle.length];
      this.clickCycleIndex = (this.clickCycleIndex + 1) % cycle.length;
      return action;
    }

    handleDoubleClick(event) {
      if (!this.isPetPoint(event)) return;
      event.preventDefault();
      event.stopPropagation();
      clearTimeout(this.touchTimer);
      const scene = this.getScene();
      this.playAction(scene.type === "image-sequence" ? "autoplay" : (scene.gestures?.doubleClick || "cutIn"));
    }

    handleWheel(event) {
      if (!this.isPetPoint(event)) return;
      event.preventDefault();
      event.stopPropagation();
      this.changeScale(event.deltaY < 0 ? 0.05 : -0.05);
      this.log(`Wheel zoom: ${Math.round(this.getScale() * 100)}%`);
    }

    bind() {
      const listen = (target, type, handler, options) => {
        target.addEventListener(type, handler, options);
        this.listeners.push(() => target.removeEventListener(type, handler, options));
      };
      listen(this.element, "pointerdown", event => this.beginDrag(event), { capture: true });
      listen(this.element, "pointermove", event => this.moveDrag(event), { capture: true });
      listen(this.element, "pointerup", event => this.endDrag(event), { capture: true });
      listen(this.element, "pointercancel", event => this.endDrag(event), { capture: true });
      listen(this.element, "contextmenu", event => {
        if (!this.isPetPoint(event)) return;
        event.preventDefault();
        event.stopPropagation();
        this.setToolsVisible(!this.getToolsVisible());
        this.setMousePassthrough(false);
      }, { capture: true });
      listen(this.element, "click", event => this.handleClick(event), { capture: true });
      listen(this.element, "dblclick", event => this.handleDoubleClick(event), { capture: true });
      listen(this.element, "wheel", event => this.handleWheel(event), { capture: true, passive: false });
      listen(window, "mousemove", event => this.updateMousePassthrough(event), { capture: true });
      listen(window, "mouseleave", () => {
        if (!this.getToolsVisible()) this.setMousePassthrough(true);
      });
    }

    dispose() {
      clearTimeout(this.touchTimer);
      this.endDrag();
      for (const remove of this.listeners.splice(0)) remove();
    }
  }

  window.AsterPet = window.AsterPet || {};
  window.AsterPet.PetInteractionController = PetInteractionController;
})();
