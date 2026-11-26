'use strict';

// Which sender drives Art-Net / sACN pixel mapping: the render core
// (native-renderer/src/pixelmap_out, sampling and sending from its own
// thread) or this process (pixelmap-output.cjs, fed frames by the editor).
//
// The editor asks for the core with `configure(plan)` and keeps its own
// path running until the core has taken over. Moving between the two hands
// over the sequence numbers and the universes being sent, so a receiver
// sees neither a black frame nor a jump back in sequence. Anything that goes
// wrong on the core side (old core, GA_CORE_PIXELMAP=0, a core that stops
// answering) leaves or puts the output back on this process.

function createPixelMapRoute({ output, invokeCore, coreSupported, env = process.env, log = console } = {}) {
  if (!output || typeof invokeCore !== 'function') throw new Error('createPixelMapRoute needs output and invokeCore');
  let coreActive = false;
  let plan = null;
  let corePort = null;
  let chain = Promise.resolve();

  // One core transition at a time; the editor's frames wait behind one.
  function serial(task) {
    const run = chain.then(task, task);
    chain = run.catch(() => {});
    return run;
  }

  function disabledReason() {
    if (env.GA_CORE_PIXELMAP === '0') return 'disabled by GA_CORE_PIXELMAP=0';
    if (typeof coreSupported === 'function' && !coreSupported()) return 'render core has no pixel-map output';
    return null;
  }

  async function takeBackFromCore() {
    if (!coreActive) return;
    coreActive = false;
    corePort = null;
    const result = await invokeCore('pixelmap_stop', { handover: true }).catch(() => null);
    if (result?.handover) output.takeOver(result.handover, plan?.sacn);
  }

  function configure(next) {
    return serial(async () => {
      const reason = disabledReason();
      if (reason) {
        await takeBackFromCore();
        return { ok: false, reason };
      }
      if (!next || typeof next !== 'object' || !Array.isArray(next.fixtures)) return { ok: false, reason: 'bad plan' };
      const handover = coreActive ? null : output.handOver();
      let result = null;
      let error = null;
      try {
        result = await invokeCore('pixelmap_configure', { plan: next, handover });
      } catch (err) {
        error = err;
      }
      if (!result || result.configured !== true) {
        const message = error?.message ?? result?.error ?? 'core did not take the plan';
        if (handover) output.takeOver(handover, next.sacn);
        if (coreActive) await takeBackFromCore();
        log.warn?.('[PixelMap] render core output unavailable, sending from the app:', message);
        return { ok: false, reason: message };
      }
      coreActive = true;
      plan = next;
      corePort = Number.isInteger(result.local_port) ? result.local_port : corePort;
      return { ok: true };
    });
  }

  async function sendFrame(frame) {
    if (coreActive) await serial(takeBackFromCore);
    return output.sendFrame(frame);
  }

  function stop() {
    return serial(async () => {
      let terminated = 0;
      if (coreActive) {
        coreActive = false;
        corePort = null;
        const result = await invokeCore('pixelmap_stop', {}).catch(() => null);
        terminated += result?.terminated ?? 0;
      }
      const local = output.stop();
      return { ...local, terminated: terminated + (local.terminated ?? 0) };
    });
  }

  async function stats(args = {}) {
    if (!coreActive) return { ...output.stats(), core: false };
    const fixtureId = typeof args?.fixtureId === 'string' ? args.fixtureId : undefined;
    const state = await invokeCore('pixelmap_state', fixtureId ? { fixture_id: fixtureId } : {}).catch(() => null);
    if (!coreActive) return { ...output.stats(), core: false };
    if (!state) {
      // The core stopped answering: the editor sends from here again.
      coreActive = false;
      corePort = null;
      return { ...output.stats(), core: false, coreLost: true };
    }
    if (state.configured === false && plan) {
      // A restarted core: give it the plan again.
      const again = await invokeCore('pixelmap_configure', { plan }).catch(() => null);
      if (again?.configured !== true) {
        coreActive = false;
        return { ...output.stats(), core: false, coreLost: true };
      }
    }
    if (Number.isInteger(state.local_port)) corePort = state.local_port;
    return {
      ...(state.stats ?? {}),
      core: true,
      lateTicks: state.late_ticks,
      maxLateUs: state.max_late_us,
      pictures: state.pictures,
      fixtureId: state.fixture_id,
      fixturePixels: Array.isArray(state.fixture_rgb) ? state.fixture_rgb : undefined,
    };
  }

  /** The port output leaves from, for DMX input's own-traffic filter. */
  function localPort() {
    return coreActive ? corePort : output.localPort();
  }

  return { configure, sendFrame, stop, stats, localPort, coreActive: () => coreActive };
}

module.exports = { createPixelMapRoute };
