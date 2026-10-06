(function registerPortraitAnimationComposer() {
  const facialName = /(?:face|eye|brow|lash|mouth|lip|blush|nose|tongue|pupil|emotion|teeth|tear)/i;
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
      this.roles = new Map();
      this.cache = new Map();
      this.neutral = undefined;
      this.currentExpression = undefined;
      this.toolbarSelection = undefined;
      this.baselineAttachments = undefined;
      this.baselineDrawOrder = undefined;
      this.hasFacialDrawOrder = false;
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
        if (keyed && (values.size > 1 || facialName.test(slot.name) || facialName.test(slot.boneData.name))) this.slots.add(slot.index);
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
      const player = this.getPlayer();
      const baseline = new this.spine.Skeleton(this.data);
      if (player.skeleton.skin) baseline.setSkin(player.skeleton.skin);
      baseline.setToSetupPose();
      const idle = this.data.findAnimation(this.getScene().actions?.idle?.animation);
      idle?.apply(baseline, 0, 0, true, [], 1, this.spine.MixBlend.setup, this.spine.MixDirection.mixIn);
      new this.spine.Animation(this.neutral.name, this.neutral.timelines.filter(t => this.isFacialTimeline(t) || t.drawOrders), this.neutral.duration)
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
      this.baselineDrawOrder = baseline.drawOrder.map(slot => slot.data.index);
      this.cache.clear();
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
    isOverlay(name) { return Boolean(this.role(name)); }

    overlay(name) {
      if (!this.enabled || !this.isOverlay(name)) return undefined;
      const role = this.role(name);
      const key = `${name}:${role === "talk" ? this.currentExpression : ""}`;
      if (this.cache.has(key)) return this.cache.get(key);
      const source = this.data.findAnimation(name);
      let timelines = source.timelines.filter(t => this.isFacialTimeline(t) || t.drawOrders)
        .map(t => t.drawOrders ? this.drawOrderOverlay(t) : t);
      if (role === "expression") {
        const keyed = new Set(timelines.flatMap(ids));
        const defaults = this.neutral.timelines.filter(t => this.isFacialTimeline(t) && ids(t).every(id => !keyed.has(id)));
        timelines = [...defaults, ...timelines];
        if (this.hasFacialDrawOrder && !source.timelines.some(t => t.drawOrders)) timelines.push(this.drawOrderOverlay());
        const attachmentSlots = new Set(timelines.filter(t => t.attachmentNames).map(t => t.slotIndex));
        for (const slotIndex of this.slots) {
          if (attachmentSlots.has(slotIndex)) continue;
          const timeline = new this.spine.AttachmentTimeline(1, slotIndex);
          timeline.setFrame(0, 0, this.baselineAttachments[slotIndex]);
          timelines.unshift(timeline);
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
      const idle = this.data.findAnimation(this.getScene().actions?.idle?.animation);
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
      if (!base || this.isOverlay(base.animation.name)) {
        const idle = this.getScene().actions.idle.animation;
        state.setAnimation(0, idle, true).mixDuration = 0;
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
