(function registerPortraitAnimationComposer() {
  const facialName = /(?:face|eye|brow|lash|mouth|lip|blush|nose|tongue|pupil|emotion|teeth|tear)/i;
  const bodyPartName = /(?:arm|hand|leg|foot|feet|toe|thigh|calf|torso|pelvis|hip|body|breast|nipple|weapon|sword|blade|staff|shield|gun|rifle|bow|cloth|skirt|dress|pants|shoe|boot)/i;
  const expressionName = /(?:^|[_/\s-])(?:emo\d*|emotion|expression|facial|blink|eyeclose|face\d+)(?:[_\d\s-]|$)/i;
  const talkingName = /(?:^|[_\s-])talk(?:[_\s-]|$)/i;
  const normalized = name => String(name || "").replace(/^\d+[_\s-]*/, "");
  const ids = timeline => timeline.getPropertyIds();

  class PortraitAnimationComposer {
    constructor({ getPlayer, getScene, spineRuntime }) {
      this.getPlayer = getPlayer;
      this.getScene = getScene;
      this.spine = spineRuntime;
      this.stop();
    }

    stop() {
      this.data = undefined;
      this.slots = new Set();
      this.bones = new Set();
      this.bodyBones = new Set();
      this.roles = new Map();
      this.cache = new Map();
      this.bodyExpressions = new Set();
      this.bodyCache = new Map();
      this.poseStates = [];
      this.activePoseAnimation = undefined;
      this.neutral = undefined;
      this.currentExpression = undefined;
      this.toolbarSelection = undefined;
      this.baselineAttachments = undefined;
      this.baselineDrawOrder = undefined;
      this.hasFacialDrawOrder = false;
      this.nativeFaceBody = undefined;
      this.baselineColors = undefined;
      this.baselineBones = undefined;
    }

    get enabled() { return Boolean(this.neutral); }

    start() {
      this.stop();
      const player = this.getPlayer();
      const scene = this.getScene();
      if (!player?.skeleton?.data || scene?.category !== "character") return;
      const data = this.data = player.skeleton.data;
      const named = data.animations.filter(animation => expressionName.test(normalized(animation.name)));
      const expressions = named.filter(animation => !talkingName.test(animation.name));
      if (!expressions.length) return;
      this.neutral = expressions.find(animation => animation.name === scene.behavior?.initialExpression)
        || expressions.find(animation => /(?:^|[_-])normal(?:$|[_-])/i.test(animation.name))
        || [...expressions].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))[0];

      // Exported face clips may contain hundreds of copied body attachment keys.
      // Learn the facial channels from differences between expressions and their
      // slot/bone labels, instead of treating attachment count as a whole pose.
      for (const slot of data.slots) {
        const values = new Set(expressions.map(animation => {
          const keys = animation.timelines.filter(t => t.slotIndex === slot.index && t.attachmentNames);
          return keys.length ? JSON.stringify([...new Set(keys.flatMap(t => t.attachmentNames))]) : undefined;
        }).filter(value => value !== undefined));
        const keyed = named.some(animation => animation.timelines.some(t => t.slotIndex === slot.index));
        const facial = facialName.test(slot.name) || facialName.test(slot.boneData.name);
        // A facial export can also swap an arm/weapon pose. Variation alone
        // does not make those body attachments safe to layer over native idle.
        if (facial || !bodyPartName.test(slot.name) && keyed && values.size > 1) this.slots.add(slot.index);
      }
      const bodyBones = this.bodyBones;
      for (const slot of data.slots) {
        if (this.slots.has(slot.index) || !bodyPartName.test(slot.name)) continue;
        for (let parent = slot.boneData; parent; parent = parent.parent) bodyBones.add(parent.index);
        for (const skin of data.skins) {
          const entries = [];
          skin.getAttachmentsForSlot(slot.index, entries);
          for (const { attachment } of entries) {
            if (!attachment?.bones) continue;
            for (let i = 0; i < attachment.bones.length;) {
              const count = attachment.bones[i++];
              for (let j = 0; j < count; j++) {
                for (let bone = data.bones[attachment.bones[i++]]; bone; bone = bone.parent) bodyBones.add(bone.index);
              }
            }
          }
        }
      }
      for (const slot of data.slots) {
        if (!this.slots.has(slot.index)) continue;
        this.bones.add(slot.boneData.index);
        for (const skin of data.skins) {
          const entries = [];
          skin.getAttachmentsForSlot(slot.index, entries);
          for (const { attachment } of entries) {
            if (!attachment?.bones) continue;
            for (let i = 0; i < attachment.bones.length;) {
              const count = attachment.bones[i++];
              for (let j = 0; j < count; j++) this.bones.add(attachment.bones[i++]);
            }
          }
        }
      }
      // A local head/mouth transform can animate the face, while a copied root
      // or leg reset must not replace the continuously running body animation.
      for (const animation of named) for (const timeline of animation.timelines) {
        if (!Number.isInteger(timeline.boneIndex)) continue;
        const bone = data.bones[timeline.boneIndex];
        const affected = data.slots.filter(slot => {
          for (let parent = slot.boneData; parent; parent = parent.parent) if (parent === bone) return true;
          return false;
        });
        if (facialName.test(bone.name) || affected.length > 0 && affected.length < data.slots.length * 0.6
          && affected.some(slot => this.slots.has(slot.index))) this.bones.add(bone.index);
      }
      // Weighted facial meshes often share a root with the body. Its presence
      // in their weights must not let a facial preset reset the entire pose.
      for (const index of bodyBones) this.bones.delete(index);
      for (const animation of data.animations) {
        if (named.includes(animation)) this.roles.set(animation.name, talkingName.test(animation.name) ? "talk" : "expression");
        else if (animation.name !== scene.actions?.idle?.animation
          && !/^(?:idle|inact|stand|wait|attack|damage|dead|death|touch|tap|motion)(?:_|\d|$)/i.test(normalized(animation.name))
          && animation.timelines.length && animation.timelines.every(t => this.isFacialTimeline(t))) {
          this.roles.set(animation.name, "expression");
        }
      }
      this.hasFacialDrawOrder = named.some(animation => animation.timelines.some(t => t.drawOrders));
      this.currentExpression = this.neutral.name;
      this.refreshSkin();
    }

    refreshSkin() {
      if (!this.enabled) return;
      this.nativeFaceBody = undefined;
      const player = this.getPlayer();
      const baseline = new this.spine.Skeleton(this.data);
      if (player.skeleton.skin) baseline.setSkin(player.skeleton.skin);
      baseline.setToSetupPose();
      const originalIdle = this.data.findAnimation(this.getScene().actions?.idle?.animation);
      const idle = this.idleAnimation() || originalIdle;
      const neutral = (this.activePoseAnimation && this.data.findAnimation(this.activePoseAnimation)) || this.neutral;
      idle?.apply(baseline, 0, 0, true, [], 1, this.spine.MixBlend.setup, this.spine.MixDirection.mixIn);
      new this.spine.Animation(neutral.name, neutral.timelines.filter(t => this.isFacialTimeline(t) || t.drawOrders), neutral.duration)
        .apply(baseline, 0, 0, false, [], 1, this.spine.MixBlend.replace, this.spine.MixDirection.mixIn);
      this.baselineAttachments = baseline.slots.map(slot => {
        const attachment = slot.getAttachment();
        if (!attachment) return null;
        // The skin lookup key can differ from the attachment's exported name.
        for (const skin of [baseline.skin, this.data.defaultSkin]) {
          if (!skin) continue;
          const entries = [];
          skin.getAttachmentsForSlot(slot.data.index, entries);
          const match = entries.find(entry => entry.attachment === attachment);
          if (match) return match.name;
        }
        return null;
      });
      this.baselineColors = baseline.slots.map(slot => ({
        light: [slot.color.r, slot.color.g, slot.color.b, slot.color.a],
        dark: slot.darkColor ? [slot.darkColor.r, slot.darkColor.g, slot.darkColor.b, slot.darkColor.a] : undefined
      }));
      this.baselineBones = new Map();
      for (const animation of this.data.animations) {
        if (!this.isOverlay(animation.name)) continue;
        for (const timeline of animation.timelines) {
          if (!Number.isInteger(timeline.boneIndex) || !this.isFacialTimeline(timeline)) continue;
          const bone = baseline.bones[timeline.boneIndex];
          this.baselineBones.set(timeline.boneIndex, Object.fromEntries(
            ["x", "y", "rotation", "scaleX", "scaleY", "shearX", "shearY"].map(key => [key, bone[key]])
          ));
        }
      }
      this.baselineDrawOrder = baseline.drawOrder.map(slot => slot.data.index);
      this.cache.clear();
      this.bodyCache.clear();
      this.bodyExpressions.clear();
      this.poseStates = originalIdle ? [{ animation: originalIdle.name, label: "待机姿势 1" }] : [];
      if (originalIdle) {
        const idlePose = new this.spine.Skeleton(this.data);
        if (player.skeleton.skin) idlePose.setSkin(player.skeleton.skin);
        idlePose.setToSetupPose();
        originalIdle.apply(idlePose, 0, 0, true, [], 1, this.spine.MixBlend.setup, this.spine.MixDirection.mixIn);
        const bodySlots = this.data.slots.filter(slot => !this.slots.has(slot.index) && bodyPartName.test(slot.name));
        const coreSlots = bodySlots.filter(slot => /(?:torso|pelvis|body|breast|thigh|leg)/i.test(slot.name));
        const visibleCore = coreSlots.filter(slot => idlePose.slots[slot.index].getAttachment()).length;
        const poseGroups = new Map();
        for (const animation of this.data.animations) {
          if (this.role(animation.name) !== "expression") continue;
          const pose = new this.spine.Skeleton(this.data);
          if (player.skeleton.skin) pose.setSkin(player.skeleton.skin);
          pose.setToSetupPose();
          animation.apply(pose, 0, 0, false, [], 1, this.spine.MixBlend.setup, this.spine.MixDirection.mixIn);
          const bodyKeys = new Set(animation.timelines.filter(t => t.attachmentNames).map(t => t.slotIndex));
          const alternate = bodySlots.some(slot => {
            const attachment = pose.slots[slot.index].getAttachment();
            return bodyKeys.has(slot.index) && attachment && pose.slots[slot.index].color.a > 0
              && attachment !== idlePose.slots[slot.index].getAttachment();
          });
          const replacesBody = bodySlots.some(slot => bodyKeys.has(slot.index)
            && idlePose.slots[slot.index].getAttachment()
            && pose.slots[slot.index].getAttachment() !== idlePose.slots[slot.index].getAttachment());
          const bodyMovement = animation.timelines.some(t => {
            if (!this.bodyBones.has(t.boneIndex) || !t.frames || !t.getFrameEntries) return false;
            const stride = t.getFrameEntries();
            const moving = Array.from(t.frames).some((value, index) => index >= stride && index % stride !== 0
              && Math.abs(value - t.frames[index % stride]) > 0.001);
            if (!moving) return false;
            const reference = originalIdle.timelines.find(other => ids(other).some(id => ids(t).includes(id)));
            return !reference || reference.frames.length !== t.frames.length
              || Array.from(t.frames).some((value, index) => Math.abs(value - reference.frames[index]) > 0.001);
          });
          // A real alternate body pose retains the character, unlike face
          // exports whose copied attachment clears erase the entire body.
          const retainedCore = coreSlots.filter(slot => pose.slots[slot.index].getAttachment()).length;
          if ((alternate && replacesBody || bodyMovement) && visibleCore > 0 && retainedCore >= visibleCore * 0.6) {
            this.bodyExpressions.add(animation.name);
            const signature = JSON.stringify([
              bodySlots.map(slot => [slot.index, pose.slots[slot.index].getAttachment()?.name, pose.slots[slot.index].color.a]),
              animation.timelines.filter(t => this.bodyBones.has(t.boneIndex)).map(t => [ids(t), Array.from(t.frames)])
            ]);
            const previous = poseGroups.get(signature);
            // Prefer the authored idle-length cycle when several emotions
            // share the same body pose. Other moods remain facial overlays.
            if (!previous || Math.abs(animation.duration - originalIdle.duration) < Math.abs(previous.duration - originalIdle.duration)) {
              poseGroups.set(signature, animation);
            }
          }
          pose.dispose?.();
        }
        idlePose.dispose?.();
        for (const animation of poseGroups.values()) this.poseStates.push({ animation: animation.name, label: `待机姿势 ${this.poseStates.length + 1}` });
      }
      for (const track of [1, 2]) {
        const entry = player.animationState.getCurrent(track);
        if (entry && this.isOverlay(entry.animation.name)) entry.animation = this.overlay(entry.animation.name);
      }
      baseline.dispose?.();
    }

    isFacialTimeline(timeline) {
      if (Number.isInteger(timeline.slotIndex)) return this.slots.has(timeline.slotIndex);
      if (Number.isInteger(timeline.boneIndex)) return this.bones.has(timeline.boneIndex);
      for (const [key, constraints] of [
        ["ikConstraintIndex", this.data?.ikConstraints],
        ["transformConstraintIndex", this.data?.transformConstraints],
        ["pathConstraintIndex", this.data?.pathConstraints]
      ]) {
        if (Number.isInteger(timeline[key])) {
          const constraint = constraints?.[timeline[key]];
          return Boolean(constraint?.bones?.length && constraint.bones.every(bone => this.bones.has(bone.index)));
        }
      }
      return false;
    }

    beforeApply() {
      if (!this.enabled) return;
      const player = this.getPlayer();
      const state = player.animationState;
      const base = state.getCurrent(0);
      if (!base) return;
      const explicitFace = this.isOverlay(this.toolbarSelection);
      const nativeFace = !explicitFace && base.animation.name !== this.idleAnimationName
        && base.animation.timelines.some(t => this.isFacialTimeline(t));
      if (nativeFace) {
        if (this.nativeFaceBody !== base) {
          // A body performance can author an entire new face. Start it from the
          // exported neutral face, then let its own channels own the face.
          // Keeping a facial preset above it can enable two mouths/eyes at once.
          for (const index of this.slots) {
            const slot = player.skeleton.slots[index];
            const name = this.baselineAttachments[index];
            slot.setAttachment(name ? player.skeleton.getAttachment(index, name) : null);
            slot.color.set(...this.baselineColors[index].light);
            if (slot.darkColor && this.baselineColors[index].dark) slot.darkColor.set(...this.baselineColors[index].dark);
            slot.deform.length = 0;
          }
          for (const [index, values] of this.baselineBones) Object.assign(player.skeleton.bones[index], values);
        }
        this.nativeFaceBody = base;
        state.clearTrack(1);
        state.clearTrack(2);
      } else {
        this.nativeFaceBody = undefined;
        this.ensureExpression();
      }
    }

    drawOrderOverlay(source) {
      const composer = this;
      return {
        // Use a distinct property so the native body draw-order channel keeps
        // running below this local facial arrangement.
        getPropertyIds: () => ["portrait-draw-order"],
        apply(skeleton, lastTime, time, events, alpha, blend, direction) {
          if (direction === composer.spine.MixDirection.mixOut) return;
          let order = composer.baselineDrawOrder;
          if (source && time >= source.frames[0]) {
            const index = composer.spine.Timeline.search1(source.frames, time);
            order = source.drawOrders[index] || skeleton.slots.map(slot => slot.data.index);
          }
          const bodyOrder = skeleton.drawOrder.filter(slot => !composer.slots.has(slot.data.index));
          let bodyIndex = 0;
          skeleton.drawOrder = order.map(index => composer.slots.has(index)
            ? skeleton.slots[index] : bodyOrder[bodyIndex++]);
        }
      };
    }

    role(name) { return this.roles.get(name); }
    isBodyAnimation(name) { return this.bodyExpressions.has(name); }
    isOverlay(name) { return Boolean(this.role(name)); }
    get idleAnimationName() { return this.activePoseAnimation || this.getScene()?.actions?.idle?.animation; }
    idleAnimation() { return this.bodyAnimation(this.activePoseAnimation) || this.data?.findAnimation(this.idleAnimationName); }
    isPoseAnimation(name) { return this.enabled && this.poseStates.some(pose => pose.animation === name); }
    selectPose(name) {
      if (!this.isPoseAnimation(name)) return undefined;
      this.activePoseAnimation = name === this.getScene().actions.idle.animation ? undefined : name;
      this.currentExpression = this.activePoseAnimation || this.neutral.name;
      this.toolbarSelection = undefined;
      this.refreshSkin();
      return this.idleAnimation();
    }
    choices(animationNames) {
      return [...this.poseStates.map(pose => ({ id: pose.animation, label: pose.label })),
        ...animationNames.filter(name => !this.isPoseAnimation(name)).map(id => ({ id, label: id }))];
    }

    bodyAnimation(name) {
      if (!this.isBodyAnimation(name)) return undefined;
      if (this.bodyCache.has(name)) return this.bodyCache.get(name);
      const source = this.data.findAnimation(name);
      const idle = this.data.findAnimation(this.getScene().actions.idle.animation);
      const keyed = new Set(source.timelines.flatMap(ids));
      // This is one complete body track, rather than an extra arm layered over
      // idle. Unkeyed native idle channels retain hair/body movement, while the
      // expression's authored attachments and transforms take precedence.
      const defaults = idle.timelines.filter(t => !t.events && ids(t).every(id => !keyed.has(id)));
      // Short pose presets need time to be seen. Their own channels hold the
      // authored endpoint while unkeyed native idle channels keep moving.
      const animation = new this.spine.Animation(source.name, [...defaults, ...source.timelines], Math.max(source.duration, idle.duration));
      this.bodyCache.set(name, animation);
      return animation;
    }

    idleFallback(timeline, idleOwnsChannel) {
      if (!idleOwnsChannel) return timeline;
      if (timeline.attachmentNames) {
        const defaults = timeline.attachmentNames;
        // AnimationState handles attachment timelines directly rather than
        // calling apply(). Resolve the fallback against the native idle clock,
        // retaining its attachment changes and the runtime's slot bookkeeping.
        Object.defineProperty(timeline, "attachmentNames", { get: () => {
          const base = this.getPlayer().animationState.getCurrent(0);
          if (base?.animation.name !== this.idleAnimationName) return defaults;
          const time = base.getAnimationTime();
          if (time < idleOwnsChannel.frames[0]) return defaults;
          return [idleOwnsChannel.attachmentNames[this.spine.Timeline.search1(idleOwnsChannel.frames, time)]];
        } });
        return timeline;
      }
      const apply = timeline.apply.bind(timeline);
      timeline.apply = (...args) => {
        // Native idle channels keep their authored timing. The same defaults
        // still complete a manually selected face over another body action.
        if (this.getPlayer().animationState.getCurrent(0)?.animation.name === this.idleAnimationName) return;
        apply(...args);
      };
      return timeline;
    }

    overlay(name) {
      if (!this.enabled || !this.role(name)) return undefined;
      const role = this.role(name);
      const key = `${name}:${role === "talk" ? this.currentExpression : ""}`;
      if (this.cache.has(key)) return this.cache.get(key);
      const source = this.data.findAnimation(name);
      const idle = this.idleAnimation();
      let timelines = source.timelines.filter(t => this.isFacialTimeline(t) || t.drawOrders)
        .map(t => t.drawOrders ? this.drawOrderOverlay(t) : t);
      if (role === "expression") {
        const keyed = new Set(timelines.flatMap(ids));
        const neutral = (this.activePoseAnimation && this.data.findAnimation(this.activePoseAnimation)) || this.neutral;
        const defaults = neutral.timelines.filter(t => this.isFacialTimeline(t) && ids(t).every(id => !keyed.has(id)));
        timelines = [...defaults, ...timelines];
        if (this.hasFacialDrawOrder && !source.timelines.some(t => t.drawOrders)) timelines.push(this.drawOrderOverlay());
        const attachmentSlots = new Set(timelines.filter(t => t.attachmentNames).map(t => t.slotIndex));
        for (const slotIndex of this.slots) {
          // The body idle can already animate opacity/color (for example,
          // blinking). Supply defaults only for unowned channels, so restoring
          // a sparse preset never flattens those authored idle cycles.
          const colorTimelines = timelines
            .filter(t => t.slotIndex === slotIndex && /^(?:RGBA?|Alpha|RGBA?2)Timeline$/.test(t.constructor.name));
          const idleColors = (idle?.timelines || [])
            .filter(t => t.slotIndex === slotIndex && /^(?:RGBA?|Alpha|RGBA?2)Timeline$/.test(t.constructor.name));
          const light = this.baselineColors[slotIndex].light;
          const rgb = colorTimelines.some(t => /^RGB/.test(t.constructor.name));
          const alpha = colorTimelines.some(t => /^(?:RGBA|RGBA2|Alpha)Timeline$/.test(t.constructor.name));
          const idleRgb = idleColors.some(t => /^RGB/.test(t.constructor.name));
          const idleAlpha = idleColors.some(t => /^(?:RGBA|RGBA2|Alpha)Timeline$/.test(t.constructor.name));
          if (!rgb && !alpha && idleRgb === idleAlpha) {
            const color = new this.spine.RGBATimeline(1, 0, slotIndex);
            color.setFrame(0, 0, ...light); timelines.unshift(this.idleFallback(color, idleRgb));
          } else {
            if (!rgb) {
              const color = new this.spine.RGBTimeline(1, 0, slotIndex);
              color.setFrame(0, 0, ...light.slice(0, 3)); timelines.unshift(this.idleFallback(color, idleRgb));
            }
            if (!alpha) {
              const color = new this.spine.AlphaTimeline(1, 0, slotIndex);
              color.setFrame(0, 0, light[3]); timelines.unshift(this.idleFallback(color, idleAlpha));
            }
          }
          if (attachmentSlots.has(slotIndex)) continue;
          const timeline = new this.spine.AttachmentTimeline(1, slotIndex);
          timeline.setFrame(0, 0, this.baselineAttachments[slotIndex]);
          timelines.unshift(this.idleFallback(timeline, idle?.timelines.find(t => t.slotIndex === slotIndex && t.attachmentNames)));
        }
      } else {
        // A mouth overlay must not copy a neutral eye/face over the selected mood.
        const expression = this.overlay(this.currentExpression);
        timelines = timelines.filter(t => {
          if (!t.attachmentNames) return true;
          const reference = expression?.timelines.find(other => other.attachmentNames && other.slotIndex === t.slotIndex);
          return !reference || t.attachmentNames.some(name => name !== reference.attachmentNames.at(-1));
        });
      }
      if (role === "expression") timelines = timelines.map(timeline => {
        if (!timeline.attachmentNames || timeline.frames[0] <= 0) return timeline;
        // Blink clips often have their first attachment key several seconds in.
        // Seed the authored neutral face before it, instead of retaining the
        // preceding mood or falling back to an empty setup attachment.
        const seeded = new this.spine.AttachmentTimeline(timeline.frames.length + 1, timeline.slotIndex);
        seeded.setFrame(0, 0, this.baselineAttachments[timeline.slotIndex]);
        for (let index = 0; index < timeline.frames.length; index++) {
          seeded.setFrame(index + 1, timeline.frames[index], timeline.attachmentNames[index]);
        }
        return seeded;
      });
      const overlay = new this.spine.Animation(source.name, timelines, source.duration);
      // Matching authored cycle lengths identify facial idle loops; short
      // reactions retain their final expression instead of repeating rapidly.
      overlay.portraitLoop = role === "expression" && source.duration > 0
        && Math.abs(source.duration - (idle?.duration || 0)) < 0.001;
      this.cache.set(key, overlay);
      return overlay;
    }

    noteOverlay(name) {
      if (this.role(name) === "expression") this.currentExpression = name;
    }

    ensureExpression() {
      if (!this.enabled) return;
      const state = this.getPlayer().animationState;
      if (state.getCurrent(1)) return;
      const expression = this.overlay(this.currentExpression);
      const entry = state.setAnimationWith(1, expression, expression.portraitLoop);
      entry.mixDuration = 0;
    }

    talkingAnimation(requested) {
      if (!this.enabled) return requested;
      const pair = this.data.findAnimation(`${this.currentExpression}_talk`);
      if (pair) return pair.name;
      if (/^_?face\d+[_-]talk$/i.test(requested)) return undefined;
      return requested;
    }

    play(name) {
      if (!this.isOverlay(name)) return false;
      const player = this.getPlayer();
      const state = player.animationState;
      const base = state.getCurrent(0);
      if (!base || this.isOverlay(base.animation.name) && base.animation.name !== this.idleAnimationName) {
        state.setAnimationWith(0, this.idleAnimation(), true).mixDuration = 0;
      }
      if (this.role(name) === "talk") {
        const paired = name.replace(/[_-]talk$/i, "");
        if (this.role(paired) === "expression") {
          this.currentExpression = paired;
          const expression = this.overlay(paired);
          state.setAnimationWith(1, expression, expression.portraitLoop).mixDuration = 0;
        }
        this.ensureExpression();
        state.setAnimationWith(2, this.overlay(name), true).mixDuration = 0;
      } else {
        state.clearTrack(2);
        this.currentExpression = name;
        const expression = this.overlay(name);
        state.setAnimationWith(1, expression, expression.portraitLoop).mixDuration = 0;
      }
      this.toolbarSelection = name;
      player.play();
      return true;
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { PortraitAnimationComposer };
  if (typeof window !== "undefined") Object.assign(window.AsterPet ||= {}, { PortraitAnimationComposer });
})();
