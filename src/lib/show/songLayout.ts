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

export interface Envelope {
  /** Onset strength per frame. */
  onset: Float32Array;
  /** Where the beat is: the rise in plain (not log) energy of the low and
   *  mid bands, each scaled to its own mean. Kicks and snares rise far more
   *  than an off-beat bass note or hi-hat, which pull a log-energy grid
   *  half a beat off in most dance music. */
  beatOnset: Float32Array;
  /** The two halves of beatOnset: the low band's rise (kicks) and the mid
   *  band's (snares), each over its own mean. */
  lowOnset: Float32Array;
  midOnset: Float32Array;
  /** Log energy per frame and band: low, mid, high. */
  bands: [Float32Array, Float32Array, Float32Array];
  frameRate: number;
}

/**
 * Per-frame energy in three bands (one-pole filters, so it is one pass over
 * the samples) and an onset strength: how much the band energies rose since
 * the previous frame. Kicks show in the low band, snares in the mid, hats
 * in the high; summing the rises catches all three.
 *
 * Built incrementally: the samples can arrive in pieces (a worker is fed a
 * long song a slice at a time), with the filters carried across the cuts,
 * so the result is the same as one pass over the whole song.
 */
export class SongEnvelopeBuilder {
  readonly frames: number;
  private readonly sampleRate: number;
  private readonly bands: [Float32Array, Float32Array, Float32Array];
  private readonly onset: Float32Array;
  private readonly lowJump: Float32Array;
  private readonly midJump: Float32Array;
  private readonly lowCoef: number;
  private readonly highCoef: number;
  private low = 0;
  private belowHigh = 0;
  /** Next frame to fill, and the samples of it seen so far. */
  private f = 0;
  private i = 0;
  private eLow = 0;
  private eMid = 0;
  private eHigh = 0;

  /** `length`: the song's sample count (only whole HOP frames are used). */
  constructor(length: number, sampleRate: number) {
    const frames = Math.floor(length / HOP);
    this.frames = frames;
    this.sampleRate = sampleRate;
    this.bands = [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames)];
    this.onset = new Float32Array(frames);
    this.lowJump = new Float32Array(frames);
    this.midJump = new Float32Array(frames);
    this.lowCoef = 1 - Math.exp((-2 * Math.PI * 200) / sampleRate);
    this.highCoef = 1 - Math.exp((-2 * Math.PI * 3000) / sampleRate);
  }

  /** The next samples of the song, in order. */
  push(samples: Float32Array): void {
    const { frames, lowCoef, highCoef, bands, onset, lowJump, midJump } = this;
    let { low, belowHigh, f, i, eLow, eMid, eHigh } = this;
    const n = samples.length;
    let index = 0;
    while (index < n && f < frames) {
      // The rest of the frame in progress, or as much of it as is here.
      const take = Math.min(HOP - i, n - index);
      for (let k = 0; k < take; k++, index++) {
        const x = samples[index] || 0;
        low += lowCoef * (x - low);
        belowHigh += highCoef * (x - belowHigh);
        const mid = belowHigh - low;
        const high = x - belowHigh;
        eLow += low * low;
        eMid += mid * mid;
        eHigh += high * high;
      }
      i += take;
      if (i < HOP) break;
      bands[0][f] = Math.log10(1e-10 + eLow / HOP);
      bands[1][f] = Math.log10(1e-10 + eMid / HOP);
      lowJump[f] = eLow;
      midJump[f] = eMid;
      bands[2][f] = Math.log10(1e-10 + eHigh / HOP);
      if (f > 0) {
        let rise = 0;
        for (let b = 0; b < 3; b++) rise += Math.max(0, bands[b][f] - bands[b][f - 1]);
        onset[f] = rise;
      }
      f++;
      i = 0;
      eLow = 0;
      eMid = 0;
      eHigh = 0;
    }
    Object.assign(this, { low, belowHigh, f, i, eLow, eMid, eHigh });
  }

  finish(): Envelope {
    const { frames, lowJump, midJump } = this;
    // Energy rises (frame to frame), then each band over its mean rise.
    let lowSum = 0, midSum = 0;
    for (let f = frames - 1; f > 0; f--) {
      lowJump[f] = Math.max(0, lowJump[f] - lowJump[f - 1]);
      midJump[f] = Math.max(0, midJump[f] - midJump[f - 1]);
      lowSum += lowJump[f];
      midSum += midJump[f];
    }
    if (frames) { lowJump[0] = 0; midJump[0] = 0; }
    const beatOnset = new Float32Array(frames);
    const lowScale = lowSum > 0 ? frames / lowSum : 0;
    const midScale = midSum > 0 ? frames / midSum : 0;
    for (let f = 0; f < frames; f++) {
      lowJump[f] *= lowScale;
      midJump[f] *= midScale;
      beatOnset[f] = lowJump[f] + midJump[f];
    }
    return { onset: this.onset, beatOnset, lowOnset: lowJump, midOnset: midJump, bands: this.bands, frameRate: this.sampleRate / HOP };
  }
}

/**
 * Tempo from the onset envelope's autocorrelation, leaning towards 120 BPM so
 * a half or double tempo does not win by a hair. A candidate beat is scored
 * on how well the music repeats one, two and four beats later: the true beat
 * lines up with the bar, while a rhythm inside the bar (the dotted-eighth
 * figure of a breakbeat, say) repeats one step later but not a bar later.
 */
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
  const corr = new Float64Array(4 * maxLag + 2);
  for (let lag = minLag - 1; lag <= 4 * maxLag + 1; lag++) {
    if (lag < 1 || lag >= n) continue;
    let sum = 0;
    for (let i = lag; i < n; i++) sum += centred[i] * centred[i - lag];
    corr[lag] = sum / energy;
  }
  // Correlation at a fractional lag, and its peak within a frame of it (a
  // beat that is not a whole number of frames drifts a frame by the bar).
  const at = (lag: number) => {
    const i = Math.floor(lag);
    const f = lag - i;
    return (corr[i] ?? 0) * (1 - f) + (corr[i + 1] ?? 0) * f;
  };
  const near = (lag: number) => Math.max(at(lag - 1), at(lag - 0.5), at(lag), at(lag + 0.5), at(lag + 1));
  let best = -1, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 0.1) {
    const bpm = (60 * frameRate) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const score = ((at(lag) + near(2 * lag) + near(4 * lag)) / 3) * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // A steady pulse correlates clearly with itself one beat later.
  if (best < 0 || near(best) < 0.08) return null;
  // Settle on the correlation peak next to the chosen lag.
  let period = best;
  for (let lag = best - 1; lag <= best + 1; lag += 0.05) if (at(lag) > at(period)) period = lag;
  return { bpm: (60 * frameRate) / period, period };
}

/** Onset strength the grid `phase + k * period` lands on, frames. */
function gridScore(onset: Float32Array, period: number, phase: number, end = onset.length): number {
  let sum = 0;
  for (let t = phase; t < end; t += period) {
    const i = Math.round(t);
    sum += onset[i] ?? 0;
  }
  return sum;
}

/** The phase (frames) that lands the most onset strength on a grid of `period`. */
function bestPhase(onset: Float32Array, period: number): number {
  const steps = Math.max(1, Math.round(period * 2));
  let best = 0, bestSum = -Infinity;
  for (let s = 0; s < steps; s++) {
    const phase = (s / steps) * period;
    const sum = gridScore(onset, period, phase);
    if (sum > bestSum) {
      bestSum = sum;
      best = phase;
    }
  }
  return best;
}

/** The strongest onset within a couple of frames of `t`. */
function peakNear(onset: Float32Array, t: number): number {
  const i = Math.round(t);
  let m = 0;
  for (let d = -2; d <= 2; d++) {
    const v = onset[i + d];
    if (v !== undefined && v > m) m = v;
  }
  return m;
}

/** Mean onset at each of four beats in turn: beats `phase + (4k + j) * period`. */
function slotMeans(onset: Float32Array, period: number, phase: number): number[] {
  const sums = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  let j = 0;
  for (let t = phase; t < onset.length; t += period, j = (j + 1) % 4) {
    sums[j] += peakNear(onset, t);
    counts[j]++;
  }
  return sums.map((v, i) => (counts[i] ? v / counts[i] : 0));
}

/**
 * A backbeat on the grid `phase + k * period`: a snare on every other beat
 * (2 and 4) and the kick strongest on the beats between (1 and 3). A snare
 * is told from a kick by its mix: more mid band against low band than the
 * kick beats have (a kick's click reaches the mid band too). Returns which
 * beats carry the snare (0: even, 1: odd), or null without a backbeat.
 */
function backbeat(env: Envelope, period: number, phase: number): 0 | 1 | null {
  const mid = slotMeans(env.midOnset, period, phase);
  const low = slotMeans(env.lowOnset, period, phase);
  // Mid over low, smoothed by the bands' mean rise (1): an empty beat is 0.
  const ratio = mid.map((m, j) => m / (low[j] + 1));
  const loudestMid = Math.max(...mid);
  for (const p of [0, 1] as const) {
    const q = (1 - p) as 0 | 1;
    const snareRatio = Math.min(ratio[p], ratio[p + 2]);
    const otherRatio = Math.max(ratio[q], ratio[q + 2]);
    const snareHit = Math.min(mid[p], mid[p + 2]);
    const kickOn = Math.max(low[q], low[q + 2]);
    const kickOff = Math.max(low[p], low[p + 2]);
    if (snareHit > 0.5 && snareHit > 0.3 * loudestMid && snareRatio > 2.5 * otherRatio && kickOn > kickOff) return p;
  }
  return null;
}

/** Tempo range the backbeat check may move a reading into. */
const CHECK_MIN_BPM = 60;
const CHECK_MAX_BPM = 200;

/**
 * Octave and 4/3 check. The autocorrelation cannot tell a half-time reading
 * (drum and bass at 174 read as 87) or a dotted figure (hip-hop at 88 read
 * as 117) from the beat. A backbeat can: at the true tempo the snare lands
 * on every other beat. When the reading shows no backbeat and double, half,
 * 3/4, 4/3, 3/2 or 2/3 of it does, that is the tempo. Returns the period
 * in frames.
 */
function checkTempo(env: Envelope, period: number): number {
  const bpmOf = (p: number) => (60 * env.frameRate) / p;
  // Each reading on its own best grid: the estimate can be a percent off,
  // which smears the beats into each other over a minute.
  const fitted = (p: number) => beatGrid(env.beatOnset, env.frameRate, p);
  const own = fitted(period);
  if (backbeat(env, own.period, own.phase) !== null) return own.period;
  // Periods, so 0.5 is double the tempo; 4/3 and 3/4 undo a dotted
  // figure read as the beat (the 3-beat term), 2/3 and 3/2 the same on top
  // of a half or double reading.
  for (const factor of [0.5, 2, 4 / 3, 3 / 4, 2 / 3, 3 / 2]) {
    const bpm = bpmOf(period * factor);
    if (bpm < CHECK_MIN_BPM || bpm > CHECK_MAX_BPM) continue;
    const grid = fitted(period * factor);
    if (backbeat(env, grid.period, grid.phase) !== null) return grid.period;
  }
  return period;
}

/**
 * The grid's period and phase fitted to the onsets themselves: each beat's
 * nearest onset peak (to a fraction of a frame), weighted by its strength,
 * on a least-squares line. The coarse search steps the period by 0.1%,
 * which is a beat out every 1000 beats; the fit is limited only by how
 * steady the music is.
 */
function refineGrid(onset: Float32Array, period: number, phase: number, end = onset.length): { period: number; phase: number } {
  let p = period, ph = phase;
  for (let pass = 0; pass < 3; pass++) {
    const half = Math.max(1, Math.floor(p * 0.15));
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    let k = 0;
    for (let t = ph; t < end; t += p, k++) {
      const c = Math.round(t);
      let best = -1, bestV = 0;
      for (let i = Math.max(1, c - half); i <= Math.min(onset.length - 2, c + half); i++) {
        if (onset[i] > bestV && onset[i] >= onset[i - 1] && onset[i] >= onset[i + 1]) {
          bestV = onset[i];
          best = i;
        }
      }
      if (best < 0 || !(bestV > 0)) continue;
      // Parabolic peak between frames.
      const a = onset[best - 1], b = onset[best], cc = onset[best + 1];
      const den = a - 2 * b + cc;
      const y = best + (den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - cc)) / den)) : 0);
      const w = bestV;
      sw += w; sx += w * k; sy += w * y; sxx += w * k * k; sxy += w * k * y;
    }
    const det = sw * sxx - sx * sx;
    if (!(sw > 0) || !(det > 1e-9)) break;
    const slope = (sw * sxy - sx * sy) / det;
    const intercept = (sy - slope * sx) / sw;
    // Only a refinement: a fit far from the search's period found something else.
    if (!(Math.abs(slope / period - 1) < 0.005)) break;
    p = slope;
    ph = intercept;
  }
  return { period: p, phase: ph };
}

/** Seconds of the song the coarse grid search looks at. */
const GRID_SEARCH_SECONDS = 90;

/**
 * Beat grid: the period (within 2% of the estimate) and phase that land the
 * most onset strength on the beats. Searching the period as well matters:
 * a period off by a fraction of a frame is a beat off by the end of a song.
 *
 * The search looks at the first minute and a half: over a long mix no step
 * of a 0.1% search stays on the beat to the end, and the best score is then
 * a wrong tempo (a 30-minute track at 127.4 read as 131.4). The fit then
 * follows the beats over a window that doubles until it covers the song.
 */
function beatGrid(onset: Float32Array, frameRate: number, estimate: number): { beats: number[]; period: number; phase: number } {
  const n = onset.length;
  const searchEnd = Math.min(n, Math.round(GRID_SEARCH_SECONDS * frameRate));
  let bestPeriod = estimate, bestPhase = 0, bestSum = -Infinity;
  const search = (period: number) => {
    const steps = Math.max(1, Math.round(period * 2));
    for (let s = 0; s < steps; s++) {
      const phase = (s / steps) * period;
      const sum = gridScore(onset, period, phase, searchEnd);
      if (sum > bestSum) {
        bestSum = sum;
        bestPeriod = period;
        bestPhase = phase;
      }
    }
  };
  for (let k = -20; k <= 20; k++) search(estimate * (1 + k * 0.001));
  let fit = { period: bestPeriod, phase: bestPhase };
  for (let end = searchEnd; ; end = Math.min(n, end * 2)) {
    fit = refineGrid(onset, fit.period, fit.phase, end);
    if (end >= n) break;
  }
  return { ...gridBeats(n, frameRate, fit.period, fit.phase), period: fit.period, phase: fit.phase };
}

/** Beat times for a grid, from the first beat at or just before the start. */
function gridBeats(n: number, frameRate: number, period: number, phase: number): { beats: number[] } {
  // A beat a frame or two before the start (the song's first downbeat at
  // 0, detected a hair late) still counts, at 0.
  let first = phase;
  while (first - period >= -2) first -= period;
  while (first < -2) first += period;
  const beats: number[] = [];
  for (let k = 0; ; k++) {
    const t = first + k * period;
    if (t >= n) break;
    beats.push(Math.max(0, t) / frameRate);
  }
  return { beats };
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
  if (!songIsAnalysable(mono.length, sampleRate)) return analyzeSongEnvelope(null, mono.length, sampleRate, options);
  const builder = new SongEnvelopeBuilder(mono.length, sampleRate);
  builder.push(mono);
  return analyzeSongEnvelope(builder.finish(), mono.length, sampleRate, options);
}

/** False for a song too short (or with no rate) to analyse: no envelope is needed then. */
export function songIsAnalysable(length: number, sampleRate: number): boolean {
  const duration = sampleRate > 0 ? length / sampleRate : 0;
  return duration > 0 && length >= HOP * 4;
}

/**
 * The analysis of a song of `length` samples from its envelope (see
 * SongEnvelopeBuilder); `env` may be null when !songIsAnalysable.
 */
export function analyzeSongEnvelope(env: Envelope | null, length: number, sampleRate: number, options: SongAnalysisOptions = {}): SongAnalysis {
  const duration = sampleRate > 0 ? length / sampleRate : 0;
  const minSection = Math.max(1, options.minSection ?? 8);
  const maxSection = Math.max(minSection * 2, options.maxSection ?? 45);
  const targetSection = Math.max(minSection, options.targetSection ?? 24);
  if (!env || !songIsAnalysable(length, sampleRate)) return { tempo: null, beats: [], sections: [], duration };

  const estimate = estimateTempo(env.onset, env.frameRate);
  let beatEnergy = 0;
  for (let i = 0; i < env.beatOnset.length; i++) beatEnergy += env.beatOnset[i];
  const beatOnset = beatEnergy > 1e-6 ? env.beatOnset : env.onset;
  let grid = estimate ? beatGrid(beatOnset, env.frameRate, beatEnergy > 1e-6 ? checkTempo(env, estimate.period) : estimate.period) : null;
  // With a backbeat, the first beat is a kick beat (1 or 3), never the
  // snare: bar 1 then starts on a beat that can be a downbeat.
  if (grid && beatEnergy > 1e-6) {
    const snareBeats = backbeat(env, grid.period, grid.phase);
    if (snareBeats !== null) {
      const firstIndex = Math.round((grid.beats[0] * env.frameRate - grid.phase) / grid.period);
      if (((firstIndex % 2) + 2) % 2 === snareBeats) {
        const phase = grid.phase + grid.period;
        grid = { ...gridBeats(env.beatOnset.length, env.frameRate, grid.period, phase), period: grid.period, phase };
        // gridBeats starts from the earliest beat; drop the snare beat before it.
        const idx = Math.round((grid.beats[0] * env.frameRate - grid.phase) / grid.period);
        if (((idx % 2) + 2) % 2 === snareBeats) grid.beats.shift();
      }
    }
  }
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
