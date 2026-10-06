import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as spine from "@esotericsoftware/spine-core";

const require = createRequire(import.meta.url);
const { AnimationGraphPlayer, inferAnimationGraph, resolveAnimationGraph, buildRigVisibility } = require("../src/renderer/pet/animation-graph-player.js");
const data = new spine.SkeletonData();
data.width = 1000;
data.bones.push(new spine.BoneData(0, "root", null));
function translate(name, from, to, duration = 0.2) {
  const timeline = new spine.TranslateXTimeline(2, 0, 0);
  timeline.setFrame(0, 0, from);
  timeline.setFrame(1, duration, to);
  return new spine.Animation(name, [timeline], duration);
}
function rotate(name, from, to) {
  const timeline = new spine.RotateTimeline(2, 0, 0);
  timeline.setFrame(0, 0, from);
  timeline.setFrame(1, 0.2, to);
  const timelines = [timeline];
  if (name === "mix3_1_1") {
    const partial = new spine.TranslateYTimeline(2, 0, 0);
    partial.setFrame(0, 0, 0);
    partial.setFrame(1, 0.2, 30);
    timelines.push(partial);
  }
  return new spine.Animation(name, timelines, 0.2);
}
data.animations.push(
  translate("idle1", 100, 100, 1), translate("idle2", 200, 200, 1), translate("idle3", 300, 300, 1),
  translate("motion1_9", 100, 200), translate("motion2_1", 200, 300), translate("motion3_0", 300, 200),
  rotate("mix3_1_1", 0, 90), rotate("mix3_1_2", 90, 0)
);
const skeleton = new spine.Skeleton(data);
const stateData = new spine.AnimationStateData(data);
stateData.defaultMix = 0.18;
const player = { skeleton, animationState: new spine.AnimationState(stateData), play() {} };
const scene = {
  actions: { idle: { animation: "idle1" } },
  behavior: { animationGraph: {
    format: "asterpet.animation-graph/v1", states: ["idle1", "idle2", "idle3"],
    transitions: [
      { animation: "motion1_9", from: "idle1", to: "idle2" },
      { animation: "motion2_1", from: "idle2", to: "idle3" },
      { animation: "motion3_0", from: "idle3", to: "idle2" }
    ],
    sequences: [{ id: "mix3_1", base: "idle3", animations: ["mix3_1_1", "mix3_1_2"] }]
  } }
};
const played = [];
const graph = new AnimationGraphPlayer({
  getPlayer: () => player, getScene: () => scene, spineRuntime: spine,
  onAnimation: name => played.push(name), onSelection() {}, log() {}
});
graph.start(data.animations.map(animation => animation.name));
assert.equal(graph.play("mix3_1"), true);
for (let frame = 0; frame < 100; frame += 1) {
  player.animationState.update(0.01);
  player.animationState.apply(skeleton);
  const overlay = player.animationState.getCurrent(1);
  if (overlay?.animation.name.startsWith("mix")) {
    assert.equal(player.animationState.getCurrent(0).animation.name, "idle3");
    assert.equal(overlay.loop, false);
    assert.equal(skeleton.bones[0].x, 300, "partial clips must retain the base pose's unkeyed properties");
    if (overlay.animation.name === "mix3_1_2") assert.equal(skeleton.bones[0].y, 0, "Spine must release channels that the next phase no longer keys");
  }
}
await new Promise(resolve => setTimeout(resolve, 150));
assert.deepEqual(played.filter(name => /^(motion|mix)/.test(name)), ["motion1_9", "motion2_1", "mix3_1_1", "mix3_1_2"]);
assert.equal(graph.currentState, "idle3");
assert.equal(graph.selection, "idle3");
assert.equal(player.animationState.getCurrent(1), null);
assert.equal(skeleton.bones[0].y, 0, "the completed sequence must reset properties that the base idle does not key");
assert.equal(graph.play("motion3_0"), true);
for (let frame = 0; frame < 30; frame += 1) {
  player.animationState.update(0.01);
  player.animationState.apply(skeleton);
}
assert.equal(graph.currentState, "idle2", "a transition must return to its declared destination");
assert.equal(player.animationState.getCurrent(0).animation.name, "idle2");

graph.play("mix3_1");
const interruptedComplete = player.animationState.getCurrent(1).listener.complete;
graph.play("idle1");
interruptedComplete();
assert.equal(graph.currentState, "idle1", "a cancelled transition must not replace the new selection");
assert.equal(player.animationState.getCurrent(1), null);
assert.equal(skeleton.bones[0].x, 100);
graph.stop();

const automatic = inferAnimationGraph(data, spine, "idle1");
assert.equal(automatic.automatic, true);
assert.deepEqual(automatic.sequences.find(entry => entry.id === "mix3_1"), {
  id: "mix3_1", base: "idle3", variant: "", animations: ["mix3_1_1", "mix3_1_2"]
});
assert.deepEqual(automatic.transitions.map(({ from, to }) => [from, to]), [["idle1", "idle2"], ["idle2", "idle3"], ["idle3", "idle2"]]);
delete scene.behavior.animationGraph;
graph.start(data.animations.map(animation => animation.name));
assert.equal(graph.enabled, true, "unconfigured imported scenes must automatically use grouped playback");
assert.equal(graph.graph.automatic, true);
graph.play("mix3_1_2");
assert.equal(graph.selection, "mix3_1", "old fragment identifiers must select the full group");
graph.play("idle1");
graph.stop();

data.animations.push(rotate("mix3_1_end", 0, 0), rotate("mix3_1_1_ORG", 0, 90), rotate("mix3_1_loop", 0, 0), rotate("mix3_1_long", 0, 0));
const variants = inferAnimationGraph(data, spine, "idle1");
assert.deepEqual(variants.sequences.find(entry => entry.id === "mix3_1").animations, ["mix3_1_1", "mix3_1_2", "mix3_1_end"]);
for (const variant of ["org", "loop", "long"]) assert.equal(variants.sequences.find(entry => entry.id === `mix3_1@${variant}`).animations.length, 1);
resolveAnimationGraph(variants, data.animations.map(animation => animation.name));
data.animations.push(translate("idle4", 300, 300, 1));
const ambiguous = inferAnimationGraph(data, spine, "idle1").transitions.find(entry => entry.animation === "motion2_1");
assert.equal(ambiguous.uncertain, true, "indistinguishable endpoints must not invent a destination");
assert.equal(ambiguous.to, "idle2");
assert.equal(inferAnimationGraph({ animations: [translate("loop", 0, 0)] }, spine, "loop"), undefined, "ordinary full animations retain their existing player");

const rigs = new spine.SkeletonData();
rigs.bones.push(new spine.BoneData(0, "root", null));
rigs.bones.push(new spine.BoneData(1, "main", rigs.bones[0]), new spine.BoneData(2, "cut", rigs.bones[0]));
rigs.slots.push(new spine.SlotData(0, "body", rigs.bones[1]), new spine.SlotData(1, "cut_body", rigs.bones[2]), new spine.SlotData(2, "static", rigs.bones[0]));
rigs.slots.push(new spine.SlotData(3, "Master", rigs.bones[1]));
const mainTimeline = new spine.RotateTimeline(1, 0, 1); mainTimeline.setFrame(0, 0, 0);
const cutTimeline = new spine.RotateTimeline(1, 0, 2); cutTimeline.setFrame(0, 0, 0);
const clearOther = new spine.AttachmentTimeline(1, 0); clearOther.setFrame(0, 0, null);
rigs.animations.push(new spine.Animation("idle1", [mainTimeline], 1), new spine.Animation("mix1_1_1", [mainTimeline], 1), new spine.Animation("cut_A", [cutTimeline, clearOther], 1));
rigs.animations.push(new spine.Animation("idle2", [mainTimeline, cutTimeline], 1));
const visibility = buildRigVisibility(rigs);
assert.deepEqual(visibility.get("idle1"), [1, 3], "embedded cut rigs and additional figures must be hidden during interactive idle");
assert.deepEqual(visibility.get("mix1_1_1"), [1, 3]);
assert.deepEqual(visibility.get("idle2"), [1, 3], "copied cut keys in modified numbered clips must not show a second viewpoint");
assert.deepEqual(visibility.get("cut_A"), [0, 3], "null attachment keys must not activate another viewpoint");

const stateViews = new spine.SkeletonData();
stateViews.bones.push(new spine.BoneData(0, "root", null));
const viewA = new spine.BoneData(1, "A_all", stateViews.bones[0]);
const viewB = new spine.BoneData(2, "idle2_All", stateViews.bones[0]);
stateViews.bones.push(viewA, viewB);
const viewTimelines = [[], []];
for (let view = 0; view < 2; view++) {
  for (let index = 0; index < 8; index++) {
    const bone = new spine.BoneData(stateViews.bones.length, `part${view}_${index}`, view ? viewB : viewA);
    stateViews.bones.push(bone);
    const slot = new spine.SlotData(stateViews.slots.length, `slot${view}_${index}`, bone);
    stateViews.slots.push(slot);
    const rotate = new spine.RotateTimeline(1, 0, bone.index); rotate.setFrame(0, 0, 0);
    const translate = new spine.TranslateTimeline(1, 0, bone.index); translate.setFrame(0, 0, 0, 0);
    const attach = new spine.AttachmentTimeline(1, slot.index); attach.setFrame(0, 0, `body${view}_${index}`);
    const scale = new spine.ScaleTimeline(1, 0, bone.index); scale.setFrame(0, 0, 1, 1);
    viewTimelines[view].push(rotate, translate, scale, attach);
  }
}
const resetA = new spine.RotateTimeline(1, 0, viewA.index); resetA.setFrame(0, 0, 0);
stateViews.animations.push(new spine.Animation("idle1", viewTimelines[0], 1),
  new spine.Animation("idle2", [...viewTimelines[1], resetA], 1),
  new spine.Animation("mix1_1_1", viewTimelines[0], 1),
  new spine.Animation("motion1_1", [...viewTimelines[0], ...viewTimelines[1]], 1));
const stateVisibility = buildRigVisibility(stateViews);
assert.deepEqual(stateVisibility.get("idle1"), [8, 9, 10, 11, 12, 13, 14, 15], "idle1 must not display the independent idle2 rig from setup pose");
assert.deepEqual(stateVisibility.get("idle2"), [0, 1, 2, 3, 4, 5, 6, 7], "an idle2 reset key on idle1's root must not activate that viewpoint");
const viewPlayer = new AnimationGraphPlayer({ getPlayer: () => ({ skeleton: new spine.Skeleton(stateViews) }),
  getScene: () => ({ actions: { idle: { animation: "idle1" } }, behavior: { animationGraph: {
    format: "asterpet.animation-graph/v1", states: ["idle1", "idle2"], transitions: [{ animation: "motion1_1", from: "idle1", to: "idle2" }],
    sequences: [{ id: "mix1_1", base: "idle1", animations: ["mix1_1_1"] }]
  } } }), spineRuntime: spine, log() {} });
viewPlayer.start(stateViews.animations.map(animation => animation.name));
assert.deepEqual(viewPlayer.getHiddenRigSlots("motion1_1"), stateVisibility.get("idle1"));
viewPlayer.currentState = "idle2";
assert.deepEqual(viewPlayer.getHiddenRigSlots("motion1_1"), stateVisibility.get("idle2"), "a held transition must show only its destination viewpoint");
viewPlayer.stop();

const nestedViews = new spine.SkeletonData();
const nestedRoot = new spine.BoneData(0, "root", null);
const sharedAll = new spine.BoneData(1, "all", nestedRoot);
nestedViews.bones.push(nestedRoot, sharedAll);
const nestedBoneMap = new Map([[stateViews.bones[0], sharedAll]]);
for (const bone of stateViews.bones.slice(1)) {
  const copy = new spine.BoneData(nestedViews.bones.length, bone === viewA ? "idle1" : bone === viewB ? "idle2" : bone.name, nestedBoneMap.get(bone.parent));
  nestedBoneMap.set(bone, copy);
  nestedViews.bones.push(copy);
}
for (const slot of stateViews.slots) nestedViews.slots.push(new spine.SlotData(slot.index, slot.name, nestedBoneMap.get(slot.boneData)));
const nestedTimelines = viewTimelines.map(timelines => timelines.map(timeline => {
  if (timeline instanceof spine.AttachmentTimeline) {
    const copy = new spine.AttachmentTimeline(1, timeline.slotIndex); copy.setFrame(0, 0, timeline.attachmentNames[0]); return copy;
  }
  const index = nestedBoneMap.get(stateViews.bones[timeline.boneIndex]).index;
  if (timeline instanceof spine.RotateTimeline) { const copy = new spine.RotateTimeline(1, 0, index); copy.setFrame(0, 0, 0); return copy; }
  if (timeline instanceof spine.TranslateTimeline) { const copy = new spine.TranslateTimeline(1, 0, index); copy.setFrame(0, 0, 0, 0); return copy; }
  const copy = new spine.ScaleTimeline(1, 0, index); copy.setFrame(0, 0, 1, 1); return copy;
}));
const copiedAttachments = nestedTimelines.map(timelines => timelines.filter(timeline => timeline instanceof spine.AttachmentTimeline));
nestedViews.animations.push(new spine.Animation("idle1", [...nestedTimelines[0], ...copiedAttachments[1]], 1),
  new spine.Animation("idle2", [...nestedTimelines[1], ...copiedAttachments[0]], 1),
  new spine.Animation("idle3", [...nestedTimelines[0], ...copiedAttachments[1]], 1),
  new spine.Animation("idle7", [...nestedTimelines[1], ...copiedAttachments[0]], 1));
const nestedVisibility = buildRigVisibility(nestedViews);
assert.deepEqual(nestedVisibility.get("idle2"), [0, 1, 2, 3, 4, 5, 6, 7], "two pose rigs under one shared all root must remain separate despite copied positive attachment keys");
assert.deepEqual(nestedVisibility.get("idle3"), nestedVisibility.get("idle1"), "idle3 can reuse the pose rig named idle1, without literal number-to-view mapping");
assert.deepEqual(nestedVisibility.get("idle7"), nestedVisibility.get("idle2"), "multiple idle states can reuse the same nested view");
const extraRoot = new spine.BoneData(nestedViews.bones.length, "S", nestedRoot);
nestedViews.bones.push(extraRoot);
const extraTimelines = [], extraAttachmentKeys = [];
for (let index = 0; index < 8; index++) {
  const bone = new spine.BoneData(nestedViews.bones.length, `extra${index}`, extraRoot);
  nestedViews.bones.push(bone);
  const slot = new spine.SlotData(nestedViews.slots.length, `extra${index}`, bone);
  nestedViews.slots.push(slot);
  const rotate = new spine.RotateTimeline(1, 0, bone.index); rotate.setFrame(0, 0, 0);
  const translate = new spine.TranslateTimeline(1, 0, bone.index); translate.setFrame(0, 0, 0, 0);
  const scale = new spine.ScaleTimeline(1, 0, bone.index); scale.setFrame(0, 0, 1, 1);
  const attach = new spine.AttachmentTimeline(1, slot.index); attach.setFrame(0, 0, `extra${index}`);
  extraTimelines.push(rotate, translate, scale, attach); extraAttachmentKeys.push(attach);
}
const extraReset = new spine.RotateTimeline(1, 0, extraRoot.index); extraReset.setFrame(0, 0, 0);
nestedViews.animations = nestedViews.animations.map(animation => new spine.Animation(animation.name, [...animation.timelines, extraReset, ...extraAttachmentKeys], 1));
nestedViews.animations.push(new spine.Animation("loop", extraTimelines, 1));
nestedViews.animations.push(new spine.Animation("mix3_23_1", [...extraTimelines, ...nestedTimelines[1].slice(0, 3)], 1));
const extraVisibility = buildRigVisibility(nestedViews);
for (const name of ["idle1", "idle2", "idle3", "idle7"]) {
  assert.ok([16, 17, 18, 19, 20, 21, 22, 23].every(index => extraVisibility.get(name).includes(index)), "copied loop-view attachments and reset keys must not activate that independent view in numbered idles");
}
assert.deepEqual(extraVisibility.get("loop"), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], "the explicit loop viewpoint must hide both numbered viewpoints");
assert.ok(extraVisibility.extraViewAnimations.has("mix3_23_1"), "a numbered action can genuinely animate the extra viewpoint even though its idle does not");
assert.deepEqual(extraVisibility.get("mix3_23_1"), extraVisibility.get("loop"), "the action's authored extra view replaces the idle view without showing both");

data.animations.push(rotate("mix3_1_end2", 0, 0));
const alternateEnd = inferAnimationGraph(data, spine, "idle1");
assert.ok(alternateEnd.sequences.some(sequence => sequence.id === "mix3_1@2"));
assert.equal(alternateEnd.sequences.some(sequence => sequence.id === "mix3_1_2"), false, "alternate endings must not collide with existing raw fragment names");

data.animations.push(rotate("mix3_2_1", 0, -30), rotate("mix3_2_end", -30, 0));
graph.start(data.animations.map(animation => animation.name));
graph.play("idle3");
player.animationState.update(0.37);
player.animationState.apply(skeleton);
const continuingIdle = player.animationState.getCurrent(0);
played.length = 0;
graph.setInteractionMode("auto");
graph.interact();
assert.equal(graph.interactionQueue.length, 1, "one click must queue every remaining ordinary action in the current pose");
const continuingAction = player.animationState.getCurrent(1);
player.animationState.update(0.08);
player.animationState.apply(skeleton);
graph.interact();
assert.equal(player.animationState.getCurrent(0), continuingIdle, "clicking must not restart the base idle");
assert.equal(player.animationState.getCurrent(1), continuingAction, "a second click must queue rather than interrupt the current clip");
assert.equal(graph.interactionQueue.length, 1);
for (let frame = 0; frame < 160; frame += 1) {
  player.animationState.update(0.01);
  player.animationState.apply(skeleton);
}
await new Promise(resolve => setTimeout(resolve, 150));
assert.deepEqual(played.filter(name => /^(mix|motion)/.test(name)), ["mix3_1_1", "mix3_1_2", "mix3_1_end", "mix3_2_1", "mix3_2_end"]);
assert.equal(graph.currentState, "idle3");
assert.equal(graph.selection, "idle3");
assert.equal(player.animationState.getCurrent(1), null);
assert.ok(player.animationState.getCurrent(0).trackTime > 2, "returning from a click chain must preserve the idle phase");
graph.interact(); graph.interact();
assert.equal(graph.interactionQueue.length, 1);
graph.play("idle1");
assert.equal(graph.interactionQueue.length, 0, "manual pose selection cancels queued interactions");
assert.equal(graph.currentState, "idle1");
const emptyPoseTrack = player.animationState.getCurrent(0);
graph.interact();
assert.equal(player.animationState.getCurrent(0), emptyPoseTrack, "a pose with no local actions must remain unchanged");
graph.interact("doubleClick");
assert.equal(player.animationState.getCurrent(1).animation.name, "motion1_9", "double clicking must play the available pose transition");
for (let frame = 0; frame < 30; frame += 1) {
  player.animationState.update(0.01);
  player.animationState.apply(skeleton);
}
assert.equal(graph.currentState, "idle2");
graph.interact("doubleClick");
assert.equal(graph.currentState, "idle3", "when no known transition reaches the next pose, switch directly");
graph.interact();
assert.equal(graph.interactionSeriesActive, true);
graph.interact("doubleClick");
assert.equal(graph.currentState, "idle4");
assert.equal(graph.interactionQueue.length, 0, "double clicking must cancel the old pose's series");
graph.interact("doubleClick");
assert.equal(graph.currentState, "idle1", "the last numbered pose cycles to the first");
graph.start(data.animations.map(animation => animation.name));
graph.play("idle3");
graph.setInteractionMode("manual");
const manualIdle = player.animationState.getCurrent(0);
played.length = 0;
graph.interact();
assert.equal(graph.selection, "mix3_1");
assert.equal(graph.interactionQueue.length, 0, "manual click plays only one complete action group");
for (let frame = 0; frame < 80; frame += 1) {
  player.animationState.update(0.01);
  player.animationState.apply(skeleton);
}
await new Promise(resolve => setTimeout(resolve, 150));
assert.deepEqual(played.filter(name => /^mix/.test(name)), ["mix3_1_1", "mix3_1_2", "mix3_1_end"]);
assert.equal(graph.selection, "idle3");
graph.interact();
assert.equal(graph.selection, "mix3_2", "the next click remembers the completed group");
const retainedIdle = player.animationState.getCurrent(0);
const cancelledAction = player.animationState.getCurrent(1).listener;
graph.interact("previous");
assert.equal(graph.selection, "mix3_1", "middle click selects the previous local group");
assert.equal(player.animationState.getCurrent(0), retainedIdle, "manual navigation must not restart the idle track");
assert.ok(retainedIdle.trackTime >= manualIdle.trackTime);
cancelledAction.start();
assert.equal(graph.viewportAnimation, "mix3_1_1", "cancelled queued phases must not revive");
graph.interact("previous");
assert.equal(graph.selection, "mix3_2", "previous wraps within the current pose");
graph.interact();
assert.equal(graph.selection, "mix3_1", "next wraps within the current pose");
graph.setInteractionMode("auto");
graph.interact();
assert.equal(graph.interactionSeriesActive, true);
assert.equal(graph.interactionQueue.length, 1);
graph.setInteractionMode("manual");
assert.equal(graph.interactionQueue.length, 0, "switching to manual clears the automatic tail");
assert.equal(graph.selection, "mix3_1", "switching modes preserves the current action");
graph.interact("doubleClick");
assert.equal(graph.currentState, "idle4", "manual mode retains double click pose switching");
graph.stop();
console.log("Animation graph playback checks passed");

// The authored action endpoint remains, while an unkeyed idle channel stays alive.
const terminalData = new spine.SkeletonData();
terminalData.bones.push(new spine.BoneData(0, "root", null));
terminalData.bones.push(new spine.BoneData(1, "hair", terminalData.bones[0]));
const terminalSkin = new spine.Skin("default");
const idleAttachments = [], poseAttachments = [], resetAttachments = [];
for (let index = 0; index < 4; index++) {
  const slot = new spine.SlotData(index, `leg${index}`, terminalData.bones[0]);
  slot.attachmentName = `idle${index}`;
  terminalData.slots.push(slot);
  for (const name of [`idle${index}`, `pose${index}`]) terminalSkin.setAttachment(index, name, new spine.RegionAttachment(name, name));
  const idle = new spine.AttachmentTimeline(1, index); idle.setFrame(0, 0, `idle${index}`); idleAttachments.push(idle);
  const pose = new spine.AttachmentTimeline(2, index); pose.setFrame(0, 0, `pose${index}`); pose.setFrame(1, 0.8, `idle${index}`); poseAttachments.push(pose);
  const reset = new spine.AttachmentTimeline(1, index); reset.setFrame(0, 0, `idle${index}`); resetAttachments.push(reset);
}
terminalData.defaultSkin = terminalSkin;
terminalData.skins.push(terminalSkin);
const idleRoot = new spine.RotateTimeline(1, 0, 0); idleRoot.setFrame(0, 0, 0);
const idleHair = new spine.RotateTimeline(3, 0, 1);
idleHair.setFrame(0, 0, -2); idleHair.setFrame(1, 0.5, 2); idleHair.setFrame(2, 1, -2);
const actionStart = new spine.RotateTimeline(2, 0, 0); actionStart.setFrame(0, 0, 0); actionStart.setFrame(1, 0.2, 30);
const actionEnd = new spine.RotateTimeline(2, 0, 0); actionEnd.setFrame(0, 0, 30); actionEnd.setFrame(1, 0.2, 45);
const nextAction = new spine.RotateTimeline(2, 0, 0); nextAction.setFrame(0, 0, 45); nextAction.setFrame(1, 0.2, 60);
terminalData.animations.push(new spine.Animation("idle1", [idleRoot, idleHair, ...idleAttachments], 1),
  new spine.Animation("mix1_1_1", [actionStart], 0.2), new spine.Animation("mix1_1_end", [actionEnd], 0.2),
  new spine.Animation("mix1_2_1", [nextAction], 0.2),
  new spine.Animation("mix1_3_1", [actionEnd, ...poseAttachments], 1),
  new spine.Animation("mix1_3_end", resetAttachments, 0.2));
const terminalPlayer = { skeleton: new spine.Skeleton(terminalData), animationState: new spine.AnimationState(new spine.AnimationStateData(terminalData)), play() {} };
const terminalGraph = new AnimationGraphPlayer({
  getPlayer: () => terminalPlayer, getScene: () => ({ actions: { idle: { animation: "idle1" } }, behavior: { animationGraph: {
    format: "asterpet.animation-graph/v1",
    states: ["idle1"], transitions: [], sequences: [
      { id: "mix1_1", base: "idle1", animations: ["mix1_1_1", "mix1_1_end"] },
      { id: "mix1_2", base: "idle1", animations: ["mix1_2_1"] },
      { id: "mix1_3", base: "idle1", animations: ["mix1_3_1", "mix1_3_end"] }
    ]
  } } }), spineRuntime: spine, onAnimation() {}, onSelection() {}, log() {}
});
terminalGraph.start(terminalData.animations.map(animation => animation.name));
terminalGraph.play("mix1_1", { holdFinal: true });
const advanceTerminal = seconds => { terminalPlayer.animationState.update(seconds); terminalPlayer.animationState.apply(terminalPlayer.skeleton); };
for (let frame = 0; frame < 55; frame++) advanceTerminal(0.01);
await new Promise(resolve => setTimeout(resolve, 150));
assert.equal(terminalGraph.selection, "mix1_1", "toolbar selection must remain the selected full action group");
assert.equal(terminalGraph.viewportAnimation, "mix1_1_end");
assert.equal(terminalGraph.heldPose, true);
assert.ok(terminalPlayer.skeleton.bones[0].rotation >= 30 && terminalPlayer.skeleton.bones[0].rotation <= 45, "terminal playback must stay in the selected resource fragment, not the idle pose");
const heldAction = terminalPlayer.animationState.getCurrent(1);
const heldTime = heldAction.trackTime;
const idleTime = terminalPlayer.animationState.getCurrent(0).trackTime;
const hairBefore = terminalPlayer.skeleton.bones[1].rotation;
advanceTerminal(0.07);
assert.ok(heldAction.trackTime > heldTime, "the action must keep playing its original terminal frames");
assert.equal(heldAction.loop, true);
assert.ok(heldAction.getAnimationTime() >= heldAction.animationStart && heldAction.getAnimationTime() <= heldAction.animationEnd);
assert.ok(terminalPlayer.animationState.getCurrent(0).trackTime > idleTime, "the resource's native idle must keep playing beneath the held action");
assert.notEqual(terminalPlayer.skeleton.bones[1].rotation, hairBefore, "unkeyed hair motion must come from the resource's idle timeline");
assert.ok(terminalPlayer.skeleton.bones[0].rotation >= 30 && terminalPlayer.skeleton.bones[0].rotation <= 45);
assert.equal(terminalPlayer.skeleton.bones[0].scaleX, 1, "no procedural breathing scale is permitted");
assert.equal(terminalPlayer.skeleton.bones[0].scaleY, 1);
terminalGraph.interact();
assert.equal(terminalGraph.selection, "mix1_2", "left click advances from a held toolbar action");
assert.equal(terminalGraph.heldPose, false);
for (let frame = 0; frame < 40; frame++) advanceTerminal(0.01);
await new Promise(resolve => setTimeout(resolve, 150));
assert.equal(terminalGraph.selection, "idle1", "body gesture actions retain their existing return behavior");
terminalGraph.play("mix1_1", { holdFinal: true });
const cancelledHeldComplete = terminalPlayer.animationState.getCurrent(1).next.listener.complete;
terminalGraph.play("idle1");
cancelledHeldComplete();
assert.equal(terminalGraph.heldPose, false, "a cancelled toolbar completion must not capture a new action");
assert.equal(terminalPlayer.animationState.getCurrent(0).loop, true, "explicit idle selection uses the resource's authored idle loop");
terminalGraph.play("mix1_3", { holdFinal: true });
for (let frame = 0; frame < 120; frame++) advanceTerminal(0.01);
assert.equal(terminalGraph.heldPose, true);
assert.equal(terminalGraph.selection, "mix1_3");
assert.equal(terminalPlayer.animationState.getCurrent(1).animation.name, "mix1_3_1", "the authored end/reset clip must not replace the action pose");
assert.ok(terminalPlayer.animationState.getCurrent(1).getAnimationTime() < 0.8, "hold before the resource's batch restoring idle attachments");
assert.deepEqual(terminalPlayer.skeleton.slots.map(slot => slot.attachment.name), ["pose0", "pose1", "pose2", "pose3"]);
for (let frame = 0; frame < 200; frame++) advanceTerminal(0.01);
assert.deepEqual(terminalPlayer.skeleton.slots.map(slot => slot.attachment.name), ["pose0", "pose1", "pose2", "pose3"], "base idle must not revive restored body attachments while holding");
terminalGraph.interact("previous");
assert.equal(terminalGraph.selection, "mix1_2", "middle click must leave a held pre-reset pose");
terminalGraph.play("mix1_3");
for (let frame = 0; frame < 150; frame++) advanceTerminal(0.01);
await new Promise(resolve => setTimeout(resolve, 150));
assert.equal(terminalGraph.selection, "idle1", "body gestures still play the resource's full reset tail");
assert.deepEqual(terminalPlayer.skeleton.slots.map(slot => slot.attachment.name), ["idle0", "idle1", "idle2", "idle3"]);
terminalGraph.stop();
console.log("Resource-authored terminal idle checks passed");

// A branch with a cut prefix can be the primary numbered interaction rig.
{
  const primaryCut = new spine.SkeletonData();
  primaryCut.bones.push(new spine.BoneData(0, 'root', null));
  const main = new spine.BoneData(1, 'cut_B', primaryCut.bones[0]);
  const auxiliary = new spine.BoneData(2, 'cut_C', primaryCut.bones[0]);
  primaryCut.bones.push(main, auxiliary);
  const motion = [];
  for (let i = 0; i < 24; i++) {
    const bone = new spine.BoneData(primaryCut.bones.length, `B_body${i}`, main);
    primaryCut.bones.push(bone);
    primaryCut.slots.push(new spine.SlotData(i, `cut_body${i}`, bone));
    const t = new spine.RotateTimeline(2, 0, bone.index); t.setFrame(0, 0, 0); t.setFrame(1, 1, 10); motion.push(t);
  }
  primaryCut.slots.push(new spine.SlotData(24, 'cut_extra', auxiliary));
  const copiedReset = new spine.RotateTimeline(2, 0, auxiliary.index);
  copiedReset.setFrame(0, 0, 0); copiedReset.setFrame(1, 1, 0);
  primaryCut.animations.push(new spine.Animation('idle1', [...motion, copiedReset], 1),
    new spine.Animation('idle2', motion, 1), new spine.Animation('mix1_1_1', motion, 1));
  const masks = buildRigVisibility(primaryCut);
  for (const name of ['idle1', 'idle2', 'mix1_1_1']) assert.deepEqual(masks.get(name), [24], 'the main authored cut_B figure stays visible while auxiliary/reset-only views remain hidden');
}
console.log('Numbered primary figures named cut_B remain visible');
