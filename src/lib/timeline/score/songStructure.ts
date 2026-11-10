/**
 * The structure of a song on the Timeline: where its sections are, what
 * each one is (intro, build, drop, breakdown, outro…) and how intense it is.
 *
 * Works on bars. From the song's offline analysis (lines/songFeatures.ts:
 * loudness, band levels, kick / snare / hat hits, all per ~10 ms frame) each
 * bar gets a feature vector: loudness, low / mid / high band, onset density
 * (how busy it is), the kick, and the spectral tilt (high against low). A
 * novelty curve on the bar lines says how different the bars after a line
 * are from the bars before it. The cuts are then chosen together (dynamic
 * programming over the bar lines): strong novelty, and section lengths that
 * are musical phrases (4 / 8 / 16 bars, also 32) on the song's phrase grid,
 * with a cost per cut so a song is not chopped up.
 *
 * Labels are rules on the sections' energy and how it moves: the loudest,
 * kick-heavy sections are drops; the one before a drop whose energy and
 * busyness rise through it is a build; a quiet one after a drop is a
 * breakdown; a quiet start is the intro and a falling end the outro.
 *
 * Pure and deterministic: the same song and grid give the same structure.
 */
import type { ShowTempoMap } from '../../types';
import { beatAtSeconds, secondsAtBeat } from '../../show/tempoMap';
import { sampleFeature, type AudioFeature, type SongFeatures } from '../lines/songFeatures';
import { SECTION_KIND_NAMES, type SectionKind } from '../sections/sectionModel';

export interface SongPlacement {
  /** Show time where the song file's time 0 would be (block start − in-point). */
  origin: number;
  /** The span of the song on the Timeline (the block). */
  start: number;
  end: number;
}

export interface DetectedSection {
  start: number;
  end: number;
  /** Bar index of the start (0 = the first whole bar of the song). */
  bar: number;
  bars: number;
  kind: SectionKind;
  name: string;
  /** 0..1 against the rest of the song. */
  energy: number;
  /** Energy rises through the section (last bars minus first bars, 0..1 scale). */
  rise: number;
}

export interface SongStructure {
  /** Show times of the bar lines used (bars[i] .. bars[i + 1] is bar i). */
  bars: number[];
  sections: DetectedSection[];
  /** 0..1 per bar (the energy line). */
  barEnergy: number[];
  /** 0..1 per bar: how busy (onset density). */
  barDensity: number[];
  /** Novelty on each bar line (bars.length − 1 entries; index 0 is the song start). */
  novelty: number[];
}

/** Bars per beat grid: from the first bar line at or after `from` to `to`. */
export function barLines(tempo: ShowTempoMap, from: number, to: number): number[] {
  const seg = tempo.segments[0];
  const perBar = (seg?.beatsPerBar ?? 4) * (4 / (seg?.beatUnit ?? 4));
  const q0 = beatAtSeconds(tempo, from);
  let bar = Math.ceil(q0 / perBar - 1e-6);
  const out: number[] = [];
  for (let guard = 0; guard < 10000; guard++) {
    const t = secondsAtBeat(tempo, bar * perBar);
    if (t > to + 1e-6) break;
    if (t >= from - 1e-6) out.push(Math.round(t * 1e6) / 1e6);
    bar++;
  }
  return out;
}

function mean(xs: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return xs.length ? s / xs.length : 0;
}

function std(xs: ArrayLike<number>, m = mean(xs)): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i] - m) ** 2;
  return xs.length ? Math.sqrt(s / xs.length) : 0;
}

/** Mean of a feature over show time [a, b) (sampled every ~23 ms). */
function spanMean(song: SongFeatures, feature: AudioFeature, origin: number, a: number, b: number): number {
  const step = Math.max(1 / song.frameRate, 0.023);
  let sum = 0;
  let n = 0;
  for (let t = a; t < b - 1e-9; t += step) {
    sum += sampleFeature(song, feature, t - origin);
    n++;
  }
  return n ? sum / n : 0;
}

/** Section length preference, in bars (higher is more musical). */
export function phraseScore(bars: number): number {
  switch (bars) {
    case 16: return 0.9;
    case 8: return 0.8;
    case 32: return 0.5;
    case 4: return 0.35;
    case 12: return 0.1;
    case 24: return 0.2;
    default:
      return bars % 4 === 0 ? -0.2 : bars % 2 === 0 ? -0.8 : -1.4;
  }
}

/** Cost of one more cut (keeps a steady song from being chopped). */
const CUT_COST = 1.2;
/** Novelty is in units of its own spread; a cut on a flat line costs this much. */
const NOVELTY_WEIGHT = 1.0;
const MIN_BARS = 2;
const MAX_BARS = 64;

/**
 * The structure of the song placed at `place` on a Timeline with `tempo`.
 * Needs at least 4 whole bars; a shorter song is one section.
 */
export function detectSongStructure(song: SongFeatures, tempo: ShowTempoMap, place: SongPlacement): SongStructure {
  const bars = barLines(tempo, place.start, place.end);
  const n = bars.length - 1;
  if (n < 4) {
    const start = bars[0] ?? place.start;
    const end = bars[bars.length - 1] ?? place.end;
    return {
      bars,
      sections: end - start > 0.25 ? [{ start, end, bar: 0, bars: Math.max(1, n), kind: 'other', name: 'Song', energy: 0.5, rise: 0 }] : [],
      barEnergy: Array.from({ length: Math.max(0, n) }, () => 0.5),
      barDensity: Array.from({ length: Math.max(0, n) }, () => 0.5),
      novelty: [],
    };
  }

  // ── Per-bar features ──────────────────────────────────────────────────
  const level: number[] = [];
  const low: number[] = [];
  const mid: number[] = [];
  const high: number[] = [];
  const density: number[] = [];
  const kick: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = bars[i];
    const b = bars[i + 1];
    level.push(spanMean(song, 'level', place.origin, a, b));
    low.push(spanMean(song, 'bass', place.origin, a, b));
    mid.push(spanMean(song, 'mid', place.origin, a, b));
    high.push(spanMean(song, 'high', place.origin, a, b));
    const k = spanMean(song, 'kick', place.origin, a, b);
    kick.push(k);
    density.push(k + spanMean(song, 'snare', place.origin, a, b) + spanMean(song, 'hats', place.origin, a, b));
  }
  const tilt = high.map((h, i) => h - low[i]);
  const features = [level, low, mid, high, density, kick, tilt].map((f) => {
    const m = mean(f);
    const s = std(f, m);
    return f.map((v) => (s > 1e-6 ? (v - m) / s : 0));
  });

  // ── Novelty on each bar line ───────────────────────────────────────────
  // How different the bars after a line are from the bars before it, over
  // windows of 2 and 4 bars (a short fill and a phrase both count).
  const noveltyAt = (k: number, w: number) => {
    let d = 0;
    for (const f of features) {
      let before = 0, after = 0, nb = 0, na = 0;
      for (let j = 1; j <= w; j++) {
        if (k - j >= 0) { before += f[k - j]; nb++; }
        if (k + j - 1 < n) { after += f[k + j - 1]; na++; }
      }
      if (!nb || !na) return 0;
      d += (after / na - before / nb) ** 2;
    }
    return Math.sqrt(d);
  };
  const raw: number[] = [0];
  for (let k = 1; k < n; k++) raw.push(0.5 * noveltyAt(k, 2) + noveltyAt(k, 4));
  raw.push(0);
  const nm = mean(raw.slice(1, n));
  const ns = std(raw.slice(1, n), nm) || 1;
  const novelty = raw.map((v, k) => (k === 0 || k === n ? 0 : (v - nm) / ns));

  // ── Cuts: best segmentation of the bar lines ──────────────────────────
  const best = new Array<number>(n + 1).fill(-Infinity);
  const from = new Array<number>(n + 1).fill(-1);
  best[0] = 0;
  for (let j = 1; j <= n; j++) {
    for (let i = Math.max(0, j - MAX_BARS); i <= j - 1; i++) {
      const len = j - i;
      // Shorter than the minimum only at the song's ends (a pickup bar, a tail).
      if (len < MIN_BARS && i !== 0 && j !== n) continue;
      if (!Number.isFinite(best[i])) continue;
      const cut = i === 0 ? 0 : NOVELTY_WEIGHT * novelty[i] - CUT_COST;
      // Phrases are counted from the song's first bar: a cut on the 4-bar
      // grid is worth a little more.
      const grid = i === 0 ? 0 : i % 8 === 0 ? 0.3 : i % 4 === 0 ? 0.15 : 0;
      const ends = i === 0 || j === n ? 0.5 : 1;
      const score = best[i] + cut + grid + ends * phraseScore(len);
      if (score > best[j]) {
        best[j] = score;
        from[j] = i;
      }
    }
  }
  const cuts: number[] = [];
  for (let j = n; j > 0; j = from[j]) cuts.push(j);
  cuts.push(0);
  cuts.reverse();

  // ── Energy per bar and per section ────────────────────────────────────
  const loud = level.map((v, i) => 0.6 * v + 0.25 * kick[i] + 0.15 * Math.min(1, density[i] / 1.5));
  const lo = Math.min(...loud);
  const hi = Math.max(...loud);
  const barEnergy = loud.map((v) => (hi - lo > 1e-6 ? (v - lo) / (hi - lo) : 0.5));
  const dMax = Math.max(...density, 1e-6);
  const barDensity = density.map((v) => v / dMax);

  const spans = [] as Array<{ i: number; j: number; energy: number; rise: number; kick: number; density: number }>;
  for (let c = 0; c < cuts.length - 1; c++) {
    const i = cuts[c];
    const j = cuts[c + 1];
    const e = barEnergy.slice(i, j);
    const q = Math.max(1, Math.floor(e.length / 4));
    const rise = mean(e.slice(e.length - q)) - mean(e.slice(0, q))
      + 0.5 * (mean(barDensity.slice(j - q, j)) - mean(barDensity.slice(i, i + q)));
    spans.push({ i, j, energy: mean(e), rise, kick: mean(kick.slice(i, j)), density: mean(barDensity.slice(i, j)) });
  }
  const eMin = Math.min(...spans.map((s) => s.energy));
  const eMax = Math.max(...spans.map((s) => s.energy));
  const rel = (v: number) => (eMax - eMin > 0.05 ? (v - eMin) / (eMax - eMin) : 0.5);

  // ── Labels ─────────────────────────────────────────────────────────────
  const kinds: SectionKind[] = spans.map(() => 'other');
  const flat = eMax - eMin <= 0.05;
  spans.forEach((s, k) => {
    const e = rel(s.energy);
    if (!flat && e >= 0.72 && s.kick >= 0.25 * Math.max(...spans.map((x) => x.kick))) kinds[k] = 'drop';
  });
  spans.forEach((s, k) => {
    if (kinds[k] !== 'other') return;
    const e = rel(s.energy);
    const nextIsDrop = kinds[k + 1] === 'drop';
    const afterDrop = kinds.slice(0, k).includes('drop');
    if (nextIsDrop && s.rise > 0.08) kinds[k] = 'build';
    else if (k === 0 && (e < 0.5 || flat)) kinds[k] = 'intro';
    else if (k === spans.length - 1 && k > 0 && (e < 0.6 || s.rise < -0.08)) kinds[k] = 'outro';
    else if (afterDrop && e < 0.45) kinds[k] = 'breakdown';
    else if (!kinds.slice(0, k).includes('drop')) kinds[k] = 'verse';
    else kinds[k] = 'bridge';
  });
  // A drop straight after a drop is the same drop going on: merge them.
  const counts: Partial<Record<SectionKind, number>> = {};
  const totals: Partial<Record<SectionKind, number>> = {};
  for (const k of kinds) totals[k] = (totals[k] ?? 0) + 1;
  const sections: DetectedSection[] = spans.map((s, k) => {
    const kind = kinds[k];
    counts[kind] = (counts[kind] ?? 0) + 1;
    const numbered = (totals[kind] ?? 0) > 1 && kind !== 'intro' && kind !== 'outro';
    return {
      start: bars[s.i],
      end: bars[s.j],
      bar: s.i,
      bars: s.j - s.i,
      kind,
      name: numbered ? `${SECTION_KIND_NAMES[kind]} ${counts[kind]}` : SECTION_KIND_NAMES[kind],
      energy: Math.round(rel(s.energy) * 1000) / 1000,
      rise: Math.round(s.rise * 1000) / 1000,
    };
  });
  return { bars, sections, barEnergy, barDensity, novelty };
}
