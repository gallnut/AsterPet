(function registerActionChoreographer() {
  const DEFAULT_ACTION_TAGS = {
    touch: ["happy", "shame", "worry", "normal"],
    damage: ["panic", "sad", "worry"],
    dead: ["eyeclose", "sad"],
    cutin: ["angry", "serious"],
    attack: ["angry", "serious"]
  };
  const DEFAULT_AGENT_TAGS = {
    streaming: ["emotalk", "talk"],
    speaking: ["emotalk", "talk"]
  };

  function normalizedName(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  class ActionChoreographer {
    constructor({ getPlayer, getScene, getAnimationNames, getOverlayAnimation, resolveAgentAnimation, onAnimation, log }) {
      this.getPlayer = getPlayer;
      this.getScene = getScene;
      this.listAnimationNames = getAnimationNames;
      this.getOverlayAnimation = getOverlayAnimation || (animationName => this.getPlayer()?.skeleton?.data?.findAnimation(animationName));
      this.resolveAgentAnimation = resolveAgentAnimation || (name => name);
      this.onAnimation = onAnimation;
      this.log = log;
      this.actionRecipes = new Map();
      this.agentOverlays = new Map();
      this.lastRecipeAnimations = new Map();
      this.agentState = "idle";
      this.activeTrack = undefined;
      this.overlayTimer = undefined;
      this.resumeTimer = undefined;
      this.resumeAt = 0;
      this.settings = undefined;
    }

    start() {
      this.stop();
      const scene = this.getScene();
      if (!scene || scene.type === "image-sequence") return;
      const source = scene.behavior || scene.behaviors || {};
      const configuredMixDuration = Number(source.actionMixDuration ?? source.mixDuration);
      this.settings = {
        track: Math.max(1, Math.round(Number(source.actionTrack) || 1)),
        agentTrack: Math.max(2, Math.round(Number(source.agentTrack) || 2)),
        mixDuration: Number.isFinite(configuredMixDuration)
          ? Math.max(0, Math.min(1.5, configuredMixDuration))
          : 0.18
      };
      this.actionRecipes = this.resolveActionRecipes(source.actionRecipes);
      this.agentOverlays = this.resolveAgentOverlays(source.agentOverlays);
      const recipes = [...this.actionRecipes.entries()]
        .filter(([, entries]) => entries.length > 0)
        .map(([action, entries]) => `${action}=[${entries.map(entry => entry.animation).join(", ")}]`);
      const agents = [...this.agentOverlays.entries()]
        .map(([state, entry]) => `${state}=${entry.animation}`);
      if (recipes.length > 0 || agents.length > 0) {
        this.log(`Action choreography ready: ${[...recipes, ...agents].join("; ")}`);
      }
    }

    stop() {
      clearTimeout(this.overlayTimer);
      clearTimeout(this.resumeTimer);
      if (this.activeTrack !== undefined && this.activeTrack !== 1) {
        this.getPlayer()?.animationState?.setEmptyAnimation?.(this.activeTrack, this.settings?.mixDuration ?? 0.18);
      }
      this.actionRecipes = new Map();
      this.agentOverlays = new Map();
      this.lastRecipeAnimations.clear();
      this.activeTrack = undefined;
      this.overlayTimer = undefined;
      this.resumeTimer = undefined;
      this.resumeAt = 0;
      this.settings = undefined;
      this.agentState = "idle";
    }

    interrupt() {
      clearTimeout(this.overlayTimer);
      clearTimeout(this.resumeTimer);
      this.overlayTimer = undefined;
      this.resumeTimer = undefined;
      this.resumeAt = 0;
      if (this.activeTrack !== undefined && this.activeTrack !== 1) {
        this.getPlayer()?.animationState?.setEmptyAnimation?.(this.activeTrack, this.settings?.mixDuration ?? 0.18);
      }
      this.activeTrack = undefined;
    }

    resolveAnimationName(requestedName) {
      const animationNames = this.listAnimationNames();
      if (animationNames.includes(requestedName)) return requestedName;
      const requested = normalizedName(requestedName);
      return animationNames.find(name => normalizedName(name) === requested);
    }

    normalizeEntries(value, defaultTrack = this.settings.track) {
      const entries = Array.isArray(value) ? value : value ? [value] : [];
      return entries
        .map(entry => typeof entry === "string" ? { animation: entry } : entry)
        .filter(entry => entry && typeof entry === "object")
        .map(entry => ({ ...entry, animation: this.resolveAnimationName(entry.animation) }))
        .filter(entry => entry.animation)
        .map(entry => ({
          animation: entry.animation,
          weight: Math.max(0.01, Number(entry.weight) || 1),
          track: Math.max(1, Math.round(Number(entry.track) || defaultTrack)),
          holdMs: Number.isFinite(Number(entry.holdMs)) ? Math.max(0, Number(entry.holdMs)) : undefined,
          loop: typeof entry.loop === "boolean" ? entry.loop : undefined,
          mixDuration: Number.isFinite(Number(entry.mixDuration))
            ? Math.max(0, Math.min(1.5, Number(entry.mixDuration)))
            : this.settings.mixDuration
        }));
    }

    inferEntries(tags, defaultTrack = this.settings.track) {
      const candidates = this.listAnimationNames().filter(name => {
        const normalized = normalizedName(name);
        return tags.some(tag => normalized.includes(tag));
      });
      return this.normalizeEntries(candidates.map(animation => ({ animation })), defaultTrack);
    }

    resolveActionRecipes(configured) {
      const configuredRecipes = configured && typeof configured === "object" ? configured : {};
      const actionNames = new Set([...Object.keys(DEFAULT_ACTION_TAGS), ...Object.keys(configuredRecipes)]);
      return new Map([...actionNames].map(actionName => {
        const key = normalizedName(actionName);
        const entries = Object.hasOwn(configuredRecipes, actionName)
          ? this.normalizeEntries(configuredRecipes[actionName])
          : this.inferEntries(DEFAULT_ACTION_TAGS[key] || []);
        return [key, entries];
      }));
    }

    resolveAgentOverlays(configured) {
      const configuredOverlays = configured && typeof configured === "object" ? configured : {};
      const stateNames = new Set([...Object.keys(DEFAULT_AGENT_TAGS), ...Object.keys(configuredOverlays)]);
      const resolved = new Map();
      for (const stateName of stateNames) {
        const key = normalizedName(stateName);
        let entries = Object.hasOwn(configuredOverlays, stateName)
          ? this.normalizeEntries(configuredOverlays[stateName], this.settings.agentTrack)
          : this.inferEntries(DEFAULT_AGENT_TAGS[key] || [], this.settings.agentTrack);
        if (!Object.hasOwn(configuredOverlays, stateName) && entries.length > 1) {
          entries = [...entries].sort((left, right) => {
            const leftFace = /^_?face\d+[_-]?talk$/i.test(left.animation) ? 0 : 1;
            const rightFace = /^_?face\d+[_-]?talk$/i.test(right.animation) ? 0 : 1;
            return leftFace - rightFace;
          });
        }
        if (entries[0]) resolved.set(key, { ...entries[0], inferred: !Object.hasOwn(configuredOverlays, stateName), loop: entries[0].loop !== false });
      }
      return resolved;
    }

    selectRecipe(actionName) {
      const key = normalizedName(actionName);
      const entries = this.actionRecipes.get(key) || [];
      if (entries.length === 0) return undefined;
      const lastAnimation = this.lastRecipeAnimations.get(key);
      const alternatives = entries.length > 1
        ? entries.filter(entry => entry.animation !== lastAnimation)
        : entries;
      const totalWeight = alternatives.reduce((sum, entry) => sum + entry.weight, 0);
      let cursor = Math.random() * totalWeight;
      let selected = alternatives.at(-1);
      for (const entry of alternatives) {
        cursor -= entry.weight;
        if (cursor <= 0) {
          selected = entry;
          break;
        }
      }
      this.lastRecipeAnimations.set(key, selected.animation);
      return selected;
    }

    playOverlay(entry, minimumVisibleMs = 0) {
      const player = this.getPlayer();
      const sourceAnimation = player?.skeleton?.data?.findAnimation?.(entry.animation);
      if (!player?.animationState || !sourceAnimation) return 0;
      clearTimeout(this.overlayTimer);
      if (this.activeTrack !== undefined && this.activeTrack !== entry.track && this.activeTrack !== 1) {
        player.animationState.setEmptyAnimation?.(this.activeTrack, entry.mixDuration);
      }
      const overlayAnimation = this.getOverlayAnimation(entry.animation) || sourceAnimation;
      const trackEntry = player.animationState.setAnimationWith
        ? player.animationState.setAnimationWith(entry.track, overlayAnimation, Boolean(entry.loop ?? overlayAnimation.portraitLoop))
        : player.animationState.setAnimation(entry.track, entry.animation, Boolean(entry.loop));
      trackEntry.mixDuration = entry.mixDuration;
      this.activeTrack = entry.track;
      this.onAnimation(entry.animation);
      player.play();
      if (entry.loop) return Number.POSITIVE_INFINITY;
      const defaultHoldMs = Math.min(1800, Math.max(700, minimumVisibleMs));
      const holdMs = entry.holdMs ?? defaultHoldMs;
      const visibleDurationMs = Math.max(overlayAnimation.duration * 1000, holdMs);
      this.overlayTimer = setTimeout(() => {
        if (entry.track !== 1) player.animationState.setEmptyAnimation?.(entry.track, entry.mixDuration);
        this.overlayTimer = undefined;
        if (this.activeTrack === entry.track) this.activeTrack = undefined;
      }, Math.max(100, visibleDurationMs + entry.mixDuration * 1000));
      return visibleDurationMs;
    }

    playAction(actionName, durationMs = 0) {
      if (!this.settings) return;
      this.interrupt();
      const normalizedAction = normalizedName(actionName);
      if (!normalizedAction || normalizedAction === "idle") {
        this.playAgentOverlay();
        return;
      }
      const recipe = this.selectRecipe(normalizedAction);
      const overlayDurationMs = recipe ? this.playOverlay(recipe, durationMs) : 0;
      const resumeDelayMs = Math.max(0, durationMs, Number.isFinite(overlayDurationMs) ? overlayDurationMs : 0);
      this.resumeAt = Date.now() + resumeDelayMs;
      this.scheduleAgentResume(resumeDelayMs + (this.settings.mixDuration * 1000));
    }

    setAgentState(state) {
      if (!this.settings) return;
      this.agentState = normalizedName(state) || "idle";
      const remainingMs = this.resumeAt - Date.now();
      if (remainingMs > 0) {
        this.scheduleAgentResume(remainingMs);
        return;
      }
      this.playAgentOverlay();
    }

    scheduleAgentResume(delayMs) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = setTimeout(() => {
        this.resumeTimer = undefined;
        this.resumeAt = 0;
        this.playAgentOverlay();
      }, Math.max(0, delayMs));
    }

    refreshAgentOverlay() {
      if (this.activeTrack === this.settings?.agentTrack) this.playAgentOverlay();
    }

    playAgentOverlay() {
      let entry = this.agentOverlays.get(this.agentState);
      if (entry?.inferred) {
        const animation = this.resolveAgentAnimation(entry.animation);
        entry = animation ? { ...entry, animation } : undefined;
      }
      if (!entry) {
        if (this.activeTrack !== undefined) this.interrupt();
        return;
      }
      clearTimeout(this.overlayTimer);
      if (this.activeTrack !== undefined && this.activeTrack !== 1) {
        this.getPlayer()?.animationState?.setEmptyAnimation?.(this.activeTrack, entry.mixDuration);
      }
      this.activeTrack = undefined;
      this.playOverlay(entry);
    }
  }

  window.AsterPet = window.AsterPet || {};
  window.AsterPet.ActionChoreographer = ActionChoreographer;
})();
