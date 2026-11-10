/**
 * The show's beat grid: bars and beats laid over show time.
 *
 * A map is an offset (the show time of bar 1 beat 1) and a list of tempo
 * segments, each starting on a bar. BPM always counts quarter notes, as Live,
 * Link and MIDI clock do, so a 6/8 bar at 120 BPM is three quarter notes
 * (1.5 s) long whatever the signature says.
 *
 * Positions are measured in quarter notes from bar 1 ("quarters" below).
 * Bars before bar 1 extend the first segment backwards (bar 0, -1, ...), so a
 * show that starts before the downbeat still has a grid.
 *
 * Pure: no stores, no DOM. The show store, the ruler, snapping and the clock
 * followers all go through these functions.
 */
import type { ShowSnapGrid, ShowTempoMap, ShowTempoSegment } from '../types';

export const SHOW_MIN_BPM = 20;
export const SHOW_MAX_BPM = 400;
export const SHOW_DEFAULT_BPM = 120;
const BEAT_UNITS = [2, 4, 8, 16] as const;

/** A segment with everything needed to convert positions inside it. */
interface ResolvedSegment extends ShowTempoSegment {
  /** Quarter notes from bar 1 to this segment's first bar. */
  startQuarter: number;
  /** Show time of this segment's first bar. */
  startSeconds: number;
  quartersPerBar: number;
  secondsPerQuarter: number;
}

const resolvedCache = new WeakMap<ShowTempoMap, ResolvedSegment[]>();

function clampBpm(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return SHOW_DEFAULT_BPM;
  return Math.max(SHOW_MIN_BPM, Math.min(SHOW_MAX_BPM, n));
}

function normalizeSegment(raw: unknown, fallbackBar: number): ShowTempoSegment | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const bar = Math.round(Number(s.bar));
  const beatsPerBar = Math.round(Number(s.beatsPerBar));
  const unit = Number(s.beatUnit);
  return {
    bar: Number.isFinite(bar) ? bar : fallbackBar,
    bpm: clampBpm(s.bpm),
    beatsPerBar: Number.isFinite(beatsPerBar) && beatsPerBar >= 1 ? Math.min(32, beatsPerBar) : 4,
    beatUnit: (BEAT_UNITS as readonly number[]).includes(unit) ? (unit as ShowTempoSegment['beatUnit']) : 4,
  };
}

/**
 * A map that is safe to evaluate, or null when there is no usable grid.
 * Segments are sorted by bar, duplicates on one bar keep the last, and the
 * first segment always starts on bar 1.
 */
export function normalizeTempoMap(raw: unknown): ShowTempoMap | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const rawSegments = Array.isArray(m.segments) ? m.segments : [];
  const byBar = new Map<number, ShowTempoSegment>();
  rawSegments.forEach((seg, i) => {
    const s = normalizeSegment(seg, i === 0 ? 1 : NaN);
    if (s && Number.isFinite(s.bar)) byBar.set(s.bar, s);
  });
  const segments = [...byBar.values()].sort((a, b) => a.bar - b.bar);
  if (!segments.length) return null;
  // The segment in force at bar 1 (the last one starting on or before it,
  // else the first) becomes the first segment, starting on bar 1.
  const atOrBefore = segments.filter((s) => s.bar <= 1);
  const first = { ...(atOrBefore.length ? atOrBefore[atOrBefore.length - 1] : segments[0]), bar: 1 };
  const kept = [first, ...segments.filter((s) => s.bar > 1)];
  const offset = Number(m.offset);
  const out: ShowTempoMap = {
    offset: Number.isFinite(offset) ? offset : 0,
    segments: kept,
    source: m.source === 'analysis' ? 'analysis' : 'manual',
  };
  if (typeof m.analysedTrackId === 'string' && m.analysedTrackId) out.analysedTrackId = m.analysedTrackId;
  return out;
}

/** A fresh single-segment map. */
export function createTempoMap(bpm = SHOW_DEFAULT_BPM, offset = 0, beatsPerBar = 4, beatUnit: ShowTempoSegment['beatUnit'] = 4): ShowTempoMap {
  return { offset, segments: [{ bar: 1, bpm: clampBpm(bpm), beatsPerBar, beatUnit }], source: 'manual' };
}

function resolve(map: ShowTempoMap): ResolvedSegment[] {
  const cached = resolvedCache.get(map);
  if (cached) return cached;
  const out: ResolvedSegment[] = [];
  let quarter = 0;
  let seconds = map.offset;
  map.segments.forEach((seg, i) => {
    const quartersPerBar = seg.beatsPerBar * (4 / seg.beatUnit);
    const secondsPerQuarter = 60 / seg.bpm;
    if (i > 0) {
      const prev = out[i - 1];
      const bars = seg.bar - prev.bar;
      quarter = prev.startQuarter + bars * prev.quartersPerBar;
      seconds = prev.startSeconds + bars * prev.quartersPerBar * prev.secondsPerQuarter;
    }
    out.push({ ...seg, startQuarter: quarter, startSeconds: seconds, quartersPerBar, secondsPerQuarter });
  });
  resolvedCache.set(map, out);
  return out;
}

function segmentForQuarter(segs: ResolvedSegment[], q: number): ResolvedSegment {
  let found = segs[0];
  for (const s of segs) {
    if (s.startQuarter <= q + 1e-9) found = s;
    else break;
  }
  return found;
}

function segmentForSeconds(segs: ResolvedSegment[], t: number): ResolvedSegment {
  let found = segs[0];
  for (const s of segs) {
    if (s.startSeconds <= t + 1e-9) found = s;
    else break;
  }
  return found;
}

/** Quarter notes since bar 1 beat 1 at show time `t` (negative before it). */
export function beatAtSeconds(map: ShowTempoMap, t: number): number {
  const segs = resolve(map);
  const s = segmentForSeconds(segs, t);
  return s.startQuarter + (t - s.startSeconds) / s.secondsPerQuarter;
}

/** Show time of a position in quarter notes since bar 1 beat 1. */
export function secondsAtBeat(map: ShowTempoMap, quarters: number): number {
  const segs = resolve(map);
  const s = segmentForQuarter(segs, quarters);
  return s.startSeconds + (quarters - s.startQuarter) * s.secondsPerQuarter;
}

/** Show time at which `bar` starts. */
export function secondsAtBar(map: ShowTempoMap, bar: number): number {
  const segs = resolve(map);
  let s = segs[0];
  for (const seg of segs) if (seg.bar <= bar) s = seg;
  return s.startSeconds + (bar - s.bar) * s.quartersPerBar * s.secondsPerQuarter;
}

export interface BarBeat {
  /** Bar number; 1 is the first bar of the map, 0 and below come before it. */
  bar: number;
  /** Beat in the bar, 1-based, counted in the signature's beat unit. */
  beat: number;
  /** How far into that beat, 0..1. */
  fraction: number;
  beatsPerBar: number;
  bpm: number;
}

export function barBeatAt(map: ShowTempoMap, t: number): BarBeat {
  const segs = resolve(map);
  const q = beatAtSeconds(map, t);
  const s = segmentForQuarter(segs, q);
  const intoSegment = q - s.startQuarter;
  // Snap float dust so exactly-on-the-bar positions don't read as x.4.999.
  const barsIn = Math.floor(intoSegment / s.quartersPerBar + 1e-9);
  const inBar = Math.max(0, intoSegment - barsIn * s.quartersPerBar);
  const beatLength = 4 / s.beatUnit;
  const beatIndex = Math.min(s.beatsPerBar - 1, Math.floor(inBar / beatLength + 1e-9));
  const fraction = Math.max(0, Math.min(1, (inBar - beatIndex * beatLength) / beatLength));
  return { bar: s.bar + barsIn, beat: beatIndex + 1, fraction, beatsPerBar: s.beatsPerBar, bpm: s.bpm };
}

/** "12.3" (bar.beat), or "12.3.2" with sixteenths. */
export function formatBarsBeats(map: ShowTempoMap, t: number, withSixteenths = false): string {
  const bb = barBeatAt(map, t);
  if (!withSixteenths) return `${bb.bar}.${bb.beat}`;
  const segs = resolve(map);
  const s = segmentForQuarter(segs, beatAtSeconds(map, t));
  // Sixteenth notes inside the beat, 1-based.
  const sixteenthsPerBeat = Math.max(1, Math.round(16 / s.beatUnit));
  const sixteenth = Math.min(sixteenthsPerBeat, Math.floor(bb.fraction * sixteenthsPerBeat + 1e-9) + 1);
  return `${bb.bar}.${bb.beat}.${sixteenth}`;
}

/** Grid step in quarter notes for a segment, or null for a non-musical grid. */
function gridQuarters(seg: ShowTempoSegment, grid: ShowSnapGrid): number | null {
  const beat = 4 / seg.beatUnit;
  switch (grid) {
    case 'bar': return seg.beatsPerBar * beat;
    case 'beat': return beat;
    case 'half': return beat / 2;
    case 'quarter': return beat / 4;
    case 'sixteenth': return 0.25;
    default: return null;
  }
}

/** The grid step, seconds, at show time `t` (for nudging by one step). */
export function gridStepSeconds(map: ShowTempoMap, t: number, grid: ShowSnapGrid): number | null {
  const segs = resolve(map);
  const s = segmentForSeconds(segs, t);
  const q = gridQuarters(s, grid);
  return q === null ? null : q * s.secondsPerQuarter;
}

/**
 * The grid line nearest to show time `t`. Grid lines are counted from the
 * start of the segment's first bar, so every bar line is on the grid; a
 * segment boundary is always a candidate too.
 */
export function nearestGridTime(map: ShowTempoMap, t: number, grid: ShowSnapGrid): number {
  const segs = resolve(map);
  const s = segmentForSeconds(segs, t);
  const step = gridQuarters(s, grid);
  if (step === null || step <= 0) return t;
  const q = beatAtSeconds(map, t);
  const snappedQ = s.startQuarter + Math.round((q - s.startQuarter) / step) * step;
  let best = s.startSeconds + (snappedQ - s.startQuarter) * s.secondsPerQuarter;
  // The next segment's first bar may be nearer than this segment's last line.
  const next = segs[segs.indexOf(s) + 1];
  if (next && Math.abs(next.startSeconds - t) < Math.abs(best - t)) best = next.startSeconds;
  return Math.round(best * 1e9) / 1e9;
}

/** Bars closer than this (px) only get a tick when they carry a number. */
const RULER_MIN_BAR_PX = 3;

export interface RulerTick {
  time: number;
  bar: number;
  beat: number;
  kind: 'bar' | 'beat';
  /** Shown on bar ticks that carry a number. */
  label?: string;
}

/**
 * Ticks for a bars|beats ruler between show times `t0` and `t1`. Beats are
 * drawn only when they are at least `minPx` apart; bar numbers thin out to
 * every 2nd, 4th, 8th... bar when bars themselves get crowded.
 */
export function rulerTicks(map: ShowTempoMap, t0: number, t1: number, pxPerSecond: number, minPx = 6): RulerTick[] {
  const ticks: RulerTick[] = [];
  if (!(t1 > t0) || !(pxPerSecond > 0)) return ticks;
  const segs = resolve(map);
  let bar = barBeatAt(map, t0).bar;
  // Hard cap: a ruler never needs more than a few thousand ticks (bars too
  // close to see are skipped below, so this is only a safety net).
  for (let guard = 0; guard < 20000; guard++) {
    const start = secondsAtBar(map, bar);
    if (start > t1) break;
    let s = segs[0];
    for (const seg of segs) if (seg.bar <= bar) s = seg;
    const barSeconds = s.quartersPerBar * s.secondsPerQuarter;
    const barPx = barSeconds * pxPerSecond;
    let every = 1;
    while (barPx * every < 40 && every < 1024) every *= 2;
    if (start >= t0 - 1e-9) {
      ticks.push({ time: start, bar, beat: 1, kind: 'bar', label: (bar - 1) % every === 0 ? String(bar) : undefined });
    }
    const beatSeconds = (4 / s.beatUnit) * s.secondsPerQuarter;
    if (beatSeconds * pxPerSecond >= minPx) {
      for (let b = 2; b <= s.beatsPerBar; b++) {
        const time = start + (b - 1) * beatSeconds;
        if (time >= t0 - 1e-9 && time <= t1) ticks.push({ time, bar, beat: b, kind: 'beat' });
      }
    }
    if (barPx < RULER_MIN_BAR_PX && every > 1) {
      // Bars under a few pixels apart are a smear: go straight to the next
      // numbered bar (or the next segment). Stepping one bar at a time ran
      // out of the tick cap and cut the ruler off at extreme zoom.
      const into = (((bar - 1) % every) + every) % every;
      const next = segs.find((seg) => seg.bar > bar)?.bar ?? Infinity;
      bar = Math.min(bar + every - into, next);
    } else {
      bar++;
    }
  }
  return ticks;
}

/**
 * The tempo of a detected beat grid, unrounded. The analysis reports its
 * tempo to 0.1 BPM for display; a map at that rounded tempo drifts off a
 * 127.37 BPM song by half a beat in ten minutes. The beats themselves are
 * the exact grid, so the tempo comes from their spacing (a least-squares
 * line, so a beat clamped to 0 at the start does not bend it). Falls back to
 * `reported` when there are too few beats or they disagree with it.
 */
export function gridTempo(beats: readonly number[], reported: number): number {
  const ts = beats.filter((b) => b > 0 && Number.isFinite(b));
  const n = ts.length;
  if (n < 8) return reported;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += ts[i];
    sxx += i * i;
    sxy += i * ts[i];
  }
  const period = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const bpm = 60 / period;
  return Number.isFinite(bpm) && Math.abs(bpm / reported - 1) < 0.01 ? clampBpm(bpm) : reported;
}

/**
 * A map seeded from audio analysis of a track placed on the show.
 *
 * `beats` are times inside the audio file. The first detected beat at or
 * after the track's in-point becomes bar 1 beat 1. There is no downbeat
 * detection, so that may be any beat of the bar; the user moves "bar 1"
 * from there.
 */
export function tempoFromAnalysis(
  analysis: { tempo: number | null; beats: number[] },
  track: { id?: string; startTime: number; offset: number },
): ShowTempoMap | null {
  if (!analysis.tempo || !(analysis.tempo > 0)) return null;
  const firstBeat = analysis.beats.find((b) => b >= track.offset - 1e-6);
  const fileTime = firstBeat ?? track.offset;
  const map = createTempoMap(gridTempo(analysis.beats, analysis.tempo), track.startTime + (fileTime - track.offset));
  map.source = 'analysis';
  if (track.id) map.analysedTrackId = track.id;
  return map;
}
