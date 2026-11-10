/**
 * A synthetic dance track with a known structure, for the section detection
 * tests (the Show Runner writes the same song as a WAV:
 * scripts/show-runner/fixtures.mjs `sections.wav`).
 *
 *   intro      pad + quiet hats
 *   verse      pad, hats, a light kick on 1 and 3, a soft bass
 *   build      pad + a snare roll getting denser + a rising noise sweep, no kick
 *   drop       kick on every beat, bass on the eighths, snare on 2 and 4, hats
 *   breakdown  pad only
 *   outro      kick + hats, fading out
 */
export type SynthPart = 'intro' | 'verse' | 'build' | 'drop' | 'breakdown' | 'outro';

export interface SynthSpec {
  bpm: number;
  parts: Array<{ part: SynthPart; bars: number }>;
  /** Silence before bar 1, seconds. */
  lead?: number;
  seed?: number;
}

export const SYNTH_DEFAULT: SynthSpec = {
  bpm: 120,
  parts: [
    { part: 'intro', bars: 8 },
    { part: 'build', bars: 8 },
    { part: 'drop', bars: 16 },
    { part: 'breakdown', bars: 8 },
    { part: 'build', bars: 4 },
    { part: 'drop', bars: 8 },
    { part: 'outro', bars: 8 },
  ],
};

/** Mono samples of the song. */
export function synthSong(spec: SynthSpec, sampleRate = 22050): Float32Array {
  const beat = 60 / spec.bpm;
  const bar = beat * 4;
  const lead = spec.lead ?? 0;
  const totalBars = spec.parts.reduce((n, p) => n + p.bars, 0);
  const n = Math.ceil((lead + totalBars * bar + 0.5) * sampleRate);
  const out = new Float32Array(n);
  let seed = (spec.seed ?? 7) >>> 0;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296 * 2 - 1;
  };
  const add = (t0: number, dur: number, fn: (t: number) => number) => {
    const a = Math.max(0, Math.floor(t0 * sampleRate));
    const b = Math.min(n, Math.floor((t0 + dur) * sampleRate));
    for (let i = a; i < b; i++) out[i] += fn(i / sampleRate - t0);
  };
  const kick = (t0: number, amp: number) => add(t0, 0.2, (t) => amp * Math.exp(-t * 18) * Math.sin(2 * Math.PI * (45 * t + 40 * (1 - Math.exp(-t * 30)) / 30)));
  const noiseHit = (t0: number, amp: number, len: number) => add(t0, len, (t) => amp * Math.exp(-t * 5 / len) * rnd());
  const pad = (t0: number, dur: number, amp: number) => add(t0, dur, (t) => amp * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.2 * t) + Math.sin(2 * Math.PI * 329.6 * t)) / 3);
  const bass = (t0: number, dur: number, amp: number) => add(t0, dur, (t) => amp * Math.exp(-t * 6) * (((55 * t) % 1) * 2 - 1));

  let t = lead;
  for (const p of spec.parts) {
    for (let b = 0; b < p.bars; b++) {
      const bt = t + b * bar;
      const progress = p.bars > 1 ? b / (p.bars - 1) : 1;
      switch (p.part) {
        case 'intro':
          pad(bt, bar, 0.06);
          for (let e = 0; e < 8; e++) noiseHit(bt + e * beat / 2, 0.015, 0.03);
          break;
        case 'verse':
          pad(bt, bar, 0.07);
          for (let e = 0; e < 8; e++) noiseHit(bt + e * beat / 2, 0.04, 0.03);
          kick(bt, 0.35);
          kick(bt + 2 * beat, 0.35);
          for (let e = 0; e < 4; e++) bass(bt + e * beat, beat, 0.08);
          break;
        case 'build': {
          pad(bt, bar, 0.07);
          const perBeat = progress < 0.4 ? 1 : progress < 0.75 ? 2 : 4;
          for (let s = 0; s < 4 * perBeat; s++) noiseHit(bt + s * beat / perBeat, 0.08 + 0.2 * progress, 0.06);
          add(bt, bar, (x) => (0.02 + 0.12 * (progress + x / bar / p.bars)) * rnd());
          break;
        }
        case 'drop':
          pad(bt, bar, 0.08);
          for (let e = 0; e < 4; e++) kick(bt + e * beat, 0.9);
          for (let e = 0; e < 8; e++) bass(bt + e * beat / 2, beat / 2, 0.3);
          noiseHit(bt + beat, 0.35, 0.1);
          noiseHit(bt + 3 * beat, 0.35, 0.1);
          for (let e = 0; e < 8; e++) noiseHit(bt + e * beat / 2 + beat / 4, 0.08, 0.03);
          break;
        case 'breakdown':
          pad(bt, bar, 0.09);
          break;
        case 'outro': {
          const fade = 1 - 0.8 * progress;
          for (let e = 0; e < 4; e++) kick(bt + e * beat, 0.5 * fade);
          for (let e = 0; e < 8; e++) noiseHit(bt + e * beat / 2, 0.05 * fade, 0.03);
          break;
        }
      }
    }
    t += p.bars * bar;
  }
  // Keep it under full scale.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.95) for (let i = 0; i < n; i++) out[i] *= 0.95 / peak;
  return out;
}

/** Section boundaries of the spec, seconds (including 0 and the end). */
export function synthBoundaries(spec: SynthSpec): number[] {
  const bar = (60 / spec.bpm) * 4;
  const out = [spec.lead ?? 0];
  for (const p of spec.parts) out.push(out[out.length - 1] + p.bars * bar);
  return out;
}
