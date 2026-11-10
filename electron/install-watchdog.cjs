'use strict';

/**
 * Install mode: what the watchdog does about a fault, and how often.
 *
 * Faults:
 *   renderer-crash  the editor's page process died
 *   renderer-hang   the editor stopped sending its heartbeat
 *   core-stall      the render core is running but its frame count stopped
 *                   (or it stopped answering)
 *   core-dead       the render core has been gone for a while and the editor
 *                   did not bring it back
 *
 * Actions, from the smallest that can fix it:
 *   kill-core        end the core process; the editor starts a new one and
 *                    sends its scene again (the show keeps its place)
 *   reload-renderer  reload the editor page; install mode reopens the
 *                    project and resumes the show
 *   relaunch-app     quit and start the whole app again
 *   wait             a restart happened moments ago: give it time to work
 *   cooldown         too many restarts recently: hold off until `retryAt`
 *
 * Each action has its own budget within a sliding window. When a smaller
 * action has used its budget the fault escalates to the next. When even
 * relaunches are used up the watchdog waits for the oldest to age out of
 * the window rather than giving up: an installation that runs for weeks
 * must try again later, but must not restart in a tight loop.
 *
 * The history is plain data so it can be saved: relaunch counts have to
 * survive the relaunch.
 */

const DEFAULT_LIMITS = Object.freeze({
  coreKills: 5,
  coreKillWindowMs: 10 * 60_000,
  reloads: 3,
  reloadWindowMs: 10 * 60_000,
  relaunches: 3,
  relaunchWindowMs: 60 * 60_000,
  /** After any action, faults are ignored this long while it takes effect. */
  graceMs: 45_000,
});

const FAULTS = ['renderer-crash', 'renderer-hang', 'core-stall', 'core-dead'];

function emptyHistory() {
  return { coreKills: [], reloads: [], relaunches: [], lastActionAt: null };
}

function normalizeHistory(raw) {
  const h = emptyHistory();
  if (!raw || typeof raw !== 'object') return h;
  const times = (v) => (Array.isArray(v) ? v.filter((t) => Number.isFinite(t)).map(Number).slice(-50) : []);
  h.coreKills = times(raw.coreKills);
  h.reloads = times(raw.reloads);
  h.relaunches = times(raw.relaunches);
  h.lastActionAt = Number.isFinite(raw.lastActionAt) ? Number(raw.lastActionAt) : null;
  return h;
}

function within(list, now, windowMs) {
  return list.filter((t) => t <= now && now - t < windowMs);
}

/**
 * Decide what to do about `fault` at `now`. Pure: returns the decision and
 * the history to keep if the caller carries it out.
 *
 * A renderer crash skips the grace period: the page is gone and waiting
 * cannot bring it back (a crash right after a reload still counts against
 * the reload budget, so a crash loop escalates).
 */
function decide(fault, history, now, limits = DEFAULT_LIMITS) {
  const L = { ...DEFAULT_LIMITS, ...(limits || {}) };
  const h = normalizeHistory(history);
  if (!FAULTS.includes(fault)) return { action: 'ignore', reason: `unknown fault ${fault}`, history: h };
  if (fault !== 'renderer-crash' && h.lastActionAt !== null && now - h.lastActionAt < L.graceMs) {
    return { action: 'wait', reason: 'a restart is still taking effect', retryAt: h.lastActionAt + L.graceMs, history: h };
  }
  const kills = within(h.coreKills, now, L.coreKillWindowMs);
  const reloads = within(h.reloads, now, L.reloadWindowMs);
  const relaunches = within(h.relaunches, now, L.relaunchWindowMs);
  const take = (action, reason) => {
    const next = {
      coreKills: action === 'kill-core' ? [...kills, now] : kills,
      reloads: action === 'reload-renderer' ? [...reloads, now] : reloads,
      relaunches: action === 'relaunch-app' ? [...relaunches, now] : relaunches,
      lastActionAt: now,
    };
    return { action, reason, history: next };
  };
  if (fault === 'core-stall' && kills.length < L.coreKills) {
    return take('kill-core', `render core stalled (restart ${kills.length + 1} of ${L.coreKills} in ${Math.round(L.coreKillWindowMs / 60_000)} min)`);
  }
  if (reloads.length < L.reloads) {
    return take('reload-renderer', `${fault} (reload ${reloads.length + 1} of ${L.reloads} in ${Math.round(L.reloadWindowMs / 60_000)} min)`);
  }
  if (relaunches.length < L.relaunches) {
    return take('relaunch-app', `${fault}, reloads used up (relaunch ${relaunches.length + 1} of ${L.relaunches} in ${Math.round(L.relaunchWindowMs / 60_000)} min)`);
  }
  const oldest = Math.min(...relaunches);
  return {
    action: 'cooldown',
    reason: `${fault}: ${relaunches.length} relaunches in the last ${Math.round(L.relaunchWindowMs / 60_000)} min, waiting before the next`,
    retryAt: oldest + L.relaunchWindowMs,
    history: { coreKills: kills, reloads, relaunches, lastActionAt: h.lastActionAt },
  };
}

/**
 * Frame-stall detector for the render core: fed a sample every few
 * seconds, says when the core has gone `stallMs` without a new frame, or
 * failed `maxMisses` status calls in a row while its process is alive.
 */
function createFrameStallDetector({ stallMs = 20_000, maxMisses = 3 } = {}) {
  let lastCount = null;
  let lastChangeAt = 0;
  let misses = 0;
  let instance = null;
  return {
    /** sample: { running, instance, frames, ok } (frames = a counter that rises every frame). */
    sample(s, now) {
      if (!s || !s.running) {
        lastCount = null;
        misses = 0;
        return { stalled: false, reason: null };
      }
      if (s.instance !== instance) {
        instance = s.instance;
        lastCount = null;
        misses = 0;
      }
      if (!s.ok) {
        misses += 1;
        if (misses >= maxMisses) return { stalled: true, reason: `the render core did not answer ${misses} status calls in a row` };
        return { stalled: false, reason: null };
      }
      misses = 0;
      const frames = Number(s.frames);
      if (!Number.isFinite(frames)) return { stalled: false, reason: null };
      if (lastCount === null || frames !== lastCount) {
        lastCount = frames;
        lastChangeAt = now;
        return { stalled: false, reason: null };
      }
      if (now - lastChangeAt >= stallMs) {
        return { stalled: true, reason: `no new frame from the render core for ${Math.round((now - lastChangeAt) / 1000)} s` };
      }
      return { stalled: false, reason: null };
    },
    reset() {
      lastCount = null;
      misses = 0;
      instance = null;
    },
    get lastFrameAt() {
      return lastChangeAt;
    },
  };
}

module.exports = { decide, normalizeHistory, emptyHistory, createFrameStallDetector, DEFAULT_LIMITS, FAULTS };
