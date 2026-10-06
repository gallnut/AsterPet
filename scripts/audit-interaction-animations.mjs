import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import * as spine from "@esotericsoftware/spine-core";
const require = createRequire(import.meta.url);
const { AnimationGraphPlayer, inferAnimationGraph, resolveAnimationGraph } = require("../src/renderer/pet/animation-graph-player.js");
const root = process.argv[2];
if (!root) throw new Error("Usage: node scripts/audit-interaction-animations.mjs <content-directory>");
const results = [];
for (const packageEntry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!packageEntry.isDirectory()) continue;
  const packageRoot = path.join(root, packageEntry.name);
  const scenesRoot = path.join(packageRoot, "scenes");
  if (!fs.existsSync(scenesRoot)) continue;
  for (const sceneEntry of fs.readdirSync(scenesRoot, { withFileTypes: true })) {
    const configPath = path.join(scenesRoot, sceneEntry.name, "scene.json");
    if (!fs.existsSync(configPath)) continue;
    const scene = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (scene.category !== "interaction" || scene.type !== "spine") continue;
    let atlas;
    try {
      atlas = new spine.TextureAtlas(fs.readFileSync(path.join(packageRoot, scene.assets.atlas), "utf8"));
      for (const page of atlas.pages) page.setTexture(new spine.FakeTexture({ width: page.width, height: page.height }));
      const loader = new spine.AtlasAttachmentLoader(atlas);
      const binary = !scene.assets.skeleton.endsWith(".json");
      const input = fs.readFileSync(path.join(packageRoot, scene.assets.skeleton));
      const data = binary
        ? new spine.SkeletonBinary(loader).readSkeletonData(new Uint8Array(input))
        : new spine.SkeletonJson(loader).readSkeletonData(JSON.parse(input));
      const automatic = inferAnimationGraph(data, spine, scene.actions.idle.animation);
      const config = scene.behavior?.animationGraph || automatic;
      const graph = resolveAnimationGraph(config, data.animations.map(animation => animation.name));
      const result = { id: scene.id, binary, animations: data.animations.length, automatic: Boolean(automatic) };
      if (graph) Object.assign(result, {
        states: [...graph.states], groups: graph.sequences.size,
        multiPhaseGroups: [...graph.sequences.values()].filter(sequence => sequence.animations.length > 1).length,
        transitions: [...graph.transitions.values()],
        fallbackBases: automatic.sequences.filter(sequence => !automatic.states.some(state => state.toLowerCase() === 'idle' + sequence.id.match(/^mix(\d+)/i)[1])).map(sequence => ({ id: sequence.id, base: sequence.base })),
        unmapped: data.animations.map(animation => animation.name).filter(name => !graph.states.has(name) && !graph.bases.has(name))
      });
      if (graph) {
        const skeleton = new spine.Skeleton(data);
        const stateData = new spine.AnimationStateData(data);
        stateData.defaultMix = 0.18;
        const player = { skeleton, animationState: new spine.AnimationState(stateData), play() {} };
        let played = [];
        const runtime = new AnimationGraphPlayer({ getPlayer: () => player, getScene: () => scene, spineRuntime: spine,
          onAnimation: name => played.push(name), onSelection() {}, log() {} });
        runtime.start(data.animations.map(animation => animation.name));
        const characterNames = new Set(scene.layers?.characterSlots || []);
        result.visibleStates = [];
        for (const name of graph.states) {
          runtime.play(name);
          player.animationState.update(.05); player.animationState.apply(skeleton); skeleton.updateWorldTransform();
          const hidden = new Set(runtime.getHiddenRigSlots(name));
          const body = skeleton.slots.filter(slot => characterNames.has(slot.data.name) && slot.getAttachment()
            && slot.color.a * (slot.getAttachment().color?.a ?? 1) > .02
            && Math.abs(slot.bone.a * slot.bone.d - slot.bone.b * slot.bone.c) > .000001);
          const visible = body.filter(slot => !hidden.has(slot.data.index));
          if (body.length >= 8 && !visible.length) throw new Error(`Rig isolation hides the entire character in ${name} (${body.length} authored visible slots)`);
          result.visibleStates.push({ name, authoredBodySlots: body.length, visibleBodySlots: visible.length });
        }
        let verifiedGroups = 0;
        for (const sequence of graph.sequences.values()) {
          runtime.setBase(sequence.base);
          played = [];
          runtime.play(sequence.id);
          for (let frame = 0; frame < sequence.animations.length * 12 + 12; frame += 1) {
            const entry = player.animationState.getCurrent(1);
            if (!entry || !sequence.animations.includes(entry.animation.name)) break;
            if (entry.loop) throw new Error(`Fragment loops independently: ${entry.animation.name}`);
            if (player.animationState.getCurrent(0)?.animation.name !== sequence.base) throw new Error(`Missing base pose: ${sequence.id}`);
            player.animationState.update(Math.max(0.001, entry.animation.duration / 4));
            player.animationState.apply(skeleton);
          }
          const actual = played.filter(name => sequence.animations.includes(name));
          if (JSON.stringify(actual) !== JSON.stringify(sequence.animations)) throw new Error(`Wrong sequence order: ${sequence.id}: ${actual.join(',')}`);
          if (sequence.animations.includes(player.animationState.getCurrent(1)?.animation.name)) throw new Error(`Sequence did not finish: ${sequence.id}`);
          clearTimeout(runtime.finishTimer);
          verifiedGroups += 1;
        }
        runtime.stop();
        skeleton.dispose?.();
        result.verifiedGroups = verifiedGroups;
      } else result.originalAnimations = data.animations.map(animation => animation.name);
      results.push(result);
    } catch (error) {
      results.push({ id: scene.id, error: error.stack || String(error) });
    } finally { atlas?.dispose(); }
  }
}
console.log(JSON.stringify({
  summary: {
    scenes: results.length, automatic: results.filter(result => result.automatic).length,
    binary: results.filter(result => result.binary).length,
    groups: results.reduce((sum, result) => sum + (result.groups || 0), 0),
    multiPhaseGroups: results.reduce((sum, result) => sum + (result.multiPhaseGroups || 0), 0),
    verifiedGroups: results.reduce((sum, result) => sum + (result.verifiedGroups || 0), 0),
    uncertainTransitions: results.flatMap(result => result.transitions || []).filter(transition => transition.uncertain).length,
    errors: results.filter(result => result.error).length
  }, results
}, null, 2));
if (results.some(result => result.error)) process.exitCode = 1;
