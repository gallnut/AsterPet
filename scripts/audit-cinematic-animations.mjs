import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as spine from '@esotericsoftware/spine-core';
const { inferCinematicPlan, CinematicPlayer, cinematicCutTimes } = createRequire(import.meta.url)('../src/renderer/pet/cinematic-player.js');
const root = process.argv[2];
if (!root) throw new Error('Usage: node scripts/audit-cinematic-animations.mjs <content-directory>');
const results = [];
for (const file of fs.readdirSync(root, { recursive: true }).filter(file => file.endsWith('/scene.json'))) {
  const scene = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  if (scene.type !== 'spine') continue;
  const packageRoot = path.join(root, file.split(path.sep)[0]);
  let atlas;
  try {
    atlas = new spine.TextureAtlas(fs.readFileSync(path.join(packageRoot, scene.assets.atlas), 'utf8'));
    for (const page of atlas.pages) page.setTexture(new spine.FakeTexture({ width: page.width, height: page.height }));
    const loader = new spine.AtlasAttachmentLoader(atlas);
    const input = fs.readFileSync(path.join(packageRoot, scene.assets.skeleton));
    const data = scene.assets.skeleton.endsWith('.json') ? new spine.SkeletonJson(loader).readSkeletonData(JSON.parse(input))
      : new spine.SkeletonBinary(loader).readSkeletonData(input);
    if (scene.category !== 'cg' && (!data.animations.some(a => /^(?:loop|idle|.*_idle)(?:$|[_\d])/i.test(a.name.split('/').at(-1)))
      || !data.animations.some(a => /^(?:cut(?:_|$)|[a-z\d]+_cut|all(?:_?\d+)?(?:_cut)?$)/i.test(a.name.split('/').at(-1))))) continue;
    const plan = inferCinematicPlan(data, spine, scene.actions?.idle?.animation);
    if (!plan) { results.push({ id: scene.id, supported: false }); continue; }
    const skeleton = new spine.Skeleton(data);
    const player = { skeleton, animationState: new spine.AnimationState(new spine.AnimationStateData(data)), play() {} };
    let played = [];
    const runtime = new CinematicPlayer({ getPlayer: () => player, spineRuntime: spine, plan,
      onAnimation: name => played.push(name), onSelection() {}, onState() {}, log() {} });
    let verified = 0, linked = 0;
    for (const name of plan.cuts) {
      runtime.play(name);
      player.animationState.update(data.findAnimation(name).duration + .001);
      player.animationState.apply(skeleton);
      player.animationState.update(.05); player.animationState.apply(skeleton);
      const tail = player.animationState.getCurrent(0);
      if (!tail?.loop || tail.animation.name !== name || tail.timeScale !== 1) throw new Error(`Invalid terminal loop: ${name}`);
      if (tail.animationEnd !== data.findAnimation(name).duration) throw new Error(`Terminal loop left the cut's endpoint: ${name}`);
      if (tail.animationStart < runtime.cameraTimes(name).at(-1)) throw new Error(`Terminal loop crossed a camera cut: ${name}`);
      const fps = data.fps > 0 ? data.fps : 30;
      if (tail.animationEnd - tail.animationStart > 4 / fps + .000001) throw new Error(`Terminal idle exceeds 4 authored frames: ${name}`);
      if (player.animationState.getCurrent(1)) throw new Error(`A different idle replaced the terminal cut: ${name}`);
      for (let frame = 0; frame < 20; frame++) {
        player.animationState.update(1 / fps); player.animationState.apply(skeleton);
        const time = tail.getAnimationTime();
        if (time < tail.animationStart || time > tail.animationEnd) throw new Error(`Tail playback escaped its interval: ${name}`);
      }
      verified++;
    }
    played = []; runtime.play('@cinematic');
    const expected = plan.full.length ? [plan.full[0]] : plan.shots;
    for (const name of expected) { player.animationState.update(data.findAnimation(name).duration + .001); player.animationState.apply(skeleton); }
    const actual = played.filter(name => !plan.loops.includes(name));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Incorrect full sequence: ${actual.join(',')}`);
    for (const name of plan.shots) {
      runtime.play(runtime.shotId(name));
      player.animationState.update(data.findAnimation(name).duration + .001); player.animationState.apply(skeleton);
      player.animationState.update(.02); player.animationState.apply(skeleton);
      const ending = plan.endings.get(name);
      if (ending) {
        const loop = player.animationState.getCurrent(1), base = player.animationState.getCurrent(0);
        if (loop?.animation.name !== ending.loop || !loop.loop || base?.timeScale !== 0) throw new Error(`Companion not joined: ${name} → ${ending.loop}`);
        if (runtime.viewportAnimation !== name || runtime.selection !== runtime.shotId(name)) throw new Error(`Linked shot changed camera or selection: ${name}`);
        linked++;
      }
    }
    runtime.stop(); skeleton.dispose?.();
    results.push({ id: scene.id, category: scene.category, supported: true, shots: plan.shots, full: plan.full, endings: [...plan.endings], verified, linked,
      unpaired: plan.cuts.filter(name => !plan.endings.has(name)), cameraCuts: data.animations.flatMap(animation => {
        const times = cinematicCutTimes(data, animation);
        return times.length > 1 ? [{ animation: animation.name, times }] : [];
      }) });
  } catch (error) { results.push({ id: scene.id, error: error.stack }); }
  finally { atlas?.dispose(); }
}
const summary = { scenes: results.length, supported: results.filter(r => r.supported).length, errors: results.filter(r => r.error).length,
  verifiedClips: results.reduce((sum, r) => sum + (r.verified || 0), 0),
  linkedShots: results.reduce((sum, r) => sum + (r.linked || 0), 0),
  supportedOutsideCg: results.filter(r => r.supported && r.category !== 'cg').length,
  companionPairs: results.reduce((sum, r) => sum + (r.endings?.length || 0), 0),
  authoredFullScenes: results.filter(r => r.full?.length).length,
  cameraCutScenes: results.filter(r => r.cameraCuts?.length).length };
console.log(JSON.stringify({ summary, results }, null, 2));
if (summary.errors) process.exitCode = 1;
