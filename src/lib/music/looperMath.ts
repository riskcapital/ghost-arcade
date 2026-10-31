/**
 * The band looper's sums, kept apart from the audio so they can be tested:
 * where the next bar line falls, the sample frames a recording covers, where
 * in a loop playback starts so it keeps the phase of the bars it was
 * recorded on, how its speed follows the clock, and the slices of a chop.
 *
 * Times are on the audio clock (AudioContext.currentTime, seconds); frames
 * are that clock in samples. Beats are the launch clock's: a multiple of 4
 * is a downbeat. A reading of the launch clock is taken to be "now" on the
 * audio clock, as the studio's sequencer takes it.
 */

export const BEATS_PER_BAR = 4;
export const LOOP_LENGTHS = [1, 2, 4, 8] as const;
export type LoopLength = (typeof LOOP_LENGTHS)[number];

/**
 * The longest recording. Eight bars at 60 BPM is 32 seconds, so every length
 * fits from 60 BPM up; slower than that the longest lengths are left out.
 * Stereo at 48 kHz that is 12 MB a loop (24 MB at 96 kHz): two loops and one
 * being recorded stay well under 100 MB.
 */
export const MAX_RECORD_SECONDS = 32;

/** A recording starts at least this far ahead, so the request reaches the audio thread before the bar line. */
export const MIN_LEAD_SECONDS = 0.03;

/** Where the launch clock is: a beat position and how long a beat lasts. */
export interface ClockReading {
  beat: number;
  beatMs: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const unit = (x: number) => (Number.isFinite(x) ? clamp(x, 0, 1) : 0.5);

/** The first bar line at least `leadSeconds` after `beat`. */
export function nextBarBeat(beat: number, beatMs: number, leadSeconds = MIN_LEAD_SECONDS): number {
  const lead = beatMs > 0 ? (Math.max(0, leadSeconds) * 1000) / beatMs : 0;
  // + 0 turns a -0 (just before beat 0) into 0.
  return Math.ceil((beat + lead) / BEATS_PER_BAR - 1e-9) * BEATS_PER_BAR + 0;
}

/** The audio-clock time of a beat, from a clock reading taken at audio time `now`. */
export function timeOfBeat(beat: number, clock: ClockReading, now: number): number {
  return now + ((beat - clock.beat) * clock.beatMs) / 1000;
}

/** The longest loop length that fits in `maxSeconds` at this beat length; 0 when not even one bar does. */
export function longestLength(beatMs: number, maxSeconds = MAX_RECORD_SECONDS): number {
  const bar = (BEATS_PER_BAR * beatMs) / 1000;
  let best = 0;
  for (const bars of LOOP_LENGTHS) if (bars * bar <= maxSeconds + 1e-9) best = bars;
  return best;
}

/** What a recording covers, from bar line to bar line. */
export interface RecordWindow {
  startBeat: number;
  endBeat: number;
  bars: number;
  startFrame: number;
  /** The frame just after the last one recorded. */
  endFrame: number;
  startTime: number;
  endTime: number;
}

/**
 * A recording of `bars` bars from the next bar line: its first and last
 * frames on the audio clock. The length in frames is the bars at the tempo
 * now, rounded once, so the loop is exactly that long.
 */
export function recordWindow(now: number, clock: ClockReading, bars: number, sampleRate: number, leadSeconds = MIN_LEAD_SECONDS): RecordWindow {
  const startBeat = nextBarBeat(clock.beat, clock.beatMs, leadSeconds);
  const startFrame = Math.round(timeOfBeat(startBeat, clock, now) * sampleRate);
  const length = Math.max(1, Math.round(((bars * BEATS_PER_BAR * clock.beatMs) / 1000) * sampleRate));
  const endFrame = startFrame + length;
  return {
    startBeat,
    endBeat: startBeat + bars * BEATS_PER_BAR,
    bars,
    startFrame,
    endFrame,
    startTime: startFrame / sampleRate,
    endTime: endFrame / sampleRate,
  };
}

/**
 * Stop a recording sooner: it ends on its next bar line at least
 * `leadSeconds` after `now` (after at least one bar), counting bars of the
 * length it started with, so a clock resync meanwhile cannot move it. Never
 * later than planned.
 */
export function shortenWindow(w: RecordWindow, now: number, sampleRate: number, leadSeconds = MIN_LEAD_SECONDS): RecordWindow {
  const barFrames = (w.endFrame - w.startFrame) / w.bars;
  const barSeconds = barFrames / sampleRate;
  if (!(barSeconds > 0)) return w;
  const bars = clamp(Math.ceil((now + leadSeconds - w.startTime) / barSeconds - 1e-9), 1, w.bars);
  if (bars >= w.bars) return w;
  const endFrame = w.startFrame + Math.round(barFrames * bars);
  return { ...w, bars, endBeat: w.startBeat + bars * BEATS_PER_BAR, endFrame, endTime: endFrame / sampleRate };
}

/** How far through a recording `now` is (0-1), and the bar it is in, from 1. */
export function recordProgress(w: RecordWindow, now: number): { progress: number; bar: number } {
  const span = w.endTime - w.startTime;
  const progress = span > 0 ? clamp((now - w.startTime) / span, 0, 1) : 0;
  return { progress, bar: Math.min(w.bars, Math.floor(progress * w.bars) + 1) };
}

/** Whole beats still to count in before a recording starts (at least 1). */
export function countInBeats(w: RecordWindow, now: number, beatMs: number): number {
  if (!(beatMs > 0)) return 1;
  return Math.max(1, Math.ceil(((w.startTime - now) * 1000) / beatMs - 1e-6));
}

/**
 * Where in a loop playback at `beat` is, in seconds of the loop: a loop
 * keeps the phase of the bars it was recorded on, so started on a bar line
 * a two-bar phrase comes back on the same bar of the phrase.
 */
export function loopOffset(beat: number, originBeat: number, loopBeats: number, duration: number): number {
  if (!(loopBeats > 0) || !(duration > 0) || !Number.isFinite(beat)) return 0;
  const phase = ((((beat - originBeat) / loopBeats) % 1) + 1) % 1;
  const offset = phase * duration;
  return duration - offset < 1e-6 ? 0 : offset;
}

/** Where a playing loop is, in seconds of the loop, from where it was at `anchorTime` and its rate since. */
export function loopPosition(anchorPos: number, anchorTime: number, rate: number, time: number, duration: number): number {
  if (!(duration > 0)) return 0;
  const pos = anchorPos + Math.max(0, time - anchorTime) * rate;
  return ((pos % duration) + duration) % duration;
}

/** `expected - actual` around a loop of `duration` seconds, between -duration/2 and duration/2. */
export function phaseError(expected: number, actual: number, duration: number): number {
  if (!(duration > 0)) return 0;
  let e = (expected - actual) % duration;
  if (e > duration / 2) e -= duration;
  else if (e <= -duration / 2) e += duration;
  return e;
}

// ── Following the clock ─────────────────────────────────────────────────

/**
 * A loop follows tempo moves up to 3% (about half a semitone): further and
 * changing its speed would put it audibly out of tune with the band, so it
 * keeps its own length instead.
 */
export const FOLLOW_LIMIT = 0.03;
/** The most the speed is bent to close a phase error (about 9 cents). */
export const MAX_CORRECTION = 0.005;
/** A phase error is closed over about this long. */
export const CORRECT_SECONDS = 2;
/** Errors smaller than this are left alone: they are the clocks' jitter. */
export const DEADBAND_SECONDS = 0.004;
/** Further out than this for RESYNC_CHECKS checks in a row, the loop jumps back into phase. */
export const RESYNC_SECONDS = 0.08;
export const RESYNC_CHECKS = 3;
/** How much of each new phase reading goes into the smoothed error. */
const SMOOTHING = 0.2;

export interface FollowState {
  /** The smoothed phase error, in seconds of the loop (positive: the loop is behind). */
  error: number;
  /** Checks in a row the loop has been far out of phase. */
  far: number;
}

export const FOLLOW_START: FollowState = { error: 0, far: 0 };

export interface FollowStep {
  state: FollowState;
  rate: number;
  /** The tempo has moved too far: the loop plays at its recorded speed and drifts. */
  ownLength: boolean;
  /** Restart the loop in phase now (the clock jumped: a resync, a nudge let go). */
  resync: boolean;
}

/**
 * One check of a playing loop against the clock. `ratio` is the tempo now
 * over the tempo it was recorded at; `rawError` the phase error measured
 * now. The rate is the ratio, bent a little to close the smoothed error.
 */
export function followStep(prev: FollowState, ratio: number, rawError: number): FollowStep {
  if (!Number.isFinite(ratio) || !(ratio > 0) || Math.abs(ratio - 1) > FOLLOW_LIMIT) {
    return { state: FOLLOW_START, rate: 1, ownLength: true, resync: false };
  }
  const isFar = Math.abs(rawError) > RESYNC_SECONDS;
  const far = isFar ? prev.far + 1 : 0;
  if (far >= RESYNC_CHECKS) return { state: FOLLOW_START, rate: ratio, ownLength: false, resync: true };
  // A single far reading is not trusted until it repeats.
  const error = isFar ? prev.error : prev.error + (rawError - prev.error) * SMOOTHING;
  const correction = Math.abs(error) < DEADBAND_SECONDS ? 0 : clamp(error / CORRECT_SECONDS, -MAX_CORRECTION, MAX_CORRECTION);
  return { state: { error, far }, rate: ratio * (1 + correction), ownLength: false, resync: false };
}

/** The speed a loop starts at: the tempo ratio while it is small enough to follow, else its own. */
export function startRate(ratio: number): number {
  return Number.isFinite(ratio) && ratio > 0 && Math.abs(ratio - 1) <= FOLLOW_LIMIT ? ratio : 1;
}

// ── Chops ───────────────────────────────────────────────────────────────

/** `count` equal slices of `length` frames, [start, end), covering every frame once. */
export function sliceBounds(length: number, count: number): Array<{ start: number; end: number }> {
  const n = Math.max(1, Math.floor(count));
  const total = Math.max(0, Math.floor(length));
  const out: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < n; i++) out.push({ start: Math.round((i * total) / n), end: Math.round(((i + 1) * total) / n) });
  return out;
}

/** The FX pads' knobs, each 0-1. */
export interface ChopKnobs {
  size: number;
  tail: number;
  tone: number;
}

export interface ChopPlayback {
  /** Where it starts in the loop, seconds. */
  offset: number;
  /** How much of the loop it plays, seconds of the loop. */
  length: number;
  rate: number;
  /** How long it sounds, seconds. */
  heard: number;
  /** Tone below the middle darkens it, above thins it; null leaves it open. */
  lowpass: number | null;
  highpass: number | null;
}

/**
 * How a chop plays with the pads' knobs, as the other pad sounds read them:
 * Size is pitch (small is high: 2x to 0.5x the speed), Tail how much it
 * plays (a quarter of its slice to the slice and as much again, running on
 * into the next), Tone dark to thin. In the middle it is the slice as
 * recorded.
 */
export function chopPlayback(start: number, end: number, total: number, sampleRate: number, knobs: ChopKnobs): ChopPlayback {
  const sr = sampleRate > 0 ? sampleRate : 48000;
  const size = unit(knobs.size);
  const tail = unit(knobs.tail);
  const tone = unit(knobs.tone);
  const rate = Math.pow(2, (0.5 - size) * 2);
  const stretch = tail < 0.5 ? 0.25 + tail * 1.5 : 1 + (tail - 0.5) * 2;
  const from = clamp(Math.floor(start), 0, Math.max(0, total - 1));
  const frames = clamp(Math.round(Math.max(1, end - start) * stretch), 1, Math.max(1, total - from));
  return {
    offset: from / sr,
    length: frames / sr,
    rate,
    heard: frames / sr / rate,
    lowpass: tone < 0.48 ? 250 * Math.pow(80, tone * 2) : null,
    highpass: tone > 0.52 ? 30 * Math.pow(40, (tone - 0.5) * 2) : null,
  };
}
