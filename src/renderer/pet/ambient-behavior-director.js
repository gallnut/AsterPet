(function registerAmbientBehaviorDirector() {
  const DEFAULT_OVERLAY_INCLUDE = /(emo|emotion|expression|facial|blink|eyeclose)/i;
  const DEFAULT_OVERLAY_EXCLUDE = /(idle|attack|damage|dead|death|touch|tap|cut[ _-]?in|skill|hit|hurt|die|talk|dizzy|sleep|yawn|stretch|motion)/i;
  const DEFAULT_BASE_INCLUDE = /(dizzy|yawn|stretch|(?:default|feeling)[a-z0-9_-]*idle|idle[_-]?save)/i;
  const DEFAULT_FACE = /^_?face\d+$/i;
  const DEFAULT_FACE_TALK = /^_?face\d+[_-]?talk$/i;

  class AmbientBehaviorDirector {
    constructor({ getPlayer, getScene, getAnimationNames, isFullPoseAnimation, isOverlayAnimation, getOverlayAnimation, canPlay, onAnimation, log }) {
      this.getPlayer = getPlayer;
      this.getScene = getScene;
      this.listAnimationNames = getAnimationNames;
      this.isOverlayAnimation = isOverlayAnimation || (() => false);
      this.isFullPoseAnimation = isFullPoseAnimation || (() => false);
      this.getOverlayAnimation = getOverlayAnimation || (animationName => this.getPlayer()?.skeleton?.data?.findAnimation(animationName));
      this.canPlay = canPlay;
      this.onAnimation = onAnimation;
      this.log = log;
      this.timer = undefined;
      this.overlayTimer = undefined;
      this.activeOverlayTrack = undefined;
      this.overlayCleanupGeneration = 0;
      this.generation = 0;
      this.lastAnimation = undefined;
      this.behaviors = [];
      this.settings = undefined;
    }

    start() {
      this.stop();
      const scene = this.getScene();
      const idleAnimation = scene?.actions?.idle?.animation;
      if (!scene || !idleAnimation) return;
      this.settings = this.normalizeSettings(scene.behavior || scene.behaviors || {});
      this.behaviors = this.resolveBehaviors(this.settings.ambient, idleAnimation);
      if (this.behaviors.length === 0) return;
      const player = this.getPlayer();
      const transitionAnimations = new Set([
        ...this.behaviors.map(item => item.animation),
        ...Object.values(scene.actions || {}).map(action => action?.animation).filter(Boolean)
      ]);
      for (const animationName of transitionAnimations) {
        if (animationName === idleAnimation) continue;
        player?.animationState?.data?.setMix?.(idleAnimation, animationName, this.settings.mixDuration);
        player?.animationState?.data?.setMix?.(animationName, idleAnimation, this.settings.mixDuration);
      }
      this.schedule(this.settings.initialDelayMs);
      this.log(`Ambient behavior ready: ${this.behaviors.map(item => item.animation).join(", ")}`);
    }

    stop() {
      this.generation += 1;
      clearTimeout(this.timer);
      this.interruptOverlay();
      this.timer = undefined;
      this.behaviors = [];
      this.settings = undefined;
      this.lastAnimation = undefined;
    }

    noteActivity(durationMs = 0) {
      if (!this.settings || this.behaviors.length === 0) return;
      this.interruptOverlay();
      clearTimeout(this.timer);
      this.schedule(Math.max(0, durationMs) + this.randomInterval());
    }

    interruptOverlay() {
      clearTimeout(this.overlayTimer);
      this.overlayTimer = undefined;
      if (this.activeOverlayTrack !== undefined && this.activeOverlayTrack !== 1) {
        this.clearOverlayTrack(this.activeOverlayTrack, this.settings?.mixDuration ?? 0.22);
      }
      this.activeOverlayTrack = undefined;
    }

    clearOverlayTrack(track, mixDuration) {
      const animationState = this.getPlayer()?.animationState;
      if (!animationState) return;
      if (track === 1) {
        this.activeOverlayTrack = undefined;
        return;
      }
      const cleanupGeneration = ++this.overlayCleanupGeneration;
      animationState.setEmptyAnimation?.(track, mixDuration);
      setTimeout(() => {
        if (cleanupGeneration !== this.overlayCleanupGeneration) return;
        animationState.clearTrack?.(track);
        if (this.activeOverlayTrack === track) this.activeOverlayTrack = undefined;
      }, Math.max(0, Math.round(mixDuration * 1000) + 50));
    }

    getAmbientAnimationNames() {
      return this.behaviors.map(item => item.animation);
    }

    normalizeSettings(source) {
      const minIntervalMs = Math.max(3000, Number(source.minIntervalMs) || 7000);
      const maxIntervalMs = Math.max(minIntervalMs, Number(source.maxIntervalMs) || 16000);
      const configuredMixDuration = Number(source.mixDuration);
      return {
        ambient: Array.isArray(source.ambient) ? source.ambient : undefined,
        initialDelayMs: Math.max(1000, Number(source.initialDelayMs) || 5000),
        minIntervalMs,
        maxIntervalMs,
        mixDuration: Number.isFinite(configuredMixDuration)
          ? Math.max(0, Math.min(1.5, configuredMixDuration))
          : 0.22
      };
    }

    resolveBehaviors(configured, idleAnimation) {
      const animationNames = this.listAnimationNames();
      const explicitlyConfigured = Array.isArray(configured);
      const entries = explicitlyConfigured
        ? configured
        : [
          ...animationNames
            .filter(name => DEFAULT_FACE.test(name))
            .map(animation => ({
              animation,
              role: "expression",
              weight: 0.8,
              track: 1,
              holdMs: this.inferredHoldMs(animation)
            })),
          ...animationNames
            .filter(name => DEFAULT_OVERLAY_INCLUDE.test(name)
              && !DEFAULT_OVERLAY_EXCLUDE.test(name)
              && !DEFAULT_FACE_TALK.test(name))
            .map(animation => ({ animation, role: "expression", weight: this.inferredWeight(animation), track: 1 })),
          ...animationNames
            .filter(name => DEFAULT_BASE_INCLUDE.test(name)
              && !DEFAULT_FACE.test(name)
              && !DEFAULT_FACE_TALK.test(name))
            .map(animation => ({
              animation,
              role: "body",
              weight: this.inferredWeight(animation),
              mode: "base",
              track: 0,
              holdMs: this.inferredHoldMs(animation)
            }))
        ];
      return entries.map(entry => typeof entry === "string" ? { animation: entry, weight: 1 } : entry)
        .filter(entry => entry && animationNames.includes(entry.animation))
        .filter(entry => entry.animation !== idleAnimation)
        .map(entry => ({
          animation: entry.animation,
          weight: Math.max(0.01, Number(entry.weight) || 1),
          track: this.isOverlayAnimation(entry.animation) ? 1 : this.isFullPoseAnimation(entry.animation)
            ? 0
            : Math.max(0, Math.round(Number(entry.track) || 1)),
          mode: !this.isOverlayAnimation(entry.animation) && (this.isFullPoseAnimation(entry.animation) || entry.mode === "base") ? "base" : "overlay",
          role: this.isOverlayAnimation(entry.animation) ? "expression" : entry.role || (this.isFullPoseAnimation(entry.animation) || entry.mode === "base" ? "body" : "expression"),
          loop: typeof entry.loop === "boolean" ? entry.loop : undefined,
          holdMs: Number.isFinite(Number(entry.holdMs))
            ? Math.max(0, Number(entry.holdMs))
            : this.inferredHoldMs(entry.animation)
        }));
    }

    inferredWeight(animationName) {
      if (/sleep/i.test(animationName)) return 1.2;
      if (/(dizzy|yawn|stretch)/i.test(animationName)) return 0.8;
      if (/(blink|eyeclose)/i.test(animationName)) return 0.35;
      if (/(expression|emo)/i.test(animationName)) return 2;
      return 1;
    }

    inferredHoldMs(animationName) {
      if (DEFAULT_FACE.test(animationName)) return 5000;
      if (/sleep/i.test(animationName)) return 2400;
      if (/(dizzy|yawn|stretch)/i.test(animationName)) return 0;
      if (/blink/i.test(animationName)) return 300;
      if (/eyeclose/i.test(animationName)) return 450;
      return 2400;
    }

    randomInterval() {
      const { minIntervalMs, maxIntervalMs } = this.settings;
      return Math.round(minIntervalMs + Math.random() * (maxIntervalMs - minIntervalMs));
    }

    schedule(delayMs = this.randomInterval()) {
      const generation = this.generation;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (generation !== this.generation) return;
        this.playNext();
      }, delayMs);
    }

    selectBehavior() {
      const alternatives = this.behaviors.length > 1
        ? this.behaviors.filter(item => item.animation !== this.lastAnimation)
        : this.behaviors;
      const totalWeight = alternatives.reduce((sum, item) => sum + item.weight, 0);
      let cursor = Math.random() * totalWeight;
      for (const behavior of alternatives) {
        cursor -= behavior.weight;
        if (cursor <= 0) return behavior;
      }
      return alternatives.at(-1);
    }

    playNext() {
      const player = this.getPlayer();
      const scene = this.getScene();
      if (!player?.animationState || !scene?.actions?.idle || !this.canPlay()) {
        this.schedule();
        return;
      }
      const behavior = this.selectBehavior();
      if (!behavior) return;
      const animation = player.skeleton.data.findAnimation(behavior.animation);
      if (!animation) {
        this.schedule();
        return;
      }
      this.lastAnimation = behavior.animation;
      const track = behavior.mode === "base" ? 0 : behavior.track;
      const visibleDurationMs = Math.max(animation.duration * 1000, behavior.holdMs);
      if (track === 0) {
        player.animationState.setAnimation(0, behavior.animation, false);
        player.animationState.addAnimation(0, scene.actions.idle.animation, true, visibleDurationMs / 1000);
      } else {
        this.interruptOverlay();
        const animation = this.getOverlayAnimation(behavior.animation);
        const entry = animation && player.animationState.setAnimationWith
          ? player.animationState.setAnimationWith(track, animation, behavior.loop ?? animation.portraitLoop ?? false)
          : player.animationState.setAnimation(track, behavior.animation, false);
        this.overlayCleanupGeneration += 1;
        entry.mixDuration = this.settings.mixDuration;
        this.activeOverlayTrack = track;
        this.overlayTimer = setTimeout(() => {
          this.clearOverlayTrack(track, this.settings.mixDuration);
          this.overlayTimer = undefined;
        }, Math.max(100, visibleDurationMs + this.settings.mixDuration * 1000));
      }
      this.onAnimation(behavior.animation);
      player.play();
      const durationMs = Math.max(250, visibleDurationMs);
      this.schedule(durationMs + this.randomInterval());
    }
  }

  window.AsterPet = window.AsterPet || {};
  window.AsterPet.AmbientBehaviorDirector = AmbientBehaviorDirector;
})();
