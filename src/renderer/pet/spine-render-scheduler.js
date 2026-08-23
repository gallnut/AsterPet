(function registerSpineRenderScheduler() {
  class SpineRenderScheduler {
    constructor({ getFrameRate, onMetrics }) {
      this.getFrameRate = getFrameRate;
      this.onMetrics = onMetrics;
      this.player = undefined;
      this.animationFrame = undefined;
      this.stopped = true;
      this.generation = 0;
      this.renderFrame = undefined;
      this.previousTimestamp = 0;
      this.frameAccumulator = 0;
      this.metricsStartedAt = performance.now();
      this.metricsFrames = 0;
      this.metricsRenderTime = 0;
      this.renderFrames = new WeakMap();
    }

    start(player) {
      this.stop();
      this.player = player;
      this.stopped = false;
      let renderFrame = this.renderFrames.get(player);
      if (!renderFrame) {
        renderFrame = player.drawFrame.bind(player, false);
        this.renderFrames.set(player, renderFrame);
      }
      this.renderFrame = renderFrame;
      player.drawFrame = () => undefined;
      player.stopRendering();
      this.schedule(this.generation);
    }

    schedule(generation) {
      if (this.stopped || generation !== this.generation || !this.player || this.player.disposed) return;
      this.animationFrame = requestAnimationFrame(timestamp => {
        if (this.stopped || generation !== this.generation || !this.player || this.player.disposed) return;
        const frameRate = Math.max(1, Number(this.getFrameRate()) || 60);
        const frameInterval = 1000 / frameRate;
        if (this.previousTimestamp === 0) this.previousTimestamp = timestamp;
        const elapsed = Math.min(100, Math.max(0, timestamp - this.previousTimestamp));
        this.previousTimestamp = timestamp;
        this.frameAccumulator += elapsed;
        if (this.frameAccumulator + 0.5 >= frameInterval) {
          const startedAt = performance.now();
          this.renderFrame();
          this.recordMetrics(performance.now() - startedAt);
          this.frameAccumulator = Math.max(0, this.frameAccumulator - frameInterval);
        }
        this.schedule(generation);
      });
    }

    recordMetrics(renderTime) {
      this.metricsFrames += 1;
      this.metricsRenderTime += renderTime;
      const elapsed = performance.now() - this.metricsStartedAt;
      if (elapsed < 5000) return;
      this.onMetrics?.({
        fps: this.metricsFrames * 1000 / elapsed,
        averageRenderTime: this.metricsRenderTime / this.metricsFrames
      });
      this.metricsStartedAt = performance.now();
      this.metricsFrames = 0;
      this.metricsRenderTime = 0;
    }

    renderNow() {
      if (this.stopped || !this.player || this.player.disposed || !this.renderFrame) return;
      this.renderFrame();
    }

    stop() {
      this.stopped = true;
      this.generation += 1;
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
      this.player = undefined;
      this.renderFrame = undefined;
      this.previousTimestamp = 0;
      this.frameAccumulator = 0;
      this.metricsStartedAt = performance.now();
      this.metricsFrames = 0;
      this.metricsRenderTime = 0;
    }
  }

  window.AsterPet = window.AsterPet || {};
  window.AsterPet.SpineRenderScheduler = SpineRenderScheduler;
})();
