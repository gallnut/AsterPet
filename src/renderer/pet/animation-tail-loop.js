(function registerAnimationTailLoop() {
  const activeTails = new WeakMap();

  function loopAnimationTail(player, entry, { frameCount = 4, minimumStart = 0, cycleSeconds = 2.4 } = {}) {
    if (!player || !entry) return;
    releaseAnimationTail(player);
    activeTails.set(player, {
      entry, animation: entry.animation, animationStart: entry.animationStart,
      animationEnd: entry.animationEnd, loop: entry.loop, timeScale: entry.timeScale,
      listener: entry.listener, getAnimationTime: Object.hasOwn(entry, "getAnimationTime") ? entry.getAnimationTime : undefined
    });
    const exportedFps = Number(player.skeleton?.data?.fps);
    const fps = Number.isFinite(exportedFps) && exportedFps > 0 ? exportedFps : 30;
    const end = entry.animationEnd;
    const start = Math.max(entry.animationStart, minimumStart, end - frameCount / fps);
    entry.animationStart = Math.min(start, end);
    entry.loop = true;
    entry.timeScale = 1;
    // This completion belongs to the one-shot performance. Tail repetitions
    // must not re-run state transitions, queue advancement or resource events.
    entry.listener = undefined;
    const source = entry.animation;
    const timelines = source.timelines.filter(timeline => !timeline.events).map(timeline => {
      // Discrete attachment/order changes cannot be eased by a playback clock.
      // Retain their authored endpoint while native continuous channels move.
      if (!timeline.attachmentNames && !timeline.drawOrders) return timeline;
      const index = Array.from(timeline.frames).findLastIndex(time => time <= end);
      if (index < 0 || !Array.from(timeline.frames).some(time => time > start && time <= end)) return timeline;
      const fixed = timeline.attachmentNames
        ? new timeline.constructor(1, timeline.slotIndex) : new timeline.constructor(1);
      fixed.setFrame(0, entry.animationStart, timeline.attachmentNames ? timeline.attachmentNames[index] : timeline.drawOrders[index]);
      return fixed;
    });
    if (timelines.length !== source.timelines.length || timelines.some((timeline, index) => timeline !== source.timelines[index])) {
      entry.animation = new source.constructor(source.name, timelines, source.duration);
    }
    const duration = end - entry.animationStart;
    // Change only the playback clock. Every sampled pose still comes directly
    // from the resource timelines. A slow, eased round trip avoids the hard
    // end-to-start jump that makes a tiny ordinary loop look like twitching.
    entry.getAnimationTime = () => end - duration * (1 - Math.cos(2 * Math.PI * entry.trackTime / cycleSeconds)) / 2;
    entry.trackTime = 0;
    entry.trackLast = entry.nextTrackLast = 0;
    entry.setAnimationLast(end);
  }

  function releaseAnimationTail(player) {
    const tail = player && activeTails.get(player);
    if (!tail) return;
    activeTails.delete(player);
    const { entry } = tail;
    Object.assign(entry, {
      animation: tail.animation, animationStart: tail.animationStart,
      animationEnd: tail.animationEnd, loop: tail.loop, timeScale: tail.timeScale,
      listener: tail.listener
    });
    if (tail.getAnimationTime) entry.getAnimationTime = tail.getAnimationTime;
    else delete entry.getAnimationTime;
    entry.trackTime = tail.animationEnd - tail.animationStart;
    entry.trackLast = entry.nextTrackLast = entry.trackTime;
    entry.setAnimationLast(tail.animationEnd);
  }

  const exports = { loopAnimationTail, releaseAnimationTail };
  if (typeof module !== "undefined" && module.exports) module.exports = exports;
  if (typeof window !== "undefined") Object.assign(window.AsterPet ||= {}, exports);
})();
