import { describe, expect, it } from 'vitest';
import { FX_DSP, FreqShifter, type FxDspKind, type Values } from './fxDsp';

const SR = 48000;
const BLOCK = 128;

/** Settings each effect is heard at: fully wet, and doing something. */
const SETTINGS: Record<FxDspKind, Values> = {
  phaser: { rate: 0.6, depth: 0.8, feedback: 0.7, mix: 1 },
  grains: { size: 0.5, density: 0.6, pitch: 0.6, spray: 0.6, reverse: 0.4, feedback: 0.5, mix: 1 },
  shimmer: { size: 0.8, decay: 0.8, shimmer: 0.7, tone: 0.6, mix: 1 },
  freqshift: { shift: 0.75, spread: 0.5, feedback: 0.5, mix: 1 },
  ring: { freq: 0.5, wobble: 0.5, mix: 1 },
  resonator: { note: 0.2, chord: 0.25, decay: 0.7, bright: 0.6, mix: 1 },
  vowel: { vowel: 0.3, talk: 0.6, rate: 0.5, reso: 0.6, mix: 1 },
  fold: { drive: 0.8, symmetry: 0.6, tone: 0.7, mix: 1 },
  reverse: { time: 0.5, feedback: 0.5, tone: 0.6, mix: 1 },
  glitch: { division: 0.25, chance: 0.8, variety: 1, mix: 1 },
  tapestop: { engage: 1, time: 0.3 },
  harmony: { voice1: 0.79, voice2: 0.67, detune: 0.3, level2: 0.7, mix: 1 },
};

/** The same knobs, all moved at once: what a macro sweep or a fast hand does. */
const JUMPED: Record<FxDspKind, Values> = {
  phaser: { rate: 0.1, depth: 0.2, feedback: 0.1, mix: 0.4 },
  grains: { size: 0.1, density: 1, pitch: 1, spray: 0, reverse: 1, feedback: 0, mix: 0.5 },
  shimmer: { size: 0.2, decay: 0.2, shimmer: 0, tone: 0.1, mix: 0.4 },
  freqshift: { shift: 0.2, spread: 0, feedback: 0, mix: 0.6 },
  ring: { freq: 0.95, wobble: 0, mix: 0.5 },
  resonator: { note: 0.9, chord: 1, decay: 0.2, bright: 0.1, mix: 0.6 },
  vowel: { vowel: 1, talk: 0, rate: 0.1, reso: 0.1, mix: 0.5 },
  fold: { drive: 0.1, symmetry: 0.1, tone: 0.2, mix: 0.4 },
  reverse: { time: 0.9, feedback: 0, tone: 0.2, mix: 0.5 },
  glitch: { division: 0.6, chance: 0, variety: 0, mix: 0.5 },
  tapestop: { engage: 0, time: 0.3 },
  harmony: { voice1: 0.25, voice2: 1, detune: 0, level2: 0.2, mix: 0.4 },
};

/** A tone with some noise on it, at about -8 dBFS: a stand-in for music. */
function source(seconds: number): [Float32Array, Float32Array] {
  const n = Math.floor(SR * seconds);
  const l = new Float32Array(n), r = new Float32Array(n);
  let seed = 12345;
  const noise = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // A plucked note every quarter second, so effects that need a transient get one.
    const env = Math.exp(-((t % 0.25) * 9));
    const tone = Math.sin(2 * Math.PI * 220 * t) * 0.3 + Math.sin(2 * Math.PI * 331 * t) * 0.15;
    l[i] = (tone + noise() * 0.04) * (0.4 + 0.6 * env);
    r[i] = (tone * 0.9 + noise() * 0.04) * (0.4 + 0.6 * env);
  }
  return [l, r];
}

function render(kind: FxDspKind, seconds: number, changeAt?: number): { l: Float32Array; r: Float32Array; ms: number } {
  // Warm the code first, as a running worklet would be, so the timing is the steady state.
  if (changeAt === undefined) {
    const warm = new FX_DSP[kind](SR);
    warm.set(SETTINGS[kind], 120);
    const [wl, wr] = source(0.5);
    const ol = new Float32Array(wl.length), or = new Float32Array(wl.length);
    for (let i = 0; i + BLOCK <= wl.length; i += BLOCK) warm.process(wl.subarray(i, i + BLOCK), wr.subarray(i, i + BLOCK), ol.subarray(i, i + BLOCK), or.subarray(i, i + BLOCK), BLOCK);
  }
  const fx = new FX_DSP[kind](SR);
  fx.set(SETTINGS[kind], 120);
  const [inL, inR] = source(seconds);
  const l = new Float32Array(inL.length), r = new Float32Array(inL.length);
  const start = performance.now();
  for (let i = 0; i < inL.length; i += BLOCK) {
    if (changeAt !== undefined && i === Math.floor((changeAt * SR) / BLOCK) * BLOCK) fx.set(JUMPED[kind], 120);
    const n = Math.min(BLOCK, inL.length - i);
    fx.process(inL.subarray(i, i + n), inR.subarray(i, i + n), l.subarray(i, i + n), r.subarray(i, i + n), n);
  }
  return { l, r, ms: performance.now() - start };
}

const KINDS = Object.keys(FX_DSP) as FxDspKind[];

describe('studio effects (sample by sample)', () => {
  for (const kind of KINDS) {
    describe(kind, () => {
      const { l, r, ms } = render(kind, 3);

      it('stays finite, bounded and centred', () => {
        let peak = 0, sum = 0;
        for (let i = 0; i < l.length; i++) {
          expect(Number.isFinite(l[i]) && Number.isFinite(r[i])).toBe(true);
          peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
          sum += l[i] + r[i];
        }
        expect(peak).toBeLessThan(1.5);
        expect(Math.abs(sum / (2 * l.length))).toBeLessThan(0.01);
      });

      it('changes the sound', () => {
        const [inL] = source(3);
        let diff = 0, energy = 0;
        // Skip the first half second: delays and reverbs are still filling.
        for (let i = SR / 2; i < l.length; i++) {
          diff += (l[i] - inL[i]) ** 2;
          energy += inL[i] ** 2;
        }
        expect(diff / energy).toBeGreaterThan(0.05);
      });

      it('is cheap enough for a live set', () => {
        // Three seconds of stereo audio, rendered in well under 10% of real time.
        expect(ms).toBeLessThan(300);
      });

      it('does not click when every knob jumps at once', () => {
        const base = render(kind, 2);
        const moved = render(kind, 2, 1);
        // The largest sample-to-sample step around the jump, against the same effect left alone.
        const step = (x: Float32Array, from: number, to: number) => {
          let m = 0;
          for (let i = from + 1; i < to; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
          return m;
        };
        // The dry input counts too: an effect handing back to it may move as fast as it does.
        const [dry] = source(2);
        const normal = Math.max(step(base.l, SR * 0.5, SR * 2), step(moved.l, SR * 0.5, SR * 0.99), step(dry, SR * 0.5, SR * 2), 0.02);
        const around = step(moved.l, SR * 0.99, SR * 1.2);
        expect(around).toBeLessThan(normal * 1.6 + 0.02);
      });
    });
  }

  it('the phaser never sweeps its filters below zero hertz (the old click)', () => {
    // Fastest, deepest sweep with full feedback, on a pure low tone: any
    // discontinuity shows as a step far bigger than the tone's own slope.
    const fx = new FX_DSP.phaser(SR);
    fx.set({ rate: 1, depth: 1, feedback: 1, mix: 1 }, 120);
    const n = SR * 2;
    const inL = new Float32Array(n), inR = new Float32Array(n), l = new Float32Array(n), r = new Float32Array(n);
    for (let i = 0; i < n; i++) inL[i] = inR[i] = Math.sin((2 * Math.PI * 110 * i) / SR) * 0.5;
    for (let i = 0; i < n; i += BLOCK) fx.process(inL.subarray(i, i + BLOCK), inR.subarray(i, i + BLOCK), l.subarray(i, i + BLOCK), r.subarray(i, i + BLOCK), BLOCK);
    let worst = 0;
    for (let i = SR / 10; i < n; i++) worst = Math.max(worst, Math.abs(l[i] - l[i - 1]));
    // A 110 Hz tone at 0.5 moves at most 0.0072 a sample; the phaser may double it, not more.
    expect(worst).toBeLessThan(0.02);
  });

  it('the frequency shifter moves a tone by hertz, not by a ratio', () => {
    const fx = new FX_DSP.freqshift(SR);
    // +100 Hz: find the knob value for it.
    let v = 0.5;
    while (FreqShifter.hz(v) < 100) v += 0.0005;
    fx.set({ shift: v, spread: 0, feedback: 0, mix: 1 }, 120);
    const n = SR;
    const inL = new Float32Array(n), inR = new Float32Array(n), l = new Float32Array(n), r = new Float32Array(n);
    for (let i = 0; i < n; i++) inL[i] = inR[i] = Math.sin((2 * Math.PI * 1000 * i) / SR) * 0.5;
    for (let i = 0; i < n; i += BLOCK) fx.process(inL.subarray(i, i + BLOCK), inR.subarray(i, i + BLOCK), l.subarray(i, i + BLOCK), r.subarray(i, i + BLOCK), BLOCK);
    // Count zero crossings over the last half second: 1100 Hz gives 1100 a second.
    let crossings = 0;
    for (let i = SR / 2 + 1; i < n; i++) if ((l[i - 1] < 0) !== (l[i] < 0)) crossings++;
    expect(crossings / 0.5 / 2).toBeGreaterThan(1080);
    expect(crossings / 0.5 / 2).toBeLessThan(1120);
  });

  it('the tape stop slows to silence and comes back to the live sound', () => {
    const fx = new FX_DSP.tapestop(SR);
    const n = SR * 3;
    const inL = new Float32Array(n), inR = new Float32Array(n), l = new Float32Array(n), r = new Float32Array(n);
    for (let i = 0; i < n; i++) inL[i] = inR[i] = Math.sin((2 * Math.PI * 440 * i) / SR) * 0.5;
    for (let i = 0; i < n; i += BLOCK) {
      fx.set({ engage: i < SR * 1.5 ? 1 : 0, time: 0.2 }, 120);
      fx.process(inL.subarray(i, i + BLOCK), inR.subarray(i, i + BLOCK), l.subarray(i, i + BLOCK), r.subarray(i, i + BLOCK), BLOCK);
    }
    const rms = (from: number, to: number) => { from = Math.floor(from); to = Math.floor(to); let s = 0; for (let i = from; i < to; i++) s += l[i] ** 2; return Math.sqrt(s / (to - from)); };
    expect(rms(SR * 1.2, SR * 1.5)).toBeLessThan(0.02); // stopped
    expect(rms(SR * 2.6, SR * 3)).toBeGreaterThan(0.3); // back
    // Back means the live sound itself, not a delayed copy.
    let off = 0;
    for (let i = Math.floor(SR * 2.7); i < n; i++) off = Math.max(off, Math.abs(l[i] - inL[i]));
    expect(off).toBeLessThan(1e-6);
  });
});
