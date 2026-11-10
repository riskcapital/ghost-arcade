/**
 * Following a musical clock: MIDI clock with Song Position, and Ableton
 * Link. Both turn the source's beats into show time through the show's
 * tempo map, then feed the same chase clock timecode uses, so the sink,
 * cue chasing and `showTimeline.chase()` work unchanged.
 *
 * Positions here are quarter notes ("quarters"), as MIDI clock (24 ticks a
 * quarter) and Link count them.
 *
 * Pure: no stores, no MIDI or IPC. The timecode chase controller owns the
 * ports and the polling.
 */
import type { ShowTempoMap } from '../../types';
import { barBeatAt, beatAtSeconds, secondsAtBar, secondsAtBeat } from '../tempoMap';

// ─── Show time from source beats ─────────────────────────────────────────

/**
 * Quarter notes (from the show's bar 1) where the source's own bar 1 lands.
 * `barOffset` moves it: 0 puts the source's bar 1 on show bar 1, 4 on show
 * bar 5 (an intro the source does not play), -1 on show bar 0.
 */
export function sourceOriginQuarters(map: ShowTempoMap, barOffset: number): number {
  const bar = 1 + Math.round(Number.isFinite(barOffset) ? barOffset : 0);
  return beatAtSeconds(map, secondsAtBar(map, bar));
}

/** Show seconds for a source position in quarters since its song start. */
export function showSecondsForSourceQuarters(map: ShowTempoMap, quarters: number, barOffset: number): number {
  return secondsAtBeat(map, sourceOriginQuarters(map, barOffset) + quarters);
}

/** The show's tempo (quarter-note BPM) at show time `t`. */
export function showTempoAt(map: ShowTempoMap, t: number): number {
  return barBeatAt(map, t).bpm;
}

/** Quarter notes in one show bar at show time `t`. */
export function quartersPerBarAt(map: ShowTempoMap, t: number): number {
  const bar = barBeatAt(map, t).bar;
  return Math.max(1e-6, beatAtSeconds(map, secondsAtBar(map, bar + 1)) - beatAtSeconds(map, secondsAtBar(map, bar)));
}

/** True when the source runs at a noticeably different tempo from the map. */
export function tempoMismatch(showBpm: number | null, sourceBpm: number | null, tolerance = 0.5): boolean {
  if (!(showBpm && showBpm > 0) || !(sourceBpm && sourceBpm > 0)) return false;
  return Math.abs(showBpm - sourceBpm) > tolerance;
}

// ─── MIDI clock ──────────────────────────────────────────────────────────

/** Song Position Pointer counts "MIDI beats": sixteenth notes. */
export const SPP_PER_QUARTER = 4;
export const MIDI_CLOCK_PPQN = 24;

export type MidiClockEvent =
  /** The source is parked at `quarters` (Song Position while stopped, Stop). */
  | { kind: 'locate'; quarters: number; atMs: number }
  /** A tick: at `atMs` the source is at `quarters`, rolling. */
  | { kind: 'tick'; quarters: number; atMs: number };

/**
 * MIDI clock and Song Position to beat positions.
 *
 *   F2 lsb msb   Song Position (sixteenths): where Continue will start
 *   FA           Start: from the top (position 0)
 *   FB           Continue: from the last Song Position
 *   F8           clock, 24 a quarter note
 *   FC           Stop: park where the clock got to
 *
 * After Start or Continue the NEXT tick is the position itself, each tick
 * after it one 24th of a quarter on. Ticks while stopped (a free-running
 * clock) only measure the tempo.
 */
export class MidiClockParser {
  /** Where the last locate / start put the clock, quarters. */
  private base = 0;
  /** Ticks since then (an integer, so long runs do not drift). */
  private ticks = 0;
  private running = false;
  private armed = false;
  /** Recent ticks: the tempo is measured over up to eight beats. Web MIDI
   *  stamps a message when the page gets it, so a busy page sees ticks late
   *  and in bursts: never early. The tempo follows the earliest ticks. */
  private tickTimes: number[] = [];
  /** Tempo from the tick spacing, quarter-note BPM, or null. */
  bpm: number | null = null;

  get isRunning(): boolean {
    return this.running || this.armed;
  }

  private get position(): number {
    return this.base + this.ticks / MIDI_CLOCK_PPQN;
  }

  private locateTo(quarters: number): void {
    this.base = quarters;
    this.ticks = 0;
  }

  reset(): void {
    this.locateTo(0);
    this.running = false;
    this.armed = false;
    this.tickTimes = [];
    this.bpm = null;
  }

  /** One MIDI message (status byte first). Returns what it means for the show. */
  feed(data: ArrayLike<number>, atMs: number): MidiClockEvent | null {
    const status = data[0];
    switch (status) {
      case 0xf2: {
        if (data.length < 3) return null;
        const sixteenths = (data[1] & 0x7f) | ((data[2] & 0x7f) << 7);
        this.locateTo(sixteenths / SPP_PER_QUARTER);
        // Some sources send a Song Position while rolling (a loop jump):
        // the next tick is that position.
        if (this.running) {
          this.armed = true;
          this.running = false;
          return null;
        }
        return { kind: 'locate', quarters: this.position, atMs };
      }
      case 0xfa:
        this.locateTo(0);
        this.armed = true;
        this.running = false;
        return null;
      case 0xfb:
        this.locateTo(this.position);
        this.armed = true;
        this.running = false;
        return null;
      case 0xfc: {
        const wasRolling = this.running || this.armed;
        this.running = false;
        this.armed = false;
        return wasRolling ? { kind: 'locate', quarters: this.position, atMs } : null;
      }
      case 0xf8: {
        this.measure(atMs);
        if (this.armed) {
          this.armed = false;
          this.running = true;
          return { kind: 'tick', quarters: this.position, atMs };
        }
        if (!this.running) return null;
        this.ticks++;
        return { kind: 'tick', quarters: this.position, atMs };
      }
      default:
        return null;
    }
  }

  private measure(atMs: number): void {
    const last = this.tickTimes[this.tickTimes.length - 1];
    // A second without ticks (or time running backwards) starts over.
    if (last !== undefined && !(atMs >= last && atMs - last < 1000)) this.tickTimes = [];
    this.tickTimes.push(atMs);
    if (this.tickTimes.length > 8 * MIDI_CLOCK_PPQN + 1) this.tickTimes.shift();
    const bpm = clockTempo(this.tickTimes);
    if (bpm !== null) this.bpm = Math.round(bpm * 10) / 10;
  }

}

/**
 * Tempo (quarter-note BPM) from consecutive 24 PPQN tick arrival times that
 * may be late but never early: the slope between the earliest-relative tick
 * of each half of the window (a lower envelope), so bursts do not bend it.
 */
export function clockTempo(times: readonly number[]): number | null {
  const n = times.length;
  if (n < 13) return null;
  let period = (times[n - 1] - times[0]) / (n - 1);
  if (!(period > 0)) return null;
  const half = n >> 1;
  // Refined: each pass's slope picks the earliest ticks better.
  for (let pass = 0; pass < 3; pass++) {
    const guess = period;
    let a = 0, b = half;
    for (let i = 0; i < half; i++) if (times[i] - i * guess < times[a] - a * guess) a = i;
    for (let i = half; i < n; i++) if (times[i] - i * guess < times[b] - b * guess) b = i;
    period = (times[b] - times[a]) / (b - a);
    if (!(period > 0)) return null;
  }
  const bpm = 60000 / (MIDI_CLOCK_PPQN * period);
  return bpm >= 20 && bpm <= 400 ? bpm : null;
}

// ─── Ableton Link ────────────────────────────────────────────────────────

export type LinkFollowMode = 'startStop' | 'quantisedStart';

export interface LinkSample {
  /** Session beat at `atMs`, continuous (does not wrap each bar). */
  beat: number;
  tempo: number;
  playing: boolean;
  atMs: number;
  /** The quantum `beat` was read against (its phase is shared with peers
   *  using that bar length). Defaults to the show's bar length. */
  quantum?: number;
}

export interface LinkFollowContext {
  map: ShowTempoMap;
  /** The show's playhead right now, seconds. */
  playhead: number;
  mode: LinkFollowMode;
  /** "Bar 1 of the source": a start lands on show bar 1 + barOffset when
   *  the playhead is at or before that bar. */
  barOffset?: number;
}

export interface LinkFollowReading {
  /** Show seconds at the sample instant. */
  seconds: number;
  running: boolean;
  /** Quantised start waiting for the next Link bar. */
  waiting: boolean;
}

/** A playhead this close before a bar line (quarters, a 32nd note) counts as on it. */
const ON_BAR_QUARTERS = 0.125;

/**
 * The show bar (in quarters from bar 1) a Link start locks to Link's bar.
 *
 * Link has no song position, so the show's bars are put on Link's bars:
 * - at or before "Bar 1 of the source" (show bar 1 + barOffset, the stopped
 *   show at 0 included): that bar, so a session starting from its top has
 *   its bar 1 there;
 * - anywhere later: the bar the playhead is in.
 * Locking the playhead itself instead put every bar of the show off Link's
 * by however far the playhead was from a bar line.
 */
export function linkLockQuarters(map: ShowTempoMap, playhead: number, barOffset = 0): number {
  const origin = sourceOriginQuarters(map, barOffset);
  const p = beatAtSeconds(map, Number.isFinite(playhead) ? playhead : 0);
  if (p <= origin + ON_BAR_QUARTERS) return origin;
  const bar = barBeatAt(map, secondsAtBeat(map, p + ON_BAR_QUARTERS)).bar;
  return beatAtSeconds(map, secondsAtBar(map, bar));
}

/** Link quantum (quarters per bar) for the bar a start would lock to. */
export function linkQuantumAt(map: ShowTempoMap, playhead: number, barOffset = 0): number {
  return quartersPerBarAt(map, secondsAtBeat(map, linkLockQuarters(map, playhead, barOffset)));
}

/**
 * Link has no song position, so the show phase-locks to it:
 *
 * - startStop: when the session starts playing, the Link bar it started on
 *   becomes the lock bar (linkLockQuarters). From then show beat = Link
 *   beat − start bar + lock bar, until the session stops.
 * - quantisedStart: the session's own start/stop is ignored. The show's
 *   Play waits for the next Link bar, which becomes the lock bar the same
 *   way, and stays locked until the show is paused.
 *
 * Bars are counted in the show's quarter notes per bar, on Link's shared
 * beat timeline read against that same quantum, so every peer that uses the
 * same bar length agrees where the downbeat is.
 */
export class LinkFollower {
  private lock: { linkStart: number; showStart: number; quantum: number } | null = null;
  private pendingStart: number | null = null;
  private wantPlay = false;

  reset(): void {
    this.lock = null;
    this.pendingStart = null;
    this.wantPlay = false;
  }

  /** Quantised start: the show's Play (true) or Pause (false). */
  request(play: boolean): void {
    this.wantPlay = play;
    if (!play) {
      this.lock = null;
      this.pendingStart = null;
    }
  }

  get requested(): boolean {
    return this.wantPlay;
  }

  get locked(): boolean {
    return this.lock !== null;
  }

  /** The quantum to read Link's beat against: the locked one while
   *  following (its beat values must not change under the lock), else the
   *  bar length a start would lock to. */
  quantum(ctx: LinkFollowContext): number {
    return this.lock?.quantum ?? linkQuantumAt(ctx.map, ctx.playhead, ctx.barOffset ?? 0);
  }

  update(sample: LinkSample, ctx: LinkFollowContext): LinkFollowReading {
    const { map } = ctx;
    const parked = (): LinkFollowReading => ({ seconds: ctx.playhead, running: false, waiting: this.pendingStart !== null });
    const qpb = sample.quantum && sample.quantum > 0 ? sample.quantum : this.quantum(ctx);

    if (ctx.mode === 'startStop') {
      this.pendingStart = null;
      if (!sample.playing) {
        this.lock = null;
        return parked();
      }
      if (!this.lock) {
        // Started (or joined a session already playing): lock the bar it
        // is in. A start seen late by a poll still lands on its own bar.
        const linkStart = Math.floor(sample.beat / qpb + 1e-6) * qpb;
        this.lock = { linkStart, showStart: linkLockQuarters(map, ctx.playhead, ctx.barOffset ?? 0), quantum: qpb };
      }
    } else {
      if (!this.wantPlay) {
        this.lock = null;
        this.pendingStart = null;
        return parked();
      }
      if (!this.lock) {
        if (this.pendingStart === null) this.pendingStart = Math.ceil(sample.beat / qpb - 1e-6) * qpb;
        if (sample.beat < this.pendingStart) return parked();
        this.lock = { linkStart: this.pendingStart, showStart: linkLockQuarters(map, ctx.playhead, ctx.barOffset ?? 0), quantum: qpb };
        this.pendingStart = null;
      }
    }
    const quarters = this.lock.showStart + (sample.beat - this.lock.linkStart);
    return { seconds: secondsAtBeat(map, quarters), running: true, waiting: false };
  }
}
