/**
 * The show transport's clock.
 *
 * With audio on the show, the sound card is the clock: the playhead is
 * derived from the AudioContext's time, which is what the song's samples are
 * actually played against. The audio no longer has to be nudged towards a
 * playhead counted from animation frames (which drifts from the sound card
 * and hiccups with every dropped frame); playhead and audio advance together.
 * Without audio, or while the audio engine is not running, animation-frame
 * time drives it as before.
 *
 * The clock is anchored: show time = anchor show time + clock time elapsed
 * since the anchor. Every discontinuity re-anchors: start, seek, scrub, a
 * loop wrap, or a change of clock source. Pure, so it can be tested with a
 * fake clock.
 */

export type ShowClockSource = 'audio' | 'frame';

export interface ShowClockSample {
  /** Animation-frame clock, seconds. Always present. */
  frame: number;
  /** Audio clock, seconds, or null when there is no running audio engine. */
  audio: number | null;
}

/** A backwards step larger than this is a clock jump, not jitter: re-anchor. */
const BACKWARD_JUMP_SECONDS = 0.25;

export class ShowTransportClock {
  private source: ShowClockSource | null = null;
  private anchorShow = 0;
  private anchorClock = 0;
  private lastElapsed = 0;

  /** The clock the playhead follows, or null before the first reading. */
  get activeSource(): ShowClockSource | null {
    return this.source;
  }

  /** Forget the anchor; the next `advance` anchors at the playhead it is given. */
  reset(): void {
    this.source = null;
    this.anchorShow = 0;
    this.anchorClock = 0;
    this.lastElapsed = 0;
  }

  /**
   * Show time for this clock sample. `showTimeNow` is the playhead as it
   * stands; it is where the clock anchors when it has no anchor or switches
   * source, so a switch never makes the playhead jump.
   */
  advance(sample: ShowClockSample, showTimeNow: number): number {
    const audioOk = sample.audio !== null && Number.isFinite(sample.audio);
    const source: ShowClockSource = audioOk ? 'audio' : 'frame';
    const clock = audioOk ? (sample.audio as number) : sample.frame;
    if (!Number.isFinite(clock)) return showTimeNow;
    if (this.source !== source) {
      this.anchor(showTimeNow, source, clock);
      return showTimeNow;
    }
    let elapsed = clock - this.anchorClock;
    if (elapsed < this.lastElapsed) {
      if (this.lastElapsed - elapsed > BACKWARD_JUMP_SECONDS) {
        // The clock itself jumped (an audio engine restarted): carry on from here.
        this.anchor(showTimeNow, source, clock);
        return showTimeNow;
      }
      // A reading a hair earlier than the last one: hold, never run backwards.
      elapsed = this.lastElapsed;
    }
    this.lastElapsed = elapsed;
    return this.anchorShow + elapsed;
  }

  /**
   * Move the playhead without touching the clock anchor: the loop wrap. The
   * show time the clock reports from here on is shifted by the same amount,
   * so no clock time is lost or counted twice across the wrap.
   */
  shift(seconds: number): void {
    if (this.source !== null && Number.isFinite(seconds)) this.anchorShow += seconds;
  }

  private anchor(showTime: number, source: ShowClockSource, clock: number): void {
    this.source = source;
    this.anchorShow = showTime;
    this.anchorClock = clock;
    this.lastElapsed = 0;
  }
}

/** The minimal AudioContext surface the audio clock reads. */
export interface AudioClockContext {
  readonly state: string;
  readonly currentTime: number;
  getOutputTimestamp?: () => { contextTime?: number; performanceTime?: number };
}

/**
 * Audio clock reading, seconds, smoothed between the sound card's buffer
 * callbacks: `currentTime` moves in whole buffers (several milliseconds), so
 * the last output timestamp is carried forward on the performance clock.
 * Null when the context is not running.
 */
export function readAudioClock(ctx: AudioClockContext | null | undefined, performanceNowMs: number): number | null {
  if (!ctx || ctx.state !== 'running') return null;
  try {
    const stamp = ctx.getOutputTimestamp?.();
    const contextTime = Number(stamp?.contextTime);
    const performanceTime = Number(stamp?.performanceTime);
    if (Number.isFinite(contextTime) && Number.isFinite(performanceTime) && contextTime > 0 && performanceTime > 0) {
      const since = Math.max(0, (performanceNowMs - performanceTime) / 1000);
      // Carry forward by at most a quarter second: a stale stamp means the
      // device stalled, and the playhead should stall with it.
      return contextTime + Math.min(since, 0.25);
    }
  } catch {
    /* fall back to currentTime */
  }
  const now = Number(ctx.currentTime);
  return Number.isFinite(now) ? now : null;
}
