import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PetInteractionController, preservesInteractionSelection } = require("../src/renderer/pet/pet-interaction.js");
const waitForClick = () => new Promise(resolve => setTimeout(resolve, 270));
const event = () => ({ clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {} });
const makeController = (scene, graph = false) => {
  const actions = [];
  const interactions = [];
  const controller = new PetInteractionController({
    getScene: () => scene, getAnimationGraphEnabled: () => graph,
    geometryInput: { isOpaquePoint: () => true }, playAction: action => actions.push(action),
    playInteraction: gesture => interactions.push(gesture)
  });
  return { controller, actions, interactions };
};
const gestures = { click: "touch", doubleClick: "touch" };
const actions = { idle: {}, touch: {}, damage: {}, dead: {} };
for (const [scene, graph] of [
  [{ type: "spine", category: "interaction", gestures, actions }, false],
  [{ type: "spine", category: "character", gestures, actions }, true],
  [{ type: "spine", behavior: { animationGraph: {} }, gestures, actions }, false]
]) {
  assert.equal(preservesInteractionSelection(scene, graph), true);
  const test = makeController(scene, graph);
  test.controller.handleClick(event());
  test.controller.handleDoubleClick(event());
  test.controller.handleClick(event());
  await waitForClick();
  assert.deepEqual(test.actions, [], "body gestures must not restart a manually selected interactive state");
  assert.deepEqual(test.interactions, ["doubleClick", "click"], "single and double clicks must use distinct contextual gestures without duplicating a double click");
  assert.equal(test.controller.clickCycleIndex, 0);
  test.controller.handleClick(event());
  test.controller.handleAuxClick({ ...event(), button: 1 });
  await waitForClick();
  assert.deepEqual(test.interactions, ["doubleClick", "click", "previous"], "middle clicking selects the previous group and cancels a pending left click");
  test.controller.handleAuxClick({ ...event(), button: 2 });
  assert.equal(test.interactions.length, 3, "right click must not navigate actions");
}
const character = makeController({ type: "spine", category: "character", gestures: { click: "touch", doubleClick: "cutIn" }, actions });
character.controller.handleClick(event());
await waitForClick();
assert.deepEqual(character.actions, ["touch"], "ordinary pets keep their click action");
character.controller.handleClick(event());
character.controller.handleDoubleClick(event());
await waitForClick();
assert.deepEqual(character.actions, ["touch", "cutIn"], "double clicking must cancel the pending ordinary click");
character.controller.handleAuxClick({ ...event(), button: 1 });
assert.deepEqual(character.interactions, [], "ordinary character middle clicks keep their existing behavior");
const sequence = makeController({ type: "image-sequence", category: "interaction", gestures, actions });
sequence.controller.handleClick(event());
await waitForClick();
sequence.controller.handleDoubleClick(event());
assert.deepEqual(sequence.actions, ["next", "autoplay"]);
console.log("Interactive scene gesture checks passed");

for (const nativeWayland of [false, true]) {
  const moves = [], windowCalls = [], zooms = [], captures = new Set();
  let visible = false;
  const controller = new PetInteractionController({
    desktopPet: { nativeWayland, setMousePassthrough() {}, dragStart: p => windowCalls.push(["start", p]), dragMove: p => windowCalls.push(["move", p]), dragEnd: () => windowCalls.push(["end"]) },
    element: { clientHeight: 600, setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) },
    geometryInput: { isOpaquePoint: () => true }, getScene: () => ({ gestures: { dragThreshold: 5 } }),
    getStateLocked: () => true,
    getToolsVisible: () => visible, setToolsVisible: value => { visible = value; },
    panView: (x, y) => moves.push([x, y]), zoomView: (...args) => zooms.push(args)
  });
  const pointer = (type, button, x, y) => ({ ...event(), type, button, pointerId: 1, clientX: x, clientY: y, screenX: x + 100, screenY: y + 200 });
  controller.beginDrag(pointer("pointerdown", 2, 10, 10));
  controller.moveDrag(pointer("pointermove", 2, 12, 11));
  assert.deepEqual(moves, [], "right click jitter must not move the camera");
  controller.endDrag(pointer("pointerup", 2, 12, 11));
  assert.equal(visible, true, "right click must toggle the toolbar once");
  controller.beginDrag(pointer("pointerdown", 2, 10, 10));
  controller.moveDrag(pointer("pointermove", 2, 30, 40));
  controller.moveDrag(pointer("pointermove", 2, 25, 42));
  controller.endDrag(pointer("pointerup", 2, 25, 42));
  assert.deepEqual(moves, [[20, 30], [-5, 2]], "camera panning must use incremental window coordinates");
  assert.equal(visible, true, "right dragging must not toggle the toolbar");
  assert.equal(captures.size, 0, "right dragging must release capture on both backends");
  controller.handleWheel({ ...event(), deltaY: -120, deltaMode: 0 });
  assert.ok(zooms[0][0] > 1);
  controller.handleWheel({ ...event(), deltaY: 120, deltaMode: 0 });
  assert.ok(zooms[1][0] < 1);
  assert.deepEqual(windowCalls, [], "right drag and wheel must never request native dragging or resizing");
  controller.beginDrag(pointer("pointerdown", 2, 10, 10));
  controller.endDrag(pointer("pointercancel", 2, 10, 10));
  assert.equal(visible, true, "cancelled pan must not toggle tools");
  controller.beginDrag(pointer("pointerdown", 0, 10, 10));
  controller.moveDrag(pointer("pointermove", 0, 30, 40));
  controller.endDrag(pointer("pointerup", 0, 30, 40));
  assert.equal(windowCalls[0][0], "start", "left dragging must still move the native window");
  assert.equal(windowCalls.length, nativeWayland ? 1 : 3);
}
console.log("Camera gestures and native drag separation checks passed");

for (const type of ["spine", "image-sequence"]) {
  let locked = false;
  const test = makeController({ type, category: "interaction", gestures, actions });
  test.controller.getStateLocked = () => locked;
  test.controller.handleClick(event());
  locked = true;
  await waitForClick();
  assert.deepEqual(test.actions, [], "locking must cancel even a previously scheduled body click");
  assert.deepEqual(test.interactions, []);
  test.controller.handleClick(event());
  test.controller.handleDoubleClick(event());
  test.controller.handleAuxClick({ ...event(), button: 1 });
  await waitForClick();
  assert.deepEqual(test.actions, [], "locking must suppress image frame clicks and autoplay gestures");
  assert.deepEqual(test.interactions, [], "locking must suppress single, double and middle action navigation");
  let zoomed = false;
  test.controller.zoomView = () => { zoomed = true; };
  test.controller.element = { clientHeight: 600 };
  test.controller.handleWheel({ ...event(), deltaY: -120, deltaMode: 0 });
  assert.equal(zoomed, true, "locking an action must leave camera zoom available");
  locked = false;
  test.controller.handleClick(event());
  await waitForClick();
  assert.deepEqual(type === "spine" ? test.interactions : test.actions, [type === "spine" ? "click" : "next"], "unlocking must restore body navigation");
}
console.log("State lock and pending click checks passed");
