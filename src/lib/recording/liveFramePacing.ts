/** Longest gap one late capture fills (seconds), so a long stall (window
 *  hidden, rAF paused) does not write minutes of a frozen frame at once. */
const MAX_FILL_SECONDS = 5;

/** How many encoder frame slots one live capture fills: 1, plus every slot
 *  the wall clock has passed since the last one was queued (capped). Keeps
 *  a recording real-time when the view renders slower than its frame rate. */
export function liveFrameRepeat(queuedFrames: number, elapsedMs: number, fps: number): number {
  const due = Math.floor((Math.max(0, elapsedMs) * fps) / 1000) + 1;
  return Math.max(1, Math.min(due - queuedFrames, Math.round(fps * MAX_FILL_SECONDS)));
}

/** Live stage capture: how many frames may be read back or queued for the
 *  encoder before renders are let pass (the held picture then fills their
 *  slots). The encoder can take ~0.4-0.7 s to take its first frame (a cold
 *  FFmpeg start), so up to a second of footage queues instead of freezing
 *  the file's opening, within 256 MB of pixels. */
export function streamFramesInFlight(width: number, height: number, fps: number): number {
  const byBytes = Math.floor(256e6 / Math.max(1, width * height * 4));
  return Math.max(3, Math.min(Math.ceil(Math.max(1, fps)), byBytes));
}

/** A frame slot claimed by a render: frames `first` .. `first + repeat - 1`. */
export interface LiveFrameSlot {
  first: number;
  repeat: number;
  /** When slot `first` is due (same clock as the render times). */
  dueAtMs: number;
}

export interface LiveFramePacer {
  /** The slot a render at `nowMs` would fill, or null when it is early.
   *  Does not claim it. */
  peek(nowMs: number): LiveFrameSlot | null;
  /** Claim the slot (as returned by `peek` at the same instant). */
  commit(slot: LiveFrameSlot): void;
  /** Render at `nowMs`: peek, and claim when one is due. */
  take(nowMs: number): LiveFrameSlot | null;
  /** Frames claimed so far. */
  readonly queued: number;
}

/**
 * Picks which renders of a live view become recording frames.
 *
 * Slot k is due at `startedAtMs + k / fps`. A render claims the next slot
 * when it is within half a render interval of its due time, so with the
 * view drawing at 60 Hz every second render is kept (the one nearest each
 * slot) and a 30 fps file gets a new picture in every frame. A render that
 * comes later than the next slot's window also fills the slots it missed
 * (the picture holds), which keeps the file in real time.
 *
 * Call `peek`/`take` once per render: the render interval is learned from
 * the calls.
 */
export function createLiveFramePacer(fps: number, startedAtMs: number): LiveFramePacer {
  const rate = Math.max(1, fps);
  const frameMs = 1000 / rate;
  let queued = 0;
  let lastCallAt: number | null = null;
  let lastCallSeen: number | null = null;
  let renderMs = 1000 / 60;

  const observe = (nowMs: number) => {
    if (lastCallSeen === nowMs) return;
    lastCallSeen = nowMs;
    if (lastCallAt !== null) {
      const dt = nowMs - lastCallAt;
      // Ignore stalls; follow rate changes within a few renders.
      if (dt > 0 && dt < 250) renderMs += (dt - renderMs) * 0.2;
    }
    lastCallAt = nowMs;
  };

  const peek = (nowMs: number): LiveFrameSlot | null => {
    observe(nowMs);
    const half = Math.min(renderMs, frameMs) / 2;
    const elapsed = nowMs - startedAtMs;
    if (elapsed < queued * frameMs - half) return null;
    return {
      first: queued,
      repeat: liveFrameRepeat(queued, elapsed + half, rate),
      dueAtMs: startedAtMs + queued * frameMs,
    };
  };

  const commit = (slot: LiveFrameSlot) => {
    if (slot.first !== queued) return;
    queued += slot.repeat;
  };

  return {
    peek,
    commit,
    take(nowMs) {
      const slot = peek(nowMs);
      if (slot) commit(slot);
      return slot;
    },
    get queued() {
      return queued;
    },
  };
}
