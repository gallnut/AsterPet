import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const context = { window: { AsterPet: {}, devicePixelRatio: 1 }, document: { getElementById: () => ({ clientWidth: 400, clientHeight: 600 }) } };
vm.runInNewContext(fs.readFileSync(new URL("../src/renderer/pet/spine-player-host.js", import.meta.url), "utf8"), context);
const Host = context.window.AsterPet.SpinePlayerHost;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
for (const stableSurface of [false, true]) {
  const host = new Host({ parentId: "player", stableSurface, initialSurfaceWidth: 400, initialSurfaceHeight: 600 });
  let originalResizes = 0;
  const viewport = { x: 10, y: 20, width: 200, height: 300, padLeft: 10, padRight: 10, padTop: 10, padBottom: 10 };
  const player = {
    currentViewport: { ...viewport }, canvas: { clientWidth: 400, clientHeight: 600 }, dom: { style: {} },
    sceneRenderer: { resize: () => originalResizes++, camera: { setViewport() {} } },
    context: { gl: { viewport() {} } },
    setViewport: () => { player.currentViewport = { ...viewport }; }
  };
  host.player = player;
  host.configureStableSurface(player);
  const initial = { ...player.currentViewport };
  host.setView({ zoom: 2, panX: 0.1, panY: 0.2 });
  const transformed = { ...player.currentViewport };
  close(transformed.width, initial.width / 2);
  close(transformed.height, initial.height / 2);
  close(transformed.x + transformed.width / 2, initial.x + initial.width / 2 - transformed.width * 0.1);
  close(transformed.y + transformed.height / 2, initial.y + initial.height / 2 + transformed.height * 0.2);
  player.setViewport("next-action");
  assert.deepEqual({ ...player.currentViewport }, transformed, "changing actions must preserve the user camera");
  player.sceneRenderer.resize();
  assert.equal(originalResizes, stableSurface ? 0 : 1);
  assert.deepEqual({ ...player.currentViewport }, transformed, "rendering must not accumulate camera transforms");
  if (stableSurface) host.setContentRect(60, 0, 800, 1200);
  else { player.canvas.clientWidth = 800; player.canvas.clientHeight = 1200; player.sceneRenderer.resize(); }
  close(player.currentViewport.width, transformed.width);
  close(player.currentViewport.height, transformed.height);
  host.setView({ zoom: 1, panX: 0, panY: 0 });
  close(player.currentViewport.width, initial.width);
  close(player.currentViewport.x, initial.x);
  assert.deepEqual(viewport, { x: 10, y: 20, width: 200, height: 300, padLeft: 10, padRight: 10, padTop: 10, padBottom: 10 }, "camera controls must not alter resource viewports");
  close(host.setView({ zoom: 100 }).zoom, 10);
  close(host.setView({ zoom: -1 }).zoom, 0.1);
  close(host.setView({ zoom: "invalid", panX: NaN }).zoom, 1);
}
console.log("Camera transform checks passed on regular and stable Wayland surfaces");

vm.runInNewContext(fs.readFileSync(new URL("../src/renderer/pet/geometry-input.js", import.meta.url), "utf8"), context);
const Geometry = context.window.AsterPet.GeometryInputController;
const geometry = Object.create(Geometry.prototype);
context.innerWidth = 900;context.innerHeight = 1018;
geometry.petPaneBounds = () => ({ left: 320, top: 0, right: 900, bottom: 896 });
const clipped = geometry.clipPetRects([
  { x: 190, y: 10, width: 300, height: 50 },
  { x: 150, y: 40, width: 100, height: 50 },
  { x: 500, y: 870, width: 500, height: 200 }
]);
assert.deepEqual(JSON.parse(JSON.stringify(clipped)), [
  { x: 320, y: 10, width: 170, height: 50 },
  { x: 500, y: 870, width: 400, height: 26 }
], "pet geometry must not intercept input in the reserved sidebar or toolbar area");
geometry.getScene = () => ({ type: "image-sequence" });
geometry.getSequenceImage = () => ({ getBoundingClientRect: () => ({ left: 100, right: 1100, top: -100, bottom: 1000 }) });
assert.equal(geometry.isOpaquePoint(200, 100), false, "zoomed image input must not extend into the sidebar");
assert.equal(geometry.isOpaquePoint(500, 900), false, "zoomed image input must not extend into the toolbar");
assert.equal(geometry.isOpaquePoint(500, 400), true);
console.log("Clipped pet pane input checks passed");
