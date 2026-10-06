(function registerAnimationGraphPlayer() {
  function buildRigVisibility(data) {
    const branchForBone = bone => {
      while (bone?.parent?.parent) bone = bone.parent;
      return bone?.parent ? `bone:${bone.index}` : undefined;
    };
    const slotBranches = data.slots.map(slot => branchForBone(slot.boneData) || `slot:${slot.index}`);
    const cutBranches = new Set(data.bones.filter(bone => bone.parent && !bone.parent.parent && /^cut(?:_|$)/i.test(bone.name))
      .map(branchForBone).filter(Boolean));
    const numberedPrimaryBranches = new Set();
    for (const idle of data.animations.filter(animation => /^idle\d+$/i.test(animation.name))) {
      const moving = new Map();
      for (const timeline of idle.timelines) {
        if (!Number.isInteger(timeline.boneIndex)) continue;
        const stride = timeline.getFrameEntries();
        if (timeline.frames.length <= stride) continue;
        const changes = Array.from(timeline.frames).some((value, index) => index >= stride && index % stride !== 0
          && Math.abs(value - timeline.frames[index % stride]) > 0.000001);
        if (!changes) continue;
        const branch = branchForBone(data.bones[timeline.boneIndex]);
        if (!moving.has(branch)) moving.set(branch, new Set());
        moving.get(branch).add(timeline.boneIndex);
      }
      const maximum = Math.max(0, ...[...moving.values()].map(bones => bones.size));
      for (const [branch, bones] of moving) if (bones.size >= 20 && bones.size >= maximum * 0.6) numberedPrimaryBranches.add(branch);
    }
    // Some interaction assets put their main figure inside cut_B/cut_C.
    // A dominant, genuinely animated idle rig is not an auxiliary cut view.
    for (const branch of numberedPrimaryBranches) cutBranches.delete(branch);
    const owners = new Map();
    const animationBranches = new Map();
    const isNumbered = name => /^(?:idle|mix|motion)\d+/i.test(name);
    for (const animation of data.animations) {
      const branches = new Set();
      for (const timeline of animation.timelines) {
        // Null attachment keys clear another view; they do not activate its rig.
        if (timeline.attachmentNames && !timeline.attachmentNames.some(Boolean)) continue;
        const branch = Number.isInteger(timeline.slotIndex) ? slotBranches[timeline.slotIndex]
          : Number.isInteger(timeline.boneIndex) ? branchForBone(data.bones[timeline.boneIndex]) : undefined;
        if (branch) branches.add(branch);
      }
      animationBranches.set(animation.name, branches);
      for (const branch of branches) {
        if (!owners.has(branch)) owners.set(branch, new Set());
        owners.get(branch).add(isNumbered(animation.name) ? "numbered" : animation.name);
      }
    }
    const hidden = new Map();
    for (const animation of data.animations) {
      const active = animationBranches.get(animation.name);
      const numbered = isNumbered(animation.name);
      hidden.set(animation.name, slotBranches.flatMap((branch, index) => {
        const branchOwners = owners.get(branch);
        // Modified packages sometimes copy cut keys into numbered clips. These
        // remain separate embedded viewpoints even when both rigs have keys.
        const cutSlot = cutBranches.has(branch) || /^cut_/i.test(data.slots[index].name);
        const additionalFigure = /^Master$/i.test(data.slots[index].name);
        if (numbered && (cutSlot && !numberedPrimaryBranches.has(branch) || additionalFigure)) return [index];
        if (!branchOwners?.size) return [];
        const visible = numbered ? branchOwners.has("numbered") : active.has(branch);
        return visible ? [] : [index];
      }));
    }

    // Separate rigs can belong to different numbered idles. A single reset key
    // on the other rig does not make it part of the selected viewpoint.
    const candidates = new Set(data.bones.filter(bone => bone.parent && !bone.parent.parent
      && !cutBranches.has(branchForBone(bone))));
    const namedView = name => name.match(/(?:^|_)(idle\d+)(?:_|$)/i)?.[1].toLowerCase();
    const nestedViews = data.bones.filter(bone => {
      if (!bone.parent?.parent || !namedView(bone.name)) return false;
      for (let parent = bone.parent; parent; parent = parent.parent) if (namedView(parent.name)) return false;
      let slots = 0;
      for (const slot of data.slots) {
        for (let parent = slot.boneData; parent; parent = parent.parent) {
          if (parent === bone) { slots++; break; }
        }
      }
      return slots >= 8;
    });
    for (const bone of nestedViews) {
      for (let parent = bone.parent; parent; parent = parent.parent) candidates.delete(parent);
      candidates.add(bone);
    }
    const viewBranchForBone = bone => {
      for (let parent = bone; parent; parent = parent.parent) if (candidates.has(parent)) return `bone:${parent.index}`;
      return undefined;
    };
    const viewSlotBranches = data.slots.map(slot => viewBranchForBone(slot.boneData));
    const animationBoneCounts = new Map();
    for (const animation of data.animations) {
      const counts = new Map();
      for (const timeline of animation.timelines) {
        if (!Number.isInteger(timeline.boneIndex)) continue;
        const branch = viewBranchForBone(data.bones[timeline.boneIndex]);
        if (branch) counts.set(branch, (counts.get(branch) || 0) + 1);
      }
      animationBoneCounts.set(animation.name, counts);
    }
    const idleCounts = new Map();
    for (const animation of data.animations.filter(item => /^idle\d+$/i.test(item.name))) {
      // Copied setup attachments do not identify the actual animated pose rig.
      idleCounts.set(animation.name.toLowerCase(), animationBoneCounts.get(animation.name));
    }
    const extraViews = new Set([...new Set(viewSlotBranches.filter(Boolean))].filter(branch => {
      if (viewSlotBranches.filter(value => value === branch).length < 8) return false;
      const numbered = Math.max(0, ...[...idleCounts.values()].map(counts => counts.get(branch) || 0));
      const other = Math.max(0, ...data.animations.filter(animation => !isNumbered(animation.name))
        .map(animation => animationBoneCounts.get(animation.name).get(branch) || 0));
      return other >= 20 && numbered < other * 0.1;
    }));
    const eligible = [...new Set(viewSlotBranches.filter(Boolean))].filter(branch => {
      const maximum = Math.max(0, ...[...idleCounts.values()].map(counts => counts.get(branch) || 0));
      return !extraViews.has(branch) && maximum >= 20 && viewSlotBranches.filter(value => value === branch).length >= 8;
    });
    const viewOwners = new Map(eligible.map(branch => [branch, new Set()]));
    for (const [state, counts] of idleCounts) {
      const maximum = Math.max(0, ...eligible.map(branch => counts.get(branch) || 0));
      if (!maximum) continue;
      for (const branch of eligible) if ((counts.get(branch) || 0) >= maximum * 0.6) viewOwners.get(branch).add(state);
    }
    for (const [branch, states] of viewOwners) if (!states.size) viewOwners.delete(branch);
    const views = [...viewOwners.values()];
    const independentViews = extraViews.size > 0 || views.some((states, index) => views.slice(index + 1)
      .some(other => ![...states].some(state => other.has(state))));
    hidden.staticHidden = new Map(hidden);
    hidden.stateViewMasks = new Map();
    hidden.extraViewAnimations = new Set();
    if (independentViews) {
      const statesByViewName = new Map();
      for (const bone of candidates) {
        const name = namedView(bone.name);
        const states = viewOwners.get(viewBranchForBone(bone));
        if (name && states) statesByViewName.set(name, states);
      }
      for (const bone of candidates) {
        const states = statesByViewName.get(namedView(bone.name));
        if (states && !viewOwners.has(viewBranchForBone(bone))) viewOwners.set(viewBranchForBone(bone), states);
      }
      for (const state of idleCounts.keys()) {
        hidden.stateViewMasks.set(state, viewSlotBranches.flatMap((branch, index) => {
          const states = viewOwners.get(branch);
          return extraViews.has(branch) || (states && !states.has(state)) ? [index] : [];
        }));
      }
      for (const animation of data.animations) {
        const state = animation.name.match(/^(?:idle|mix|motion)(\d+)/i)?.[1];
        const mask = state && hidden.stateViewMasks.get(`idle${state}`);
        if (mask) hidden.set(animation.name, [...new Set([...hidden.get(animation.name), ...mask])]);
        const counts = animationBoneCounts.get(animation.name);
        const extraMaximum = Math.max(0, ...[...extraViews].map(branch => counts.get(branch) || 0));
        const baseMaximum = Math.max(0, ...[...viewOwners.keys()].map(branch => counts.get(branch) || 0));
        const usesExtraView = isNumbered(animation.name) && extraMaximum >= 20 && extraMaximum > baseMaximum;
        if (!isNumbered(animation.name) || usesExtraView) {
          const allViews = new Set([...viewOwners.keys(), ...extraViews]);
          const maximum = Math.max(0, ...[...allViews].map(branch => counts.get(branch) || 0));
          if (maximum < 20) continue;
          const active = new Set([...(usesExtraView ? extraViews : allViews)].filter(branch => (counts.get(branch) || 0) >= maximum * 0.6));
          // Components named for a numbered view follow the same pose rig.
          for (const bone of candidates) {
            const name = namedView(bone.name);
            if (name && [...candidates].some(other => namedView(other.name) === name && active.has(viewBranchForBone(other)))) active.add(viewBranchForBone(bone));
          }
          const inactive = viewSlotBranches.flatMap((branch, index) => allViews.has(branch) && !active.has(branch) ? [index] : []);
          hidden.set(animation.name, [...new Set([...hidden.staticHidden.get(animation.name), ...inactive])]);
          if (usesExtraView) hidden.extraViewAnimations.add(animation.name);
        }
      }
    }
    return hidden;
  }

  // Work with loaded SkeletonData so JSON and binary resources use the same rules.
  function inferAnimationGraph(data, spineRuntime, fallbackIdle) {
    const idleAnimations = data.animations.filter(animation => /^idle\d+(?:[a-z].*)?$/i.test(animation.name));
    const mixAnimations = data.animations.filter(animation => /^mix\d+_\d+_/i.test(animation.name));
    if (!idleAnimations.length || !mixAnimations.length) return undefined;
    const skeleton = new spineRuntime.Skeleton(data);
    const sample = (animation, time, base) => {
      skeleton.setToSetupPose();
      base?.apply(skeleton, 0, 0, true, [], 1, spineRuntime.MixBlend.first, spineRuntime.MixDirection.mixIn);
      animation.apply(skeleton, time, time, false, [], 1, spineRuntime.MixBlend.replace, spineRuntime.MixDirection.mixIn);
      return {
        attachments: skeleton.slots.map(slot => slot.getAttachment()?.name || null),
        bones: skeleton.bones.map(bone => [bone.rotation, bone.x, bone.y, bone.scaleX, bone.scaleY, bone.shearX, bone.shearY])
      };
    };
    const references = idleAnimations.filter(animation => /^idle\d+$/i.test(animation.name)
      || !idleAnimations.some(other => other.name.toLowerCase() === animation.name.match(/^idle\d+/i)[0].toLowerCase())).map(animation => ({
      name: animation.name,
      poses: [0, 0.25, 0.5, 0.75].map(fraction => sample(animation, animation.duration * fraction))
    }));
    const scale = Math.max(Math.abs(data.width || 0), Math.abs(data.height || 0), 1);
    const idleProperties = idleAnimations.flatMap(animation => animation.timelines.flatMap(timeline => timeline.getPropertyIds()));
    const rank = (animation, time, base) => {
      const actual = sample(animation, time, base);
      const slots = new Set([...idleAnimations, animation].flatMap(item => item.timelines)
        .filter(timeline => timeline.attachmentNames).map(timeline => timeline.slotIndex));
      const keyedSlots = new Set(animation.timelines.filter(timeline => timeline.attachmentNames).map(timeline => timeline.slotIndex));
      const keyedProperties = new Set(animation.timelines.flatMap(timeline => timeline.getPropertyIds())
        .filter(id => /^([0-6])\|\d+$/.test(id)));
      const properties = new Set([...idleProperties, ...animation.timelines.flatMap(timeline => timeline.getPropertyIds())]
        .filter(id => /^([0-6])\|\d+$/.test(id)));
      const distanceChannels = (reference, selectedSlots, selectedProperties) => {
        let attachments = 0;
        let bones = 0;
        for (const index of selectedSlots) if (actual.attachments[index] !== reference.attachments[index]) attachments += 1;
        for (const id of selectedProperties) {
          const [type, index] = id.split("|").map(Number);
          const difference = actual.bones[index][type] - reference.bones[index][type];
          const normalized = type === 0 || type >= 5
            ? Math.abs(((difference % 360 + 540) % 360) - 180) / 180
            : type <= 2 ? Math.abs(difference) / scale : Math.abs(difference);
          // One malformed coordinate must not outweigh all of the other keyed channels.
          bones += Number.isFinite(normalized) ? Math.min(normalized, 2) : 2;
        }
        return attachments * 4 / Math.max(selectedSlots.size, 1) + bones / Math.max(selectedProperties.size, 1);
      };
      // Keyed endpoint channels identify the destination; the whole pose distinguishes
      // otherwise identical partial endpoints without making inherited source channels dominant.
      const distance = reference => distanceChannels(reference, keyedSlots, keyedProperties)
        + 0.25 * distanceChannels(reference, slots, properties);
      return references.map(reference => ({ name: reference.name, score: Math.min(...reference.poses.map(distance)) }))
        .sort((a, b) => a.score - b.score);
    };
    const stateForStage = stage => idleAnimations.find(animation => animation.name.toLowerCase() === `idle${stage}`);
    const groups = new Map();
    for (const animation of mixAnimations) {
      const match = animation.name.match(/^mix(\d+)_(\d+)_(.*)$/i);
      const phase = match[3].match(/^(\d+|end)(?:_?(.*))?$/i);
      const variant = phase ? (phase[2] || "").toLowerCase() : match[3].toLowerCase();
      const id = `mix${match[1]}_${match[2]}${variant ? `@${variant}` : ""}`;
      if (!groups.has(id)) groups.set(id, { id, stage: match[1], variant, parts: [] });
      groups.get(id).parts.push({ name: animation.name, order: phase ? (/^end$/i.test(phase[1]) ? Infinity : Number(phase[1])) : 0 });
    }
    const sequences = [...groups.values()].map(group => {
      group.parts.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
      const first = data.findAnimation(group.parts[0].name);
      const base = stateForStage(group.stage)?.name || rank(first, 0)[0]?.name || fallbackIdle;
      return { id: group.id, base, variant: group.variant, animations: group.parts.map(part => part.name) };
    });
    const transitions = data.animations.filter(animation => /^motion\d+(?:_|$)/i.test(animation.name)).map(animation => {
      const stage = animation.name.match(/^motion(\d+)/i)[1];
      const from = stateForStage(stage)?.name || rank(animation, 0)[0]?.name || fallbackIdle;
      const ranked = rank(animation, animation.duration, data.findAnimation(from));
      const best = ranked[0];
      const margin = ranked[1] ? ranked[1].score - best.score : Infinity;
      const confident = (best.score < 0.00001 && margin > 0.000001) || (margin > 0.002 && margin > best.score * 0.12);
      return { animation: animation.name, from, to: confident ? best.name : from, inferred: true, uncertain: !confident, candidates: ranked.slice(0, 3) };
    });
    skeleton.dispose?.();
    return { format: "asterpet.animation-graph/v1", automatic: true, states: idleAnimations.map(animation => animation.name), transitions, sequences };
  }

  function resolveAnimationGraph(config, animationNames) {
    if (!config) return undefined;
    if (config.format !== "asterpet.animation-graph/v1") throw new Error("不支持的动作图格式");
    const available = new Set(animationNames);
    const states = new Set(config.states || []);
    if (!states.size || [...states].some(name => !available.has(name))) throw new Error("动作图包含不存在的基础姿态");
    const transitions = new Map();
    const sequences = new Map();
    const bases = new Map();
    for (const entry of config.transitions || []) {
      if (!available.has(entry.animation) || !states.has(entry.from) || !states.has(entry.to)) {
        throw new Error(`动作图切换无效：${entry.animation}`);
      }
      transitions.set(entry.animation, { ...entry });
      bases.set(entry.animation, entry.from);
    }
    for (const entry of config.sequences || []) {
      const compatibleBases = entry.compatibleBases || [entry.base];
      if (!entry.id || !states.has(entry.base) || compatibleBases.some(name => !states.has(name))
        || !entry.animations?.length || entry.animations.some(name => !available.has(name))) {
        throw new Error(`动作图片段组无效：${entry.id}`);
      }
      const sequence = { ...entry, compatibleBases };
      if (sequences.has(entry.id) || states.has(entry.id) || transitions.has(entry.id)) {
        throw new Error(`动作图选项重复：${entry.id}`);
      }
      sequences.set(entry.id, sequence);
      for (const name of entry.animations) {
        if (bases.has(name)) throw new Error(`动作图片段重复：${name}`);
        bases.set(name, entry.base);
      }
    }
    return { states, transitions, sequences, bases, automatic: Boolean(config.automatic) };
  }

  function findTransitionPath(graph, from, to) {
    if (from === to) return [];
    const pending = [{ state: from, path: [] }];
    const visited = new Set([from]);
    for (let index = 0; index < pending.length; index += 1) {
      const { state, path } = pending[index];
      for (const transition of graph.transitions.values()) {
        if (transition.from !== state || visited.has(transition.to)) continue;
        const nextPath = [...path, transition];
        if (transition.to === to) return nextPath;
        visited.add(transition.to);
        pending.push({ state: transition.to, path: nextPath });
      }
    }
    return undefined;
  }

  function findTerminalPlayback(data, runtime, baseName, animationNames, skin, rigVisibility) {
    const skeleton = new runtime.Skeleton(data);
    if (skin) skeleton.setSkin(skin);
    const base = data.findAnimation(baseName);
    if (!base) return { animations: animationNames };
    base.apply(skeleton, 0, 0, true, [], 1, runtime.MixBlend.first, runtime.MixDirection.mixIn);
    const baseNames = skeleton.slots.map(slot => slot.attachment?.name || null);
    const currentNames = [...baseNames];
    const resets = animationNames.map(name => {
      const animation = data.findAnimation(name);
      const hiddenSlots = new Set(rigVisibility?.get(name) || []);
      const clusters = new Map();
      let attachmentChannels = 0;
      let hasOtherAttachments = false;
      for (const timeline of animation.timelines) {
        if (!Array.isArray(timeline.attachmentNames)) continue;
        if (hiddenSlots.has(timeline.slotIndex)) continue;
        attachmentChannels++;
        const slot = timeline.slotIndex;
        let previous = currentNames[slot];
        for (let index = 0; index < timeline.frames.length; index++) {
          const target = timeline.attachmentNames[index] || null;
          if (target !== baseNames[slot]) hasOtherAttachments = true;
          const time = timeline.frames[index];
          if (previous !== target && target === baseNames[slot]) {
            const key = Math.round(time * 1000);
            const cluster = clusters.get(key) || { time, slots: new Set() };
            cluster.time = Math.min(cluster.time, time);
            cluster.slots.add(slot);
            clusters.set(key, cluster);
          }
          previous = target;
        }
        currentNames[slot] = previous;
      }
      // A batch restoring the base attachments marks an authored reset, not a new pose.
      const reset = [...clusters.values()].filter(cluster => cluster.slots.size >= 4
        && (cluster.time === 0 || cluster.time >= animation.duration * 0.5))
        .sort((a, b) => a.time - b.time)[0];
      return { reset, restoreOnlyEnd: /_end(?:\d*)$/i.test(name) && attachmentChannels >= 4 && !hasOtherAttachments };
    });
    for (let index = animationNames.length - 1; index >= 0; index--) {
      const { reset, restoreOnlyEnd } = resets[index];
      if ((reset?.time === 0 || restoreOnlyEnd) && index > 0) continue;
      return {
        animations: animationNames.slice(0, index + 1),
        endTime: reset?.time > 0 ? Math.max(0, reset.time - 1 / (data.fps || 60)) : undefined,
        restoredSlots: reset ? [...reset.slots].map(slot => data.slots[slot].name) : []
      };
    }
    return { animations: animationNames };
  }

  function holdAnimationPose(player, entry = player.animationState.getCurrent(1) || player.animationState.getCurrent(0)) {
    const tails = typeof module !== "undefined" && module.exports ? require("./animation-tail-loop.js") : window.AsterPet;
    tails.loopAnimationTail(player, entry);
  }

  function releaseAnimationPose(player) {
    const tails = typeof module !== "undefined" && module.exports ? require("./animation-tail-loop.js") : window.AsterPet;
    tails.releaseAnimationTail(player);
  }

  class AnimationGraphPlayer {
    constructor({ getPlayer, getScene, spineRuntime, onAnimation, onSelection, log }) {
      Object.assign(this, { getPlayer, getScene, spineRuntime, onAnimation, onSelection, log });
      this.generation = 0;
      this.interactionMode = "manual";
    }

    get enabled() { return Boolean(this.graph || this.cinematic); }

    start(animationNames) {
      this.stop();
      const scene = this.getScene();
      const data = this.getPlayer()?.skeleton?.data;
      const config = scene.behavior?.animationGraph || (data && inferAnimationGraph(data, this.spineRuntime, scene.actions.idle.animation));
      this.graph = resolveAnimationGraph(config, animationNames);
      if (!this.graph) {
        const cinematicRuntime = typeof module !== "undefined" && module.exports
          ? require("./cinematic-player.js") : window.AsterPet;
        // Imported bundles may label cut/loop resources as interaction or
        // character. Their actual animation structure determines playback.
        const plan = data && cinematicRuntime.inferCinematicPlan(data, this.spineRuntime, scene.actions.idle.animation);
        if (plan) {
          this.cinematic = new cinematicRuntime.CinematicPlayer({
            getPlayer: this.getPlayer, spineRuntime: this.spineRuntime, plan,
            onAnimation: name => this.showAnimation(name), onSelection: name => this.select(name),
            onState: name => { this.currentState = name; }, log: this.log
          });
          this.cinematic.setInteractionMode(this.interactionMode);
          this.currentState = plan.idle;
          this.log(`Cinematic ready: ${plan.shots.length} shots, ${plan.loops.length} loops, ${plan.endings.size} authored endings`);
        }
        return;
      }
      this.rigVisibility = buildRigVisibility(data);
      this.currentState = this.graph.states.has(scene.actions.idle.animation)
        ? scene.actions.idle.animation : this.graph.states.values().next().value;
      this.log(`Animation graph ready: ${this.graph.states.size} states, ${this.graph.transitions.size} transitions, ${this.graph.sequences.size} sequences`);
      const uncertain = [...this.graph.transitions.values()].filter(entry => entry.uncertain);
      if (uncertain.length) this.log(`Animation graph keeps the source pose for ambiguous transitions: ${uncertain.map(entry => entry.animation).join(", ")}`);
    }

    stop() {
      this.cinematic?.stop();
      this.cinematic = undefined;
      releaseAnimationPose(this.getPlayer());
      this.heldPose = false;
      this.generation += 1;
      clearTimeout(this.finishTimer);
      this.finishTimer = undefined;
      this.graph = undefined;
      this.currentState = undefined;
      this.selection = undefined;
      this.viewportAnimation = undefined;
      this.rigVisibility = undefined;
      this.interactionQueue = [];
      this.interactionSeriesActive = false;
      this.actionCursorByState = new Map();
      this.terminalPlaybackCache = new Map();
    }

    choices() {
      if (this.cinematic) return this.cinematic.choices();
      if (!this.graph) return [];
      const stateLabel = name => name.replace(/^idle/i, "");
      return [
        ...[...this.graph.states].map(id => ({ id, label: `待机 ${stateLabel(id)}` })),
        ...[...this.graph.transitions.values()].map(entry => ({
          id: entry.animation, label: entry.uncertain ? `动作 ${entry.animation}` : `切换 ${stateLabel(entry.from)} → ${stateLabel(entry.to)}`
        })),
        ...[...this.graph.sequences.values()].map(entry => ({
          id: entry.id, label: `动作 ${entry.id.split("@")[0].replace(/^mix/i, "").replaceAll("_", "-")}${entry.variant ? ` · ${entry.variant} 版` : ""}${entry.animations.length > 1 ? ` · ${entry.animations.length} 段` : ""}`
        })),
        ...this.listUnmappedAnimations().map(id => ({ id, label: id }))
      ];
    }

    listUnmappedAnimations() {
      return this.getPlayer().skeleton.data.animations.map(animation => animation.name)
        .filter(name => !this.graph.states.has(name) && !this.graph.bases.has(name));
    }

    getBaseAnimation(animationName) {
      if (this.cinematic) return this.cinematic.baseFor(animationName);
      if (!this.graph) return undefined;
      const sequence = [...this.graph.sequences.values()].find(entry => entry.animations.includes(animationName));
      if (sequence?.compatibleBases.includes(this.currentState)) return this.currentState;
      return this.graph.bases.get(animationName);
    }

    getHiddenRigSlots(animationName) {
      if (this.cinematic) return this.cinematic.hiddenRigSlots(animationName);
      if (this.rigVisibility?.extraViewAnimations.has(animationName)) return this.rigVisibility.get(animationName);
      if (/^(?:mix|motion)\d+/i.test(animationName || "")) {
        const state = this.currentState?.match(/^idle\d+/i)?.[0].toLowerCase();
        const mask = this.rigVisibility?.stateViewMasks.get(state);
        if (mask) return [...new Set([...(this.rigVisibility.staticHidden.get(animationName) || []), ...mask])];
      }
      return this.rigVisibility?.get(animationName) || [];
    }

    getViewportAnimations(animationName) {
      if (this.cinematic) return [animationName];
      const sequence = this.graph && [...this.graph.sequences.values()].find(entry => entry.animations.includes(animationName));
      return sequence ? [...sequence.animations, this.getBaseAnimation(animationName)] : [animationName];
    }

    select(name) {
      this.selection = name;
      this.onSelection(name);
    }

    showAnimation(name) {
      if (name === this.viewportAnimation) return;
      this.viewportAnimation = name;
      this.onAnimation(name);
    }

    setBase(name, preserveTime = false) {
      const player = this.getPlayer();
      releaseAnimationPose(player);
      this.heldPose = false;
      const previous = player.animationState.getCurrent(0);
      const time = preserveTime && previous?.animation.name === name ? previous.trackTime : 0;
      player.animationState.clearTracks();
      player.skeleton.setToSetupPose();
      this.currentState = name;
      this.showAnimation(name);
      const entry = player.animationState.setAnimation(0, name, true);
      entry.mixDuration = 0;
      entry.trackTime = time;
      entry.animation.apply(player.skeleton, time, time, true, [], 1, this.spineRuntime.MixBlend.first, this.spineRuntime.MixDirection.mixIn);
      player.skeleton.updateWorldTransform();
    }

    transition(entry, generation, complete, holdFinal = false) {
      const player = this.getPlayer();
      const trackEntry = player.animationState.setAnimation(1, entry.animation, false);
      trackEntry.mixDuration = 0;
      this.showAnimation(entry.animation);
      trackEntry.listener = {
        complete: () => {
          if (generation !== this.generation) return;
          if (holdFinal) {
            this.currentState = entry.to;
            if (entry.to !== entry.from) {
              const base = player.animationState.setAnimation(0, entry.to, true);
              base.mixDuration = 0.12;
            }
            this.heldPose = true;
            holdAnimationPose(player, trackEntry);
            return;
          }
          this.setBase(entry.to);
          complete();
        }
      };
    }

    reachState(target, generation, complete) {
      const path = findTransitionPath(this.graph, this.currentState, target);
      if (!path) {
        // Select the requested base pose directly when the graph has no route.
        this.setBase(target);
        complete();
        return;
      }
      const next = index => {
        if (generation !== this.generation) return;
        if (index === path.length) complete();
        else this.transition(path[index], generation, () => next(index + 1));
      };
      next(0);
    }

    sequence(entry, generation, initialMix = 0, holdFinal = false) {
      const player = this.getPlayer();
      let playback = { animations: entry.animations };
      if (holdFinal && this.graph.sequences.has(entry.id)) {
        const key = `${this.currentState}:${entry.id}:${player.skeleton.skin?.name || ""}`;
        playback = this.terminalPlaybackCache.get(key);
        if (!playback) {
          playback = findTerminalPlayback(player.skeleton.data, this.spineRuntime, this.currentState, entry.animations, player.skeleton.skin, this.rigVisibility);
          this.terminalPlaybackCache.set(key, playback);
        }
        if (playback.endTime !== undefined || playback.animations.length !== entry.animations.length) {
          this.log(`Toolbar terminal pose before authored reset: ${entry.id}, ${playback.animations.at(-1)} at ${playback.endTime ?? "end"}`);
        }
      }
      let previous;
      const entries = playback.animations.map((name, index) => {
        const trackEntry = index === 0
          ? player.animationState.setAnimation(1, name, false)
          : player.animationState.addAnimation(1, name, false, previous.animation.duration);
        trackEntry.mixDuration = index === 0 ? initialMix : 0;
        if (index === playback.animations.length - 1 && playback.endTime !== undefined) trackEntry.animationEnd = playback.endTime;
        previous = trackEntry;
        trackEntry.listener = {
          start: () => { if (generation === this.generation) this.showAnimation(name); }
        };
        return trackEntry;
      });
      this.showAnimation(playback.animations[0]);
      entries.at(-1).listener.complete = () => {
        if (generation !== this.generation) return;
        if (holdFinal) {
          this.heldPose = true;
          holdAnimationPose(player);
          return;
        }
        if (this.interactionQueue.length) {
          const next = this.interactionQueue.shift();
          this.select(next.id);
          this.actionCursorByState.set(this.currentState, next.id);
          this.sequence(next, generation, 0.12);
          return;
        }
        player.animationState.setEmptyAnimation(1, 0.12);
        this.finishTimer = setTimeout(() => {
          if (generation !== this.generation) return;
          this.setBase(this.currentState, true);
          this.select(this.currentState);
          this.interactionSeriesActive = false;
        }, 120);
      };
    }

    cycleState() {
      if (!this.graph) return false;
      const overlay = this.getPlayer().animationState.getCurrent(1);
      if (overlay && this.graph.transitions.has(overlay.animation.name) && !this.heldPose) return true;
      const numbered = [...this.graph.states].filter(name => /^idle\d+$/i.test(name));
      const states = (numbered.length ? numbered : [...this.graph.states])
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (states.length < 2) return true;
      const canonical = this.currentState.match(/^idle\d+/i)?.[0];
      const index = states.findIndex(name => name === this.currentState || name.toLowerCase() === canonical?.toLowerCase());
      return this.play(states[(index + 1) % states.length]);
    }

    interact(gesture = "click") {
      if (this.cinematic) return this.cinematic.interact(gesture);
      if (!this.graph) return false;
      if (gesture === "doubleClick") return this.cycleState();
      if (gesture === "previous" || this.interactionMode === "manual") {
        return this.stepAction(gesture === "previous" ? -1 : 1);
      }
      const player = this.getPlayer();
      if (this.interactionSeriesActive) { player.play(); return true; }
      const active = this.graph.sequences.get(this.selection);
      const overlay = player.animationState.getCurrent(1);
      // A body click cannot redirect a pending pose change or a separate cut view.
      if ((!active && !this.graph.states.has(this.selection) && !(this.heldPose && this.graph.transitions.has(this.selection)))
        || (active && !active.compatibleBases.includes(this.currentState))) return true;
      if (overlay && this.graph.transitions.has(overlay.animation.name) && !this.heldPose) return true;
      const groups = [...this.graph.sequences.values()].filter(entry => !entry.variant
        && entry.compatibleBases.includes(this.currentState)
        && entry.animations.some(name => player.skeleton.data.findAnimation(name).duration > 0));
      if (!groups.length) return true;
      const wasHeld = this.heldPose;
      this.resumeHeldPose();
      this.interactionSeriesActive = true;
      if (!wasHeld && active && overlay && active.animations.includes(overlay.animation.name)) {
        this.interactionQueue = groups.slice(Math.max(0, groups.indexOf(active) + 1));
      } else {
        const generation = ++this.generation;
        clearTimeout(this.finishTimer);
        const [next, ...remaining] = groups;
        this.interactionQueue = remaining;
        this.select(next.id);
        this.actionCursorByState.set(this.currentState, next.id);
        this.sequence(next, generation, 0.12);
      }
      player.play();
      return true;
    }

    setInteractionMode(mode) {
      this.interactionMode = mode === "auto" ? "auto" : "manual";
      this.cinematic?.setInteractionMode(this.interactionMode);
      if (this.interactionMode === "manual") {
        this.interactionQueue = [];
        this.interactionSeriesActive = false;
      }
    }

    resumeHeldPose() {
      if (!this.heldPose) return;
      releaseAnimationPose(this.getPlayer());
      this.heldPose = false;
      const base = this.getPlayer().animationState.getCurrent(0);
      if (base?.animation.name !== this.currentState || !base.loop) this.setBase(this.currentState, true);
    }

    stepAction(direction) {
      const player = this.getPlayer();
      const active = this.graph.sequences.get(this.selection);
      const overlay = player.animationState.getCurrent(1);
      if ((!active && !this.graph.states.has(this.selection) && !(this.heldPose && this.graph.transitions.has(this.selection)))
        || (active && !active.compatibleBases.includes(this.currentState))
        || (overlay && this.graph.transitions.has(overlay.animation.name) && !this.heldPose)) return true;
      const groups = [...this.graph.sequences.values()].filter(entry => !entry.variant
        && entry.compatibleBases.includes(this.currentState)
        && entry.animations.some(name => player.skeleton.data.findAnimation(name).duration > 0));
      if (!groups.length) return true;
      this.resumeHeldPose();
      const cursor = active?.id || this.actionCursorByState.get(this.currentState);
      const index = groups.findIndex(entry => entry.id === cursor);
      const next = groups[index < 0 ? (direction < 0 ? groups.length - 1 : 0)
        : (index + direction + groups.length) % groups.length];
      const generation = ++this.generation;
      clearTimeout(this.finishTimer);
      this.interactionQueue = [];
      this.interactionSeriesActive = false;
      this.actionCursorByState.set(this.currentState, next.id);
      this.select(next.id);
      this.sequence(next, generation, 0.12);
      player.play();
      return true;
    }

    play(name, { holdFinal = false } = {}) {
      if (this.cinematic) return this.cinematic.play(name, { holdFinal });
      if (!this.graph) return false;
      const sequence = this.graph.sequences.get(name)
        || [...this.graph.sequences.values()].find(entry => entry.animations.includes(name));
      const transition = this.graph.transitions.get(name);
      const extra = !sequence && !transition && !this.graph.states.has(name)
        && this.getPlayer().skeleton.data.findAnimation(name);
      if (!sequence && !transition && !this.graph.states.has(name) && !extra) return false;
      const generation = ++this.generation;
      this.interactionQueue = [];
      this.interactionSeriesActive = false;
      clearTimeout(this.finishTimer);
      this.setBase(this.currentState);
      this.select(sequence?.id || name);
      if (extra) {
        this.sequence({ animations: [name] }, generation, 0, holdFinal);
      } else if (sequence) {
        const base = sequence.compatibleBases.includes(this.currentState) ? this.currentState : sequence.base;
        this.reachState(base, generation, () => {
          this.actionCursorByState.set(this.currentState, sequence.id);
          this.sequence(sequence, generation, 0, holdFinal);
        });
      } else if (transition) {
        this.reachState(transition.from, generation, () => this.transition(transition, generation, () => this.select(transition.to), holdFinal));
      } else {
        this.reachState(name, generation, () => {
          this.select(name);

        });
      }
      this.getPlayer().play();
      return true;
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { AnimationGraphPlayer, resolveAnimationGraph, findTransitionPath, inferAnimationGraph, buildRigVisibility, holdAnimationPose, releaseAnimationPose, findTerminalPlayback };
  if (typeof window !== "undefined") {
    window.AsterPet = window.AsterPet || {};
    window.AsterPet.AnimationGraphPlayer = AnimationGraphPlayer;
    window.AsterPet.holdAnimationPose = holdAnimationPose;
    window.AsterPet.releaseAnimationPose = releaseAnimationPose;
  }
})();
