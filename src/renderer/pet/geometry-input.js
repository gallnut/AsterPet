(function registerGeometryInputController() {
  class GeometryInputController {
    constructor({ desktopPet, spineRuntime, getScene, getPlayer, getSequenceImage, embeddedStatus, controlElements, statusElement, log }) {
      this.desktopPet = desktopPet;
      this.spine = spineRuntime;
      this.getScene = getScene;
      this.getPlayer = getPlayer;
      this.getSequenceImage = getSequenceImage;
      this.embeddedStatus = embeddedStatus;
      this.controlElements = controlElements;
      this.statusElement = statusElement;
      this.log = log;
      this.lastInputShapeSignature = "";
      this.cachedPetRects = [];
      this.samplerLogged = false;
      this.updateQueued = false;
      this.workerBusy = false;
      this.updatePending = false;
      this.visualBoundsPending = false;
      this.sampleCount = 0;
      this.collectionTotal = 0;
      this.collectionMaximum = 0;
      this.rasterTotal = 0;
      this.rasterMaximum = 0;
      this.quadTriangles = [0, 1, 2, 2, 3, 0];
      this.clipper = new spineRuntime.SkeletonClipping();
      this.color = new spineRuntime.Color(1, 1, 1, 1);
      this.screenPoint = new spineRuntime.Vector3();
      this.attachmentVertexBuffers = new WeakMap();
      this.projectedBuffer = new Float32Array(0);
      this.triangleBuffer = new Float32Array(4096);
      this.worker = new Worker("geometry-input-worker.js");
      this.stopped = false;
      this.scheduleTimer = undefined;
      this.worker.onmessage = event => this.handleWorkerMessage(event);
      this.worker.onerror = event => {
        this.workerBusy = false;
        this.log(`Spine geometry worker failed: ${event.message}`);
      };
    }

    handleWorkerMessage(event) {
      if (this.stopped) return;
      this.workerBusy = false;
      if (event.data?.buffer instanceof ArrayBuffer) this.triangleBuffer = new Float32Array(event.data.buffer);
      const runPendingUpdate = this.updatePending;
      this.cachedPetRects = Array.isArray(event.data?.rects) ? event.data.rects : this.cachedPetRects;
      const rasterElapsed = Number(event.data?.elapsed) || 0;
      this.rasterTotal += rasterElapsed;
      this.rasterMaximum = Math.max(this.rasterMaximum, rasterElapsed);
      if (!this.samplerLogged && this.cachedPetRects.length > 0) {
        this.samplerLogged = true;
        this.log(`Input shape sampler: Spine geometry worker (${this.cachedPetRects.length} rectangles)`);
      }
      if (this.sampleCount === 32) {
        this.log(`Spine geometry timing: main average ${(this.collectionTotal / this.sampleCount).toFixed(2)} ms, main max ${this.collectionMaximum.toFixed(2)} ms, worker average ${(this.rasterTotal / this.sampleCount).toFixed(2)} ms, worker max ${this.rasterMaximum.toFixed(2)} ms, current rectangles ${this.cachedPetRects.length}`);
      }
      if (this.visualBoundsPending && !runPendingUpdate) {
        this.visualBoundsPending = false;
        this.publishVisualBounds();
      }
      this.reportInputShape();
      if (runPendingUpdate) {
        this.updatePending = false;
        this.queueUpdate();
      }
    }

    addElementRect(rects, element) {
      if (!element || element.hidden) return;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return;
      const bounds = element.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      rects.push({
        x: Math.max(0, Math.floor(bounds.left)),
        y: Math.max(0, Math.floor(bounds.top)),
        width: Math.ceil(bounds.width),
        height: Math.ceil(bounds.height)
      });
    }

    addEmbeddedStatusRects(rects) {
      if (this.embeddedStatus.hidden || !this.embeddedStatus.contentDocument) return;
      const iframeBounds = this.embeddedStatus.getBoundingClientRect();
      const frameDocument = this.embeddedStatus.contentDocument;
      const addFrameElement = element => {
        if (!element || element.hidden) return;
        const style = frameDocument.defaultView.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return;
        const bounds = element.getBoundingClientRect();
        const left = Math.max(0, bounds.left);
        const top = Math.max(0, bounds.top);
        const right = Math.min(iframeBounds.width, bounds.right);
        const bottom = Math.min(iframeBounds.height, bounds.bottom);
        if (right <= left || bottom <= top) return;
        rects.push({
          x: Math.max(0, Math.floor(iframeBounds.left + left)),
          y: Math.max(0, Math.floor(iframeBounds.top + top)),
          width: Math.ceil(right - left),
          height: Math.ceil(bottom - top)
        });
      };
      const card = frameDocument.getElementById("card");
      addFrameElement(card);
      for (const menu of frameDocument.querySelectorAll(".launcher-select-menu:not([hidden])")) addFrameElement(menu);
      if (!card) return;
      const cardBounds = card.getBoundingClientRect();
      const frameScale = Number.parseFloat(frameDocument.defaultView.getComputedStyle(frameDocument.documentElement).getPropertyValue("--ui-scale")) || 1;
      rects.push({
        x: Math.max(0, Math.floor(iframeBounds.left + cardBounds.right)),
        y: Math.max(0, Math.floor(iframeBounds.top + cardBounds.top + 24 * frameScale)),
        width: Math.max(1, Math.ceil(13 * frameScale)),
        height: Math.max(1, Math.ceil(18 * frameScale))
      });
    }

    reportInputShape() {
      const scene = this.getScene();
      const player = this.getPlayer();
      const petRects = [...this.cachedPetRects];
      const controlRects = [];
      if (scene?.type === "image-sequence") {
        petRects.length = 0;
        this.addElementRect(petRects, this.getSequenceImage());
      } else if (petRects.length === 0) {
        this.addElementRect(petRects, player?.canvas);
      }
      for (const element of this.controlElements()) this.addElementRect(controlRects, element);
      if (!this.statusElement.hidden) this.addElementRect(controlRects, this.statusElement);
      this.addEmbeddedStatusRects(controlRects);
      if (petRects.length === 0 && controlRects.length === 0) {
        controlRects.push({ x: 0, y: 0, width: innerWidth, height: innerHeight });
      }
      const rects = [...petRects, ...controlRects];
      let hash = 2166136261;
      for (const rect of rects) {
        hash = Math.imul(hash ^ rect.x, 16777619);
        hash = Math.imul(hash ^ rect.y, 16777619);
        hash = Math.imul(hash ^ rect.width, 16777619);
        hash = Math.imul(hash ^ rect.height, 16777619);
      }
      const signature = `${petRects.length}:${controlRects.length}:${hash >>> 0}`;
      if (signature === this.lastInputShapeSignature) return;
      this.lastInputShapeSignature = signature;
      this.desktopPet.reportInputShape({ petRects, controlRects, rects });
    }

    publishVisualBounds() {
      if (this.cachedPetRects.length === 0) return;
      let left = Infinity;
      let right = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      for (const rect of this.cachedPetRects) {
        left = Math.min(left, rect.x);
        right = Math.max(right, rect.x + rect.width);
        top = Math.min(top, rect.y);
        bottom = Math.max(bottom, rect.y + rect.height);
      }
      this.desktopPet.reportVisualBounds({ left, right, top, bottom });
    }

    requestVisualBoundsUpdate() {
      this.visualBoundsPending = true;
      this.queueUpdate();
    }

    attachmentVertexBuffer(attachment, length) {
      let buffer = this.attachmentVertexBuffers.get(attachment);
      if (!buffer || buffer.length !== length) {
        buffer = new Float32Array(length);
        this.attachmentVertexBuffers.set(attachment, buffer);
      }
      return buffer;
    }

    collectAttachmentTriangles() {
      const player = this.getPlayer();
      if (!player?.skeleton || !player?.sceneRenderer?.camera || !player?.canvas) return 0;
      let triangleLength = 0;
      const camera = player.sceneRenderer.camera;
      const canvasBounds = player.asterPetCanvasBounds || player.canvas.getBoundingClientRect();
      const renderViewport = player.asterPetRenderViewport || {
        x: 0,
        y: 0,
        width: player.canvas.clientWidth,
        height: player.canvas.clientHeight
      };
      if (canvasBounds.width <= 0 || canvasBounds.height <= 0) return triangleLength;
      this.clipper.clipEnd();
      const ensureTriangleCapacity = requiredLength => {
        if (this.triangleBuffer.length >= requiredLength) return;
        let capacity = Math.max(4096, this.triangleBuffer.length);
        while (capacity < requiredLength) capacity *= 2;
        const expanded = new Float32Array(capacity);
        expanded.set(this.triangleBuffer.subarray(0, triangleLength));
        this.triangleBuffer = expanded;
      };
      const addTriangles = (vertices, indices, stride = 2) => {
        const projectedLength = vertices.length / stride * 2;
        if (this.projectedBuffer.length < projectedLength) this.projectedBuffer = new Float32Array(projectedLength);
        for (let source = 0, target = 0; source < vertices.length; source += stride, target += 2) {
          camera.worldToScreen(this.screenPoint.set(vertices[source], vertices[source + 1], 0), renderViewport.width, renderViewport.height);
          this.projectedBuffer[target] = canvasBounds.left + renderViewport.x + this.screenPoint.x;
          this.projectedBuffer[target + 1] = canvasBounds.top + renderViewport.y + renderViewport.height - this.screenPoint.y;
        }
        for (let index = 0; index + 2 < indices.length; index += 3) {
          ensureTriangleCapacity(triangleLength + 6);
          const first = indices[index] * 2;
          const second = indices[index + 1] * 2;
          const third = indices[index + 2] * 2;
          this.triangleBuffer[triangleLength++] = this.projectedBuffer[first];
          this.triangleBuffer[triangleLength++] = this.projectedBuffer[first + 1];
          this.triangleBuffer[triangleLength++] = this.projectedBuffer[second];
          this.triangleBuffer[triangleLength++] = this.projectedBuffer[second + 1];
          this.triangleBuffer[triangleLength++] = this.projectedBuffer[third];
          this.triangleBuffer[triangleLength++] = this.projectedBuffer[third + 1];
        }
      };
      for (const slot of player.skeleton.drawOrder) {
        if (!slot.bone.active) {
          this.clipper.clipEndWithSlot(slot);
          continue;
        }
        const attachment = slot.getAttachment();
        if (attachment instanceof this.spine.ClippingAttachment) {
          this.clipper.clipStart(slot, attachment);
          continue;
        }
        if (!attachment || slot.color.a * player.skeleton.color.a * (attachment.color?.a ?? 1) <= 0.02) {
          this.clipper.clipEndWithSlot(slot);
          continue;
        }
        let vertices;
        let indices;
        let uvs;
        if (attachment instanceof this.spine.RegionAttachment) {
          vertices = this.attachmentVertexBuffer(attachment, 8);
          attachment.computeWorldVertices(slot, vertices, 0, 2);
          indices = this.quadTriangles;
          uvs = attachment.uvs;
        } else if (attachment instanceof this.spine.MeshAttachment) {
          vertices = this.attachmentVertexBuffer(attachment, attachment.worldVerticesLength);
          attachment.computeWorldVertices(slot, 0, attachment.worldVerticesLength, vertices, 0, 2);
          indices = attachment.triangles;
          uvs = attachment.uvs;
        }
        if (vertices && indices) {
          if (this.clipper.isClipping()) {
            this.clipper.clipTriangles(vertices, vertices.length, indices, indices.length, uvs, this.color, this.color, false);
            addTriangles(this.clipper.clippedVertices, this.clipper.clippedTriangles, 8);
          } else {
            addTriangles(vertices, indices);
          }
        }
        this.clipper.clipEndWithSlot(slot);
      }
      this.clipper.clipEnd();
      return triangleLength;
    }

    update() {
      if (this.stopped) return;
      const scene = this.getScene();
      const player = this.getPlayer();
      if (scene?.type === "image-sequence" || !player?.skeleton) return;
      if (this.workerBusy) {
        this.updatePending = true;
        return;
      }
      const startedAt = performance.now();
      const triangleLength = this.collectAttachmentTriangles();
      const elapsed = performance.now() - startedAt;
      this.sampleCount += 1;
      this.collectionTotal += elapsed;
      this.collectionMaximum = Math.max(this.collectionMaximum, elapsed);
      const buffer = this.triangleBuffer.buffer;
      this.workerBusy = true;
      this.triangleBuffer = new Float32Array(0);
      this.worker.postMessage({ buffer, length: triangleLength, width: innerWidth, height: innerHeight }, [buffer]);
    }

    queueUpdate() {
      if (this.updateQueued) return;
      this.updateQueued = true;
      requestAnimationFrame(() => {
        if (this.stopped) return;
        this.updateQueued = false;
        this.update();
      });
    }

    start() {
      const schedule = () => {
        if (this.stopped) return;
        const player = this.getPlayer();
        const scene = this.getScene();
        const currentAnimation = player?.animationState?.getCurrent(0)?.animation?.name;
        const idleAnimation = scene?.actions?.idle?.animation;
        const delay = currentAnimation && currentAnimation !== idleAnimation ? 125 : 500;
        this.scheduleTimer = setTimeout(() => {
          this.update();
          schedule();
        }, delay);
      };
      schedule();
    }

    stop() {
      this.stopped = true;
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = undefined;
      this.updatePending = false;
      this.workerBusy = false;
      this.worker.terminate();
    }

    resetScene() {
      this.cachedPetRects = [];
      this.lastInputShapeSignature = "";
      this.visualBoundsPending = false;
      this.updatePending = false;
      this.reportInputShape();
    }

    isOpaquePoint(clientX, clientY) {
      const scene = this.getScene();
      if (scene?.type === "image-sequence") {
        const rect = this.getSequenceImage()?.getBoundingClientRect();
        return Boolean(rect && clientX >= rect.left && clientX < rect.right && clientY >= rect.top && clientY < rect.bottom);
      }
      return this.cachedPetRects.some(rect => clientX >= rect.x && clientX < rect.x + rect.width && clientY >= rect.y && clientY < rect.y + rect.height);
    }
  }

  window.AsterPet = window.AsterPet || {};
  window.AsterPet.GeometryInputController = GeometryInputController;
})();
