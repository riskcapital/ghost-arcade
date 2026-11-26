'use strict';

// Which sender drives each WLED controller: the render core
// (native-renderer/src/pixelmap_out/wled.rs, sampling its own program
// picture and sending from its own thread) or this process (wled-link.cjs,
// fed frames by the editor).
//
// The editor offers the core the controllers it can drive alone with
// `configure(plan)` and stops sending those itself once the core has them.
// Controllers move one by one: one the editor sends a frame for again (an
// LED FX now reaches it, the Timeline took it) is taken back from the core
// before that frame goes out. Neither side sends black on a move; WLED
// holds the last frame for two seconds, far longer than a move takes.
//
// Link states move with the controller in both directions, and every
// change is reported once, from whichever side saw it (`onChange`, the
// install health log). Anything that goes wrong on the core side (old core,
// GA_CORE_WLED=0, a core that stops answering) leaves or puts the output
// back on this process.

function createWledRoute({
  links,
  invokeCore,
  coreSupported,
  env = process.env,
  log = console,
  onChange = null,
  now = () => Date.now(),
  pollMs = 250,
  setTimer = setInterval,
  clearTimer = clearInterval,
} = {}) {
  if (!links || typeof invokeCore !== 'function') throw new Error('createWledRoute needs links and invokeCore');
  let plan = null;
  const coreIds = new Set();
  // Last link states from the core, by controller.
  let coreLinks = new Map();
  let coreState = null;
  let coreLost = false;
  // The last state reported for each controller, from either side.
  const known = new Map();
  let poll = null;
  let polling = false;
  let chain = Promise.resolve();

  function serial(task) {
    const run = chain.then(task, task);
    chain = run.catch(() => {});
    return run;
  }

  function disabledReason() {
    if (env.GA_CORE_WLED === '0') return 'disabled by GA_CORE_WLED=0';
    if (typeof coreSupported === 'function' && !coreSupported()) return 'render core has no WLED output';
    return null;
  }

  /** Report a state change once, with the state it changed from. */
  function report(info) {
    const id = info.controllerId;
    const before = known.get(id);
    if (before && before.state === info.state) return;
    // A fresh link knows nothing yet; what was last reported still stands.
    if (before && info.state === 'unknown') return;
    known.set(id, { state: info.state, downSince: info.downSince || 0 });
    if (typeof onChange !== 'function' || info.state === 'unknown') return;
    const previous = before?.state ?? info.previous ?? 'unknown';
    const downSince = before?.downSince || 0;
    try {
      onChange({
        ...info,
        error: info.error ?? info.lastError ?? null,
        previous,
        downForMs: info.state === 'up' && previous === 'down' && downSince ? Math.max(0, now() - downSince) : info.downForMs ?? 0,
      });
    } catch { /* a listener failing must not stop the LEDs */ }
  }

  /** wled-link.cjs's own changes, for controllers this process sends. */
  function linkChange(info) {
    if (coreIds.has(info.controllerId)) return;
    report(info);
  }

  function rememberCoreLinks(list) {
    if (!Array.isArray(list)) return;
    for (const link of list) {
      if (!link || typeof link.controllerId !== 'string') continue;
      coreLinks.set(link.controllerId, link);
      if (coreIds.has(link.controllerId)) report(link);
    }
  }

  /** Controllers the core gave up go on from here with its link state. */
  function seedFromCore(list) {
    if (!Array.isArray(list)) return;
    for (const link of list) {
      if (!link || typeof link.controllerId !== 'string' || typeof link.ip !== 'string') continue;
      coreIds.delete(link.controllerId);
      coreLinks.delete(link.controllerId);
      try { links.seed(link); } catch { /* a bad address: the next frame reports it */ }
    }
  }

  function startPoll() {
    if (poll) return;
    poll = setTimer(() => { void pollCore(); }, pollMs);
    poll?.unref?.();
  }

  function stopPoll() {
    if (poll) clearTimer(poll);
    poll = null;
  }

  function dropCore(reason) {
    if (coreIds.size && reason) log.warn?.(`[WLED] render core output ${reason}; sending from the app`);
    coreIds.clear();
    coreLinks = new Map();
    coreState = null;
    plan = null;
    stopPoll();
  }

  async function takeAllBack() {
    if (!plan && coreIds.size === 0) return;
    const result = await invokeCore('wled_stop', {}).catch(() => null);
    seedFromCore(result?.links);
    dropCore(null);
  }

  function pollCore() {
    if (polling || !plan) return Promise.resolve();
    polling = true;
    return serial(async () => {
      if (!plan) return;
      const state = await invokeCore('wled_state', { pixels: true }).catch(() => null);
      if (!plan) return;
      if (!state) {
        coreLost = true;
        dropCore('stopped answering');
        return;
      }
      if (state.configured === false) {
        // A restarted core: give it the plan again, with the last link states.
        const again = await invokeCore('wled_configure', { plan, links: Array.from(coreLinks.values()) }).catch(() => null);
        if (again?.configured !== true) {
          coreLost = true;
          dropCore('was lost');
          return;
        }
        rememberCoreLinks(again.links);
        return;
      }
      coreState = state;
      rememberCoreLinks(state.controllers);
    }).finally(() => { polling = false; });
  }

  function configure(next) {
    return serial(async () => {
      const reason = disabledReason();
      if (reason) {
        await takeAllBack();
        return { ok: false, reason };
      }
      if (!next || typeof next !== 'object' || !Array.isArray(next.controllers)) return { ok: false, reason: 'bad plan' };
      // A fixed send rate for benchmarks (scripts/wled-jitter-bench.mjs).
      const fps = Number(env.GA_CORE_WLED_FPS);
      if (Number.isFinite(fps) && fps > 0) next = { ...next, fps: Math.min(60, Math.max(1, Math.round(fps))) };
      const ids = new Set(next.controllers.map((c) => String(c?.id)));
      // The app's link state for every controller the core takes on.
      const seeds = links.list().filter((l) => ids.has(l.controllerId) && !coreIds.has(l.controllerId));
      let result = null;
      let error = null;
      try {
        result = await invokeCore('wled_configure', { plan: next, links: seeds });
      } catch (err) {
        error = err;
      }
      if (!result || result.configured !== true) {
        const message = error?.message ?? result?.error ?? 'core did not take the plan';
        await takeAllBack();
        log.warn?.('[WLED] render core output unavailable, sending from the app:', message);
        return { ok: false, reason: message };
      }
      coreLost = false;
      seedFromCore(result.released);
      for (const id of ids) {
        coreIds.add(id);
        // The core sends now: this process's socket for it goes.
        links.close(id);
      }
      plan = next;
      rememberCoreLinks(result.links);
      startPoll();
      return { ok: true };
    });
  }

  /** Take one controller back from the core (the editor sends it again). */
  async function release(controllerId) {
    if (!coreIds.has(controllerId) || !plan) return;
    const rest = plan.controllers.filter((c) => String(c?.id) !== controllerId);
    if (rest.length === 0) {
      await takeAllBack();
      return;
    }
    const nextPlan = { ...plan, controllers: rest };
    const result = await invokeCore('wled_configure', { plan: nextPlan }).catch(() => null);
    if (result?.configured !== true) {
      await takeAllBack();
      return;
    }
    plan = nextPlan;
    seedFromCore(result.released);
    rememberCoreLinks(result.links);
  }

  /** A frame from the editor (wled_send_frame). */
  async function send(frame) {
    const id = String(frame.controllerId);
    if (coreIds.has(id)) await serial(() => release(id));
    return links.send({ ...frame, controllerId: id });
  }

  function close(controllerId) {
    const id = String(controllerId);
    links.close(id);
    if (!coreIds.has(id)) known.delete(id);
  }

  function stop() {
    return serial(async () => {
      await takeAllBack();
      return { ok: true };
    });
  }

  /** For the editor's poll: whether the core sends, and what it sent. */
  function stats() {
    if (!plan) {
      const lost = coreLost;
      coreLost = false;
      return { core: false, coreLost: lost };
    }
    return {
      core: true,
      controllers: coreState?.controllers ?? [],
      fps: coreState?.fps,
      packetsSent: coreState?.packetsSent,
      packetsSkipped: coreState?.packetsSkipped,
      sendErrors: coreState?.sendErrors,
      lateTicks: coreState?.lateTicks,
      maxLateUs: coreState?.maxLateUs,
      pictures: coreState?.pictures,
      pictureWidth: coreState?.picture_width,
      pictureHeight: coreState?.picture_height,
    };
  }

  /** Every controller's link, from whichever side sends it (install status). */
  function list() {
    const own = links.list().filter((l) => !coreIds.has(l.controllerId));
    const fromCore = Array.from(coreIds).map((id) => coreLinks.get(id)).filter(Boolean).map((l) => ({
      controllerId: l.controllerId,
      name: l.name,
      ip: l.ip,
      port: l.port,
      state: l.state,
      downSince: l.downSince || null,
      lastOkAt: l.lastOkAt || null,
      lastError: l.lastError ?? null,
      errors: l.errors ?? 0,
      sent: l.sent ?? 0,
      core: true,
    }));
    return [...own, ...fromCore];
  }

  function dispose() {
    stopPoll();
  }

  return { configure, send, close, stop, stats, list, linkChange, dispose, coreIds: () => new Set(coreIds), pollNow: pollCore };
}

module.exports = { createWledRoute };
