import { describe, expect, it } from 'vitest';
import { createShowTicker, SHOW_TICKER_FRAME_GRACE_MS, SHOW_TICKER_TIMER_MS, type ShowTickerEnv } from './showTicker';

/** A hand-stepped page: frames and timers fire only when the test says so. */
function fakeEnv(opts: { hidden?: boolean; frames?: boolean; fallback?: boolean } = {}) {
  let now = 0;
  let nextId = 1;
  const frames = new Map<number, (t: number) => void>();
  const timers = new Map<number, { cb: () => void; at: number }>();
  const state = { hidden: !!opts.hidden, frames: opts.frames !== false };
  const env: ShowTickerEnv = {
    now: () => now,
    requestFrame: (cb) => {
      if (!state.frames) return null;
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    cancelFrame: (id) => { frames.delete(id); },
    setTimer: (cb, ms) => { const id = nextId++; timers.set(id, { cb, at: now + ms }); return id; },
    clearTimer: (id) => { timers.delete(id as number); },
    hidden: () => state.hidden,
    fallback: opts.fallback !== false,
  };
  return {
    env,
    state,
    frame() {
      const [first] = frames.entries();
      if (!first) return false;
      frames.delete(first[0]);
      first[1](now);
      return true;
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers.entries()]) {
        if (t.at <= now && timers.has(id)) { timers.delete(id); t.cb(); }
      }
    },
    timerDelays: () => [...timers.values()].map((t) => t.at - now),
  };
}

describe('show ticker', () => {
  it('ticks once per animation frame while the window is on screen', () => {
    const page = fakeEnv();
    const ticks: string[] = [];
    const ticker = createShowTicker(() => { ticks.push(ticker.lastSource ?? ''); ticker.request(); }, page.env);
    ticker.request();
    expect(page.timerDelays()).toEqual([SHOW_TICKER_FRAME_GRACE_MS]);
    page.advance(16);
    page.frame();
    page.advance(16);
    page.frame();
    expect(ticks).toEqual(['frame', 'frame']);
    // The standby timer was cancelled by each frame, never fired.
    page.advance(SHOW_TICKER_FRAME_GRACE_MS - 1);
    expect(ticks.length).toBe(2);
  });

  it('a hidden window ticks on a 60 Hz timer', () => {
    const page = fakeEnv({ hidden: true });
    let n = 0;
    const ticker = createShowTicker(() => { n++; ticker.request(); }, page.env);
    ticker.request();
    expect(page.timerDelays()).toEqual([SHOW_TICKER_TIMER_MS]);
    for (let i = 0; i < 60; i++) page.advance(SHOW_TICKER_TIMER_MS);
    expect(n).toBe(60);
    expect(ticker.lastSource).toBe('timer');
  });

  it('frames that stop coming are covered by the timer, at frame rate, until they return', () => {
    const page = fakeEnv();
    let n = 0;
    const ticker = createShowTicker(() => { n++; ticker.request(); }, page.env);
    ticker.request();
    page.advance(SHOW_TICKER_FRAME_GRACE_MS); // no frame came
    expect(n).toBe(1);
    expect(ticker.lastSource).toBe('timer');
    expect(page.timerDelays()).toEqual([SHOW_TICKER_TIMER_MS]);
    page.advance(SHOW_TICKER_TIMER_MS);
    expect(n).toBe(2);
    page.frame(); // frames are back
    expect(ticker.lastSource).toBe('frame');
    expect(page.timerDelays()).toEqual([SHOW_TICKER_FRAME_GRACE_MS]);
  });

  it('cancel stops both pumps', () => {
    const page = fakeEnv();
    let n = 0;
    const ticker = createShowTicker(() => { n++; }, page.env);
    ticker.request();
    ticker.cancel();
    expect(ticker.pending).toBe(false);
    page.advance(1000);
    expect(page.frame()).toBe(false);
    expect(n).toBe(0);
  });

  it('without a fallback (frames stepped by hand) only frames tick', () => {
    const page = fakeEnv({ fallback: false });
    let n = 0;
    const ticker = createShowTicker(() => { n++; }, page.env);
    ticker.request();
    expect(page.timerDelays()).toEqual([]);
    page.advance(1000);
    expect(n).toBe(0);
    page.frame();
    expect(n).toBe(1);
  });
});
