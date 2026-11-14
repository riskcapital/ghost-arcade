/**
 * The song analysis reads the same tempo at every sample rate. It used to
 * step 512 samples at any rate, so a song was analysed at 43, 86 or 94
 * frames a second and a 128 BPM song read as 102.4 at 44.1 kHz.
 */
import { describe, expect, it } from 'vitest';
import { analyzeSong, analysisHop, ANALYSIS_STEP, SongEnvelopeBuilder } from './songLayout';
// @ts-expect-error plain JS fixture generator
import { styleSong } from '../../../scripts/show-runner/styleSongs.mjs';

const RATES = [22050, 44100, 48000, 96000];

type Pattern = 'four' | 'breaks' | 'hiphop';

/**
 * Noise made of fixed partials (random phases, seeded) between `lo` and `hi`
 * Hz: the same sound at every sample rate. (Per-sample white noise is not:
 * at 96 kHz half its power is above 24 kHz, so the hats and snare would be
 * another mix at each rate.)
 */
function bandNoise(lo: number, hi: number, partials: number, seed: number): (t: number) => number {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const parts = Array.from({ length: partials }, () => ({ f: lo + (hi - lo) * rnd(), p: 2 * Math.PI * rnd() }));
  const scale = Math.sqrt(2 / partials);
  return (t) => {
    let v = 0;
    for (const { f, p } of parts) v += Math.sin(2 * Math.PI * f * t + p);
    return v * scale;
  };
}

/** Kick, snare (band noise and a 190 Hz body), hats (high band noise); peak 0.9 (nothing clips). */
function drumSong(bpm: number, pattern: Pattern, rate: number, seconds = 32): Float32Array {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  const add = (t0: number, dur: number, fn: (t: number) => number) => {
    const a = Math.max(0, Math.round(t0 * rate));
    const b = Math.min(n, Math.round((t0 + dur) * rate));
    for (let i = a; i < b; i++) out[i] += fn((i - a) / rate);
  };
  const snareNoise = bandNoise(300, 4000, 48, 3);
  const hatNoise = bandNoise(5000, 10000, 48, 5);
  const kick = (t0: number) => add(t0, 0.25, (t) => 0.9 * Math.exp(-t * 14) * Math.sin(2 * Math.PI * (50 * t + (100 * (1 - Math.exp(-t * 35))) / 35)));
  const snare = (t0: number) => add(t0, 0.18, (t) => 0.7 * Math.exp(-t * 22) * (snareNoise(t0 + t) + 0.5 * Math.sin(2 * Math.PI * 190 * t)));
  const hat = (t0: number) => add(t0, 0.04, (t) => 0.15 * Math.exp(-t * 90) * hatNoise(t0 + t));
  const beat = 60 / bpm;
  for (let b = 0; b * beat < seconds; b++) {
    const t = b * beat;
    const inBar = b % 4;
    if (pattern === 'four') {
      kick(t);
      if (inBar === 1 || inBar === 3) snare(t);
      hat(t + beat / 2);
    } else {
      // breaks: kick on 1 and the "and" of 3; hip-hop: kick on 1, the "and" of 2, and 3.
      if (inBar === 0) kick(t);
      if (pattern === 'breaks' && inBar === 2) kick(t + beat / 2);
      if (pattern === 'hiphop' && inBar === 1) kick(t + beat / 2);
      if (pattern === 'hiphop' && inBar === 2) kick(t);
      if (inBar === 1 || inBar === 3) snare(t);
      hat(t); hat(t + beat / 2);
    }
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] *= 0.9 / (peak || 1);
  return out;
}

/** A style fixture normalised to peak 0.9 (the generator's own peak can pass 1). */
function fixture(style: string, rate: number, bpm: number): Float32Array {
  const raw: Float32Array = styleSong(style, rate, { bpm, scale: 0.5 });
  let peak = 0;
  for (const v of raw) peak = Math.max(peak, Math.abs(v));
  return raw.map((v) => (v / peak) * 0.9);
}

describe('song analysis at any sample rate', () => {
  it('frames are the same length of time at every rate', () => {
    for (const rate of RATES) {
      const env = new SongEnvelopeBuilder(rate * 2, rate).finish();
      expect(Math.abs(analysisHop(rate) / rate - ANALYSIS_STEP)).toBeLessThan(0.5 / rate);
      expect(env.frameRate).toBeCloseTo(1 / ANALYSIS_STEP, 1);
    }
  });

  const cases: Array<[Pattern, number]> = [['hiphop', 90], ['four', 120], ['four', 128], ['four', 140], ['breaks', 174]];
  for (const [pattern, bpm] of cases) {
    it(`${pattern} at ${bpm} BPM reads ${bpm} at 22.05, 44.1, 48 and 96 kHz, on the same beats`, () => {
      const firstBeats: number[][] = [];
      for (const rate of RATES) {
        const result = analyzeSong(drumSong(bpm, pattern, rate), rate);
        expect(result.tempo, `${rate} Hz`).not.toBeNull();
        expect(Math.abs(result.tempo! - bpm), `${rate} Hz read ${result.tempo}`).toBeLessThan(0.3);
        firstBeats.push(result.beats.slice(0, 16));
      }
      for (const beats of firstBeats.slice(1)) {
        for (let i = 0; i < beats.length; i++) expect(Math.abs(beats[i] - firstBeats[0][i])).toBeLessThan(0.015);
      }
    });
  }

  it('the four-on-the-floor song that read 102.4 at 44.1 kHz reads 128 at every rate', () => {
    for (const rate of RATES) expect(analyzeSong(fixture('driving', rate, 128), rate).tempo, `${rate} Hz`).toBeCloseTo(128, 0);
  });

  it('a kick on every beat with sixteenth hats is not read at 2/3 of its tempo', () => {
    // 174 used to read 116: the hats' dotted figure taken for the beat.
    for (const rate of RATES) expect(analyzeSong(fixture('hard', rate, 174), rate).tempo, `${rate} Hz`).toBeCloseTo(174, 0);
  });
});
