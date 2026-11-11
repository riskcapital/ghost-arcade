/**
 * Music features of a song file, analysed once (offline) and cached, so a
 * line that follows the music reads the same value at the same show time
 * whether the show is scrubbed, played or exported. Live analyser input is
 * never used for these lines.
 *
 * Features, each 0..1 per analysis frame (~10 ms):
 *   level   loudness (all bands)
 *   energy  loudness over a couple of seconds (the song's intensity curve)
 *   bass / mid / high   band loudness
 *   kick / snare / hats  hits in the low / mid / high band, with a short decay
 *
 * Stems (drums / bass / vocals / other): real stems when the set has them
 * (`stems`), otherwise a band stand-in until stem separation lands.
 *
 * Built on the song analysis's envelope pass (show/songLayout.ts).
 */
import { SongEnvelopeBuilder, type Envelope } from '../../show/songLayout';
import { songEnvelopeOffThread } from '../../show/songAnalysisClient';

export const AUDIO_FEATURES = ['level', 'energy', 'bass', 'mid', 'high', 'kick', 'snare', 'hats'] as const;
export type AudioFeature = (typeof AUDIO_FEATURES)[number];
export const STEMS = ['drums', 'bass', 'vocals', 'other'] as const;
export type Stem = (typeof STEMS)[number];

export interface SongFeatures {
  frameRate: number;
  frames: number;
  duration: number;
  features: Record<AudioFeature, Float32Array>;
  /** Real stems' levels (0..1 per frame) when the song has them. */
  stems?: Partial<Record<Stem, Float32Array>>;
  /** Song-wide measures the per-frame features (each scaled to the song)
   *  lose: how loud, how wide its dynamics, how much low end. */
  stats?: SongStats;
}

export interface SongStats {
  /** Mean loudness of the frames that sound, dB (energy, full scale ≈ 0). */
  loudDb: number;
  /** How far apart its quiet and loud parts are: the 95th minus the 10th
   *  percentile of loudness over the frames that sound, dB. */
  rangeDb: number;
  /** Share of the energy in the low band over the frames that sound, 0..1. */
  lowShare: number;
  /** Hits per second: sudden jumps in loudness (6 dB or more summed over
   *  the bands within a frame) while the song sounds. Pads and swells make
   *  none; drums one per hit. */
  hitRate: number;
  /** How hard the hits land: the median jump of those hits, dB. */
  punchDb: number;
  /** How regular the beat is: how well the kick-and-snare rises repeat
   *  themselves at the best beat length between 60 and 200 BPM, 0..1. */
  pulse: number;
  /** When the hits are (song seconds). */
  hits: Float32Array;
  /** When the low band jumps hard (kicks, bass hits; song seconds). */
  lowHits: Float32Array;
}

const HIT_JUMP = 0.6;
const LOW_HIT = 6;

/** Song-wide loudness, dynamics, low end and hits from the envelope (log energies). */
export function songStatsFromEnvelope(env: Pick<Envelope, 'bands'> & Partial<Pick<Envelope, 'onset' | 'beatOnset' | 'lowOnset' | 'frameRate'>>): SongStats {
  const [low, mid, high] = env.bands;
  const n = low.length;
  const none: SongStats = { loudDb: -120, rangeDb: 0, lowShare: 0, hitRate: 0, punchDb: 0, pulse: 0, hits: new Float32Array(0), lowHits: new Float32Array(0) };
  if (!n) return none;
  const loud = new Float32Array(n);
  for (let i = 0; i < n; i++) loud[i] = Math.log10(1e-12 + 10 ** low[i] + 10 ** mid[i] + 10 ** high[i]);
  // Frames within 50 dB of the loudest sound; silence and fades out of it do not count.
  const top = quantile(loud, 0.99);
  const sounding: number[] = [];
  let lowSum = 0;
  let allSum = 0;
  let loudSum = 0;
  for (let i = 0; i < n; i++) {
    if (loud[i] < top - 5) continue;
    sounding.push(loud[i]);
    loudSum += loud[i];
    const l = 10 ** low[i];
    lowSum += l;
    allSum += l + 10 ** mid[i] + 10 ** high[i];
  }
  if (!sounding.length) return none;
  const round = (v: number) => Math.round(v * 100) / 100;
  const fr = env.frameRate ?? 100;
  // Hits: local peaks of the summed rise over HIT_JUMP, 60 ms apart at least.
  const onset = env.onset;
  const peakTimes = (curve: Float32Array | undefined, threshold: number, heights?: number[]): Float32Array => {
    const times: number[] = [];
    if (!curve) return new Float32Array(0);
    const gap = Math.max(1, Math.round(0.06 * fr));
    let last = -Infinity;
    for (let i = 1; i < curve.length - 1; i++) {
      const v = curve[i];
      if (v < threshold || v < curve[i - 1] || v < curve[i + 1] || loud[i] < top - 5) continue;
      if (i - last < gap) continue;
      heights?.push(v);
      times.push(i / fr);
      last = i;
    }
    return Float32Array.from(times);
  };
  const peaks: number[] = [];
  const hits = peakTimes(onset, HIT_JUMP, peaks);
  // The low band's jump over its mean (1): a kick is many times the mean.
  const lowHits = peakTimes(env.lowOnset, LOW_HIT);
  return {
    loudDb: round((10 * loudSum) / sounding.length),
    rangeDb: round(10 * (quantile(sounding, 0.95) - quantile(sounding, 0.1))),
    lowShare: round(allSum > 0 ? lowSum / allSum : 0),
    hitRate: round(peaks.length / Math.max(1, sounding.length / fr)),
    punchDb: round(10 * quantile(peaks, 0.5)),
    pulse: round(env.beatOnset ? pulseStrength(env.beatOnset, fr) : 0),
    hits,
    lowHits,
  };
}

/** Normalised self-similarity of an onset curve one beat later, at the best
 *  beat length between 60 and 200 BPM (the same beat two beats later too). */
function pulseStrength(onset: Float32Array, frameRate: number): number {
  const n = onset.length;
  if (n < frameRate * 4) return 0;
  // Two minutes at most: the middle of a long song says enough.
  const from = Math.max(0, Math.floor(n / 2 - 60 * frameRate));
  const to = Math.min(n, from + Math.floor(120 * frameRate));
  let mean = 0;
  for (let i = from; i < to; i++) mean += onset[i];
  mean /= Math.max(1, to - from);
  let energy = 0;
  for (let i = from; i < to; i++) energy += (onset[i] - mean) ** 2;
  if (energy <= 1e-9) return 0;
  const minLag = Math.max(2, Math.floor((60 * frameRate) / 200));
  const maxLag = Math.ceil((60 * frameRate) / 60);
  const corr = new Float64Array(2 * maxLag + 2);
  for (let lag = minLag - 1; lag <= 2 * maxLag + 1; lag++) {
    let sum = 0;
    for (let i = from + lag; i < to; i++) sum += (onset[i] - mean) * (onset[i - lag] - mean);
    corr[lag] = sum / energy;
  }
  const near = (l: number) => Math.max(corr[l - 1], corr[l], corr[l + 1]);
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) best = Math.max(best, Math.min(near(lag), near(2 * lag)));
  return Math.max(0, Math.min(1, best));
}

/** Hit envelope decay, seconds to fall to ~37 %. */
const KICK_DECAY = 0.16;
const SNARE_DECAY = 0.14;
const HATS_DECAY = 0.07;
const ENERGY_WINDOW = 2;

/** Value at quantile q of `data` (sampled, so a long song stays cheap). */
function quantile(data: ArrayLike<number>, q: number): number {
  const n = data.length;
  if (!n) return 0;
  const stride = Math.max(1, Math.floor(n / 20000));
  const sample: number[] = [];
  for (let i = 0; i < n; i += stride) sample.push(data[i]);
  sample.sort((a, b) => a - b);
  return sample[Math.min(sample.length - 1, Math.max(0, Math.floor(q * (sample.length - 1))))];
}

/** Rescale so the q-low quantile is 0 and the q-high one is 1, clamped. */
function normalize(data: Float32Array, lo = 0.05, hi = 0.98): Float32Array {
  const a = quantile(data, lo);
  const b = quantile(data, hi);
  const span = b - a;
  const out = new Float32Array(data.length);
  if (!(span > 1e-9)) return out;
  for (let i = 0; i < data.length; i++) out[i] = Math.max(0, Math.min(1, (data[i] - a) / span));
  return out;
}

/** Impulses -> peaks that decay exponentially. */
function hitEnvelope(onset: ArrayLike<number>, frameRate: number, decaySeconds: number): Float32Array {
  const n = onset.length;
  const scale = quantile(onset, 0.985) || 1;
  const k = Math.exp(-1 / Math.max(1, decaySeconds * frameRate));
  const out = new Float32Array(n);
  let env = 0;
  for (let i = 0; i < n; i++) {
    env = Math.max(env * k, Math.min(1, Math.max(0, onset[i]) / scale));
    out[i] = env;
  }
  return out;
}

function boxSmooth(data: Float32Array, frames: number): Float32Array {
  const half = Math.max(1, Math.round(frames / 2));
  const n = data.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + data[i];
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    out[i] = (prefix[b] - prefix[a]) / (b - a);
  }
  return out;
}

export function songFeaturesFromEnvelope(env: Envelope): SongFeatures {
  const frames = env.onset.length;
  const fr = env.frameRate;
  const [low, mid, high] = env.bands;
  const loud = new Float32Array(frames);
  const highRise = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    loud[i] = Math.log10(1e-10 + 10 ** low[i] + 10 ** mid[i] + 10 ** high[i]);
    highRise[i] = i > 0 ? Math.max(0, high[i] - high[i - 1]) : 0;
  }
  const level = normalize(loud);
  return {
    frameRate: fr,
    frames,
    duration: frames / fr,
    stats: songStatsFromEnvelope(env),
    features: {
      level,
      energy: normalize(boxSmooth(level, ENERGY_WINDOW * fr), 0.02, 0.995),
      bass: normalize(low),
      mid: normalize(mid),
      high: normalize(high),
      kick: hitEnvelope(env.lowOnset, fr, KICK_DECAY),
      snare: hitEnvelope(env.midOnset, fr, SNARE_DECAY),
      hats: hitEnvelope(highRise, fr, HATS_DECAY),
    },
  };
}

/** Analyse decoded mono samples. Pure; a 5 min song takes well under a second. */
export function analyzeSongFeatures(mono: Float32Array, sampleRate: number): SongFeatures {
  const builder = new SongEnvelopeBuilder(mono.length, sampleRate);
  builder.push(mono);
  return songFeaturesFromEnvelope(builder.finish());
}

/** The stand-in a stem reads until real stems exist. */
export function stemFeature(stem: Stem): AudioFeature | 'drums' {
  return stem === 'drums' ? 'drums' : stem === 'bass' ? 'bass' : stem === 'vocals' ? 'mid' : 'high';
}

// ── Sampling ─────────────────────────────────────────────────────────────

const prefixCache = new WeakMap<Float32Array, Float64Array>();
function prefixOf(data: Float32Array): Float64Array {
  let p = prefixCache.get(data);
  if (!p) {
    p = new Float64Array(data.length + 1);
    for (let i = 0; i < data.length; i++) p[i + 1] = p[i] + data[i];
    prefixCache.set(data, p);
  }
  return p;
}

/**
 * `data` at song time `seconds`: linear between frames, or the mean over a
 * `smooth`-second window centred there (constant time, from prefix sums).
 * Outside the song: 0.
 */
export function sampleSeries(data: Float32Array, frameRate: number, seconds: number, smooth = 0): number {
  const n = data.length;
  if (!n || !(seconds >= 0)) return 0;
  const x = seconds * frameRate;
  if (x > n - 1) return 0;
  if (smooth > 0) {
    const half = (smooth * frameRate) / 2;
    if (half >= 1) {
      const a = Math.max(0, Math.floor(x - half));
      const b = Math.min(n, Math.ceil(x + half) + 1);
      const p = prefixOf(data);
      return (p[b] - p[a]) / (b - a);
    }
  }
  const i = Math.floor(x);
  const f = x - i;
  return i + 1 < n ? data[i] + (data[i + 1] - data[i]) * f : data[i];
}

export function sampleFeature(song: SongFeatures, feature: AudioFeature, seconds: number, smooth = 0): number {
  return sampleSeries(song.features[feature], song.frameRate, seconds, smooth);
}

export function sampleStem(song: SongFeatures, stem: Stem, seconds: number, smooth = 0): number {
  const real = song.stems?.[stem];
  if (real) return sampleSeries(real, song.frameRate, seconds, smooth);
  const f = stemFeature(stem);
  if (f !== 'drums') return sampleFeature(song, f, seconds, smooth);
  return Math.max(
    sampleFeature(song, 'kick', seconds, smooth),
    sampleFeature(song, 'snare', seconds, smooth),
    sampleFeature(song, 'hats', seconds, smooth),
  );
}

// ── Cache ────────────────────────────────────────────────────────────────

/** Analysed songs by key (the audio file's URL); a few at a time. */
const CACHE_LIMIT = 8;
const cache = new Map<string, SongFeatures>();
const pending = new Map<string, Promise<SongFeatures | null>>();
let analyses = 0;

/** How many analyses have run (tests prove the cache holds). */
export function songFeatureAnalysisCount(): number {
  return analyses;
}

export function cachedSongFeatures(key: string): SongFeatures | null {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit ?? null;
}

export function putSongFeatures(key: string, features: SongFeatures): void {
  cache.delete(key);
  cache.set(key, features);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

/**
 * The features for `key`, analysed at most once: `load` decodes the audio
 * (mono samples + rate) and is called only on a miss.
 */
export function songFeaturesFor(
  key: string,
  load: () => Promise<{ mono: Float32Array; sampleRate: number } | null>,
): Promise<SongFeatures | null> {
  const hit = cachedSongFeatures(key);
  if (hit) return Promise.resolve(hit);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const job = (async () => {
    try {
      const decoded = await load();
      if (!decoded) return null;
      analyses++;
      // The envelope pass walks every sample: in a worker, so a long song
      // does not stall the page (same result as analyzeSongFeatures).
      const features = songFeaturesFromEnvelope(await songEnvelopeOffThread(decoded.mono, decoded.sampleRate));
      putSongFeatures(key, features);
      return features;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, job);
  return job;
}

export function clearSongFeatureCache(): void {
  cache.clear();
  pending.clear();
}
