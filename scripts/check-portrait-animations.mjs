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
  const step = time => { player.animationState.update(time); player.animationState.apply(player.skeleton); };
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

// Exercise the real scheduling classes: attachment-heavy expressions stay on
// track 1, and inferred speech resolves against the currently selected mood.
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
const choreographer = new context.window.AsterPet.ActionChoreographer({
  ...options, resolveAgentAnimation: name => composer.talkingAnimation(name)
});
choreographer.start(); choreographer.setAgentState('speaking'); step(.4);
assert.equal(player.animationState.getCurrent(2).animation.name, `${angry}_talk`);
assert.equal(player.skeleton.slots[0].attachment.name, 'export-angry');
composer.play(normal); choreographer.setAgentState('speaking'); step(.4);
assert.equal(player.animationState.getCurrent(2).animation.name, `${normal}_talk`);
choreographer.stop();
console.log('Portrait body, expression, sparse facial reset, skin, speech pairing and scheduler checks passed');
