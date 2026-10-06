(function registerPetInteractionController() {
  function preservesInteractionSelection(scene, animationGraphEnabled = false) {
    return scene?.type === "spine" && (scene.category === "interaction"
      || animationGraphEnabled || Boolean(scene.behavior?.animationGraph));
  }

  class PetInteractionController {
    constructor({ desktopPet, element, geometryInput, getScene, getAnimationGraphEnabled = () => false, getStateLocked = () => false, getToolsVisible, setToolsVisible, playAction, playInteraction, zoomView, panView, log }) {
      this.desktopPet = desktopPet;
      this.element = element;
      this.geometryInput = geometryInput;
      this.getScene = getScene;
      this.getAnimationGraphEnabled = getAnimationGraphEnabled;
      this.getStateLocked = getStateLocked;
      this.getToolsVisible = getToolsVisible;
      this.setToolsVisible = setToolsVisible;
      this.playAction = playAction;
      this.playInteraction = playInteraction;
      this.zoomView = zoomView;
      this.panView = panView;
      this.panStart = undefined;
      this.suppressContextMenu = false;
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
      if (this.pointerStart || this.panStart) {
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
      if (event.button !== 2) this.suppressContextMenu = false;
      if (event.button === 2 && this.isPetPoint(event)) {
        event.preventDefault();
        event.stopPropagation();
        this.panStart = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, dragged: false, pointerId: event.pointerId };
        this.suppressContextMenu = true;
        this.setMousePassthrough(false);
        this.element.setPointerCapture(event.pointerId);
        return;
      }
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
      if (this.panStart) {
        const pan = this.panStart;
        if (!pan.dragged && Math.hypot(event.clientX - pan.x, event.clientY - pan.y) < (this.getScene()?.gestures?.dragThreshold ?? 5)) return;
        pan.dragged = true;
        event.preventDefault();
        event.stopPropagation();
        this.panView(event.clientX - pan.lastX, event.clientY - pan.lastY);
        pan.lastX = event.clientX;
        pan.lastY = event.clientY;
        return;
      }
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
      if (this.panStart) {
        const pan = this.panStart;
        this.panStart = undefined;
        if (this.element.hasPointerCapture?.(pan.pointerId)) this.element.releasePointerCapture(pan.pointerId);
        if (event?.type === "pointerup" && !pan.dragged) this.setToolsVisible(!this.getToolsVisible());
        return;
      }
      if (!this.pointerStart) return;
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
      if (this.getStateLocked()) return;
      const scene = this.getScene();
      this.touchTimer = setTimeout(() => {
        if (this.getStateLocked() || this.getScene() !== scene) return;
        if (scene.type === "image-sequence") {
          this.playAction("next");
          return;
        }
        if (preservesInteractionSelection(scene, this.getAnimationGraphEnabled())) {
          this.playInteraction?.("click");
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
      if (this.getStateLocked()) return;
      const scene = this.getScene();
      if (preservesInteractionSelection(scene, this.getAnimationGraphEnabled())) {
        this.touchTimer = undefined;
        this.playInteraction?.("doubleClick");
        return;
      }
      this.playAction(scene.type === "image-sequence" ? "autoplay" : (scene.gestures?.doubleClick || "cutIn"));
    }

    handleAuxClick(event) {
      if (event.button !== 1 || !this.isPetPoint(event)) return;
      if (this.getStateLocked()) {
        event.preventDefault();
        event.stopPropagation();
        clearTimeout(this.touchTimer);
        return;
      }
      const scene = this.getScene();
      if (!preservesInteractionSelection(scene, this.getAnimationGraphEnabled())) return;
      event.preventDefault();
      event.stopPropagation();
      clearTimeout(this.touchTimer);
      this.touchTimer = undefined;
      this.playInteraction?.("previous");
    }

    handleWheel(event) {
      if (!this.isPetPoint(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.deltaY === 0) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.element.clientHeight : 1);
      this.zoomView(Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.0015), event.clientX, event.clientY);
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
        if (!this.suppressContextMenu && !this.isPetPoint(event)) return;
        event.preventDefault();
        event.stopPropagation();
        // The right pointerup toggles tools; contextmenu may occur before or after it.
        // Keyboard context menus still toggle the toolbar without a pointer gesture.
        if (!this.suppressContextMenu || event.button !== 2) this.setToolsVisible(!this.getToolsVisible());
        this.setMousePassthrough(false);
      }, { capture: true });
      listen(this.element, "click", event => this.handleClick(event), { capture: true });
      listen(this.element, "dblclick", event => this.handleDoubleClick(event), { capture: true });
      listen(this.element, "auxclick", event => this.handleAuxClick(event), { capture: true });
      listen(this.element, "mousedown", event => {
        if (event.button === 1 && this.isPetPoint(event)
          && (this.getStateLocked() || preservesInteractionSelection(this.getScene(), this.getAnimationGraphEnabled()))) {
          event.preventDefault();
        }
      }, { capture: true });
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

  if (typeof module !== "undefined" && module.exports) module.exports = { PetInteractionController, preservesInteractionSelection };
  if (typeof window !== "undefined") {
    window.AsterPet = window.AsterPet || {};
    window.AsterPet.PetInteractionController = PetInteractionController;
    window.AsterPet.preservesInteractionSelection = preservesInteractionSelection;
  }
})();
