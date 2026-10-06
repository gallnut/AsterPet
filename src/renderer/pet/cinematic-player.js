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

  function cinematicAnimation(data, runtime, name) {
    const source = data.findAnimation(name);
    if (!source) return undefined;
    const parts = cutParts(name);
    const mainName = parts?.suffix && !/^_(?:\d|all|idle|camera)/i.test(parts.suffix)
      ? data.animations.find(a => cutParts(a.name)?.family === parts.family && !cutParts(a.name).suffix)?.name
      : name.match(/^(loop_?\d+|loop|idle_?\d*)(_[a-z].*)$/i)?.[1];
    const main = mainName && data.findAnimation(mainName);
    if (!main || isArchive(name)) return source;
    const count = animation => new Set(animation.timelines.filter(t => Number.isInteger(t.boneIndex)).map(t => t.boneIndex)).size;
    // Sparse named variants change accessories/visibility and rely on the
    // full shot for pose movement. They are not independent setup-pose scenes.
    if (count(main) < 8 || count(source) >= count(main) * 0.3) return source;
    const attachments = source.timelines.filter(t => t.attachmentNames);
    const clears = attachments.filter(t => !t.attachmentNames.some(Boolean));
    // Isolated effect exports often clear virtually every other slot so the
    // effect can be rendered alone. Those clears must not erase its parent shot.
    const isolatedEffect = clears.length >= 8 && clears.length >= attachments.length * 0.9;
    const timelines = isolatedEffect ? source.timelines.filter(t => !clears.includes(t)) : source.timelines;
    const keyed = new Set(timelines.flatMap(t => t.getPropertyIds()));
    const defaults = main.timelines.filter(t => !t.events && t.getPropertyIds().every(id => !keyed.has(id)));
    return new runtime.Animation(source.name, [...defaults, ...timelines], Math.max(source.duration, main.duration));
  }

  function cinematicSceneAnimation(data, runtime, name) {
    let source = cinematicAnimation(data, runtime, name);
    if (!source) return undefined;
    // Exporters can place water/background/effects in a separate render pass.
    // Bulk null keys isolate that pass for export; they must not erase the
    // foreground when the two passes are played as one scene.
    const scope = name.slice(0, name.lastIndexOf("/") + 1);
    const parts = cutParts(name);
    const main = parts?.suffix && !/^_(?:\d|all|idle|camera)/i.test(parts.suffix)
      ? data.animations.find(a => a.name.startsWith(scope) && cutParts(a.name)?.family === parts.family && !cutParts(a.name).suffix)?.name
      : leaf(name).match(/^(loop_?\d+|loop|idle_?\d*)(_[a-z].*)$/i)?.[1];
    const base = main && (data.findAnimation(main) ? main : `${scope}${main}`);
    const passSuffix = /^(?:water(?:drop)?|bg(?:_back|_front)?|background(?:_back|_front)?|fx|ef|effect|fire|flame|smoke|cloud|rain|snow|candle|light|lighting|sparks?|particles?|shadow(?:_?\d+(?:_\d+)*)?)$/i;
    const passesByRole = new Map();
    // A named foreground variant inherits its view's scene passes, unless it
    // supplies its own pass for that role. Alternatives are never stacked.
    for (const owner of [...new Set([base, name].filter(Boolean))]) {
      for (const pass of data.animations) {
        if (!pass.name.toLowerCase().startsWith(`${owner.toLowerCase()}_`)) continue;
        const suffix = pass.name.slice(owner.length + 1);
        if (passSuffix.test(suffix)) passesByRole.set(suffix.toLowerCase(), pass);
      }
    }
    const passes = [...passesByRole.values()];
    for (const pass of passes) {
      const attachments = pass.timelines.filter(t => t.attachmentNames);
      const clears = attachments.filter(t => !t.attachmentNames.some(Boolean));
      const visibleSlots = new Set(attachments.filter(t => t.attachmentNames.some(Boolean)).map(t => t.slotIndex));
      if (!visibleSlots.size || clears.length < 8 || clears.length < attachments.length * .9) continue;
      const bones = new Set();
      const addBone = index => {
        for (let bone = data.bones[index]; bone; bone = bone.parent) bones.add(bone.index);
      };
      for (const index of visibleSlots) {
        addBone(data.slots[index].boneData.index);
        for (const skin of data.skins || []) {
          const entries = []; skin.getAttachmentsForSlot(index, entries);
          for (const { attachment } of entries) if (attachment?.bones) {
            for (let i = 0; i < attachment.bones.length;) {
              const count = attachment.bones[i++];
              for (let j = 0; j < count; j++) addBone(attachment.bones[i++]);
            }
          }
        }
      }
      const owned = new Set(source.timelines.flatMap(t => t.getPropertyIds()));
      const additions = pass.timelines.filter(t => {
        if (Number.isInteger(t.slotIndex)) return visibleSlots.has(t.slotIndex);
        if (!Number.isInteger(t.boneIndex) || !bones.has(t.boneIndex)) return false;
        const bone = data.bones[t.boneIndex], view = cutParts(bone.name);
        if (!bone.parent || /^(?:[a-z]|all|master|camera)$/i.test(bone.name) || view && !view.suffix) return false;
        // Shared foreground/camera channels retain their native pose. Only
        // unkeyed dependencies of the pass's visible artwork accompany it.
        return t.getPropertyIds().every(id => !owned.has(id));
      });
      const replaced = new Set(additions.flatMap(t => t.getPropertyIds()));
      source = new runtime.Animation(source.name,
        [...source.timelines.filter(t => t.getPropertyIds().every(id => !replaced.has(id))), ...additions], source.duration);
    }
    return source;
  }

  function cinematicLoopAnimation(data, runtime, loop, base, skin) {
    if (!base) return loop;
    const skeleton = new runtime.Skeleton(data);
    if (skin) skeleton.setSkin(skin);
    skeleton.setToSetupPose();
    base.apply(skeleton, 0, base.duration, false, [], 1, runtime.MixBlend.replace, runtime.MixDirection.mixIn);
    const previous = skeleton.slots.map(slot => slot.getAttachment());
    loop.apply(skeleton, 0, 0, true, [], 1, runtime.MixBlend.replace, runtime.MixDirection.mixIn);
    const influences = new Set();
    for (const slot of skeleton.slots) {
      const mesh = slot.getAttachment(), old = previous[slot.data.index];
      if (!(mesh instanceof runtime.MeshAttachment) || !(old instanceof runtime.MeshAttachment)
        || mesh === old || mesh.timelineAttachment === old.timelineAttachment
        || mesh.worldVerticesLength === old.worldVerticesLength) continue;
      // A replacement mesh has a different binding. Unkeyed joint channels
      // must use that binding's setup values, not the previous mesh's cut pose.
      if (mesh.bones) for (let i = 0; i < mesh.bones.length;) {
        const count = mesh.bones[i++];
        for (let j = 0; j < count; j++) influences.add(mesh.bones[i++]);
      }
      else influences.add(slot.data.boneData.index);
    }
    skeleton.dispose?.();
    const owned = new Set(loop.timelines.flatMap(t => t.getPropertyIds()));
    const inherited = new Set(base.timelines.flatMap(t => t.getPropertyIds()));
    const classes = [runtime.RotateTimeline, runtime.TranslateXTimeline, runtime.TranslateYTimeline,
      runtime.ScaleXTimeline, runtime.ScaleYTimeline, runtime.ShearXTimeline, runtime.ShearYTimeline];
    const defaults = [];
    for (const index of influences) {
      const bone = data.bones[index];
      // Shared view/camera containers retain the completed shot's framing.
      const parts = cutParts(bone.name);
      if (!bone.parent || /^(?:[a-z]|all|master)$/i.test(bone.name) || parts && !parts.suffix) continue;
      for (let type = 0; type < classes.length; type++) {
        const property = `${type}|${index}`;
        if (!inherited.has(property) || owned.has(property)) continue;
        const timeline = new classes[type](1, 0, index);
        timeline.setFrame(0, 0, type === 3 || type === 4 ? 1 : 0);
        defaults.push(timeline);
      }
    }
    return defaults.length ? new runtime.Animation(loop.name, [...defaults, ...loop.timelines], loop.duration) : loop;
  }

  function offstageCinematicViews(skeleton, runtime, groups, frame) {
    if (!frame) return [];
    const marginX = frame.size.x * .04, marginY = frame.size.y * .04;
    return groups.flatMap(group => {
      let drawable = false;
      for (const index of group) {
        const slot = skeleton.slots[index], attachment = slot?.getAttachment();
        const vertices = [];
        if (attachment instanceof runtime.RegionAttachment) {
          vertices.length = 8; attachment.computeWorldVertices(slot, vertices, 0, 2);
        } else if (attachment instanceof runtime.MeshAttachment) {
          vertices.length = attachment.worldVerticesLength;
          attachment.computeWorldVertices(slot, 0, vertices.length, vertices, 0, 2);
        } else continue;
        drawable = true;
        let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
        for (let i = 0; i < vertices.length; i += 2) {
          left = Math.min(left, vertices[i]); right = Math.max(right, vertices[i]);
          bottom = Math.min(bottom, vertices[i + 1]); top = Math.max(top, vertices[i + 1]);
        }
        if (right >= frame.offset.x - marginX && left <= frame.offset.x + frame.size.x + marginX
          && top >= frame.offset.y - marginY && bottom <= frame.offset.y + frame.size.y + marginY) return [];
      }
      return drawable ? group : [];
    });
  }

  function buildCinematicRigVisibility(data) {
    // View containers may be nested under a shared All/Master camera bone.
    // Exact cut names or matching bare shot letters identify a view; numbered
    // child bones (A_cut2, etc.) belong to that view rather than new cameras.
    const cutFamilies = new Set(data.animations.map(a => cutParts(a.name)?.family).filter(Boolean));
    const viewFamily = bone => {
      const parts = cutParts(bone.name);
      if (parts && !parts.suffix) return parts.family;
      // Some exports name their shot containers A/B, without a cut suffix.
      const family = /^[a-z]$/i.test(bone.name) && bone.name.toUpperCase();
      return family && cutFamilies.has(family) ? family : undefined;
    };
    const roots = new Set(data.bones.filter(bone => {
      if (!viewFamily(bone)) return false;
      for (let parent = bone.parent; parent; parent = parent.parent) if (viewFamily(parent)) return false;
      return true;
    }));
    const rootFor = bone => {
      for (; bone; bone = bone.parent) if (roots.has(bone)) return bone;
    };
    const slotRoots = data.slots.map(slot => rootFor(slot.boneData));
    for (const root of roots) if (slotRoots.filter(value => value === root).length < 8) roots.delete(root);
    const masks = new Map();
    if (roots.size < 2) return masks;
    const keyedRoots = animation => {
      const bones = new Map([...roots].map(root => [root, new Set()]));
      for (const timeline of animation.timelines) {
        if (!Number.isInteger(timeline.boneIndex)) continue;
        const bone = data.bones[timeline.boneIndex], root = rootFor(bone);
        if (root && bone !== root) bones.get(root)?.add(bone.index);
      }
      const maximum = Math.max(0, ...[...bones.values()].map(keyed => keyed.size));
      const active = [...bones].filter(([, keyed]) => keyed.size >= 8 && keyed.size >= maximum * 0.6).map(([root]) => root);
      if (!active.length) {
        const family = cutParts(animation.name)?.family;
        const named = [...roots].find(root => viewFamily(root) === family);
        if (named) active.push(named);
      }
      return active;
    };
    // A mesh may live on the shared root while all its vertex weights belong
    // to one shot. Follow those authored influences, not the slot container.
    for (const slot of data.slots) {
      if (slotRoots[slot.index]) continue;
      const influences = new Set();
      for (const skin of data.skins || []) {
        const entries = []; skin.getAttachmentsForSlot(slot.index, entries);
        for (const { attachment } of entries) if (attachment?.bones) {
          for (let i = 0; i < attachment.bones.length;) {
            const count = attachment.bones[i++];
            for (let j = 0; j < count; j++) {
              const root = rootFor(data.bones[attachment.bones[i++]]);
              if (root) influences.add(root);
            }
          }
        }
      }
      if (influences.size === 1) slotRoots[slot.index] = [...influences][0];
    }
    // Unnamed views can be nested inside a shot or parked beside it. Use
    // their shared bone branch as one view, rather than filtering its parts.
    const hasPrefix = (slot, root) => slot.name.replace(/^\(sh\)/i, "").toUpperCase().startsWith(`${viewFamily(root)}_`);
    const namespaced = new Set([...roots].filter(root => data.slots.filter(slot => slotRoots[slot.index] === root && hasPrefix(slot, root)).length >= 8));
    const primary = new Set(data.slots.filter(slot => {
      const root = slotRoots[slot.index];
      return root && (!namespaced.has(root) || hasPrefix(slot, root));
    }).map(slot => slot.index));
    const slotBones = slot => {
      const influences = new Set();
      for (const skin of data.skins || []) {
        const entries = []; skin.getAttachmentsForSlot(slot.index, entries);
        for (const { attachment } of entries) if (attachment?.bones) {
          for (let i = 0; i < attachment.bones.length;) {
            const count = attachment.bones[i++];
            for (let j = 0; j < count; j++) influences.add(data.bones[attachment.bones[i++]]);
          }
        }
      }
      return influences.size ? [...influences] : [slot.boneData];
    };
    const scaffold = new Set();
    for (const index of primary) for (let bone of slotBones(data.slots[index])) {
      for (; bone; bone = bone.parent) scaffold.add(bone);
    }
    const groups = new Map();
    for (const slot of data.slots) {
      if (primary.has(slot.index)) continue;
      const influences = slotBones(slot);
      let anchor = influences[0];
      while (anchor && !influences.every(bone => {
        for (; bone; bone = bone.parent) if (bone === anchor) return true;
        return false;
      })) anchor = anchor.parent;
      while (anchor?.parent && !scaffold.has(anchor.parent)) anchor = anchor.parent;
      const key = anchor && !scaffold.has(anchor) ? `bone:${anchor.index}` : `slot:${slot.index}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(slot.index);
    }
    masks.independentViewGroups = [...groups.values()];
    masks.sceneFrameIgnoredSlots = masks.independentViewGroups.flat();
    const auxiliaryBranch = bone => {
      while (bone?.parent?.parent) bone = bone.parent;
      return bone?.parent && !roots.has(bone) ? bone : undefined;
    };
    const auxiliaryOwners = new Map();
    for (const animation of data.animations) {
      const active = keyedRoots(animation);
      if (active.length !== 1) continue;
      for (const timeline of animation.timelines) {
        if (timeline.attachmentNames && !timeline.attachmentNames.some(Boolean)) continue;
        const bone = Number.isInteger(timeline.boneIndex) ? data.bones[timeline.boneIndex]
          : Number.isInteger(timeline.slotIndex) ? data.slots[timeline.slotIndex].boneData : undefined;
        const branch = auxiliaryBranch(bone);
        if (!branch) continue;
        if (!auxiliaryOwners.has(branch)) auxiliaryOwners.set(branch, new Set());
        auxiliaryOwners.get(branch).add(active[0]);
      }
    }
    for (const slot of data.slots) {
      if (slotRoots[slot.index]) continue;
      const owners = auxiliaryOwners.get(auxiliaryBranch(slot.boneData));
      if (owners?.size === 1) slotRoots[slot.index] = [...owners][0];
    }
    // Static sibling pieces can be exported directly on the shared root.
    // Associate only uniquely owned numbered siblings; shared scenery stays.
    const stem = name => name.replace(/[_\s-]*\d+$/, "").toLowerCase();
    const siblingOwners = new Map();
    for (const slot of data.slots) {
      const root = slotRoots[slot.index];
      if (!root) continue;
      const key = stem(slot.name);
      if (!siblingOwners.has(key)) siblingOwners.set(key, new Set());
      siblingOwners.get(key).add(root);
    }
    for (const slot of data.slots) {
      if (slotRoots[slot.index] || slot.boneData.parent) continue;
      const owners = siblingOwners.get(stem(slot.name));
      if (owners?.size === 1) slotRoots[slot.index] = [...owners][0];
    }
    for (const animation of data.animations) {
      if (fullCut(animation.name)) continue;
      const active = keyedRoots(animation);
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
    const loops = data.animations.filter(a => isLoop(a.name)).map(a => cinematicAnimation(data, runtime, a.name));
    const cuts = data.animations.filter(a => cutParts(a.name) || fullCut(a.name) || /^cut$/i.test(leaf(a.name)))
      .map(a => cinematicAnimation(data, runtime, a.name));
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
      const ranked = loops.filter(loop => {
        if (isArchive(loop.name)) return false;
        const variant = loop.name.match(/^(loop_?\d+|loop|idle_?\d*)(_[a-z].*)$/i);
        // A projected effect loop duplicates the main body's endpoint. Match
        // it only to its named cut variant so it cannot obscure the main pair.
        return !variant || loop === data.findAnimation(loop.name) || cutParts(cut.name)?.suffix === variant[2];
      }).map(loop => {
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
    framingAnimation(name) {
      const state = this.getPlayer().animationState;
      const base = state.getCurrent(0), companion = state.getCurrent(1);
      return base?.animation.name === name && base.timeScale === 0 && companion?.loop
        && this.baseFor(companion.animation.name) === name ? companion.animation.name : name;
    }
    getFramingRange(name) {
      const state = this.getPlayer().animationState;
      const entry = [state.getCurrent(1), state.getCurrent(0)].find(e => e?.animation.name === name);
      return entry?.loop && entry.animationStart > 0
        ? { start: entry.animationStart, end: entry.animationEnd } : undefined;
    }
    independentViewGroups(name) {
      return this.rigVisibility.has(name) || this.rigVisibility.has(this.baseFor(name))
        ? this.rigVisibility.independentViewGroups || [] : [];
    }
    sceneFrameIgnoredSlots(name) {
      return this.rigVisibility.has(name) || this.rigVisibility.has(this.baseFor(name))
        ? this.rigVisibility.sceneFrameIgnoredSlots || [] : [];
    }
    animationFor(name) {
      this.playbackAnimations ||= new Map();
      const { data, skin } = this.getPlayer().skeleton;
      const key = `${name}:${skin?.name || ""}`;
      if (!this.playbackAnimations.has(key)) {
        const source = cinematicSceneAnimation(data, this.spineRuntime, name);
        const predecessor = this.baseFor(name);
        const animation = predecessor ? cinematicLoopAnimation(data, this.spineRuntime, source, this.animationFor(predecessor), skin) : source;
        this.playbackAnimations.set(key, animation);
      }
      return this.playbackAnimations.get(key);
    }
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
          terminal = player.animationState.setAnimationWith(0, this.animationFor(predecessor), false);
          terminal.trackTime = terminal.animation.duration; terminal.timeScale = 0;
        }
      } else { terminal.trackTime = terminal.animationEnd - terminal.animationStart; terminal.timeScale = 0; }
      const entry = player.animationState.setAnimationWith(terminal ? 1 : 0, this.animationFor(name), true);
      entry.mixDuration = 0;
      entry.trackTime = phase * entry.animation.duration;
      if (!continuation) this.applyCamera(name, terminal?.animation.duration);
      this.currentState = name; this.onState(name); this.show(viewport || name);
    }
    shot(name, generation, holdFinal) {
      const player = this.getPlayer();
      player.animationState.clearTracks(); player.skeleton.setToSetupPose();
      const entry = player.animationState.setAnimationWith(0, this.animationFor(name), false);
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
        // Keep the selected shot and its authored terminal frame. Choosing a loop
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
    cameraTimes(name) { return cinematicCutTimes(this.getPlayer().skeleton.data, this.animationFor(name)); }
    cameraSegment(name) {
      const state = this.getPlayer().animationState;
      const entry = [state.getCurrent(1), state.getCurrent(0)].find(e => e?.animation.name === name);
      const time = entry?.getAnimationTime() || 0;
      const times = this.cameraTimesCache?.get(name) || this.cameraTimes(name);
      this.cameraTimesCache ||= new Map(); this.cameraTimesCache.set(name, times);
      return Math.max(0, times.findLastIndex(start => start <= time));
    }
  }
  const exports = { CinematicPlayer, inferCinematicPlan, cinematicCutTimes, buildCinematicRigVisibility, cinematicAnimation, cinematicSceneAnimation, cinematicLoopAnimation, offstageCinematicViews };
  if (typeof module !== "undefined" && module.exports) module.exports = exports;
  if (typeof window !== "undefined") Object.assign(window.AsterPet ||= {}, exports);
})();
