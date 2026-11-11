/**
 * The style of a song, for Auto show: Chill, Groove, Driving, Hard or
 * Cinematic. Read from the analysis Score already has (the song's features,
 * its tempo and its sections) plus a few song-wide measures:
 *
 *   tempo        BPM of the Timeline's tempo map at the song
 *   hits         sudden jumps in loudness (drums), per beat, and how hard
 *                they land (dB): pads and swells make none
 *   on the beat  the share of beats with a hit, and with a low-band hit (a
 *                kick: four on the floor puts one on every beat)
 *   sustained    the share of bars at high energy
 *   dynamics     the gap between its quiet and loud parts (dB)
 *   low end      the share of its energy in the low band
 *   long builds  rising sections of 16 bars or more
 *   pulse        whether tempo detection found a steady beat at all
 *
 * Rules (AUTO-SHOW.md): Chill is slow, soft and sparse; Groove sits at
 * 90–125 BPM on a steady kick at mid energy; Driving is 120–140 on four on
 * the floor with high energy held; Hard is fast or very dense, with wide
 * dynamics and heavy low end; Cinematic has no steady beat, or long builds.
 * Each style gets a score; the highest wins. A wrong guess is one chip away
 * in the dialog. Pure.
 */
import type { ShowTempoMap } from '../../types';
import { beatAtSeconds, secondsAtBeat } from '../../show/tempoMap';
import { sampleFeature, type SongFeatures } from '../lines/songFeatures';
import type { SongStructure } from '../score/songStructure';

export const SHOW_STYLES = ['chill', 'groove', 'driving', 'hard', 'cinematic'] as const;
export type ShowStyle = (typeof SHOW_STYLES)[number];

export const SHOW_STYLE_NAMES: Record<ShowStyle, string> = {
  chill: 'Chill',
  groove: 'Groove',
  driving: 'Driving',
  hard: 'Hard',
  cinematic: 'Cinematic',
};

export interface StyleMeasures {
  bpm: number;
  /** Hits (sudden jumps in loudness) per beat, where the song sounds. */
  hitsPerBeat: number;
  /** How hard they land, dB. */
  punchDb: number;
  /** Share of sounding beats with a hit on them. */
  hitOnBeat: number;
  /** Share of sounding beats with a low-band hit (a kick) on them. */
  lowOnBeat: number;
  /** Share of bars at high energy. */
  sustained: number;
  /** Quiet-to-loud gap, dB. */
  rangeDb: number;
  /** Share of the energy in the low band. */
  lowShare: number;
  /** Bars of the longest rising section (a build). */
  longestRise: number;
  /** The song has a beat to cut to. */
  pulse: boolean;
}

export interface StyleReading {
  style: ShowStyle;
  scores: Record<ShowStyle, number>;
  measures: StyleMeasures;
}

/** How many of the sorted `times` fall within ±`win` of `t` (binary search). */
function near(times: Float32Array, t: number, win: number): boolean {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] < t - win) lo = mid + 1;
    else hi = mid;
  }
  return lo < times.length && times[lo] <= t + win;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** 1 inside [b, c], ramping to 0 at a and d. */
function trap(x: number, a: number, b: number, c: number, d: number): number {
  if (x <= a || x >= d) return 0;
  if (x < b) return (x - a) / (b - a);
  if (x <= c) return 1;
  return (d - x) / (d - c);
}

/**
 * Measure the song placed with its file's time 0 at show time `origin`, on a
 * Timeline with `tempo`, with its `structure` (songStructure.ts). `pulse`:
 * false when tempo detection found no steady beat.
 */
export function measureStyle(
  song: SongFeatures,
  tempo: ShowTempoMap,
  structure: Pick<SongStructure, 'bars' | 'barEnergy' | 'sections'>,
  origin: number,
  pulse = true,
): StyleMeasures {
  const bars = structure.bars;
  const start = bars[0] ?? origin;
  const end = bars[bars.length - 1] ?? origin + song.duration;
  const bpm = tempo.segments[0]?.bpm ?? 120;
  const stats = song.stats;
  const hits = stats?.hits ?? new Float32Array(0);
  const lowHits = stats?.lowHits ?? new Float32Array(0);
  const win = Math.min(0.06, 15 / bpm);
  // Beats where the song sounds.
  let beats = 0;
  let onBeat = 0;
  let lowOn = 0;
  const firstBeat = Math.ceil(beatAtSeconds(tempo, start) - 1e-6);
  for (let q = firstBeat; q - firstBeat < 100000; q++) {
    const t = secondsAtBeat(tempo, q);
    if (t >= end - 1e-6) break;
    if (sampleFeature(song, 'level', t - origin, 0.2) < 0.15) continue;
    beats++;
    if (near(hits, t - origin, win)) onBeat++;
    if (near(lowHits, t - origin, win)) lowOn++;
  }
  const high = structure.barEnergy.filter((e) => e >= 0.6).length;
  let longestRise = 0;
  for (const s of structure.sections) if (s.rise > 0.12 && s.kind !== 'drop' && s.kind !== 'outro') longestRise = Math.max(longestRise, s.bars);
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return {
    bpm: Math.round(bpm * 10) / 10,
    hitsPerBeat: r(((stats?.hitRate ?? 0) * 60) / Math.max(1, bpm)),
    punchDb: stats?.punchDb ?? 0,
    hitOnBeat: r(beats ? onBeat / beats : 0),
    lowOnBeat: r(beats ? lowOn / beats : 0),
    sustained: r(structure.barEnergy.length ? high / structure.barEnergy.length : 0),
    rangeDb: stats?.rangeDb ?? 0,
    lowShare: stats?.lowShare ?? 0,
    longestRise,
    pulse,
  };
}

/** Score each style from the measures; the highest wins. */
export function classifyStyle(m: StyleMeasures): StyleReading {
  const bpm = m.bpm;
  // A beat to cut to: hits land on most beats.
  const steady = m.pulse ? clamp01((m.hitOnBeat - 0.25) / 0.45) : 0;
  const fourOnFloor = clamp01((m.lowOnBeat - 0.55) / 0.3);
  const busy = clamp01((m.hitsPerBeat - 0.8) / 1.2);
  const dense = clamp01((m.hitsPerBeat - 1.9) / 1.0);
  const soft = clamp01((22 - m.punchDb) / 12);
  const wide = clamp01((m.rangeDb - 10) / 14);
  const heavy = clamp01((m.lowShare - 0.5) / 0.35);
  const fast = clamp01((bpm - 136) / 12);
  const slow = trap(bpm, 0, 0, 98, 116);
  const scores: Record<ShowStyle, number> = {
    // Slow, low energy, soft and sparse onsets.
    chill: steady * (1.3 * slow + 0.7 * (1 - busy) + 0.5 * soft + 0.3 * (1 - m.sustained)) + 0.3 * slow,
    // 90–125 BPM on a steady kick, mid energy: syncopated rather than four on the floor.
    groove: steady * (1.2 * trap(bpm, 86, 94, 122, 130) + 0.6 * busy + 0.5 * (1 - fourOnFloor) + 0.2 * (1 - soft)),
    // 120–140 on four on the floor, high energy held.
    driving: steady * (1.2 * trap(bpm, 114, 120, 138, 146) + 0.9 * fourOnFloor + 0.4 * busy + 0.3 * clamp01(m.sustained / 0.35)) - 0.5 * fast,
    // Fast or very dense, wide dynamics, heavy low end.
    hard: steady * (1.3 * fast + 0.8 * dense + 0.4 * wide + 0.4 * heavy + 0.2 * fourOnFloor),
    // No steady beat, or long builds.
    cinematic: 1.6 * (1 - steady) + 0.6 * clamp01((m.longestRise - 12) / 12),
  };
  for (const k of SHOW_STYLES) scores[k] = Math.round(scores[k] * 1000) / 1000;
  let style: ShowStyle = 'groove';
  for (const k of SHOW_STYLES) if (scores[k] > scores[style] + 1e-9) style = k;
  return { style, scores, measures: m };
}

/** The style of a song (see the module notes). */
export function readSongStyle(song: SongFeatures, tempo: ShowTempoMap, structure: Pick<SongStructure, 'bars' | 'barEnergy' | 'sections'>, origin: number, pulse = true): StyleReading {
  return classifyStyle(measureStyle(song, tempo, structure, origin, pulse));
}
