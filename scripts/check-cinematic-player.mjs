import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as spine from '@esotericsoftware/spine-core';
const require = createRequire(import.meta.url);
const { inferCinematicPlan, cinematicCutTimes, CinematicPlayer } = require('../src/renderer/pet/cinematic-player.js');
const { AnimationGraphPlayer } = require('../src/renderer/pet/animation-graph-player.js');
const data = new spine.SkeletonData();
data.bones.push(new spine.BoneData(0, 'root', null));
for (let i = 1; i <= 10; i++) data.bones.push(new spine.BoneData(i, `part${i}`, data.bones[0]));
for (let i = 0; i < 10; i++) data.slots.push(new spine.SlotData(i, `part${i}`, data.bones[i + 1]));
const translate = (x, y) => { const t = new spine.TranslateTimeline(2, 0, 0); t.setFrame(0, 0, x, y); t.setFrame(1, .2, x, y); return t; };
const blink = new spine.RotateTimeline(2, 0, 1); blink.setFrame(0, 0, 0); blink.setFrame(1, .2, 10);
data.animations.push(new spine.Animation('A_cut', [translate(25, 70), blink], .2), new spine.Animation('A_cut_idle', [blink], .2),
  new spine.Animation('B_cut', [translate(150, 100)], .2), new spine.Animation('loop', [], .2),
  new spine.Animation('ALL', [translate(150, 100)], .4), new spine.Animation('cut_B_fire', [], .2));
const visibility = data.slots.map((slot, i) => { const t = new spine.AttachmentTimeline(3, i); t.setFrame(0, 0, 'A'); t.setFrame(1, .1, 'B'); t.setFrame(2, .2, null); return t; });
const cameraAnimation = new spine.Animation('cameraCuts', visibility, .3);
assert.deepEqual(cinematicCutTimes(data, cameraAnimation), [0, .1, .2]);
const plan = inferCinematicPlan(data, spine, 'loop');
assert.deepEqual(plan.shots, ['A_cut', 'B_cut']);
assert.deepEqual(plan.full, ['ALL']);
assert.equal(plan.endings.get('A_cut').loop, 'A_cut_idle');
assert.ok(!plan.shots.includes('cut_B_fire'), 'effects and variants must not be concatenated as shots');
const player = { skeleton: new spine.Skeleton(data), animationState: new spine.AnimationState(new spine.AnimationStateData(data)), play() {} };
let played = [];
const runtime = new CinematicPlayer({ getPlayer: () => player, spineRuntime: spine, plan, onAnimation: n => played.push(n), onSelection() {}, onState() {}, log() {} });
const step = seconds => { player.animationState.update(seconds); player.animationState.apply(player.skeleton); player.skeleton.updateWorldTransform(); };
runtime.play('A_cut'); step(.25); step(.01);
assert.equal(player.animationState.getCurrent(0).animation.name, 'A_cut');
assert.equal(player.animationState.getCurrent(0).loop, true);
assert.equal(player.animationState.getCurrent(0).timeScale, 1);
assert.equal(player.animationState.getCurrent(1), null, 'completed shots do not switch to a different idle animation');
assert.equal(player.skeleton.bones[0].x, 25, 'unkeyed idle channels inherit the authored terminal cut pose');
assert.equal(player.skeleton.bones[0].y, 70);
const rotation = player.skeleton.bones[1].rotation; step(.08);
assert.notEqual(player.skeleton.bones[1].rotation, rotation, 'native idle remains animated');
assert.equal(player.skeleton.bones[0].y, 70, 'native idle must not reset the terminal posture');
played = []; runtime.play('@cinematic'); step(.1);
assert.deepEqual(played, ['ALL'], 'prefer the authored complete performance');
const oldComplete = player.animationState.getCurrent(0).listener.complete;
runtime.play('loop'); oldComplete();
assert.equal(player.animationState.getCurrent(0).animation.name, 'loop', 'interrupted cut callbacks must not redirect a new selection');
runtime.play('A_cut_idle'); step(.05);
assert.equal(player.skeleton.bones[0].y, 70, 'selecting a partial companion idle directly must establish its cut pose');
runtime.plan.full = []; played = []; runtime.play('@cinematic'); step(.25); step(.25);
assert.deepEqual(played, ['A_cut', 'B_cut']);
assert.equal(player.animationState.getCurrent(0).timeScale, 1, 'unpaired endings must also keep playing their native tail');
assert.equal(player.animationState.getCurrent(0).loop, true);
runtime.play('loop'); runtime.interact('click'); assert.equal(runtime.selection, '@shot:A_cut');
runtime.interact('click'); assert.equal(runtime.selection, '@shot:B_cut');
runtime.interact('previous'); assert.equal(runtime.selection, '@shot:A_cut');
runtime.setInteractionMode('auto'); runtime.interact('click'); assert.equal(runtime.selection, '@cinematic');
runtime.setInteractionMode('manual'); assert.deepEqual(runtime.queue, []);
const cameraMove = new spine.TranslateTimeline(2, 0, 2);
cameraMove.setFrame(0, 0, 0, 0); cameraMove.setFrame(1, .2, 40, 0);
const clearBody = new spine.AttachmentTimeline(1, 0); clearBody.setFrame(0, 0, null);
data.animations.push(new spine.Animation('b_camera', [cameraMove, clearBody], .2));
plan.cameras.set('B_cut', 'b_camera');
runtime.play('B_cut'); step(.1);
assert.equal(player.animationState.getCurrent(2).animation.name, 'b_camera');
assert.ok(player.skeleton.bones[2].x > 0, 'native camera channels must accompany the cut');
assert.ok(runtime.cameraFor('B_cut').timelines.every(t => t.slotIndex === undefined), 'camera companions must not clear body attachments');
step(.2);
assert.equal(player.animationState.getCurrent(2).timeScale, 0, 'ending idle must not endlessly repeat the camera performance');
runtime.play('A_cut');
assert.equal(player.animationState.getCurrent(2), null, 'camera companions must not leak into another shot');
// A logical shot and a held raw action have different completion contracts.
plan.cameras.set('A_cut', 'b_camera');
runtime.play('@shot:A_cut'); step(.1);
const linkedCamera = player.animationState.getCurrent(2);
step(.15); step(.01);
assert.equal(player.animationState.getCurrent(0).animation.name, 'A_cut');
assert.equal(player.animationState.getCurrent(0).timeScale, 0, 'the completed cut supplies unkeyed pose channels');
assert.equal(player.animationState.getCurrent(1).animation.name, 'A_cut_idle', 'a logical shot enters its resource-authored companion loop');
assert.equal(runtime.framingAnimation('A_cut'), 'A_cut_idle', 'the ending camera follows the active companion instead of the complete transition');
assert.equal(player.animationState.getCurrent(2), linkedCamera, 'the camera must not restart when entering the companion loop');
assert.equal(linkedCamera.timeScale, 0);
assert.equal(runtime.viewportAnimation, 'A_cut', 'cut-to-loop continuation retains the same final camera composition');
assert.equal(runtime.selection, '@shot:A_cut');
const linkedRotation = player.skeleton.bones[1].rotation; step(.05);
assert.notEqual(player.skeleton.bones[1].rotation, linkedRotation, 'the linked idle uses native loop animation');
assert.equal(player.skeleton.bones[0].y, 70, 'a partial loop inherits the cut pose');
runtime.play('A_cut', { holdFinal: true }); step(.25); step(.01);
assert.equal(player.animationState.getCurrent(1), null, 'explicit raw actions retain their tail instead of entering another idle');
assert.equal(player.animationState.getCurrent(0).loop, true);
assert.equal(runtime.selection, 'A_cut');
assert.deepEqual(runtime.getFramingRange('A_cut'), {
  start: player.animationState.getCurrent(0).animationStart,
  end: player.animationState.getCurrent(0).animationEnd
}, 'completed raw shots frame only the native terminal idle, not the whole performance');
runtime.play('loop');
assert.equal(runtime.getFramingRange('loop'), undefined, 'switching away from a held ending restores full loop framing');
runtime.stop();
const wrapper = new AnimationGraphPlayer({ getPlayer: () => player, getScene: () => ({ category: 'cg', actions: { idle: { animation: 'loop' } } }), spineRuntime: spine, onAnimation() {}, onSelection() {}, log() {} });
wrapper.start(data.animations.map(a => a.name)); assert.equal(wrapper.enabled, true); assert.ok(wrapper.cinematic);
assert.equal(wrapper.play('A_cut', { holdFinal: true }), true); step(.25);
assert.equal(wrapper.currentState, 'A_cut_idle', 'toolbar cuts settle into a resource-authored companion loop');
assert.deepEqual(wrapper.getHiddenRigSlots('ALL'), [], 'authored crossfades must retain their own visibility timelines');
wrapper.stop(); assert.equal(wrapper.enabled, false);
for (const category of ['interaction', 'character']) {
  const mislabeled = new AnimationGraphPlayer({ getPlayer: () => player, getScene: () => ({ category, actions: { idle: { animation: 'loop' } } }), spineRuntime: spine, onAnimation() {}, onSelection() {}, log() {} });
  mislabeled.start(data.animations.map(a => a.name));
  assert.ok(mislabeled.cinematic, `cut/loop structures in ${category} bundles must receive cinematic playback`);
  assert.ok(mislabeled.choices().some(choice => choice.id === '@shot:A_cut' && choice.label.includes('A_cut_idle')));
  assert.ok(!mislabeled.choices().some(choice => choice.id === 'A_cut_idle'), 'paired cut and loop appear as one logical shot');
  assert.equal(mislabeled.play('@shot:A_cut', { holdFinal: true }), true); step(.25); step(.01);
  assert.equal(player.animationState.getCurrent(1).animation.name, 'A_cut_idle');
  mislabeled.stop();
}
console.log('Cinematic playback, authored idle, camera cuts, navigation and cancellation checks passed');

// Alternative views nested beneath a common camera are not separate characters.
{
  const views = new spine.SkeletonData();
  views.bones.push(new spine.BoneData(0, 'root', null));
  views.bones.push(new spine.BoneData(1, 'All', views.bones[0]));
  const timelines = {};
  for (const name of ['A_cut', 'B_cut']) {
    const root = new spine.BoneData(views.bones.length, name, views.bones[1]);
    views.bones.push(root); timelines[name] = [];
    for (let i = 0; i < 10; i++) {
      const bone = new spine.BoneData(views.bones.length, `${name}${i + 2}`, root);
      views.bones.push(bone);
      const slot = new spine.SlotData(views.slots.length, `${name}_part${i}`, bone);
      views.slots.push(slot);
      const motion = new spine.RotateTimeline(2, 0, bone.index);
      motion.setFrame(0, 0, 0); motion.setFrame(1, 1, 8);
      timelines[name].push(motion);
    }
  }
  const resetOther = new spine.ScaleTimeline(1, 0, views.bones.find(b => b.name === 'B_cut').index);
  resetOther.setFrame(0, 0, 1, 1);
  const copyAttachment = new spine.AttachmentTimeline(1, 10); copyAttachment.setFrame(0, 0, 'B_part');
  const clearOther = new spine.AttachmentTimeline(1, 10); clearOther.setFrame(0, 0, null);
  const crossfade = new spine.AlphaTimeline(2, 0, 10);
  crossfade.setFrame(0, 0, 0); crossfade.setFrame(1, .5, 1);
  const zeroAlpha = new spine.AlphaTimeline(2, 0, 10);
  zeroAlpha.setFrame(0, 0, 0); zeroAlpha.setFrame(1, .5, 0);
  views.animations.push(new spine.Animation('A_cut', [...timelines.A_cut, resetOther, copyAttachment], 1),
    new spine.Animation('B_cut', [...timelines.B_cut, clearOther], 1),
    new spine.Animation('loop', timelines.A_cut, 1), new spine.Animation('loop2', timelines.B_cut, 1),
    new spine.Animation('ALL', [...timelines.A_cut, ...timelines.B_cut], 1),
    new spine.Animation('A_cut_fade', [...timelines.A_cut, crossfade], 1),
    new spine.Animation('A_cut_clear', [...timelines.A_cut, zeroAlpha], 1));
  const { buildCinematicRigVisibility } = require('../src/renderer/pet/cinematic-player.js');
  const masks = buildCinematicRigVisibility(views);
  assert.deepEqual(masks.get('A_cut'), Array.from({ length: 10 }, (_, i) => i + 10), 'copied attachment and setup scale do not activate a second view');
  assert.deepEqual(masks.get('B_cut'), Array.from({ length: 10 }, (_, i) => i), 'switching shots exposes the other authored view');
  assert.deepEqual(masks.get('loop'), masks.get('A_cut'));
  assert.deepEqual(masks.get('loop2'), masks.get('B_cut'));
  assert.equal(masks.has('ALL'), false, 'authored multi-view sequences retain camera changes');
  assert.deepEqual(masks.get('A_cut_fade'), [], 'explicit authored crossfades retain both rigs');
  assert.deepEqual(masks.get('A_cut_clear'), masks.get('A_cut'), 'null/zero visibility keys do not activate an alternative rig');
}
console.log('Nested cinematic viewpoint isolation and crossfade checks passed');

// Bare shot containers, shared-root weighted meshes and offscreen auxiliaries.
{
  const views = new spine.SkeletonData();
  views.bones.push(new spine.BoneData(0, 'root', null));
  views.defaultSkin = new spine.Skin('default'); views.skins.push(views.defaultSkin);
  const roots = {}, timelines = {}, slots = {};
  for (const name of ['A', 'B']) {
    const root = new spine.BoneData(views.bones.length, name, views.bones[0]);
    views.bones.push(root); roots[name] = root; timelines[name] = []; slots[name] = [];
    for (let i = 0; i < 12; i++) {
      const bone = new spine.BoneData(views.bones.length, `${name}_part${i}`, root);
      views.bones.push(bone);
      const slot = new spine.SlotData(views.slots.length, `${name}_part${i}`, bone);
      views.slots.push(slot); slots[name].push(slot.index);
      const move = new spine.RotateTimeline(2, 0, bone.index);
      move.setFrame(0, 0, 0); move.setFrame(1, 1, 8); timelines[name].push(move);
    }
  }
  views.slots[slots.B[0]].name = 'accessory1';
  const weighted = new spine.SlotData(views.slots.length, 'weighted-part', views.bones[0]);
  views.slots.push(weighted);
  const mesh = new spine.MeshAttachment('weighted-part', 'weighted-part');
  mesh.bones = [1, views.slots[slots.B[1]].boneData.index]; mesh.vertices = [0, 0, 1];
  views.defaultSkin.setAttachment(weighted.index, 'weighted-part', mesh);
  const sibling = new spine.SlotData(views.slots.length, 'accessory2', views.bones[0]); views.slots.push(sibling);
  const auxiliary = new spine.BoneData(views.bones.length, 'auxiliary', views.bones[0]);
  auxiliary.x = 5000; views.bones.push(auxiliary);
  const prop = new spine.SlotData(views.slots.length, 'auxiliary-part', auxiliary); views.slots.push(prop);
  const moveProp = new spine.TranslateTimeline(2, 0, auxiliary.index);
  moveProp.setFrame(0, 0, 5000, 0); moveProp.setFrame(1, 1, 5100, 0);
  const backdrop = new spine.SlotData(views.slots.length, 'shared-background', views.bones[0]); views.slots.push(backdrop);
  const resetA = new spine.RotateTimeline(1, 0, views.slots[slots.A[0]].boneData.index); resetA.setFrame(0, 0, 0);
  views.animations.push(new spine.Animation('cut_A', timelines.A, 1),
    new spine.Animation('cut_B', [...timelines.B, resetA, moveProp], 1),
    new spine.Animation('loop', timelines.A, 1), new spine.Animation('loop_2', [...timelines.B, resetA], 1),
    new spine.Animation('cut_A_effect', [], 1), new spine.Animation('ALL', [...timelines.A, resetA], 1));
  const { buildCinematicRigVisibility, cinematicAnimation } = require('../src/renderer/pet/cinematic-player.js');
  const variantMove = new spine.TranslateTimeline(1, 0, views.slots[slots.B[0]].boneData.index);
  variantMove.setFrame(0, 0, 50, 0);
  const hidePart = new spine.AttachmentTimeline(1, slots.B[0]); hidePart.setFrame(0, 0, null);
  views.animations.push(new spine.Animation('loop_2_variant', [variantMove, hidePart], .1));
  const variant = cinematicAnimation(views, spine, 'loop_2_variant');
  const sampled = new spine.Skeleton(views);
  variant.apply(sampled, 0, .25, true, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn);
  const firstRotation = sampled.bones[views.slots[slots.B[1]].boneData.index].rotation;
  variant.apply(sampled, .25, .5, true, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn);
  assert.notEqual(sampled.bones[views.slots[slots.B[1]].boneData.index].rotation, firstRotation, 'sparse loop variants inherit the authored body movement');
  assert.equal(sampled.bones[views.slots[slots.B[0]].boneData.index].x, 50, 'variant channels override the main shot');
  assert.equal(sampled.slots[slots.B[0]].attachment, null, 'variant visibility remains authoritative');
  assert.equal(variant.duration, 1, 'short accessory exports do not truncate the native loop');
  const isolatedClears = slots.B.map(index => {
    const clear = new spine.AttachmentTimeline(1, index); clear.setFrame(0, 0, null); return clear;
  });
  const nativePart = new spine.AttachmentTimeline(1, slots.B[1]); nativePart.setFrame(0, 0, 'native-part');
  views.defaultSkin.setAttachment(slots.B[1], 'native-part', new spine.RegionAttachment('native-part', 'native-part'));
  views.findAnimation('loop_2').setTimelines([...views.findAnimation('loop_2').timelines, nativePart]);
  views.animations.push(new spine.Animation('loop_2_effect', isolatedClears, .1));
  const effect = cinematicAnimation(views, spine, 'loop_2_effect');
  sampled.setToSetupPose(); effect.apply(sampled, 0, .5, true, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn);
  assert.equal(sampled.slots[slots.B[1]].attachment.name, 'native-part', 'an isolated effect export cannot clear the native body');
  const masks = buildCinematicRigVisibility(views);
  for (const name of ['cut_A', 'loop', 'cut_A_effect']) {
    assert.deepEqual(masks.get(name), [...slots.B, weighted.index, sibling.index, prop.index], 'the inactive shot includes its weighted and ancillary pieces');
  }
  for (const name of ['cut_B', 'loop_2']) {
    assert.deepEqual(masks.get(name), slots.A, 'minor copied reset keys do not activate the other shot');
    assert.ok(!masks.get(name).includes(prop.index), 'auxiliary art may enter its authored shot');
  }
  assert.ok(!masks.get('cut_A').includes(backdrop.index), 'unowned shared scenery remains visible');
  assert.equal(masks.has('ALL'), false, 'authored multiple-view sequences remain intact');
}
console.log('Bare cinematic containers, weighted view ownership and auxiliary ownership checks passed');

// A companion loop can replace a cut mesh with a different weighted binding.
// The frozen cut may keep camera/pose channels, but cannot stretch the new mesh.
{
  const binding = new spine.SkeletonData();
  const root = new spine.BoneData(0, 'root', null);
  const camera = new spine.BoneData(1, 'A', root);
  const joint = new spine.BoneData(2, 'body-joint', camera); joint.x = 10;
  binding.bones.push(root, camera, joint);
  const slot = new spine.SlotData(0, 'body-part', joint); slot.attachmentName = 'cut-mesh';
  binding.slots.push(slot);
  const skin = new spine.Skin('default'); binding.skins.push(skin); binding.defaultSkin = skin;
  const old = new spine.MeshAttachment('cut-mesh', 'cut-mesh');
  old.worldVerticesLength = 2; old.bones = [1, 2]; old.vertices = [0, 0, 1];
  const replacement = new spine.MeshAttachment('idle-mesh', 'idle-mesh');
  replacement.worldVerticesLength = 4; replacement.bones = [1, 2, 1, 2]; replacement.vertices = [0, 0, 1, 20, 0, 1];
  skin.setAttachment(0, old.name, old); skin.setAttachment(0, replacement.name, replacement);
  const moveJoint = new spine.TranslateTimeline(1, 0, 2); moveJoint.setFrame(0, 0, 200, 0);
  const moveCamera = new spine.TranslateTimeline(1, 0, 1); moveCamera.setFrame(0, 0, 60, 0);
  const changeMesh = new spine.AttachmentTimeline(1, 0); changeMesh.setFrame(0, 0, replacement.name);
  const idleMove = new spine.RotateTimeline(2, 0, 2); idleMove.setFrame(0, 0, 0); idleMove.setFrame(1, 1, 10);
  const cut = new spine.Animation('A_cut', [moveCamera, moveJoint], 1);
  const loop = new spine.Animation('loop', [changeMesh, idleMove], 1);
  binding.animations.push(cut, loop);
  const { cinematicLoopAnimation } = require('../src/renderer/pet/cinematic-player.js');
  const projected = cinematicLoopAnimation(binding, spine, loop, cut, skin);
  const sample = new spine.Skeleton(binding);
  sample.setToSetupPose();
  cut.apply(sample, 0, 1, false, [], 1, spine.MixBlend.replace, spine.MixDirection.mixIn);
  projected.apply(sample, 0, .5, true, [], 1, spine.MixBlend.replace, spine.MixDirection.mixIn);
  sample.updateWorldTransform();
  assert.equal(sample.bones[2].x, 10, 'replacement-mesh joints use their native binding instead of inherited cut translation');
  assert.equal(sample.bones[1].x, 60, 'the inherited camera/shot position remains intact');
  assert.equal(sample.bones[2].rotation, 5, 'native loop motion remains dynamic');
  assert.equal(sample.slots[0].attachment, replacement);
  const vertices = new Array(4); replacement.computeWorldVertices(sample.slots[0], 0, 4, vertices, 0, 2);
  assert.equal(vertices[0], 70, 'the replacement vertex is not pulled to the previous cut joint');
  const linked = old.newLinkedMesh(); linked.name = 'linked-mesh'; skin.setAttachment(0, linked.name, linked);
  const compatibleKey = new spine.AttachmentTimeline(1, 0); compatibleKey.setFrame(0, 0, linked.name);
  const compatibleLoop = new spine.Animation('compatible-loop', [compatibleKey], 1);
  assert.equal(cinematicLoopAnimation(binding, spine, compatibleLoop, cut, skin), compatibleLoop,
    'compatible linked meshes still inherit the cut pose without unnecessary resets');
}
console.log('Replacement mesh bindings, native loop movement and retained camera pose checks passed');

// Active-shot props remain available; only independent viewpoints are hidden.
{
  const layers = new spine.SkeletonData();
  const root = new spine.BoneData(0, 'root', null);
  const distant = new spine.BoneData(1, 'distant-prop', root); distant.x = 5000;
  layers.bones.push(root, distant);
  const skin = new spine.Skin('default'); layers.defaultSkin = skin; layers.skins.push(skin);
  for (let index = 0; index < 3; index++) {
    const slot = new spine.SlotData(index, `part${index}`, index === 0 ? root : distant);
    slot.attachmentName = 'part'; layers.slots.push(slot);
    skin.setAttachment(index, 'part', new spine.RegionAttachment('part', 'part'));
  }
  const opacity = new spine.AlphaTimeline(1, 0, 1); opacity.setFrame(0, 0, .4);
  const nativeHidden = new spine.AttachmentTimeline(1, 2); nativeHidden.setFrame(0, 0, null);
  layers.animations.push(new spine.Animation('cut_A', [opacity, nativeHidden], 1));
  const skeleton = new spine.Skeleton(layers);
  const state = new spine.AnimationState(new spine.AnimationStateData(layers));
  const source = readFileSync(new URL('../src/renderer/pet/app.js', import.meta.url), 'utf8');
  const visibility = source.slice(source.indexOf('function applyConfiguredLayerVisibility('), source.indexOf('\nfunction rebuildLayerVisibilityCache()'));
  const hook = source.slice(source.indexOf('function applyIndependentViewVisibility('), source.indexOf('\nfunction playVoice('));
  const hidden = [];
  runInNewContext(`${visibility}\n${hook}\nfunction applyLayerVisibility() { applyConfiguredLayerVisibility(player.skeleton); }\nenforceLayerVisibilityAfterAnimation();`, {
    player: { skeleton, animationState: state }, hiddenLayerSlotIndices: hidden,
    animationGraphPlayer: { enabled: true, viewportAnimation: 'cut_A', getHiddenRigSlots: () => [0] },
    portraitComposer: { beforeApply() {} }, animationSelect: { value: 'cut_A' },
    setAnimationViewport() {}
  });
  state.setAnimation(0, 'cut_A', true);
  state.apply(skeleton); skeleton.updateWorldTransform();
  assert.equal(skeleton.slots[0].attachment, null, 'independent viewpoints still remain hidden');
  assert.ok(skeleton.slots[1].attachment, 'active-shot material is not filtered because it is distant');
  assert.ok(Math.abs(skeleton.slots[1].color.a - .4) < 1e-6, 'resource-authored opacity is preserved');
  assert.equal(skeleton.slots[2].attachment, null, 'the resource can still animate attachment visibility');
  hidden.push(1); state.apply(skeleton); skeleton.updateWorldTransform();
  assert.equal(skeleton.slots[1].attachment, null, 'the user can explicitly hide a layer');
  assert.equal(skeleton.slots[1].color.a, 0);
  hidden.length = 0; skeleton.setSlotsToSetupPose();
  state.apply(skeleton); skeleton.updateWorldTransform();
  assert.ok(skeleton.slots[1].attachment, 'reenabling the layer restores its authored material');
  assert.ok(Math.abs(skeleton.slots[1].color.a - .4) < 1e-6);
}
console.log('Active-shot material visibility, viewpoint isolation and manual layer control checks passed');

// Secondary actors may cross the scene during a transition, and embedded
// close-ups can be placed by the following idle rather than by the cut.
{
  const { buildCinematicRigVisibility, offstageCinematicViews } = require('../src/renderer/pet/cinematic-player.js');
  const views = new spine.SkeletonData();
  const root = new spine.BoneData(0, 'root', null);
  const a = new spine.BoneData(1, 'A', root), b = new spine.BoneData(2, 'B', root);
  const actor = new spine.BoneData(3, 'transition-actor', root); actor.x = 500;
  const detail = new spine.BoneData(4, 'embedded-view', a); detail.x = 600;
  views.bones.push(root, a, b, actor, detail);
  const skin = new spine.Skin('default'); views.defaultSkin = skin; views.skins.push(skin);
  const addSlot = (name, bone, x = 0) => {
    const slot = new spine.SlotData(views.slots.length, name, bone); slot.attachmentName = 'part';
    views.slots.push(slot);
    const attachment = new spine.RegionAttachment('part', 'part');
    attachment.offset = [x, 0, x, 10, x + 10, 10, x + 10, 0];
    skin.setAttachment(slot.index, 'part', attachment);
    return slot.index;
  };
  for (const bone of [a, b]) for (let index = 0; index < 8; index++) addSlot(`${bone.name}_part${index}`, bone);
  const first = addSlot('actor-part', actor), second = addSlot('actor-accessory', actor, 1000);
  const inset = addSlot('close-up', detail);
  const authoredEffect = addSlot('A_effect', a, 1000);
  const movement = new spine.TranslateXTimeline(4, 0, actor.index);
  movement.setFrame(0, 0, 0); movement.setFrame(1, .5, -480); movement.setFrame(2, 1, -1500); movement.setFrame(3, 2, -2500);
  const opacity = new spine.AlphaTimeline(1, 0, second); opacity.setFrame(0, 0, .6);
  views.animations.push(new spine.Animation('cut_A', [movement, opacity], 2), new spine.Animation('cut_B', [], 1));
  const masks = buildCinematicRigVisibility(views);
  const groups = masks.independentViewGroups;
  assert.ok(groups.some(group => group.includes(first) && group.includes(second)), 'an independent actor is one view, including its accessories');
  assert.ok(groups.some(group => group.includes(inset)), 'a nested unnamespaced close-up is recognized as a separate view');
  assert.ok(!groups.flat().includes(authoredEffect), 'authored effects within the primary shot namespace are never classified away');
  const skeleton = new spine.Skeleton(views);
  const state = new spine.AnimationState(new spine.AnimationStateData(views));
  const frame = { offset: { x: 0, y: 0 }, size: { x: 100, y: 100 } };
  const source = readFileSync(new URL('../src/renderer/pet/app.js', import.meta.url), 'utf8');
  const hook = source.slice(source.indexOf('function applyIndependentViewVisibility('), source.indexOf('\nfunction playVoice('));
  runInNewContext(`${hook}\nenforceLayerVisibilityAfterAnimation();`, {
    player: { skeleton, animationState: state }, spine,
    animationGraphPlayer: { enabled: true, viewportAnimation: 'cut_A', cinematic: {
      independentViewGroups: () => groups, sceneFrameIgnoredSlots: () => masks.sceneFrameIgnoredSlots
    } },
    getVisibleSkeletonBounds: () => frame, window: { AsterPet: { offstageCinematicViews } },
    portraitComposer: { beforeApply() {} }, animationSelect: { value: 'cut_A' },
    setAnimationViewport() {}, applyLayerVisibility() {}
  });
  const entry = state.setAnimation(0, 'cut_A', false);
  state.apply(skeleton); skeleton.updateWorldTransform();
  assert.equal(skeleton.slots[first].color.a, 0, 'the actor starts outside the scene');
  assert.equal(skeleton.slots[inset].color.a, 0, 'the unplaced close-up is not displayed beside the main scene');
  assert.ok(skeleton.slots[authoredEffect].attachment, 'primary-shot effects remain available regardless of position');
  entry.trackTime = .5; state.apply(skeleton); skeleton.updateWorldTransform();
  assert.equal(skeleton.slots[first].color.a, 1, 'the resource-authored actor appears when its transition enters the scene');
  assert.ok(Math.abs(skeleton.slots[second].color.a - .6) < 1e-6, 'the entire actor view retains its accessory and authored opacity');
  entry.trackTime = 1; state.apply(skeleton); skeleton.updateWorldTransform();
  // The accessory remains in-frame here: a view is retained as a whole,
  // even after the actor's other part moves out of frame.
  assert.equal(skeleton.slots[first].color.a, 1, 'view isolation never filters individual parts of an active view');
  entry.trackTime = 2; state.apply(skeleton); skeleton.updateWorldTransform();
  assert.equal(skeleton.slots[first].color.a, 0, 'the actor disappears only after its entire native view exits the scene');
  assert.equal(skeleton.slots[second].color.a, 0);
}
console.log('Native transition actors, embedded views and complete active-view materials checks passed');

// A water/background export is a render pass, not a separate foreground pose.
{
  const { cinematicSceneAnimation } = require('../src/renderer/pet/cinematic-player.js');
  const scene = new spine.SkeletonData();
  const root = new spine.BoneData(0, 'root', null), camera = new spine.BoneData(1, 'A', root);
  const body = new spine.BoneData(2, 'body', camera), water = new spine.BoneData(3, 'water-joint', camera);
  const unrelated = new spine.BoneData(4, 'unused-view', root);
  scene.bones.push(root, camera, body, water, unrelated);
  const skin = new spine.Skin('default'); scene.defaultSkin = skin; scene.skins.push(skin);
  const clears = [];
  for (let index = 0; index < 10; index++) {
    const slot = new spine.SlotData(index, `A_part${index}`, body); slot.attachmentName = 'body'; scene.slots.push(slot);
    skin.setAttachment(index, 'body', new spine.RegionAttachment('body', 'body'));
    const clear = new spine.AttachmentTimeline(1, index); clear.setFrame(0, 0, null); clears.push(clear);
  }
  const backdrop = new spine.SlotData(10, 'A_background', camera); scene.slots.push(backdrop);
  const mesh = new spine.MeshAttachment('background', 'background');
  mesh.worldVerticesLength = 4; mesh.bones = [1, 3, 1, 3]; mesh.vertices = [0, 0, 1, 100, 100, 1];
  skin.setAttachment(10, 'background', mesh);
  const hide = new spine.AttachmentTimeline(1, 10); hide.setFrame(0, 0, null);
  const show = new spine.AttachmentTimeline(1, 10); show.setFrame(0, 0, 'background');
  const position = new spine.TranslateXTimeline(1, 0, 1); position.setFrame(0, 0, 42);
  const conflicting = new spine.TranslateXTimeline(1, 0, 1); conflicting.setFrame(0, 0, 9000);
  const movement = new spine.RotateTimeline(2, 0, 2); movement.setFrame(0, 0, 0); movement.setFrame(1, 1, 10);
  const ripples = new spine.TranslateYTimeline(2, 0, 3); ripples.setFrame(0, 0, 0); ripples.setFrame(1, 1, 30);
  const opacity = new spine.AlphaTimeline(2, 0, 10); opacity.setFrame(0, 0, .4); opacity.setFrame(1, 1, .8);
  const unused = new spine.RotateTimeline(1, 0, 4); unused.setFrame(0, 0, 90);
  scene.animations.push(new spine.Animation('cut_A', [hide, position, movement], 1),
    new spine.Animation('loop', [hide, movement], 1),
    new spine.Animation('cut_A_water', [...clears, show, conflicting, ripples, opacity, unused], 1),
    new spine.Animation('loop_water', [...clears, show, conflicting, ripples, opacity, unused], 1));
  const skeleton = new spine.Skeleton(scene);
  cinematicSceneAnimation(scene, spine, 'cut_A').apply(skeleton, 0, .5, false, [], 1, spine.MixBlend.replace, spine.MixDirection.mixIn);
  assert.ok(skeleton.slots.slice(0, 10).every(slot => slot.attachment), 'copied export clears cannot erase foreground materials');
  assert.equal(skeleton.slots[10].attachment, mesh, 'the matching render pass restores the background hidden in the main clip');
  assert.equal(skeleton.bones[1].x, 42, 'the auxiliary pass cannot move the main camera');
  assert.equal(skeleton.bones[2].rotation, 5, 'foreground animation remains native');
  assert.equal(skeleton.bones[3].y, 15, 'the weighted background receives its native movement');
  assert.ok(Math.abs(skeleton.slots[10].color.a - .6) < 1e-6, 'background opacity follows the resource');
  assert.equal(skeleton.bones[4].rotation, 0, 'unrelated pass transforms cannot activate another view');
  const player = { skeleton, animationState: new spine.AnimationState(new spine.AnimationStateData(scene)), play() {} };
  const plan = { idle: 'loop', loops: ['loop'], predecessors: new Map([['loop', 'cut_A']]), cameras: new Map() };
  const runtime = new CinematicPlayer({ getPlayer: () => player, spineRuntime: spine, plan, onAnimation() {}, onState() {}, log() {} });
  runtime.loop('loop'); player.animationState.update(.25); player.animationState.apply(skeleton);
  const previous = skeleton.bones[3].y;
  player.animationState.update(.25); player.animationState.apply(skeleton);
  assert.equal(skeleton.slots[10].attachment, mesh, 'the following idle keeps its matching background pass');
  assert.notEqual(skeleton.bones[3].y, previous, 'water animation keeps running during idle');
  assert.equal(skeleton.bones[1].x, 42, 'the companion idle retains the cut camera rather than an export-only transform');
  const variantPose = new spine.RotateTimeline(1, 0, 2); variantPose.setFrame(0, 0, 25);
  scene.animations.push(new spine.Animation('cut_A_variant', [hide, position, variantPose], 1));
  skeleton.setToSetupPose();
  cinematicSceneAnimation(scene, spine, 'cut_A_variant').apply(skeleton, 0, .5, false, [], 1, spine.MixBlend.replace, spine.MixDirection.mixIn);
  assert.equal(skeleton.slots[10].attachment, mesh, 'a foreground variant inherits its view background pass');
  assert.equal(skeleton.bones[2].rotation, 25, 'background pairing cannot replace the selected foreground variant');
  const alternate = new spine.RegionAttachment('alternate-background', 'alternate-background');
  skin.setAttachment(10, 'alternate-background', alternate);
  const alternateKey = new spine.AttachmentTimeline(1, 10); alternateKey.setFrame(0, 0, 'alternate-background');
  scene.animations.push(new spine.Animation('cut_A_variant_WATER', [...clears, alternateKey], 1));
  skeleton.setToSetupPose();
  cinematicSceneAnimation(scene, spine, 'cut_A_variant').apply(skeleton, 0, .5, false, [], 1, spine.MixBlend.replace, spine.MixDirection.mixIn);
  assert.equal(skeleton.slots[10].attachment, alternate, 'a variant-specific pass takes precedence without stacking the base alternative');
  const mist = new spine.SlotData(11, 'A_mist', water); scene.slots.push(mist);
  skin.setAttachment(11, 'mist', new spine.RegionAttachment('mist', 'mist'));
  const mistKey = new spine.AttachmentTimeline(1, 11); mistKey.setFrame(0, 0, 'mist');
  scene.animations.push(new spine.Animation('cut_A_bg_front', [...clears, mistKey], 1));
  const expanded = new spine.Skeleton(scene);
  cinematicSceneAnimation(scene, spine, 'cut_A').apply(expanded, 0, .5, false, [], 1, spine.MixBlend.replace, spine.MixDirection.mixIn);
  assert.ok(expanded.slots[10].attachment && expanded.slots[11].attachment, 'distinct back and front scene layers accompany the main animation together');
}
console.log('Synchronized background render passes, foreground pose and animated idle checks passed');
