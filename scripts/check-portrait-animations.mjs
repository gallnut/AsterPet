import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as spine from '@esotericsoftware/spine-core';
const { PortraitAnimationComposer } = createRequire(import.meta.url)('../src/renderer/pet/portrait-animation-composer.js');

function fixture(copiedBodyKeys) {
  const data = new spine.SkeletonData();
  const root = new spine.BoneData(0, 'root', null);
  const body = new spine.BoneData(1, 'body', root);
  const face = new spine.BoneData(2, 'face', body);
  data.bones.push(root, body, face);
  const skin = new spine.Skin('default');
  data.defaultSkin = skin; data.skins.push(skin);
  for (let i = 0; i < 60; i++) {
    const slot = new spine.SlotData(i, i < 3 ? ['eye', 'mouth', 'brow'][i] : `body-part-${i}`, i < 3 ? face : body);
    slot.attachmentName = i < 3 ? null : 'body';
    data.slots.push(slot);
    for (const name of ['body', 'neutral', 'angry', 'talk']) {
      // Exported names are not necessarily the skin's attachment lookup keys.
      skin.setAttachment(i, name, new spine.RegionAttachment(`export-${name}`, name));
    }
  }
  const attachment = (slot, name) => {
    const timeline = new spine.AttachmentTimeline(1, slot); timeline.setFrame(0, 0, name); return timeline;
  };
  const bodyMotion = new spine.TranslateTimeline(2, 0, 1);
  bodyMotion.setFrame(0, 0, 0, 0); bodyMotion.setFrame(1, 2, 10, 20);
  const copied = copiedBodyKeys ? data.slots.slice(3).map(slot => attachment(slot.index, null)) : [];
  const rootReset = new spine.TranslateTimeline(1, 0, 0); rootReset.setFrame(0, 0, 500, 500);
  const hiddenColor = new spine.RGBATimeline(1, 0, 2); hiddenColor.setFrame(0, 0, 1, 1, 1, 0);
  const faceTurn = new spine.RotateTimeline(1, 0, 2); faceTurn.setFrame(0, 0, 23);
  const delayedBlink = new spine.AttachmentTimeline(2, 0); delayedBlink.setFrame(0, 1, null); delayedBlink.setFrame(1, 1.1, 'neutral');
  const normal = copiedBodyKeys ? '_face0' : '90_Emo1_normal';
  const angry = copiedBodyKeys ? '_face1' : '90_Emo2_angry';
  const normalKeys = copiedBodyKeys ? [attachment(0, 'neutral'), ...copied, rootReset] : [];
  const bodyOrder = new spine.DrawOrderTimeline(1);
  bodyOrder.setFrame(0, 0, [0, 1, 2, ...data.slots.slice(3).map(slot => slot.index).reverse()]);
  const facialOrder = new spine.DrawOrderTimeline(1);
  facialOrder.setFrame(0, 0, [2, 1, 0, ...data.slots.slice(3).map(slot => slot.index)]);
  data.animations.push(
    new spine.Animation('00_Idle', [bodyMotion, bodyOrder, ...[0, 1, 2].map(i => attachment(i, 'neutral'))], 2),
    new spine.Animation(normal, normalKeys, 0),
    new spine.Animation(angry, [attachment(0, 'angry'), attachment(1, null), attachment(2, 'angry'), hiddenColor, faceTurn, facialOrder, ...copied, rootReset], 0),
    new spine.Animation(`${normal}_talk`, [attachment(0, 'neutral'), attachment(1, 'talk'), ...copied, rootReset], 1),
    new spine.Animation(`${angry}_talk`, [attachment(0, 'angry'), attachment(1, 'talk'), ...copied, rootReset], 1),
    new spine.Animation('90_Emo3_blink', [delayedBlink], 2),
    new spine.Animation('99_dizzy', [attachment(0, 'angry')], 0),
    new spine.Animation('body-motion', [bodyMotion], 2)
  );
  const player = { skeleton: new spine.Skeleton(data), animationState: new spine.AnimationState(new spine.AnimationStateData(data)), play() {} };
  const scene = { category: 'character', actions: { idle: { animation: '00_Idle' } } };
  const composer = new PortraitAnimationComposer({ getPlayer: () => player, getScene: () => scene, spineRuntime: spine });
  composer.start();
  const idle = player.animationState.setAnimation(0, '00_Idle', true);
  composer.ensureExpression();
  const step = time => { player.animationState.update(time); composer.beforeApply(); player.animationState.apply(player.skeleton); };
  return { data, player, scene, composer, idle, step, normal, angry };
}

for (const copiedBodyKeys of [false, true]) {
  const { data, player, scene, composer, idle, step, normal, angry } = fixture(copiedBodyKeys);
  assert.equal(composer.enabled, true);
  assert.equal(composer.role('99_dizzy'), 'expression', 'face-only presets must not replace the body');
  assert.equal(composer.role('body-motion'), undefined);
  step(.5);
  assert.equal(player.skeleton.slots[1].attachment.name, 'export-neutral', 'initial idle seeds authored neutral facial attachments');
  assert.equal(player.skeleton.bones[1].x, 2.5);
  assert.equal(composer.play(angry), true);
  step(.3);
  assert.equal(player.animationState.getCurrent(0), idle, 'selecting an expression retains the running body track');
  assert.equal(player.skeleton.bones[0].x, 0, 'copied root resets must not affect the body');
  assert.equal(player.skeleton.bones[1].x, 4);
  assert.equal(player.skeleton.slots[3].attachment.name, 'export-body', 'copied attachment clears must not hide the body');
  assert.equal(player.skeleton.slots[0].attachment.name, 'export-angry');
  assert.deepEqual(player.skeleton.drawOrder.slice(0, 3).map(slot => slot.data.index), [2, 1, 0], 'authored facial layering must be preserved');
  assert.deepEqual(player.skeleton.drawOrder.slice(3).map(slot => slot.data.index), data.slots.slice(3).map(slot => slot.index).reverse(), 'facial draw order must retain the body animation layering');
  assert.equal(player.skeleton.slots[1].attachment, null, 'intentional authored facial clears are preserved');
  composer.play('90_Emo3_blink'); step(.3);
  assert.equal(player.skeleton.slots[0].attachment.name, 'export-neutral', 'delayed first blink keys must restore the native face before blinking');
  assert.equal(player.animationState.getCurrent(1).loop, true, 'an authored expression idle cycle loops with the body');
  step(.71);
  assert.equal(player.skeleton.slots[0].attachment, null, 'the original authored blink still plays at its original time');
  step(.11);
  assert.equal(player.skeleton.slots[0].attachment.name, 'export-neutral');
  step(1.9);
  assert.equal(player.skeleton.slots[0].attachment, null, 'the native facial idle repeats its authored blink on the next cycle');
  composer.play(normal); step(.3);
  assert.equal(player.skeleton.slots[1].attachment.name, 'export-neutral', 'sparse normal expressions restore facial channels from the authored idle');
  assert.equal(player.skeleton.slots[2].attachment.name, 'export-neutral');
  assert.equal(player.skeleton.slots[2].color.a, 1, 'sparse neutral expressions reset leftover facial opacity');
  assert.equal(player.skeleton.bones[2].rotation, 0, 'sparse neutral expressions reset leftover facial transforms');
  assert.deepEqual(player.skeleton.drawOrder.slice(0, 3).map(slot => slot.data.index), [0, 1, 2], 'sparse neutral expressions restore native facial layering');
  composer.play(angry); step(.3);
  assert.equal(composer.talkingAnimation(`${normal}_talk`), `${angry}_talk`);
  composer.play(`${angry}_talk`); step(.3);
  assert.equal(player.skeleton.slots[0].attachment.name, 'export-angry');
  assert.equal(player.skeleton.slots[1].attachment.name, 'export-talk');
  player.animationState.setEmptyAnimation(2, .1); step(.2); step(.1);
  assert.equal(player.skeleton.slots[0].attachment.name, 'export-angry');
  assert.equal(player.skeleton.slots[1].attachment, null, 'ending speech restores the selected facial pose');
  // A skin/setup reset must immediately reapply all active channels.
  player.skeleton.setSlotsToSetupPose(); composer.refreshSkin(); step(0);
  assert.equal(player.skeleton.slots[0].attachment.name, 'export-angry');
  assert.equal(player.skeleton.slots[3].attachment.name, 'export-body');
  for (const category of ['interaction', 'cg']) {
    scene.category = category; composer.start(); assert.equal(composer.enabled, false);
  }
  scene.category = 'character';
  data.animations = data.animations.filter(animation => !animation.name.includes('talk'));
  composer.start(); composer.noteOverlay(angry);
  assert.equal(composer.talkingAnimation('_face0_talk'), undefined, 'a different expression must not be borrowed for speech');
}

{
  const { data, composer } = fixture(false);
  data.animations.find(animation => animation.name === '00_Idle').setTimelines([
    data.animations.find(animation => animation.name === '99_dizzy').timelines[0]
  ]);
  composer.start();
  assert.equal(composer.role('00_Idle'), undefined, 'a body idle stays the base even in a portrait with only facial channels');
}

{
  const f = fixture(true);
  f.data.slots[55].name = 'hand_variant'; f.data.slots[55].attachmentName = null;
  f.data.slots[56].name = 'weapon_variant'; f.data.slots[56].attachmentName = null;
  const alternate = (slot, name) => {
    const t = new spine.AttachmentTimeline(1, slot); t.setFrame(0, 0, name); return t;
  };
  f.data.findAnimation(f.normal).setTimelines([
    ...f.data.findAnimation(f.normal).timelines.filter(t => ![55, 56].includes(t.slotIndex)),
    alternate(55, null), alternate(56, null)
  ]);
  f.data.findAnimation(f.angry).setTimelines([
    ...f.data.findAnimation(f.angry).timelines.filter(t => ![55, 56].includes(t.slotIndex)),
    alternate(55, 'angry'), alternate(56, 'angry')
  ]);
  const weightedFace = new spine.MeshAttachment('export-neutral', 'neutral');
  weightedFace.bones = [1, 0]; weightedFace.vertices = [0, 0, 1];
  f.data.defaultSkin.setAttachment(0, 'neutral', weightedFace);
  f.player.skeleton.setToSetupPose(); f.composer.start();
  assert.ok(!f.composer.slots.has(55) && !f.composer.slots.has(56), 'varying body attachments in facial exports must not become face overlays');
  assert.ok(!f.composer.bones.has(0), 'a weighted facial mesh does not give its shared body root to the facial layer');
  f.composer.play(f.angry); f.step(.5);
  assert.equal(f.player.skeleton.slots[55].attachment, null, 'an expression cannot display an alternate hand over the idle hand');
  assert.equal(f.player.skeleton.slots[56].attachment, null, 'an expression cannot display a second weapon');
  assert.equal(f.player.skeleton.slots[3].attachment.name, 'export-body');
  assert.equal(f.player.skeleton.bones[0].x, 0);
  assert.equal(f.player.skeleton.bones[1].x, 2.5);
}

{
  const f = fixture(false);
  const blink = new spine.AlphaTimeline(3, 0, 0);
  blink.setFrame(0, 0, 1); blink.setFrame(1, 1, 0); blink.setFrame(2, 2, 1);
  const mouth = new spine.AttachmentTimeline(3, 1);
  mouth.setFrame(0, 0, 'neutral'); mouth.setFrame(1, .8, null); mouth.setFrame(2, 1.1, 'neutral');
  f.data.findAnimation('00_Idle').setTimelines([
    ...f.data.findAnimation('00_Idle').timelines.filter(t => !(t.slotIndex === 1 && t.attachmentNames)), blink, mouth
  ]);
  f.composer.start(); f.player.animationState.clearTracks();
  f.player.animationState.setAnimation(0, '00_Idle', true); f.composer.ensureExpression();
  f.step(.5);
  assert.equal(f.player.skeleton.slots[0].color.a, .5, 'sparse facial defaults must preserve the native idle blink opacity');
  f.step(.5); assert.equal(f.player.skeleton.slots[0].color.a, 0);
  assert.equal(f.player.skeleton.slots[1].attachment, null, 'sparse facial defaults preserve native idle attachment changes');
  f.step(1.5); assert.equal(f.player.skeleton.slots[0].color.a, .5, 'the native blink remains dynamic on later idle cycles');
  assert.equal(f.player.skeleton.slots[1].attachment.name, 'export-neutral');
}

// Exercise the real scheduling classes: attachment-heavy expressions stay on
// track 1, and inferred speech resolves against the currently selected mood.
{
  const f = fixture(true);
  // Some exports use an additional, alpha-hidden mesh for the performance's
  // mouth. Facial presets never key it, so retaining their layer over motion
  // can expose both the preset mouth and this native mouth simultaneously.
  const alternate = f.data.slots[58];
  alternate.name = 'performance-mouth'; alternate.boneData = f.data.bones[2];
  alternate.color.a = 0;
  const hidden = new spine.AlphaTimeline(1, 0, 58); hidden.setFrame(0, 0, 0);
  f.data.findAnimation('00_Idle').setTimelines([...f.data.findAnimation('00_Idle').timelines, hidden]);
  const mouth = new spine.AttachmentTimeline(1, 1); mouth.setFrame(0, 0, null);
  const alternateMouth = new spine.AttachmentTimeline(1, 58); alternateMouth.setFrame(0, 0, 'talk');
  const visible = new spine.AlphaTimeline(1, 0, 58); visible.setFrame(0, 0, 1);
  const eyes = new spine.AttachmentTimeline(1, 0); eyes.setFrame(0, 0, 'talk');
  const turn = new spine.RotateTimeline(1, 0, 2); turn.setFrame(0, 0, -12);
  f.data.animations.push(new spine.Animation('motion', [mouth, alternateMouth, visible, eyes, turn], 1));
  f.composer.start();
  assert.ok(f.composer.slots.has(58), 'the face domain includes motion-only facial meshes');
  f.composer.play(f.normal); f.step(.1);
  f.composer.toolbarSelection = undefined;
  f.player.animationState.setAnimation(0, 'motion', false);
  f.player.animationState.addAnimation(0, '00_Idle', true, 1);
  f.step(.3);
  assert.equal(f.player.animationState.getCurrent(1), null, 'native performance faces must own the facial channels');
  assert.equal(f.player.skeleton.slots[1].attachment, null, 'the preset mouth cannot remain above the performance');
  assert.equal(f.player.skeleton.slots[58].attachment.name, 'export-talk');
  assert.equal(f.player.skeleton.slots[58].color.a, 1);
  assert.equal(f.player.skeleton.slots[0].attachment.name, 'export-talk');
  assert.equal(f.player.skeleton.bones[2].rotation, -12);
  f.step(.3);
  assert.equal(f.player.skeleton.slots[58].color.a, 1, 'the face must not be reset on each frame');
  for (let i = 0; i < 40; i++) f.step(1 / 60);
  assert.equal(f.player.animationState.getCurrent(0).animation.name, '00_Idle');
  assert.equal(f.player.animationState.getCurrent(1).animation.name, f.normal);
  assert.equal(f.player.skeleton.slots[1].attachment.name, 'export-neutral');
  assert.equal(f.player.skeleton.slots[58].color.a, 0, 'returning to idle hides the authored alternate mouth');
  assert.equal(f.player.skeleton.bones[2].rotation, 0);
  // Explicit facial choices remain possible, but must also clear native-only
  // channels so that they display one complete facial pose.
  f.player.animationState.setAnimation(0, 'motion', false); f.step(.2);
  f.composer.play(f.normal); f.step(.2);
  assert.equal(f.player.skeleton.slots[1].attachment.name, 'export-neutral');
  assert.equal(f.player.skeleton.slots[58].color.a, 0);
}

const context = { window: {}, setTimeout, clearTimeout, Date, Math, console };
vm.createContext(context);
for (const file of ['ambient-behavior-director.js', 'action-choreographer.js']) {
  vm.runInContext(fs.readFileSync(new URL(`../src/renderer/pet/${file}`, import.meta.url), 'utf8'), context);
}
const { player, scene, composer, step, normal, angry, idle } = fixture(true);
const options = {
  getPlayer: () => player, getScene: () => scene,
  getAnimationNames: () => player.skeleton.data.animations.map(animation => animation.name),
  getOverlayAnimation: name => composer.overlay(name),
  onAnimation: name => composer.noteOverlay(name), log() {}
};
const ambient = new context.window.AsterPet.AmbientBehaviorDirector({
  ...options, isFullPoseAnimation: () => true, isOverlayAnimation: name => composer.isOverlay(name), canPlay: () => true
});
ambient.start();
assert.ok(ambient.behaviors.every(behavior => behavior.track === 1 && behavior.mode === 'overlay'));
ambient.behaviors = ambient.behaviors.filter(behavior => behavior.animation === angry);
ambient.playNext(); step(.4);
assert.equal(player.animationState.getCurrent(0), idle);
assert.equal(player.skeleton.slots[0].attachment.name, 'export-angry');
ambient.stop();
// Alternate body poses are explicitly selected idle states. Automatic moods
// stay local to the selected pose and cannot switch its arm/weapon rig.
{
  const f = fixture(true);
  f.data.slots[55].name = 'hand_alternate'; f.data.slots[55].attachmentName = null;
  const attachments = f.data.slots.map(slot => {
    const t = new spine.AttachmentTimeline(1, slot.index);
    t.setFrame(0, 0, slot.index === 3 ? null : slot.index === 55 ? 'angry' : slot.index < 3 ? 'neutral' : 'body');
    return t;
  });
  f.data.animations.push(new spine.Animation('_face2', attachments, 2));
  const bodyTurn = new spine.RotateTimeline(2, 0, 1);
  bodyTurn.setFrame(0, 0, 0); bodyTurn.setFrame(1, 2, 20);
  const unchangedPose = attachments.map(t => {
    const key = new spine.AttachmentTimeline(1, t.slotIndex);
    key.setFrame(0, 0, t.slotIndex === 3 ? 'body' : t.slotIndex === 55 ? null : t.attachmentNames[0]); return key;
  });
  f.data.animations.push(new spine.Animation('_face3', [...unchangedPose, bodyTurn], 2));
  f.player.skeleton.setToSetupPose(); f.composer.start();
  assert.equal(f.composer.isBodyAnimation('_face2'), true);
  assert.equal(f.composer.isOverlay('_face2'), true, 'automatic expressions remain facial projections');
  assert.equal(f.composer.isBodyAnimation('_face3'), true, 'native body transforms remain available as manual pose states');
  assert.equal(f.composer.isOverlay(f.normal), true);
  assert.equal(f.composer.poseStates.length, 3);
  const pose = f.composer.selectPose('_face2');
  f.player.animationState.clearTracks(); f.player.skeleton.setToSetupPose();
  const base = f.player.animationState.setAnimationWith(0, pose, true);
  f.composer.ensureExpression(); f.step(.5);
  assert.equal(f.player.skeleton.slots[3].attachment, null);
  assert.equal(f.player.skeleton.slots[55].attachment.name, 'export-angry');
  const auto = new context.window.AsterPet.AmbientBehaviorDirector({
    getPlayer: () => f.player, getScene: () => f.scene,
    getAnimationNames: () => f.data.animations.map(a => a.name),
    isFullPoseAnimation: name => f.composer.isBodyAnimation(name), isOverlayAnimation: name => f.composer.isOverlay(name),
    getOverlayAnimation: name => f.composer.overlay(name), getBaseAnimation: name => f.composer.bodyAnimation(name),
    getIdleAnimation: () => f.composer.idleAnimation(), canPlayBaseAnimation: () => !f.composer.activePoseAnimation,
    canPlay: () => true, onAnimation: name => f.composer.noteOverlay(name), log() {}
  });
  auto.start(); const mood = auto.behaviors.find(b => b.animation === '_face3');
  assert.equal(mood.mode, 'overlay'); assert.equal(mood.role, 'expression');
  auto.behaviors = [mood]; auto.playNext(); f.step(.3);
  assert.equal(f.player.animationState.getCurrent(0), base, 'automatic expression changes retain the explicitly selected body idle');
  assert.equal(f.player.skeleton.slots[3].attachment, null);
  assert.equal(f.player.skeleton.slots[55].attachment.name, 'export-angry');
  assert.equal(f.player.skeleton.bones[1].rotation, 0, 'another expression cannot apply its body turn to this pose');
  for (let frame = 0; frame < 180; frame++) f.step(1 / 60);
  assert.equal(f.player.animationState.getCurrent(0), base, 'the chosen pose remains a dynamic idle on later cycles');
  assert.ok(base.loop && base.trackTime > 3);
  f.composer.play(f.angry); f.step(.2);
  assert.equal(f.player.animationState.getCurrent(0), base, 'manual moods also retain the selected idle');
  auto.behaviors = [{ animation: 'body-motion', mode: 'base', role: 'body', weight: 1 }, mood];
  assert.equal(auto.selectBehavior().animation, mood.animation, 'unpaired body gestures cannot leave a manually selected pose');
  auto.stop();
  const original = f.composer.selectPose('00_Idle');
  f.player.animationState.clearTracks(); f.player.skeleton.setToSetupPose();
  f.player.animationState.setAnimationWith(0, original, true); f.composer.ensureExpression(); f.step(.1);
  assert.equal(f.player.skeleton.slots[3].attachment.name, 'export-body');
  assert.equal(f.player.skeleton.slots[55].attachment, null, 'explicitly returning to the original idle removes the alternate hand');

}
// Automatic portraits include authored body gestures, with facial presets on
// their own track. Weapon changes are allowed when the body action keys them.
{
  const f = fixture(true);
  const weapon = new spine.AttachmentTimeline(3, 3);
  weapon.setFrame(0, 0, 'body'); weapon.setFrame(1, .5, null); weapon.setFrame(2, 1.5, 'body');
  const gesture = new spine.TranslateTimeline(3, 0, 1);
  gesture.setFrame(0, 0, 0, 0); gesture.setFrame(1, 1, 0, -20); gesture.setFrame(2, 2, 0, 0);
  f.data.animations.push(new spine.Animation('motion', [gesture, weapon], 2));
  f.scene.actions.touch = { animation: 'motion', loop: false };
  const auto = new context.window.AsterPet.AmbientBehaviorDirector({
    getPlayer: () => f.player, getScene: () => f.scene,
    getAnimationNames: () => f.data.animations.map(a => a.name),
    isFullPoseAnimation: () => false, isOverlayAnimation: name => f.composer.isOverlay(name),
    getOverlayAnimation: name => f.composer.overlay(name),
    canPlay: () => f.player.animationState.getCurrent(0)?.animation.name === '00_Idle',
    onAnimation: name => f.composer.noteOverlay(name), log() {}
  });
  auto.start();
  const body = auto.behaviors.find(b => b.animation === 'motion');
  assert.equal(body.mode, 'base'); assert.equal(body.track, 0); assert.equal(body.holdMs, 0);
  assert.ok(auto.behaviors.filter(b => f.composer.isOverlay(b.animation)).every(b => b.track === 1));
  const savedMath = context.Math;
  context.Math = Object.create(Math); context.Math.random = () => .1;
  try {
    // Even many facial presets cannot push body gestures out of the pool.
    auto.behaviors = [body, ...Array.from({ length: 40 }, (_, i) => ({ animation: `face-${i}`, role: 'expression', weight: 1 }))];
    assert.equal(auto.selectBehavior().animation, 'motion');
  } finally { context.Math = savedMath; }
  auto.behaviors = [body];
  f.composer.play(f.angry); f.step(.4); const face = f.player.animationState.getCurrent(1);
  auto.playNext(); f.step(.8);
  assert.equal(f.player.animationState.getCurrent(0).animation.name, 'motion');
  assert.equal(f.player.animationState.getCurrent(1), face, 'body gestures retain the selected facial track');
  assert.equal(f.player.skeleton.slots[3].attachment, null, 'the body resource can deliberately put its weapon away');
  for (let frame = 0; frame < 96; frame++) f.step(1 / 60);
  assert.equal(f.player.animationState.getCurrent(0).animation.name, '00_Idle');
  assert.equal(f.player.animationState.getCurrent(0).loop, true, 'automatic gestures return to dynamic idle');
  assert.equal(f.player.skeleton.slots[3].attachment.name, 'export-body');
  auto.stop();
  f.scene.behavior = { ambient: [f.normal] };
  auto.start();
  assert.ok(!auto.behaviors.some(b => b.animation === 'motion'), 'explicit authored ambient rules remain authoritative');
  auto.stop();
  delete f.scene.behavior; f.scene.category = 'interaction'; auto.start();
  assert.ok(!auto.behaviors.some(b => b.animation === 'motion'), 'portrait inference must not change interaction scene choreography');
  auto.stop();
}

const choreographer = new context.window.AsterPet.ActionChoreographer({
  ...options, resolveAgentAnimation: name => composer.talkingAnimation(name)
});
choreographer.start(); choreographer.setAgentState('speaking'); step(.4);
assert.equal(player.animationState.getCurrent(2).animation.name, `${angry}_talk`);
assert.equal(player.skeleton.slots[0].attachment.name, 'export-angry');
composer.play(normal); choreographer.setAgentState('speaking'); step(.4);
assert.equal(player.animationState.getCurrent(2).animation.name, `${normal}_talk`);
choreographer.stop();
console.log('Portrait body, expressions, native performance faces, speech and automatic gesture checks passed');
