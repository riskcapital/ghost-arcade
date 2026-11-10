/**
 * The show transport's frame pump.
 *
 * Animation frames drive it while the editor window is on screen. They stop
 * when the window is minimised or hidden (the editor can be put away while
 * the show is rehearsed in the Stage Sim window), so a timer takes over:
 * at once when the page reports itself hidden, and otherwise whenever an
 * animation frame is overdue. Whichever fires first runs the tick and
 * cancels the other, so a visible window still ticks exactly once per frame.
 */

export interface ShowTickerEnv {
  now(): number;
  /** Ask for an animation frame; null when the page has none. */
  requestFrame(cb: (t: number) => void): number | null;
  cancelFrame(id: number): void;
  setTimer(cb: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
  hidden(): boolean;
  /** Whether a timer may stand in for animation frames (a real page; tests
   *  that step frames by hand turn it off). */
  fallback: boolean;
}

/** Timer period when no animation frames are coming (60 Hz). */
export const SHOW_TICKER_TIMER_MS = 16;
/** An animation frame later than this counts as stopped. */
export const SHOW_TICKER_FRAME_GRACE_MS = 50;

export interface ShowTicker {
  /** Run `tick` once, on the next frame (or timer when frames are not coming). */
  request(): void;
  cancel(): void;
  readonly pending: boolean;
  /** Which pump ran the most recent tick. */
  readonly lastSource: 'frame' | 'timer' | null;
}

function browserEnv(): ShowTickerEnv {
  return {
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    // Looked up per call: tests stub requestAnimationFrame after import.
    requestFrame: (cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : null),
    cancelFrame: (id) => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); },
    setTimer: (cb, ms) => setTimeout(cb, ms),
    clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    fallback: typeof document !== 'undefined',
  };
}

export function createShowTicker(tick: (now: number) => void, env: ShowTickerEnv = browserEnv()): ShowTicker {
  let frameId: number | null = null;
  let timerId: unknown = null;
  let lastSource: 'frame' | 'timer' | null = null;
  /** The timer had to stand in for a frame: keep it at frame rate until frames return. */
  let framesStalled = false;

  const clear = () => {
    if (frameId !== null) env.cancelFrame(frameId);
    frameId = null;
    if (timerId !== null) env.clearTimer(timerId);
    timerId = null;
  };

  const run = (source: 'frame' | 'timer', now: number) => {
    framesStalled = source === 'timer' && frameId !== null;
    if (source === 'frame') framesStalled = false;
    clear();
    lastSource = source;
    tick(now);
  };

  return {
    request() {
      if (frameId !== null || timerId !== null) return;
      const hidden = env.fallback && env.hidden();
      if (!hidden) frameId = env.requestFrame((t) => run('frame', t));
      if (frameId !== null && !env.fallback) return;
      timerId = env.setTimer(
        () => run('timer', env.now()),
        hidden || framesStalled || frameId === null ? SHOW_TICKER_TIMER_MS : SHOW_TICKER_FRAME_GRACE_MS,
      );
    },
    cancel: clear,
    get pending() {
      return frameId !== null || timerId !== null;
    },
    get lastSource() {
      return lastSource;
    },
  };
}
