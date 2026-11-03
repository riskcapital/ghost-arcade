/**
 * Sample-by-sample effects for the studio's insert and macro racks.
 *
 * These run inside an AudioWorklet (fxWorklet.ts), one effect per node, in
 * stereo. Every parameter is smoothed per sample, so turning a knob or
 * sweeping a macro never steps or clicks. The code is plain TypeScript with
 * no Web Audio types, so the tests render it directly.
 *
 * Parameter values arrive 0-1, as the racks store them; each effect maps
 * them to its own ranges, the same ranges the knobs print (macroFx.ts).
 */

export type Values = Record<string, number>;

export interface FxDsp {
  set(values: Values, tempo: number): void;
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void;
}

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const expRange = (lo: number, hi: number, v: number) => lo * Math.pow(hi / lo, clamp(v, 0, 1));
/** Soft saturation that keeps feedback loops bounded. */
const soft = (x: number) => x / (1 + Math.abs(x));
/** Equal-power wet/dry: the level holds steady across the sweep. */
const dryGain = (mix: number) => Math.cos((clamp(mix, 0, 1) * Math.PI) / 2);
const wetGain = (mix: number) => Math.sin((clamp(mix, 0, 1) * Math.PI) / 2);

/** A one-pole glide toward a target, per sample. */
class Smooth {
  value: number;
  target: number;
  private k: number;
  constructor(sr: number, initial = 0, ms = 25) {
    this.value = initial;
    this.target = initial;
    this.k = 1 - Math.exp(-1 / (sr * ms * 0.001));
  }
  next(): number {
    this.value += (this.target - this.value) * this.k;
    return this.value;
  }
}

/** Takes the DC out of a signal (feedback loops and folders drift). */
class DcBlock {
  private x1 = 0;
  private y1 = 0;
  run(x: number): number {
    const y = x - this.x1 + 0.9975 * this.y1;
    this.x1 = x;
    this.y1 = y;
    return y;
  }
}

/** A circular buffer read at fractional positions with cubic interpolation. */
class Ring {
  readonly data: Float32Array;
  private w = 0;
  constructor(length: number) {
    this.data = new Float32Array(length);
  }
  get size(): number { return this.data.length; }
  get head(): number { return this.w; }
  write(x: number): void {
    this.data[this.w] = x;
    this.w = this.w + 1 === this.data.length ? 0 : this.w + 1;
  }
  /** The sample `delay` samples ago (fractional), Hermite-interpolated. */
  tap(delay: number): number {
    return this.at(this.w - 1 - delay);
  }
  /** The same, linearly interpolated: cheaper, for lines that move slowly. */
  tapLinear(delay: number): number {
    const n = this.data.length;
    let pos = this.w - 1 - delay;
    if (pos < 0) pos += n * Math.ceil(-pos / n);
    let i = pos | 0;
    const f = pos - i;
    if (i >= n) i -= n;
    const j = i + 1 === n ? 0 : i + 1;
    return this.data[i] + (this.data[j] - this.data[i]) * f;
  }
  /** The sample at absolute (fractional) index `pos`, wrapped. */
  at(pos: number): number {
    const n = this.data.length;
    if (pos < 0 || pos >= n) pos -= n * Math.floor(pos / n);
    let i1 = pos | 0;
    const f = pos - i1;
    if (i1 >= n) i1 -= n;
    const d = this.data;
    const i0 = i1 === 0 ? n - 1 : i1 - 1;
    const i2 = i1 + 1 === n ? 0 : i1 + 1;
    const i3 = i2 + 1 === n ? 0 : i2 + 1;
    const y0 = d[i0], y1 = d[i1], y2 = d[i2], y3 = d[i3];
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * f + c2) * f + c1) * f + y1;
  }
}

/** A zero-delay-feedback state-variable filter (Cytomic / Simper). */
class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  k = 1;
  low = 0;
  band = 0;
  high = 0;
  tune(sr: number, freq: number, q: number): void {
    const g = Math.tan(Math.PI * clamp(freq, 10, sr * 0.45) / sr);
    this.k = 1 / Math.max(0.05, q);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  run(x: number): void {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = x - this.k * v1 - v2;
  }
}

/** One-pole low-pass, for damping inside loops. */
class OnePole {
  private y = 0;
  private a = 0;
  tune(sr: number, freq: number): void {
    this.a = Math.exp(-TAU * clamp(freq, 10, sr * 0.49) / sr);
  }
  run(x: number): number {
    this.y = x + this.a * (this.y - x);
    return this.y;
  }
}

/**
 * A delay-line pitch shifter: two read heads sweep through a short window
 * at the new speed, half a window apart, crossfaded with a raised cosine so
 * the seams never click.
 */
class PitchShifter {
  private ring: Ring;
  private phase = 0;
  constructor(private sr: number, private windowMs = 70) {
    this.ring = new Ring(Math.ceil(sr * 0.25));
  }
  run(x: number, ratio: number): number {
    this.ring.write(x);
    const win = this.sr * this.windowMs * 0.001;
    this.phase += (1 - ratio) / win;
    this.phase -= Math.floor(this.phase);
    const p2 = (this.phase + 0.5) % 1;
    const a = this.ring.tap(this.phase * win + 2);
    const b = this.ring.tap(p2 * win + 2);
    const wa = Math.sin(Math.PI * this.phase);
    const wb = Math.sin(Math.PI * p2);
    // sin² windows half a cycle apart sum to one.
    return a * wa * wa + b * wb * wb;
  }
}

/** Beats per tempo in samples, with a floor so a stopped clock still runs. */
const beatSamples = (sr: number, tempo: number) => (60 / clamp(tempo || 120, 30, 300)) * sr;

/** The racks' beat divisions (macroFx.ts DIVISIONS), shortest first. */
const DIVISION_BEATS = [0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.5, 2, 4];
export const divisionBeats = (v: number) => DIVISION_BEATS[clamp(Math.round(v * (DIVISION_BEATS.length - 1)), 0, DIVISION_BEATS.length - 1)];

/** A small deterministic random source (tests stay repeatable). */
class Rand {
  private s: number;
  constructor(seed = 0x9e3779b9) { this.s = seed >>> 0; }
  next(): number {
    this.s ^= this.s << 13; this.s >>>= 0;
    this.s ^= this.s >>> 17;
    this.s ^= this.s << 5; this.s >>>= 0;
    return this.s / 4294967296;
  }
}

// ---------------------------------------------------------------------------
// Phaser

/**
 * Eight first-order all-pass stages per side, swept on an exponential curve
 * that never leaves the audible range, the right side a quarter-cycle behind
 * the left. Feedback runs through a soft clip, so it sings but never runs
 * away.
 */
export class Phaser implements FxDsp {
  private rate: Smooth; private depth: Smooth; private feedback: Smooth; private mix: Smooth;
  private lfo = 0;
  private st = [new Float64Array(16), new Float64Array(16)];
  private last = [0, 0];
  private dc = [new DcBlock(), new DcBlock()];
  constructor(private sr: number) {
    this.rate = new Smooth(sr, 0.35); this.depth = new Smooth(sr, 0.6); this.feedback = new Smooth(sr, 0.5); this.mix = new Smooth(sr, 0);
  }
  set(v: Values): void {
    this.rate.target = v.rate ?? 0.35; this.depth.target = v.depth ?? 0.6;
    this.feedback.target = v.feedback ?? 0.5; this.mix.target = v.mix ?? 0;
  }
  /** The all-pass coefficient for a side at the current sweep. */
  private coef(c: number, depth: number): number {
    const lo = 140;
    const span = 0.5 + depth * 4.6; // octaves above `lo`
    const sweep = 0.5 - 0.5 * Math.cos(TAU * (this.lfo + c * 0.25));
    const f = Math.min(lo * Math.pow(2, span * sweep), this.sr * 0.45);
    const t = Math.tan(Math.PI * f / this.sr);
    return (t - 1) / (t + 1);
  }
  private a = [0, 0];
  private aStep = [0, 0];
  private tick = 0;
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    for (let i = 0; i < n; i++) {
      const depth = this.depth.next();
      const fb = this.feedback.next() * 0.85;
      const mix = this.mix.next();
      const rateV = this.rate.next();
      if ((this.tick++ & 7) === 0) {
        // The sweep is smooth, so its coefficient is worked out every 8 samples and glided between.
        const rate = expRange(0.05, 8, rateV);
        const ahead = this.lfo + (rate * 8) / this.sr;
        const save = this.lfo;
        for (let c = 0; c < 2; c++) {
          this.lfo = save;
          const now = this.tick === 1 ? this.coef(c, depth) : this.a[c];
          this.lfo = ahead - Math.floor(ahead);
          const next = this.coef(c, depth);
          this.a[c] = now;
          this.aStep[c] = (next - now) / 8;
        }
        this.lfo = ahead - Math.floor(ahead);
      }
      const dg = dryGain(mix), wg = wetGain(mix) * 1.2;
      for (let c = 0; c < 2; c++) {
        const x = c === 0 ? inL[i] : inR[i];
        const a = this.a[c];
        this.a[c] += this.aStep[c];
        const s = this.st[c];
        let y = x + soft(this.last[c] * fb);
        for (let k = 0; k < 16; k += 2) {
          const out = a * y + s[k] - a * s[k + 1];
          s[k] = y;
          s[k + 1] = out;
          y = out;
        }
        this.last[c] = y;
        const o = x * dg + this.dc[c].run(0.5 * (x + y)) * wg;
        if (c === 0) outL[i] = o; else outR[i] = o;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Grain cloud

interface Grain { pos: number; step: number; age: number; len: number; panL: number; panR: number; }

/**
 * A granular delay: short windowed slices of the last two seconds, scattered
 * in time and pitch, played forwards or backwards and spread across the
 * stereo field. Feedback writes the cloud back into the buffer, so it can
 * smear into a texture or climb in pitch.
 */
export class GrainCloud implements FxDsp {
  private ring: [Ring, Ring];
  private grains: Grain[] = [];
  private rnd = new Rand(0x51ed270b);
  private untilNext = 0;
  private v: Values = { size: 0.4, density: 0.5, pitch: 0.5, spray: 0.4, reverse: 0.2, feedback: 0.3, mix: 0 };
  private mix: Smooth; private fbAmt: Smooth;
  private fb = [0, 0];
  private dc = [new DcBlock(), new DcBlock()];
  constructor(private sr: number) {
    this.ring = [new Ring(Math.ceil(sr * 3)), new Ring(Math.ceil(sr * 3))];
    this.mix = new Smooth(sr, 0); this.fbAmt = new Smooth(sr, 0.3);
  }
  set(v: Values): void {
    this.v = { ...this.v, ...v };
    this.mix.target = this.v.mix; this.fbAmt.target = this.v.feedback;
  }
  private spawn(): void {
    const v = this.v;
    const len = this.sr * expRange(0.03, 0.5, v.size);
    // Pitch snaps to musical steps: -1 octave, -5th, unison, +5th, +1 octave, +2 octaves.
    const steps = [-12, -5, 0, 7, 12, 24];
    const base = steps[clamp(Math.round(v.pitch * (steps.length - 1)), 0, steps.length - 1)];
    const detune = (this.rnd.next() * 2 - 1) * v.spray * 0.6;
    const jump = this.rnd.next() < v.spray * 0.25 ? (this.rnd.next() < 0.5 ? -12 : 12) : 0;
    const ratio = Math.pow(2, (base + detune + jump) / 12);
    const reverse = this.rnd.next() < v.reverse;
    const scatter = this.rnd.next() * v.spray * this.sr * 1.2;
    // The read head must stay behind the write head for the whole grain.
    const head = this.ring[0].head;
    const behind = len * Math.max(1, ratio) + scatter + 64;
    const start = reverse ? head - scatter - 64 : head - behind;
    const pan = (this.rnd.next() * 2 - 1) * 0.85;
    if (this.grains.length >= 40) this.grains.shift();
    this.grains.push({
      pos: start,
      step: reverse ? -ratio : ratio,
      age: 0,
      len,
      panL: Math.cos((pan + 1) * Math.PI / 4),
      panR: Math.sin((pan + 1) * Math.PI / 4),
    });
  }
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const v = this.v;
    const perSecond = expRange(2, 60, v.density);
    // Overlap: how many grains sound at once on average, for level.
    const overlap = Math.max(1, perSecond * expRange(0.03, 0.5, v.size));
    const norm = 1 / Math.sqrt(overlap);
    const [rl, rr] = this.ring;
    for (let i = 0; i < n; i++) {
      const fb = this.fbAmt.next() * 0.7;
      rl.write(inL[i] + soft(this.fb[0] * fb));
      rr.write(inR[i] + soft(this.fb[1] * fb));
      if (--this.untilNext <= 0) {
        this.spawn();
        this.untilNext = (this.sr / perSecond) * (0.5 + this.rnd.next());
      }
      let l = 0, r = 0;
      for (let g = this.grains.length - 1; g >= 0; g--) {
        const gr = this.grains[g];
        const w = Math.sin(Math.PI * gr.age / gr.len);
        const env = w * w;
        const sl = rl.at(gr.pos), sr2 = rr.at(gr.pos);
        const mono = 0.5 * (sl + sr2);
        // Each grain is mostly its own side plus some of the other, then panned.
        l += (0.6 * sl + 0.4 * mono) * env * gr.panL;
        r += (0.6 * sr2 + 0.4 * mono) * env * gr.panR;
        gr.pos += gr.step;
        if (++gr.age >= gr.len) this.grains.splice(g, 1);
      }
      l = this.dc[0].run(l * norm * 1.9);
      r = this.dc[1].run(r * norm * 1.9);
      this.fb[0] = l; this.fb[1] = r;
      const mix = this.mix.next();
      outL[i] = inL[i] * dryGain(mix) + l * wetGain(mix);
      outR[i] = inR[i] * dryGain(mix) + r * wetGain(mix);
    }
  }
}

// ---------------------------------------------------------------------------
// Shimmer reverb

/**
 * An eight-line feedback delay network with slowly moving taps (so it never
 * rings metallic), damped per line. "Shimmer" feeds the tail back an octave
 * up, so every repeat climbs into a halo.
 */
export class Shimmer implements FxDsp {
  private lines: Ring[];
  private lens: number[];
  private damp: OnePole[];
  private state = new Float64Array(8);
  private modPhase = new Float64Array(8);
  private shifterL: PitchShifter; private shifterR: PitchShifter;
  private shimmerL = 0; private shimmerR = 0;
  private pre: [Ring, Ring];
  private size: Smooth; private decay: Smooth; private shimmer: Smooth; private tone: Smooth; private mix: Smooth;
  private dc = [new DcBlock(), new DcBlock()];
  private tick = 0;
  private gains = new Float64Array(8);
  constructor(private sr: number) {
    const base = [1031, 1327, 1523, 1801, 2063, 2357, 2693, 2999];
    this.lens = base.map((b) => b * sr / 44100);
    this.lines = this.lens.map((l) => new Ring(Math.ceil(l * 2.2) + 64));
    this.damp = base.map(() => new OnePole());
    this.modPhase = Float64Array.from(base, (_, i) => i / 8);
    this.shifterL = new PitchShifter(sr, 90); this.shifterR = new PitchShifter(sr, 97);
    this.pre = [new Ring(Math.ceil(sr * 0.05)), new Ring(Math.ceil(sr * 0.05))];
    this.size = new Smooth(sr, 0.7, 500); this.decay = new Smooth(sr, 0.7, 60); this.shimmer = new Smooth(sr, 0.5, 60);
    this.tone = new Smooth(sr, 0.5, 60); this.mix = new Smooth(sr, 0);
  }
  set(v: Values): void {
    this.size.target = v.size ?? 0.7; this.decay.target = v.decay ?? 0.7; this.shimmer.target = v.shimmer ?? 0.5;
    this.tone.target = v.tone ?? 0.5; this.mix.target = v.mix ?? 0;
  }
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const sr = this.sr;
    for (let i = 0; i < n; i++) {
      const size = 0.4 + this.size.next() * 1.6;
      const decay = this.decay.next();
      const shimmer = this.shimmer.next();
      const mix = this.mix.next();
      if ((this.tick++ & 15) === 0) {
        // RT60 from 1 s to 30 s; each line's gain follows its own length.
        const rt = expRange(1, 30, decay);
        for (let k = 0; k < 8; k++) this.gains[k] = Math.pow(10, (-3 * this.lens[k] * size) / (rt * sr));
        const cutoff = expRange(1800, 14000, this.tone.next());
        for (const d of this.damp) d.tune(sr, cutoff);
      }
      this.pre[0].write(inL[i]); this.pre[1].write(inR[i]);
      const xl = this.pre[0].tap(sr * 0.02) + this.shimmerL * shimmer * 0.55;
      const xr = this.pre[1].tap(sr * 0.023) + this.shimmerR * shimmer * 0.55;
      // Read every line (with a slow 0.6 ms wobble), mix with a Householder matrix.
      let sum = 0;
      for (let k = 0; k < 8; k++) {
        this.modPhase[k] += (0.13 + k * 0.021) / sr;
        if (this.modPhase[k] >= 1) this.modPhase[k] -= 1;
        // A parabola stands in for the sine: the wobble only has to be smooth.
        const ph = this.modPhase[k] * 2 - 1;
        const wobble = (1 - 2 * Math.abs(ph)) * (2 - 2 * Math.abs(1 - 2 * Math.abs(ph))) * sr * 0.0003;
        const out = this.lines[k].tapLinear(this.lens[k] * size + wobble + 4);
        this.state[k] = this.damp[k].run(out) * this.gains[k];
        sum += this.state[k];
      }
      const h = sum * 0.25;
      let l = 0, r = 0;
      for (let k = 0; k < 8; k++) {
        const into = this.state[k] - h + (k & 1 ? xr : xl) * 0.35;
        this.lines[k].write(soft(into * 0.9) / 0.9);
        if (k & 1) r += this.state[k]; else l += this.state[k];
      }
      l = this.dc[0].run(l * 0.5);
      r = this.dc[1].run(r * 0.5);
      this.shimmerL = this.shifterL.run(l, 2);
      this.shimmerR = this.shifterR.run(r, 2);
      outL[i] = inL[i] * dryGain(mix) + l * wetGain(mix);
      outR[i] = inR[i] * dryGain(mix) + r * wetGain(mix);
    }
  }
}

// ---------------------------------------------------------------------------
// Frequency shifter

/** Two all-pass chains 90° apart across the band (Niemitalo's Hilbert pair). */
class Hilbert {
  private static readonly A = [0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737].map((c) => c * c);
  private static readonly B = [0.4021921162426, 0.8561710882420, 0.9722909545651, 0.9952884791278].map((c) => c * c);
  private sa = new Float64Array(16);
  private sb = new Float64Array(16);
  private bDelay = 0;
  private chain(x: number, coefs: number[], s: Float64Array): number {
    for (let k = 0; k < 4; k++) {
      const x1 = s[k * 4], x2 = s[k * 4 + 1], y1 = s[k * 4 + 2], y2 = s[k * 4 + 3];
      const y = coefs[k] * (x + y2) - x2;
      s[k * 4 + 1] = x1; s[k * 4] = x; s[k * 4 + 3] = y1; s[k * 4 + 2] = y;
      x = y;
    }
    return x;
  }
  /** [in-phase, quadrature]. */
  run(x: number): [number, number] {
    const i = this.chain(x, Hilbert.A, this.sa);
    const qNow = this.chain(x, Hilbert.B, this.sb);
    const q = this.bDelay;
    this.bDelay = qNow;
    return [i, q];
  }
}

/**
 * Moves every frequency by the same number of hertz (not a pitch shift), so
 * harmonics stop lining up: bells, robots, a barber-pole climb with
 * feedback. The right side shifts the other way by "Spread".
 */
export class FreqShifter implements FxDsp {
  private hil = [new Hilbert(), new Hilbert()];
  private phase = [0, 0];
  private shift: Smooth; private spread: Smooth; private feedback: Smooth; private mix: Smooth;
  private last = [0, 0];
  constructor(private sr: number) {
    this.shift = new Smooth(sr, 0.6, 40); this.spread = new Smooth(sr, 0.3); this.feedback = new Smooth(sr, 0.2); this.mix = new Smooth(sr, 0);
  }
  /** -1..1 → ±2 kHz, fine near zero. */
  static hz(v: number): number {
    const s = clamp(v, 0, 1) * 2 - 1;
    return Math.sign(s) * (Math.pow(2, Math.abs(s) * 11) - 1);
  }
  set(v: Values): void {
    this.shift.target = v.shift ?? 0.6; this.spread.target = v.spread ?? 0.3;
    this.feedback.target = v.feedback ?? 0.2; this.mix.target = v.mix ?? 0;
  }
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    for (let i = 0; i < n; i++) {
      const hz = FreqShifter.hz(this.shift.next());
      const spread = this.spread.next();
      const fb = this.feedback.next() * 0.8;
      const mix = this.mix.next();
      for (let c = 0; c < 2; c++) {
        const x = c === 0 ? inL[i] : inR[i];
        const f = c === 0 ? hz : hz * (1 - 2 * spread);
        this.phase[c] += f / this.sr;
        this.phase[c] -= Math.floor(this.phase[c]);
        const [re, im] = this.hil[c].run(x + soft(this.last[c] * fb));
        const y = re * Math.cos(TAU * this.phase[c]) + im * Math.sin(TAU * this.phase[c]);
        this.last[c] = y;
        const o = x * dryGain(mix) + y * wetGain(mix);
        if (c === 0) outL[i] = o; else outR[i] = o;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Ring modulator

/** Multiplies by a sine: metal, bells and Daleks. Wobble swings the carrier. */
export class RingMod implements FxDsp {
  private phase = 0;
  private lfo = 0;
  private freq: Smooth; private wobble: Smooth; private mix: Smooth;
  constructor(private sr: number) {
    this.freq = new Smooth(sr, 0.45, 30); this.wobble = new Smooth(sr, 0.2); this.mix = new Smooth(sr, 0);
  }
  set(v: Values): void {
    this.freq.target = v.freq ?? 0.45; this.wobble.target = v.wobble ?? 0.2; this.mix.target = v.mix ?? 0;
  }
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    for (let i = 0; i < n; i++) {
      const base = expRange(20, 4000, this.freq.next());
      const wob = this.wobble.next();
      const mix = this.mix.next();
      this.lfo += 0.35 / this.sr;
      if (this.lfo >= 1) this.lfo -= 1;
      const f = base * Math.pow(2, Math.sin(TAU * this.lfo) * wob * 1.5);
      this.phase += f / this.sr;
      this.phase -= Math.floor(this.phase);
      const carrier = Math.sin(TAU * this.phase);
      outL[i] = inL[i] * dryGain(mix) + inL[i] * carrier * wetGain(mix);
      outR[i] = inR[i] * dryGain(mix) + inR[i] * carrier * wetGain(mix);
    }
  }
}

// ---------------------------------------------------------------------------
// Resonator

export const RESONATOR_CHORDS: { label: string; steps: number[] }[] = [
  { label: 'Fifths', steps: [0, 7, 12, 19] },
  { label: 'Major', steps: [0, 4, 7, 12] },
  { label: 'Minor', steps: [0, 3, 7, 10] },
  { label: 'Fourths', steps: [0, 5, 10, 15] },
  { label: 'Cluster', steps: [0, 1, 5, 6] },
];
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const resonatorNote = (v: number) => clamp(Math.round(v * 11), 0, 11);
export const resonatorChord = (v: number) => RESONATOR_CHORDS[clamp(Math.round(v * (RESONATOR_CHORDS.length - 1)), 0, RESONATOR_CHORDS.length - 1)];

/**
 * Four tuned strings the sound rings through: drums and noise come out as a
 * chord. Each string is a feedback delay with damping in its loop.
 */
export class Resonator implements FxDsp {
  private strings: Ring[][];
  private damp: OnePole[][];
  private last: number[][];
  private tuned = '';
  private lens = [0, 0, 0, 0];
  private gains = [0, 0, 0, 0];
  private decay = 0.6; private bright = 0.5;
  private mix: Smooth;
  private dc = [new DcBlock(), new DcBlock()];
  constructor(private sr: number) {
    const maxLen = Math.ceil(sr / 30) + 8;
    this.strings = [0, 1].map(() => [0, 1, 2, 3].map(() => new Ring(maxLen)));
    this.damp = [0, 1].map(() => [0, 1, 2, 3].map(() => new OnePole()));
    this.last = [[0, 0, 0, 0], [0, 0, 0, 0]];
    this.mix = new Smooth(sr, 0);
  }
  set(v: Values): void {
    const note = resonatorNote(v.note ?? 0.17);
    const chord = resonatorChord(v.chord ?? 0);
    this.decay = v.decay ?? 0.6;
    this.bright = v.bright ?? 0.5;
    this.mix.target = v.mix ?? 0;
    const key = `${note}:${chord.label}:${this.decay.toFixed(3)}:${this.bright.toFixed(3)}`;
    if (key === this.tuned) return;
    this.tuned = key;
    chord.steps.forEach((step, k) => {
      // Root around C2-B2, so a chord sits in the low-mid range.
      const freq = 65.41 * Math.pow(2, (note + step) / 12);
      this.lens[k] = this.sr / freq;
      const rt = expRange(0.15, 6, this.decay);
      this.gains[k] = Math.pow(10, -3 / (rt * freq));
      for (const side of this.damp) side[k].tune(this.sr, expRange(800, 16000, this.bright));
    });
  }
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    for (let i = 0; i < n; i++) {
      const mix = this.mix.next();
      for (let c = 0; c < 2; c++) {
        const x = (c === 0 ? inL[i] : inR[i]) * 0.25;
        let y = 0;
        for (let k = 0; k < 4; k++) {
          const ring = this.strings[c][k];
          // Strings on the right sit a hair sharp: a slow stereo beat.
          const out = ring.tap(this.lens[k] * (c ? 0.9985 : 1) - 1);
          const fed = this.damp[c][k].run(out) * this.gains[k];
          ring.write(soft(x + fed));
          y += out;
        }
        y = this.dc[c].run(y * 0.35);
        const dry = c === 0 ? inL[i] : inR[i];
        const o = dry * dryGain(mix) + y * wetGain(mix);
        if (c === 0) outL[i] = o; else outR[i] = o;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Vowel filter

const VOWELS: number[][] = [
  [800, 1150, 2900], // a
  [400, 1700, 2600], // e
  [280, 2250, 2900], // i
  [450, 800, 2830], // o
  [325, 700, 2530], // u
];
export const VOWEL_LABELS = ['A', 'E', 'I', 'O', 'U'];

/**
 * Three formant filters that make the sound speak: the vowel knob glides
 * a-e-i-o-u, and Talk sways it on its own.
 */
export class Vowel implements FxDsp {
  private f = [[new Svf(), new Svf(), new Svf()], [new Svf(), new Svf(), new Svf()]];
  private vowel: Smooth; private talk: Smooth; private rate: Smooth; private reso: Smooth; private mix: Smooth;
  private lfo = 0;
  private lfoStep = 0;
  private tick = 0;
  constructor(private sr: number) {
    this.vowel = new Smooth(sr, 0, 40); this.talk = new Smooth(sr, 0.3); this.rate = new Smooth(sr, 0.4);
    this.reso = new Smooth(sr, 0.5); this.mix = new Smooth(sr, 0);
  }
  set(v: Values): void {
    this.vowel.target = v.vowel ?? 0; this.talk.target = v.talk ?? 0.3; this.rate.target = v.rate ?? 0.4;
    this.reso.target = v.reso ?? 0.5; this.mix.target = v.mix ?? 0;
  }
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    for (let i = 0; i < n; i++) {
      const vowel = this.vowel.next();
      const talk = this.talk.next();
      const rateV = this.rate.next();
      const reso = this.reso.next();
      const mix = this.mix.next();
      if ((this.tick & 7) === 0) this.lfoStep = expRange(0.1, 8, rateV) / this.sr;
      this.lfo += this.lfoStep;
      if (this.lfo >= 1) this.lfo -= 1;
      if ((this.tick++ & 7) === 0) {
        for (let c = 0; c < 2; c++) {
          const pos = clamp(vowel + talk * 0.5 * Math.sin(TAU * (this.lfo + c * 0.15)), 0, 1) * (VOWELS.length - 1);
          const a = Math.floor(pos), b = Math.min(VOWELS.length - 1, a + 1), t = pos - a;
          for (let k = 0; k < 3; k++) {
            const freq = VOWELS[a][k] * Math.pow(VOWELS[b][k] / VOWELS[a][k], t);
            this.f[c][k].tune(this.sr, freq, 3 + reso * 14);
          }
        }
      }
      for (let c = 0; c < 2; c++) {
        const x = c === 0 ? inL[i] : inR[i];
        const fs = this.f[c];
        fs[0].run(x); fs[1].run(x); fs[2].run(x);
        // band × k peaks at unity whatever the resonance.
        const y = (fs[0].band * fs[0].k + fs[1].band * fs[1].k * 0.7 + fs[2].band * fs[2].k * 0.45) * 5.4;
        const o = x * dryGain(mix) + y * wetGain(mix);
        if (c === 0) outL[i] = o; else outR[i] = o;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Wavefolder

/**
 * Folds the wave back on itself instead of clipping it: harmonics bloom as
 * the drive goes up. Runs at four times the sample rate so the new
 * harmonics do not fold back down as noise.
 */
export class Wavefolder implements FxDsp {
  private drive: Smooth; private symmetry: Smooth; private tone: Smooth; private mix: Smooth;
  private prev = [0, 0];
  private aa = [[new Svf(), new Svf()], [new Svf(), new Svf()]];
  private toneF = [new OnePole(), new OnePole()];
  private dc = [new DcBlock(), new DcBlock()];
  private tick = 0;
  constructor(private sr: number) {
    this.drive = new Smooth(sr, 0.4); this.symmetry = new Smooth(sr, 0.5); this.tone = new Smooth(sr, 0.7); this.mix = new Smooth(sr, 0);
    // Two cascaded low-passes at the original Nyquist, running at 4x.
    for (const side of this.aa) for (const f of side) f.tune(sr * 4, sr * 0.45, 0.707);
  }
  set(v: Values): void {
    this.drive.target = v.drive ?? 0.4; this.symmetry.target = v.symmetry ?? 0.5;
    this.tone.target = v.tone ?? 0.7; this.mix.target = v.mix ?? 0;
  }
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    for (let i = 0; i < n; i++) {
      const gain = 1 + this.drive.next() * 9;
      const bias = (this.symmetry.next() - 0.5) * 1.2;
      const mix = this.mix.next();
      const tone = this.tone.next();
      if ((this.tick++ & 15) === 0) for (const t of this.toneF) t.tune(this.sr, expRange(1500, 18000, tone));
      for (let c = 0; c < 2; c++) {
        const x = c === 0 ? inL[i] : inR[i];
        const x0 = this.prev[c];
        this.prev[c] = x;
        let acc = 0;
        for (let s = 1; s <= 4; s++) {
          // Linear steps up to 4x, fold, band-limit, keep every fourth.
          const u = x0 + (x - x0) * (s / 4);
          const folded = Math.sin((u * gain + bias) * (Math.PI / 2));
          const [f1, f2] = this.aa[c];
          f1.run(folded);
          f2.run(f1.low);
          acc = f2.low;
        }
        const y = this.dc[c].run(this.toneF[c].run(acc)) * (0.45 / Math.sqrt(gain * 0.5 + 0.5));
        const o = x * dryGain(mix) + y * wetGain(mix);
        if (c === 0) outL[i] = o; else outR[i] = o;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Reverse delay

/**
 * Plays the last stretch of sound backwards, in time with the beat. Two
 * heads half a stretch apart crossfade, so the turns never click.
 */
export class ReverseDelay implements FxDsp {
  private ring: [Ring, Ring];
  /** Two heads, half a stretch apart; each keeps its length until its own turn. */
  private heads = [{ phase: 0, len: 0 }, { phase: 0.5, len: 0 }];
  private target: number;
  private feedback: Smooth; private mix: Smooth;
  private tone = [new OnePole(), new OnePole()];
  private last = [0, 0];
  constructor(private sr: number) {
    this.ring = [new Ring(Math.ceil(sr * 9)), new Ring(Math.ceil(sr * 9))];
    this.target = sr * 0.5;
    for (const h of this.heads) h.len = this.target;
    this.feedback = new Smooth(sr, 0.4); this.mix = new Smooth(sr, 0);
    for (const t of this.tone) t.tune(sr, 9000);
  }
  set(v: Values, tempo: number): void {
    this.target = clamp(divisionBeats(v.time ?? 0.6) * beatSamples(this.sr, tempo), this.sr * 0.05, this.sr * 4);
    this.feedback.target = v.feedback ?? 0.4;
    this.mix.target = v.mix ?? 0;
    const cutoff = expRange(1500, 16000, v.tone ?? 0.6);
    for (const t of this.tone) t.tune(this.sr, cutoff);
  }
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    for (let i = 0; i < n; i++) {
      const fb = this.feedback.next() * 0.85;
      const mix = this.mix.next();
      this.ring[0].write(inL[i] + soft(this.last[0] * fb));
      this.ring[1].write(inR[i] + soft(this.last[1] * fb));
      let yl = 0, yr = 0;
      for (const h of this.heads) {
        h.phase += 1 / h.len;
        // A head takes a new length only at its own turn, where its window is silent.
        if (h.phase >= 1) { h.phase -= 1; h.len = this.target; }
        const w = Math.sin(Math.PI * h.phase);
        // Reading 2·phase·len back makes the head run backwards at normal speed.
        const d = 2 * h.phase * h.len + 1;
        yl += this.ring[0].tap(d) * w * w;
        yr += this.ring[1].tap(d) * w * w;
      }
      const sl = this.tone[0].run(yl), sr2 = this.tone[1].run(yr);
      this.last[0] = sl; this.last[1] = sr2;
      outL[i] = inL[i] * dryGain(mix) + sl * wetGain(mix);
      outR[i] = inR[i] * dryGain(mix) + sr2 * wetGain(mix);
    }
  }
}

// ---------------------------------------------------------------------------
// Glitch

type GlitchMove = 'pass' | 'repeat' | 'roll' | 'reverse' | 'half' | 'stop' | 'gate';

/**
 * Cuts the beat up as it plays: on each step it may repeat the last slice,
 * roll it fast, flip it, drop it an octave, brake it to a halt or gate it.
 * Chance sets how often; Variety how strange the moves get.
 */
export class Glitch implements FxDsp {
  private ring: [Ring, Ring];
  private rnd = new Rand(0x2545f491);
  private step = 0;
  private stepLen: number;
  private move: GlitchMove = 'pass';
  private sliceStart = 0;
  private read = 0;
  private speed = 1;
  private v: Values = { division: 0.25, chance: 0.3, variety: 0.5, mix: 1 };
  private tempo = 120;
  private mix: Smooth;
  private gateLevel = 1;
  constructor(private sr: number) {
    this.ring = [new Ring(Math.ceil(sr * 6)), new Ring(Math.ceil(sr * 6))];
    this.stepLen = sr * 0.125;
    this.mix = new Smooth(sr, 1);
  }
  set(v: Values, tempo: number): void {
    this.v = { ...this.v, ...v };
    this.tempo = tempo;
    this.mix.target = this.v.mix;
  }
  private choose(): void {
    const v = this.v;
    this.stepLen = clamp(divisionBeats(v.division) * beatSamples(this.sr, this.tempo), this.sr * 0.02, this.sr * 2);
    const head = this.ring[0].head;
    this.sliceStart = head - this.stepLen;
    this.read = 0;
    this.speed = 1;
    if (this.rnd.next() >= v.chance) { this.move = 'pass'; return; }
    const moves: GlitchMove[] = v.variety < 0.34 ? ['repeat', 'roll'] : v.variety < 0.67 ? ['repeat', 'roll', 'reverse', 'gate'] : ['repeat', 'roll', 'reverse', 'half', 'stop', 'gate'];
    this.move = moves[Math.floor(this.rnd.next() * moves.length)];
    if (this.move === 'half') this.speed = 0.5;
  }
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const edge = this.sr * 0.004;
    const gateK = 1 - Math.exp(-1 / (this.sr * 0.002));
    for (let i = 0; i < n; i++) {
      this.ring[0].write(inL[i]);
      this.ring[1].write(inR[i]);
      if (this.step <= 0) { this.choose(); this.step = this.stepLen; }
      this.step--;
      const mix = this.mix.next();
      let gl = inL[i], gr = inR[i];
      if (this.move !== 'pass') {
        const len = this.stepLen;
        const sub = len / 4;
        let pos: number;
        let gate = 1;
        if (this.move === 'repeat') pos = this.read % len;
        else if (this.move === 'roll') pos = this.read % sub;
        else if (this.move === 'reverse') pos = len - 1 - (this.read % len);
        else if (this.move === 'gate') { pos = this.read % len; gate = ((this.read / (len / 8)) | 0) % 2 === 0 ? 1 : 0; }
        else if (this.move === 'stop') { this.speed = Math.max(0, this.speed - 1 / len); pos = this.read; gate = Math.min(1, this.speed * 4); }
        else pos = this.read; // half speed
        // The gate glides over 2 ms; a roll fades each repeat's ends.
        this.gateLevel += (gate - this.gateLevel) * gateK;
        let env = this.gateLevel;
        if (this.move === 'roll') env *= Math.min(1, pos / edge, (sub - pos) / edge);
        const at = this.sliceStart + pos;
        // Every cut crossfades with the live sound over 4 ms, so none clicks.
        const into = len - this.step;
        const xf = Math.min(1, into / edge, (this.step + 1) / edge);
        gl = this.ring[0].at(at) * env * xf + inL[i] * (1 - xf);
        gr = this.ring[1].at(at) * env * xf + inR[i] * (1 - xf);
        this.read += this.speed;
      } else {
        this.gateLevel = 1;
      }
      outL[i] = inL[i] * dryGain(mix) + gl * wetGain(mix);
      outR[i] = inR[i] * dryGain(mix) + gr * wetGain(mix);
    }
  }
}

// ---------------------------------------------------------------------------
// Tape stop

/**
 * The record-player brake: engaged, the sound slows to a halt over Time;
 * let go, it spins back up and rejoins the live sound.
 */
export class TapeStop implements FxDsp {
  private ring: [Ring, Ring];
  /** How far the tape head trails the live sound, in samples. */
  private lag = 0;
  private speed = 1;
  private engaged = false;
  private time = 0.5;
  /** 0 = tape, 1 = live: the handover once the tape is back up to speed. */
  private live = 1;
  constructor(private sr: number) {
    this.ring = [new Ring(Math.ceil(sr * 8)), new Ring(Math.ceil(sr * 8))];
  }
  set(v: Values): void {
    this.engaged = (v.engage ?? 0) > 0.5;
    this.time = expRange(0.15, 3, v.time ?? 0.4);
  }
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const brake = 1 / (this.time * this.sr);
    const spinUp = 1 / (0.25 * this.sr);
    const handover = 1 / (0.03 * this.sr);
    for (let i = 0; i < n; i++) {
      this.ring[0].write(inL[i]);
      this.ring[1].write(inR[i]);
      if (this.engaged) {
        // Slows faster as it nears the stop, like a platter losing momentum.
        this.speed = Math.max(0, this.speed - brake * (0.3 + this.speed));
        this.live = 0;
      } else if (this.speed < 1) {
        this.speed = Math.min(1, this.speed + spinUp);
      } else if (this.lag > 0) {
        this.live = Math.min(1, this.live + handover);
        if (this.live >= 1) this.lag = 0;
      }
      this.lag = Math.min(this.ring[0].size - 8, this.lag + (1 - this.speed));
      if (this.lag === 0 && this.live >= 1) { outL[i] = inL[i]; outR[i] = inR[i]; continue; }
      // A slow tape also loses level, as a stopping deck does.
      const level = Math.min(1, this.speed * 3 + 0.02);
      const tl = this.ring[0].tap(this.lag) * level, tr = this.ring[1].tap(this.lag) * level;
      outL[i] = tl * (1 - this.live) + inL[i] * this.live;
      outR[i] = tr * (1 - this.live) + inR[i] * this.live;
    }
  }
}

// ---------------------------------------------------------------------------
// Harmonizer

export const harmonyInterval = (v: number) => clamp(Math.round(v * 24 - 12), -12, 12);

/** Two extra voices at set intervals, one each side, a little detuned for width. */
export class Harmonizer implements FxDsp {
  private shift: PitchShifter[];
  private ratios = [1, 1];
  private detune = 0.2;
  private mix: Smooth;
  private voice2: Smooth;
  constructor(sr: number) {
    this.shift = [new PitchShifter(sr, 60), new PitchShifter(sr, 66)];
    this.mix = new Smooth(sr, 0); this.voice2 = new Smooth(sr, 0.7);
  }
  set(v: Values): void {
    this.detune = v.detune ?? 0.2;
    const cents = this.detune * 18;
    this.ratios = [
      Math.pow(2, (harmonyInterval(v.voice1 ?? 0.79) * 100 - cents) / 1200),
      Math.pow(2, (harmonyInterval(v.voice2 ?? 0.79) * 100 + cents) / 1200),
    ];
    this.mix.target = v.mix ?? 0;
    this.voice2.target = v.level2 ?? 0.7;
  }
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    for (let i = 0; i < n; i++) {
      const mix = this.mix.next();
      const lvl2 = this.voice2.next();
      const mono = 0.5 * (inL[i] + inR[i]);
      const a = this.shift[0].run(mono, this.ratios[0]);
      const b = this.shift[1].run(mono, this.ratios[1]) * lvl2;
      outL[i] = inL[i] * dryGain(mix) + (a * 0.8 + b * 0.35) * wetGain(mix);
      outR[i] = inR[i] * dryGain(mix) + (b * 0.8 + a * 0.35) * wetGain(mix);
    }
  }
}

// ---------------------------------------------------------------------------

export type FxDspKind = 'phaser' | 'grains' | 'shimmer' | 'freqshift' | 'ring' | 'resonator' | 'vowel' | 'fold' | 'reverse' | 'glitch' | 'tapestop' | 'harmony';

export const FX_DSP: Record<FxDspKind, new (sr: number) => FxDsp> = {
  phaser: Phaser,
  grains: GrainCloud,
  shimmer: Shimmer,
  freqshift: FreqShifter,
  ring: RingMod,
  resonator: Resonator,
  vowel: Vowel,
  fold: Wavefolder,
  reverse: ReverseDelay,
  glitch: Glitch,
  tapestop: TapeStop,
  harmony: Harmonizer,
};
