// Main-process capture cadence. Only one capture may be in flight.
// `started` (in `now()` units) may lie in the past: the first capture then
// fills every slot since then with copies of one frame.
function createLiveCaptureClock({ fps, capture, now = () => performance.now(), started = now() }) {
  let frames = 0, timer, running = true, active = Promise.resolve(), error = null;
  async function tick() {
    if (!running) return;
    const last = Math.min(frames + 119, Math.max(frames, Math.floor((now() - started) * fps / 1000)));
    try {
      await capture(frames, last);
      frames = last + 1;
    } catch (err) { error = err instanceof Error ? err.message : String(err); running = false; }
    if (running) timer = setTimeout(() => { active = tick(); }, Math.max(0, started + frames * 1000 / fps - now()));
  }
  timer = setTimeout(() => { active = tick(); }, 0);
  return {
    status: () => ({ frames, error, running }),
    async stop() { running = false; clearTimeout(timer); await active; return { frames, error }; },
    cancel() { running = false; clearTimeout(timer); },
  };
}
module.exports = { createLiveCaptureClock };
