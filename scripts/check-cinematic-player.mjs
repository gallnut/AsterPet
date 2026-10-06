import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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
