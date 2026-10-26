/**
 * Laying looks out over a song: "New show from audio".
 *
 * Three ways to fill the preset lane under one song:
 *  - keep:     no preset clips. The show plays the song and whatever is on
 *              screen stays there (a gap on the preset lane holds the
 *              picture), so the show simply runs for the length of the song.
 *  - even:     the chosen presets share the song in equal parts.
 *  - sections: a cut wherever the music changes section, landed on the
 *              beat, cycling through the chosen presets.
 *
 * Everything here is pure: plain numbers in, plain numbers out. The song is
 * analysed offline from the decoded mono PCM the waveform already needs, so
 * no AudioContext and no playback are involved, and the tests can feed it
 * synthetic signals.
 */

export type SongLayoutMode = 'keep' | 'even' | 'sections';

export interface SongLayoutPreset {
  id: string;
  name?: string;
}

export interface SongLayoutClip {
  compositionId: string;
  startTime: number;
  duration: number;
  label?: string;
}

/** Shortest clip the layouts produce, seconds (the show's own minimum). */
export const SONG_MIN_CLIP_SECONDS = 0.25;
/** Grid the even layout's cut points are kept on, seconds. */
export const SONG_LAYOUT_SNAP = 0.25;

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function cleanDuration(songDuration: number): number {
  return Number.isFinite(songDuration) && songDuration > 0 ? songDuration : 0;
}

/**
 * Clips for the given cut points: [0, b1), [b1, b2) … [bn, end), with the
 * presets cycling. Cut points outside the song, out of order or closer than
 * the minimum clip length are dropped. Neighbours that would show the same
 * preset are merged, so one preset over three sections is one clip.
 */
export function layoutOnBoundaries(
  presets: SongLayoutPreset[],
  boundaries: number[],
  songDuration: number,
): SongLayoutClip[] {
  const end = cleanDuration(songDuration);
  if (presets.length === 0 || end <= 0) return [];
  const cuts: number[] = [];
  let last = 0;
  for (const raw of [...boundaries].filter(Number.isFinite).sort((a, b) => a - b)) {
    if (raw - last < SONG_MIN_CLIP_SECONDS || end - raw < SONG_MIN_CLIP_SECONDS) continue;
    cuts.push(raw);
    last = raw;
  }
  const edges = [0, ...cuts, end];
  const clips: SongLayoutClip[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const preset = presets[i % presets.length];
    const startTime = edges[i];
    const duration = edges[i + 1] - edges[i];
    const prev = clips[clips.length - 1];
    if (prev && prev.compositionId === preset.id) {
      prev.duration += duration;
      continue;
    }
    clips.push({ compositionId: preset.id, startTime, duration, label: preset.name });
  }
  return clips;
}

/** The chosen presets share the song equally, cut points on a 0.25 s grid. */
export function layoutEvenly(presets: SongLayoutPreset[], songDuration: number): SongLayoutClip[] {
  const end = cleanDuration(songDuration);
  if (presets.length === 0 || end <= 0) return [];
  const count = Math.max(1, Math.min(presets.length, Math.floor(end / SONG_MIN_CLIP_SECONDS)));
  const used = presets.slice(0, count);
  const boundaries: number[] = [];
  for (let i = 1; i < count; i++) boundaries.push(roundTo((end * i) / count, SONG_LAYOUT_SNAP));
  return layoutOnBoundaries(used, boundaries, end);
}

export function layoutSong(
  mode: SongLayoutMode,
  presets: SongLayoutPreset[],
  songDuration: number,
  sectionBoundaries: number[] = [],
): SongLayoutClip[] {
  if (mode === 'keep') return [];
  if (mode === 'even') return layoutEvenly(presets, songDuration);
  return layoutOnBoundaries(presets, sectionBoundaries, songDuration);
}

// ─── Analysis ────────────────────────────────────────────────────────────

export interface SongAnalysis {
  /** Beats per minute, or null when the song has no steady pulse. */
  tempo: number | null;
  /** Beat times, seconds. Empty without a tempo. */
  beats: number[];
  /** Where the sections change, seconds, in order, not including 0 or the end. */
  sections: number[];
  duration: number;
}

export interface SongAnalysisOptions {
  /** A section is never shorter than this, seconds. */
  minSection?: number;
  /** Longer stretches are split on the phrase grid, seconds. */
  maxSection?: number;
  /** Roughly how long a section is: the number of changes looked for follows the song length. */
  targetSection?: number;
}

/** Samples per analysis frame at 44.1/48 kHz: about 10 ms. */
const HOP = 512;
const MIN_BPM = 70;
const MAX_BPM = 180;
/** Seconds per feature block for the section search. */
const BLOCK_SECONDS = 0.5;

interface Envelope {
  /** Onset strength per frame. */
  onset: Float32Array;
  /** Log energy per frame and band: low, mid, high. */
  bands: [Float32Array, Float32Array, Float32Array];
  frameRate: number;
}

/**
 * Per-frame energy in three bands (one-pole filters, so it is one pass over
 * the samples) and an onset strength: how much the band energies rose since
 * the previous frame. Kicks show in the low band, snares in the mid, hats
 * in the high; summing the rises catches all three.
 */
function envelope(mono: Float32Array, sampleRate: number): Envelope {
  const frames = Math.floor(mono.length / HOP);
  const bands: [Float32Array, Float32Array, Float32Array] = [
    new Float32Array(frames),
    new Float32Array(frames),
    new Float32Array(frames),
  ];
  const onset = new Float32Array(frames);
  const lowCoef = 1 - Math.exp((-2 * Math.PI * 200) / sampleRate);
  const highCoef = 1 - Math.exp((-2 * Math.PI * 3000) / sampleRate);
  let low = 0, belowHigh = 0;
  let index = 0;
  for (let f = 0; f < frames; f++) {
    let eLow = 0, eMid = 0, eHigh = 0;
    for (let i = 0; i < HOP; i++, index++) {
      const x = mono[index] || 0;
      low += lowCoef * (x - low);
      belowHigh += highCoef * (x - belowHigh);
      const mid = belowHigh - low;
      const high = x - belowHigh;
      eLow += low * low;
      eMid += mid * mid;
      eHigh += high * high;
    }
    bands[0][f] = Math.log10(1e-10 + eLow / HOP);
    bands[1][f] = Math.log10(1e-10 + eMid / HOP);
    bands[2][f] = Math.log10(1e-10 + eHigh / HOP);
    if (f > 0) {
      let rise = 0;
      for (let b = 0; b < 3; b++) rise += Math.max(0, bands[b][f] - bands[b][f - 1]);
      onset[f] = rise;
    }
  }
  return { onset, bands, frameRate: sampleRate / HOP };
}

/** Tempo from the onset envelope's autocorrelation, leaning towards 120 BPM so a half or double tempo does not win by a hair. */
function estimateTempo(onset: Float32Array, frameRate: number): { bpm: number; period: number } | null {
  const n = onset.length;
  if (n < frameRate * 4) return null;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += onset[i];
  mean /= n;
  const centred = new Float32Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    centred[i] = onset[i] - mean;
    energy += centred[i] * centred[i];
  }
  if (energy <= 1e-9) return null;
  const minLag = Math.max(2, Math.floor((60 * frameRate) / MAX_BPM));
  const maxLag = Math.min(n - 1, Math.ceil((60 * frameRate) / MIN_BPM));
  const corr = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    if (lag < 1 || lag >= n) continue;
    let sum = 0;
    for (let i = lag; i < n; i++) sum += centred[i] * centred[i - lag];
    corr[lag] = sum / energy;
  }
  let best = -1, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * frameRate) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const score = corr[lag] * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // A steady pulse correlates clearly with itself one beat later.
  if (best < 0 || corr[best] < 0.08) return null;
  // Parabolic interpolation for a fractional period.
  const a = corr[best - 1] ?? corr[best];
  const b = corr[best];
  const c = corr[best + 1] ?? corr[best];
  const denom = a - 2 * b + c;
  const shift = Math.abs(denom) > 1e-12 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  const period = best + shift;
  return { bpm: (60 * frameRate) / period, period };
}

/** Onset strength the grid `phase + k * period` lands on, frames. */
function gridScore(onset: Float32Array, period: number, phase: number): number {
  let sum = 0;
  for (let t = phase; t < onset.length; t += period) {
    const i = Math.round(t);
    sum += onset[i] ?? 0;
  }
  return sum;
}

/**
 * Beat grid: the period (within 2% of the estimate) and phase that land the
 * most onset strength on the beats. Searching the period as well matters:
 * a period off by a fraction of a frame is a beat off by the end of a song.
 */
function beatGrid(onset: Float32Array, frameRate: number, estimate: number): { beats: number[]; period: number } {
  const n = onset.length;
  let bestPeriod = estimate, bestPhase = 0, bestSum = -Infinity;
  const search = (period: number) => {
    const steps = Math.max(1, Math.round(period * 2));
    for (let s = 0; s < steps; s++) {
      const phase = (s / steps) * period;
      const sum = gridScore(onset, period, phase);
      if (sum > bestSum) {
        bestSum = sum;
        bestPeriod = period;
        bestPhase = phase;
      }
    }
  };
  for (let k = -20; k <= 20; k++) search(estimate * (1 + k * 0.001));
  const beats: number[] = [];
  for (let t = bestPhase; t < n; t += bestPeriod) beats.push(t / frameRate);
  return { beats, period: bestPeriod };
}

function meanStd(values: Float32Array | number[]): { mean: number; std: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0 };
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i];
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (values[i] - mean) * (values[i] - mean);
  return { mean, std: Math.sqrt(sq / n) };
}

/**
 * Section changes from a novelty curve: at each half-second block, how
 * different the music in the seconds before it is from the seconds after
 * it (band loudness and how busy it is). Peaks of that curve, far enough
 * apart, are the section changes.
 */
function noveltyBoundaries(env: Envelope, duration: number, minSection: number, targetSection: number): number[] {
  const perBlock = Math.max(1, Math.round(env.frameRate * BLOCK_SECONDS));
  const blocks = Math.floor(env.onset.length / perBlock);
  if (blocks < 4) return [];
  const features: Float32Array[] = [0, 1, 2, 3].map(() => new Float32Array(blocks));
  for (let k = 0; k < blocks; k++) {
    for (let f = k * perBlock; f < (k + 1) * perBlock; f++) {
      features[0][k] += env.bands[0][f];
      features[1][k] += env.bands[1][f];
      features[2][k] += env.bands[2][f];
      features[3][k] += env.onset[f];
    }
    for (const feature of features) feature[k] /= perBlock;
  }
  // Each feature in units of its own spread, so a loud band does not drown the rest.
  for (const feature of features) {
    const { mean, std } = meanStd(feature);
    for (let k = 0; k < blocks; k++) feature[k] = std > 1e-9 ? (feature[k] - mean) / std : 0;
  }
  const half = Math.max(2, Math.round(Math.min(8, minSection) / BLOCK_SECONDS));
  const novelty = new Float32Array(blocks);
  for (let k = half; k <= blocks - half; k++) {
    let distance = 0;
    for (const feature of features) {
      let before = 0, after = 0;
      for (let j = 1; j <= half; j++) {
        before += feature[k - j];
        after += feature[k + j - 1];
      }
      const d = (after - before) / half;
      distance += d * d;
    }
    novelty[k] = Math.sqrt(distance);
  }
  // Peaks of the curve that stand above its average are the candidates.
  const { mean } = meanStd(novelty);
  const candidates: { time: number; strength: number }[] = [];
  for (let k = 1; k < blocks - 1; k++) {
    const v = novelty[k];
    if (v <= mean || v < novelty[k - 1] || v < novelty[k + 1]) continue;
    const time = k * BLOCK_SECONDS;
    if (time < minSection || duration - time < minSection) continue;
    candidates.push({ time, strength: v });
  }
  // About one change per `targetSection` seconds: the strongest ones, and a
  // weaker change too close to a stronger one is the same change.
  const wanted = Math.max(0, Math.round(duration / targetSection) - 1);
  candidates.sort((a, b) => b.strength - a.strength);
  const chosen: number[] = [];
  for (const c of candidates) {
    if (chosen.length >= wanted) break;
    if (chosen.every((t) => Math.abs(t - c.time) >= minSection)) chosen.push(c.time);
  }
  return chosen.sort((a, b) => a - b);
}

function nearest(values: number[], target: number): number | null {
  let best: number | null = null;
  for (const v of values) if (best === null || Math.abs(v - target) < Math.abs(best - target)) best = v;
  return best;
}

/**
 * Splits any section longer than `maxSection` into equal parts on the phrase
 * grid (eight bars when the tempo is known), so a song without clear section
 * changes still changes look now and then.
 */
function splitLongSections(cuts: number[], duration: number, maxSection: number, phrase: number | null): number[] {
  const edges = [0, ...cuts, duration];
  const out: number[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const start = edges[i];
    const length = edges[i + 1] - start;
    if (i > 0) out.push(start);
    if (length <= maxSection) continue;
    const parts = Math.ceil(length / maxSection);
    for (let p = 1; p < parts; p++) {
      let cut = start + (length * p) / parts;
      if (phrase && phrase > 0) cut = start + Math.max(1, Math.round((cut - start) / phrase)) * phrase;
      if (cut > start + SONG_MIN_CLIP_SECONDS && cut < edges[i + 1] - SONG_MIN_CLIP_SECONDS) out.push(cut);
    }
  }
  return [...new Set(out.map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b);
}

/**
 * Tempo, beats and section changes of a song, from its mono PCM.
 *
 * Section changes land on the nearest beat when there is a tempo. Sections
 * are kept between `minSection` (default 8 s) and roughly `maxSection`
 * (default 45 s): longer stretches are split on an eight-bar phrase grid.
 */
export function analyzeSong(mono: Float32Array, sampleRate: number, options: SongAnalysisOptions = {}): SongAnalysis {
  const duration = sampleRate > 0 ? mono.length / sampleRate : 0;
  const minSection = Math.max(1, options.minSection ?? 8);
  const maxSection = Math.max(minSection * 2, options.maxSection ?? 45);
  const targetSection = Math.max(minSection, options.targetSection ?? 24);
  if (!(duration > 0) || mono.length < HOP * 4) return { tempo: null, beats: [], sections: [], duration };

  const env = envelope(mono, sampleRate);
  const estimate = estimateTempo(env.onset, env.frameRate);
  const grid = estimate ? beatGrid(env.onset, env.frameRate, estimate.period) : null;
  const beats = grid?.beats ?? [];
  const bpm = grid ? (60 * env.frameRate) / grid.period : null;
  const beatSeconds = bpm ? 60 / bpm : null;

  let cuts = noveltyBoundaries(env, duration, minSection, targetSection);
  if (beats.length > 0) {
    cuts = cuts.map((t) => nearest(beats, t) ?? t);
  }
  const phrase = beatSeconds ? beatSeconds * 32 : null;
  cuts = splitLongSections(cuts, duration, maxSection, phrase);
  if (beats.length > 0) cuts = cuts.map((t) => nearest(beats, t) ?? t);
  const sections = [...new Set(cuts.map((t) => Math.round(t * 1000) / 1000))]
    .filter((t) => t >= SONG_MIN_CLIP_SECONDS && duration - t >= SONG_MIN_CLIP_SECONDS)
    .sort((a, b) => a - b);

  return {
    tempo: bpm ? Math.round(bpm * 10) / 10 : null,
    beats,
    sections,
    duration,
  };
}
