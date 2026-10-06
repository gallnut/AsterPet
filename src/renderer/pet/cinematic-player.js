(function registerCinematicPlayer() {
  const leaf = name => name.split("/").at(-1);
  const isLoop = name => /^(?:loop|.*_idle|idle)(?:$|[_\d])/i.test(leaf(name));
  const isArchive = name => /(?:bak|back|old|org|test|temp|xport)/i.test(leaf(name));
  const fullCut = name => /^(?:all(?:_?\d+)?(?:_cut)?|cut_all)$/i.test(leaf(name));
  function cutParts(name) {
    const value = leaf(name);
    const match = value.match(/^cut_([a-z]|\d+)(.*)$/i) || value.match(/^([a-z]|\d+)_cut(.*)$/i);
    return match && { family: match[1].toUpperCase(), suffix: match[2] };
  }

  function buildCinematicRigVisibility(data) {
    // View containers may be nested under a shared All/Master camera bone.
    // Only containers with an exact cut name identify a view; numbered child
    // bones (A_cut2, etc.) are parts of that view rather than new cameras.
    const roots = new Set(data.bones.filter(bone => {
      const parts = cutParts(bone.name);
      if (!parts || parts.suffix) return false;
      for (let parent = bone.parent; parent; parent = parent.parent) {
        const outer = cutParts(parent.name);
        if (outer && !outer.suffix) return false;
      }
      return true;
    }));
    const rootFor = bone => {
      for (; bone; bone = bone.parent) if (roots.has(bone)) return bone;
    };
    const slotRoots = data.slots.map(slot => rootFor(slot.boneData));
    for (const root of roots) if (slotRoots.filter(value => value === root).length < 8) roots.delete(root);
    const masks = new Map();
    if (roots.size < 2) return masks;
    for (const animation of data.animations) {
      const bones = new Map([...roots].map(root => [root, new Set()]));
      for (const timeline of animation.timelines) {
        if (!Number.isInteger(timeline.boneIndex)) continue;
        // Setup/reset scale keys on a whole rig do not activate that viewpoint.
        const bone = data.bones[timeline.boneIndex], root = rootFor(bone);
        if (root && bone !== root) bones.get(root)?.add(bone.index);
      }
      const active = [...bones].filter(([, keyed]) => keyed.size >= 8).map(([root]) => root);
      if (active.length !== 1) continue; // Authored multi-view cuts/crossfades retain their visibility keys.
      const selected = active[0];
      const inactive = new Set([...roots].filter(root => root !== selected));
      // A clip can animate one rig while explicitly bringing another into view.
      // Do not override positive visibility keys on that other rig.
      for (const root of [...inactive]) {
        const activatedSlots = new Set(animation.timelines.filter(t => t.attachmentNames?.some(Boolean)
          && slotRoots[t.slotIndex] === root).map(t => t.slotIndex));
        const visibility = animation.timelines.some(t => slotRoots[t.slotIndex] === root
          && /^(?:Alpha|RGBA|RGBA2)Timeline$/.test(t.constructor.name)
          && t.frames.length > t.getFrameEntries()
          && Array.from(t.frames).some((value, i) => i % t.getFrameEntries() === (/^Alpha/.test(t.constructor.name) ? 1 : 4) && value > 0.02));
        const scaleVisibility = animation.timelines.some(t => t.boneIndex === root.index
          && /^Scale(?:X|Y)?Timeline$/.test(t.constructor.name)
          && Array.from(t.frames).some((value, i) => i % t.getFrameEntries() === 1 && Math.abs(value) < 0.001)
          && Array.from(t.frames).some((value, i) => i % t.getFrameEntries() === 1 && Math.abs(value) > 0.001));
        if (activatedSlots.size >= 8 || visibility || scaleVisibility) inactive.delete(root);
      }
      masks.set(animation.name, slotRoots.flatMap((root, index) => inactive.has(root) ? [index] : []));
    }
    return masks;
  }

  // Camera cuts are authored visibility changes, never continuous pose tracking.
  // Keep native bone translation/scale (pans, zooms, shake) within each shot.
  function cinematicCutTimes(data, animation) {
    const events = new Map();
    const add = (time, weight) => {
      if (time <= 0 || time >= animation.duration - 1 / 60) return;
      const frame = Math.round(time * 30);
      events.set(frame, (events.get(frame) || 0) + weight);
    };
    for (const timeline of animation.timelines) {
      if (timeline.attachmentNames) {
        for (let i = 1; i < timeline.frames.length; i += 1) {
          if (timeline.attachmentNames[i] !== timeline.attachmentNames[i - 1]) add(timeline.frames[i], 1);
        }
      } else if (/^Scale(?:X|Y)?Timeline$/.test(timeline.constructor.name)) {
        const bone = data.bones[timeline.boneIndex];
        const slots = data.slots.filter(slot => {
          for (let parent = slot.boneData; parent; parent = parent.parent) if (parent === bone) return true;
          return false;
        }).length;
        if (slots < 8) continue;
        const stride = timeline.getFrameEntries();
        for (let i = stride; i < timeline.frames.length; i += stride) {
          const visible = offset => Math.abs(timeline.frames[offset + 1]) > 0.001
            && (stride < 3 || Math.abs(timeline.frames[offset + 2]) > 0.001);
          if (visible(i) !== visible(i - stride)) add(timeline.frames[i], slots);
        }
      }
    }
    return [0, ...[...events].filter(([, count]) => count >= 8).map(([frame]) => frame / 30).sort((a, b) => a - b)];
  }

  function inferCinematicPlan(data, runtime, fallbackIdle) {
    const loops = data.animations.filter(a => isLoop(a.name));
    const cuts = data.animations.filter(a => cutParts(a.name) || fullCut(a.name) || /^cut$/i.test(leaf(a.name)));
    if (!loops.length || !cuts.length) return undefined;
    const names = new Map(data.animations.map(a => [a.name.toLowerCase(), a.name]));
    const canonicalLoops = loops.filter(a => !isArchive(a.name) && /^(?:loop_?\d*|idle_?\d*|.*_cut_idle|cut_.*_idle)$/i.test(leaf(a.name)));
    const primary = cuts.filter(a => !isArchive(a.name) && !fullCut(a.name) && !isLoop(a.name)
      && (!cutParts(a.name)?.suffix || /^_\d+(?:_\d+)*$/.test(cutParts(a.name).suffix)));
    // A family-level authored assembly takes precedence over its numbered pieces.
    const families = new Map();
    for (const cut of primary) {
      const family = cutParts(cut.name)?.family || cut.name;
      if (!families.has(family)) families.set(family, []);
      families.get(family).push(cut.name);
    }
    for (const [family, parts] of families) {
      const assembled = cuts.find(a => cutParts(a.name)?.family === family && /^_all$/i.test(cutParts(a.name).suffix));
      families.set(family, assembled ? [assembled.name] : parts.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
    }
    const full = cuts.filter(a => fullCut(a.name) && !isArchive(a.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const skeleton = new runtime.Skeleton(data);
    const apply = (animation, time) => animation.apply(skeleton, time, time, false, [], 1, runtime.MixBlend.replace, runtime.MixDirection.mixIn);
    const pose = () => {
      skeleton.updateWorldTransform();
      return ({
      attachments: skeleton.slots.map(slot => slot.getAttachment()?.name || null),
      visible: skeleton.slots.map(slot => Boolean(slot.getAttachment()) && slot.color.a * (slot.getAttachment()?.color?.a ?? 1) > 0.02
        && Math.abs(slot.bone.a * slot.bone.d - slot.bone.b * slot.bone.c) > 0.000001),
      bones: skeleton.bones.map(b => [b.rotation, b.x, b.y, b.scaleX, b.scaleY, b.shearX, b.shearY])
    }); };
    const scale = Math.max(Math.abs(data.width || 0), Math.abs(data.height || 0), 100);
    const endings = new Map();
    const candidates = new Map();
    for (const cut of cuts.filter(a => !isLoop(a.name))) {
      const explicit = names.get(`${cut.name}_idle`.toLowerCase());
      if (explicit) { endings.set(cut.name, { loop: explicit, reason: "named-companion" }); continue; }
      skeleton.setToSetupPose(); apply(cut, cut.duration);
      const end = pose();
      const visibleBones = new Set();
      end.visible.forEach((visible, i) => {
        if (!visible) return;
        const addBone = index => {
          for (let bone = data.bones[index]; bone; bone = bone.parent) visibleBones.add(bone.index);
        };
        addBone(data.slots[i].boneData.index);
        // Weighted meshes are attached to a container slot but animated by
        // their vertex influence bones, not just that container's ancestors.
        const influences = skeleton.slots[i].getAttachment()?.bones;
        if (influences) for (let offset = 0; offset < influences.length;) {
          const count = influences[offset++];
          for (let j = 0; j < count; j += 1) addBone(influences[offset++]);
        }
      });
      const ranked = loops.filter(loop => !isArchive(loop.name)).map(loop => {
        const phases = [0, 0.25, 0.5, 0.75].map(fraction => {
          // An idle may omit channels that the cut establishes (especially attachments).
          skeleton.setToSetupPose(); apply(cut, cut.duration); apply(loop, loop.duration * fraction);
          const next = pose();
          let mismatch = 0, slots = 0, distance = 0, channels = 0;
          for (let i = 0; i < end.attachments.length; i += 1) {
            if (!end.visible[i] && !next.visible[i]) continue;
            slots += 1;
            if (end.visible[i] !== next.visible[i] || end.visible[i] && end.attachments[i] !== next.attachments[i]) mismatch += 1;
          }
          const ids = new Set(loop.timelines.flatMap(t => t.getPropertyIds()).filter(id => /^[0-6]\|\d+$/.test(id)));
          for (const id of ids) {
            const [type, index] = id.split("|").map(Number);
            if (!visibleBones.has(index)) continue;
            const delta = next.bones[index][type] - end.bones[index][type];
            const normalized = type === 0 || type >= 5 ? Math.abs(((delta % 360 + 540) % 360) - 180) / 180
              : type <= 2 ? Math.abs(delta) / scale : Math.abs(delta);
            distance += Math.min(normalized, 2); channels += 1;
          }
          return { loop: loop.name, score: mismatch * 2 / Math.max(slots, 1) + distance / Math.max(channels, 1), channels, phase: fraction };
        });
        return phases.sort((a, b) => a.score - b.score)[0];
      }).filter(entry => entry.channels >= 8).sort((a, b) => a.score - b.score);
      const best = ranked[0], margin = ranked[1] ? ranked[1].score - best?.score : Infinity;
      candidates.set(cut.name, ranked.slice(0, 3));
      const sameView = best?.channels >= 40 && best.score < 0.65 && margin > 0.08 && !fullCut(cut.name);
      if (best && (sameView || best.score < 0.06 && (margin > 0.002 || best.score < 0.00001))) {
        endings.set(cut.name, { loop: best.loop, reason: "native-endpoint", score: best.score, phase: best.phase });
      }
    }
    skeleton.dispose?.();
    // Match named variants to the same view's named loop variant when available.
    for (const cut of cuts) {
      const parts = cutParts(cut.name);
      if (!parts?.suffix || /^_(?:\d|all|idle)/i.test(parts.suffix) || isArchive(cut.name)) continue;
      const main = cuts.find(a => cutParts(a.name)?.family === parts.family && !cutParts(a.name).suffix);
      const base = main && endings.get(main.name)?.loop;
      const companion = base && names.get(`${base}${parts.suffix}`.toLowerCase());
      if (companion && isLoop(companion)) endings.set(cut.name, { loop: companion, reason: "named-variant" });
    }
    // Some resources name every shot by a variant (e.g. cut_A_ch). Retain the
    // main performance, preferring the configured idle's variant and then the
    // clip with the most authored bone channels; omit small accessory clips.
    for (const cut of cuts.filter(a => !isLoop(a.name) && !isArchive(a.name))) {
      const family = cutParts(cut.name)?.family;
      if (!family || families.has(family)) continue;
      const options = cuts.filter(a => cutParts(a.name)?.family === family && !isLoop(a.name) && !isArchive(a.name));
      options.sort((a, b) => Number(endings.get(b.name)?.loop === fallbackIdle) - Number(endings.get(a.name)?.loop === fallbackIdle)
        || b.timelines.filter(t => Number.isInteger(t.boneIndex)).length - a.timelines.filter(t => Number.isInteger(t.boneIndex)).length);
      families.set(family, [options[0].name]);
    }
    const shots = [...families].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).flatMap(([, parts]) => parts);
    const states = canonicalLoops.length ? canonicalLoops.map(a => a.name) : loops.filter(a => !isArchive(a.name)).map(a => a.name);
    if (loops.some(a => a.name === fallbackIdle) && !states.includes(fallbackIdle)) states.unshift(fallbackIdle);
    if (!states.length) states.push(loops[0].name);
    const idle = states.includes(fallbackIdle) ? fallbackIdle : states[0];
    const predecessors = new Map();
    for (const [cut, end] of endings) if (!predecessors.has(end.loop)) predecessors.set(end.loop, cut);
    const cameras = new Map();
    for (const animation of data.animations) {
      const match = leaf(animation.name).match(/^(?:cut_)?([a-z]|\d+)(?:_cut)?_camera$/i);
      const boneCount = new Set(animation.timelines.filter(t => Number.isInteger(t.boneIndex)).map(t => t.boneIndex)).size;
      if (!match || !boneCount || boneCount > 12) continue;
      const family = match[1].toUpperCase();
      for (const cut of cuts.filter(a => cutParts(a.name)?.family === family && a !== animation)) {
        if (new Set(cut.timelines.filter(t => Number.isInteger(t.boneIndex)).map(t => t.boneIndex)).size < 40) continue;
        cameras.set(cut.name, animation.name);
        const loop = endings.get(cut.name)?.loop;
        if (loop) cameras.set(loop, animation.name);
      }
    }
    return { states, idle, shots, full: full.map(a => a.name), endings, predecessors,
      cameras, candidates, cuts: cuts.filter(a => !isLoop(a.name)).map(a => a.name), loops: loops.map(a => a.name) };
  }

  class CinematicPlayer {
    constructor({ getPlayer, spineRuntime, onAnimation, onSelection, onState, log, plan }) {
      Object.assign(this, { getPlayer, spineRuntime, onAnimation, onSelection, onState, log, plan });
      this.generation = 0;
      this.currentState = plan.idle;
      this.interactionMode = "manual";
      this.rigVisibility = buildCinematicRigVisibility(this.getPlayer().skeleton.data);
    }
    tailRuntime() { return typeof module !== "undefined" && module.exports ? require("./animation-tail-loop.js") : window.AsterPet; }
    stop() { this.generation += 1; this.queue = []; this.tailRuntime().releaseAnimationTail(this.getPlayer()); }
    choices() {
      const { plan } = this;
      const used = new Set([...plan.loops, ...plan.cuts]);
      return [
        ...(plan.shots.length > 1 || plan.full.length ? [{ id: "@cinematic", label: "完整过场" }] : []),
        ...plan.shots.map(cut => ({ id: this.shotId(cut), label: `分镜 · ${cut} → ${plan.endings.get(cut)?.loop || "末帧循环"}` })),
        ...plan.loops.filter(id => !plan.shots.some(cut => plan.endings.get(cut)?.loop === id))
          .map(id => ({ id, label: `循环 · ${id}` })),
        ...plan.cuts.map(id => ({ id, label: `原始${plan.full.includes(id) ? "整段" : "片段"} · ${id} → 末帧循环` })),
        ...this.getPlayer().skeleton.data.animations.filter(a => !used.has(a.name)).map(a => ({ id: a.name, label: `独立片段 · ${a.name}` }))
      ];
    }
    baseFor(name) {
      // Companion loops inherit the last authored cut, not an unrelated main idle.
      return this.plan.loops.includes(name) ? this.plan.predecessors.get(name) : undefined;
    }
    shotId(name) { return `@shot:${name}`; }
    shotName(selection) { return selection?.startsWith("@shot:") ? selection.slice(6) : selection; }
    selectionForLoop(name) {
      const cut = this.plan.shots.find(cut => this.plan.endings.get(cut)?.loop === name);
      return cut ? this.shotId(cut) : name;
    }
    hiddenRigSlots(name) { return this.rigVisibility.get(name) || this.rigVisibility.get(this.baseFor(name)) || []; }
    cameraFor(name) {
      const camera = this.plan.cameras.get(name);
      if (!camera) return undefined;
      this.cameraAnimations ||= new Map();
      if (!this.cameraAnimations.has(camera)) {
        const source = this.getPlayer().skeleton.data.findAnimation(camera);
        // Isolated camera assets can contain null keys clearing the other rigs.
        // Only their authored transform/constraint channels accompany the shot.
        const timelines = source.timelines.filter(t => t.slotIndex === undefined && !t.drawOrders && !t.events);
        this.cameraAnimations.set(camera, new this.spineRuntime.Animation(source.name, timelines, source.duration));
      }
      return this.cameraAnimations.get(camera);
    }
    applyCamera(name, terminalTime) {
      const animation = this.cameraFor(name);
      this.getPlayer().animationState.clearTrack(2);
      if (animation) {
        const entry = this.getPlayer().animationState.setAnimationWith(2, animation, false);
        entry.mixDuration = 0;
        if (terminalTime !== undefined) { entry.trackTime = terminalTime; entry.timeScale = 0; }
      }
    }
    setInteractionMode(mode) { this.interactionMode = mode; if (mode !== "auto") this.queue = []; }
    select(name) { this.selection = name; this.onSelection(name); }
    show(name) { this.viewportAnimation = name; this.onAnimation(name); }
    loop(name, terminal, { phase = 0, viewport } = {}) {
      const player = this.getPlayer();
      const continuation = Boolean(terminal);
      const predecessor = this.baseFor(name);
      if (!terminal) {
        player.animationState.clearTracks(); player.skeleton.setToSetupPose();
        if (predecessor) {
          terminal = player.animationState.setAnimation(0, predecessor, false);
          terminal.trackTime = terminal.animation.duration; terminal.timeScale = 0;
        }
      } else { terminal.trackTime = terminal.animationEnd - terminal.animationStart; terminal.timeScale = 0; }
      const entry = player.animationState.setAnimation(terminal ? 1 : 0, name, true);
      entry.mixDuration = 0;
      entry.trackTime = phase * entry.animation.duration;
      if (!continuation) this.applyCamera(name, terminal?.animation.duration);
      this.currentState = name; this.onState(name); this.show(viewport || name);
    }
    shot(name, generation, holdFinal) {
      const player = this.getPlayer();
      player.animationState.clearTracks(); player.skeleton.setToSetupPose();
      const entry = player.animationState.setAnimation(0, name, false);
      entry.mixDuration = 0;
      this.applyCamera(name);
      this.show(name);
      entry.listener = { complete: () => {
        if (this.generation !== generation) return;
        if (this.queue.length) { this.shot(this.queue.shift(), generation, holdFinal); return; }
        const camera = player.animationState.getCurrent(2);
        if (camera) camera.timeScale = 0;
        const ending = this.plan.endings.get(name);
        if (!holdFinal && ending) {
          entry.listener = undefined;
          this.loop(ending.loop, entry, { phase: ending.phase || 0, viewport: name });
          this.log(`Cinematic linked playback: ${name} → ${ending.loop}`);
          return;
        }
        this.tailRuntime().loopAnimationTail(player, entry, { minimumStart: this.cameraTimes(name).at(-1) });
        // A held raw clip has not actually entered another loop state.
        this.currentState = ending?.loop || name; this.onState(this.currentState);
        // Keep the selected shot and its viewport. Explicitly choosing a loop
        // still plays that resource loop; a completed shot stays in its tail.
        this.log(`Cinematic terminal idle: ${name}, ${entry.animationStart.toFixed(3)}–${entry.animationEnd.toFixed(3)}`);
      } };
    }
    play(name, { holdFinal = true } = {}) {
      const data = this.getPlayer().skeleton.data;
      const logicalShot = name.startsWith("@shot:");
      const animationName = this.shotName(name);
      if (name !== "@cinematic" && (!data.findAnimation(animationName) || logicalShot && !this.plan.shots.includes(animationName))) return false;
      const generation = ++this.generation;
      this.tailRuntime().releaseAnimationTail(this.getPlayer());
      this.queue = []; this.select(this.plan.loops.includes(name) ? this.selectionForLoop(name) : name);
      if (name === "@cinematic") {
        const clips = this.plan.full.length ? [this.plan.full[0]] : this.plan.shots;
        if (!clips.length) return false;
        this.queue = clips.slice(1); this.shot(clips[0], generation, holdFinal);
      } else if (this.plan.loops.includes(name)) this.loop(name);
      else this.shot(animationName, generation, logicalShot ? false : holdFinal);
      this.getPlayer().play(); return true;
    }
    interact(gesture) {
      if (gesture === "doubleClick") {
        const states = this.plan.states;
        const next = states[(states.indexOf(this.currentState) + 1) % states.length];
        const cut = this.plan.predecessors.get(next);
        return this.play(cut && this.plan.shots.includes(cut) ? this.shotId(cut) : cut || next, { holdFinal: false });
      }
      if (gesture !== "previous" && this.interactionMode === "auto") {
        const state = this.getPlayer().animationState;
        if (this.queue.length || this.selection === "@cinematic" && !state.getCurrent(1) && !state.getCurrent(0)?.loop) return true;
        return this.play("@cinematic", { holdFinal: false });
      }
      const shots = this.plan.shots.length ? this.plan.shots : this.plan.full;
      if (!shots.length) return true;
      const index = shots.indexOf(this.shotName(this.selection)), direction = gesture === "previous" ? -1 : 1;
      const next = shots[index < 0 ? (direction < 0 ? shots.length - 1 : 0) : (index + direction + shots.length) % shots.length];
      return this.play(this.plan.shots.includes(next) ? this.shotId(next) : next, { holdFinal: false });
    }
    cameraTimes(name) { return cinematicCutTimes(this.getPlayer().skeleton.data, this.getPlayer().skeleton.data.findAnimation(name)); }
    cameraSegment(name) {
      const state = this.getPlayer().animationState;
      const entry = [state.getCurrent(1), state.getCurrent(0)].find(e => e?.animation.name === name);
      const time = entry?.getAnimationTime() || 0;
      const times = this.cameraTimesCache?.get(name) || this.cameraTimes(name);
      this.cameraTimesCache ||= new Map(); this.cameraTimesCache.set(name, times);
      return Math.max(0, times.findLastIndex(start => start <= time));
    }
  }
  const exports = { CinematicPlayer, inferCinematicPlan, cinematicCutTimes, buildCinematicRigVisibility };
  if (typeof module !== "undefined" && module.exports) module.exports = exports;
  if (typeof window !== "undefined") Object.assign(window.AsterPet ||= {}, exports);
})();
