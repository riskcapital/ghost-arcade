/**
 * The tone engine's signal processing, written plainly so it runs in an
 * AudioWorklet and in tests alike.
 *
 * Oscillators are band-limited with polyBLEP; the low-pass ladder and the
 * state-variable filter are zero-delay-feedback (topology-preserving)
 * designs, with their coefficients updated every CONTROL samples to keep the
 * cost down. Voices are mono or polyphonic with glide, legato, drift and
 * stealing; the engine's effects run once on the summed stereo signal.
 */

import { Arpeggiator } from '../arp';
import type { DrumKit, DrumSound, DrumTweak, Env, Lfo, Osc, TonePatch, ToneFx, ToneMessage, Wave } from './toneTypes';

const TAU = Math.PI * 2;
/** Samples between control updates (filter coefficients, LFOs, envelopes of the filter). */
export const CONTROL = 16;
const MAX_UNISON = 7;

const mtof = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** A small fast tanh, close enough for saturation. */
export function softClip(x: number): number {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** One band-limited oscillator. */
export class Oscillator {
  phase = Math.random();
  tri = 0;
  /** True on the sample the phase wrapped (for hard sync). */
  wrapped = false;

  next(wave: Wave, dt: number, pw: number, pm: number, noise: () => number): number {
    let t = this.phase;
    let out: number;
    switch (wave) {
      case 'sine':
        out = Math.sin(TAU * (t + pm));
        break;
      case 'saw':
        out = 2 * t - 1 - polyBlep(t, dt);
        break;
      case 'square': {
        out = (t < pw ? 1 : -1) + polyBlep(t, dt) - polyBlep((t + 1 - pw) % 1, dt);
        break;
      }
      case 'tri': {
        // A leaky integral of a band-limited square.
        const sq = (t < 0.5 ? 1 : -1) + polyBlep(t, dt) - polyBlep((t + 0.5) % 1, dt);
        this.tri = dt * sq * 4 + (1 - dt * 0.5) * this.tri;
        out = this.tri;
        break;
      }
      default:
        out = noise();
    }
    t += dt;
    this.wrapped = t >= 1;
    if (this.wrapped) t -= Math.floor(t);
    this.phase = t;
    return out;
  }

  reset(to = 0): void {
    this.phase = to;
  }
}

/** ADSR, linear attack and exponential decay and release, times in seconds. */
export class Envelope {
  value = 0;
  stage: 0 | 1 | 2 | 3 | 4 = 0; // idle, attack, decay/sustain, release, done
  private attackStep = 0;
  private decayCoef = 0;
  private releaseCoef = 0;
  private sustain = 0;

  set(env: Env, sr: number, rate = 1): void {
    this.attackStep = 1 / Math.max(1, env.a * sr / rate);
    this.decayCoef = 1 - Math.exp(-4.6 / Math.max(1, env.d * sr / rate));
    this.releaseCoef = 1 - Math.exp(-4.6 / Math.max(1, env.r * sr / rate));
    this.sustain = env.s;
  }

  gate(on: boolean, retrigger = true): void {
    if (on) {
      if (retrigger || this.stage === 0 || this.stage === 4 || this.stage === 3) this.stage = 1;
    } else if (this.stage !== 0 && this.stage !== 4) this.stage = 3;
  }

  next(): number {
    switch (this.stage) {
      case 1:
        this.value += this.attackStep;
        if (this.value >= 1) {
          this.value = 1;
          this.stage = 2;
        }
        break;
      case 2:
        this.value += (this.sustain - this.value) * this.decayCoef;
        break;
      case 3:
        this.value -= this.value * this.releaseCoef;
        if (this.value < 1e-4) {
          this.value = 0;
          this.stage = 4;
        }
        break;
    }
    return this.value;
  }
}

/** Zero-delay-feedback four-pole ladder low-pass, with drive on its input. */
export class Ladder {
  private s = [0, 0, 0, 0];
  private G = 0;
  private g1 = 1;
  private k = 0;

  set(cutoff: number, res: number, sr: number): void {
    const g = Math.tan(Math.PI * clamp(cutoff, 10, sr * 0.45) / sr);
    this.G = g / (1 + g);
    this.g1 = 1 / (1 + g);
    this.k = clamp(res, 0, 1) * 3.9;
  }

  process(x: number, drive: number): number {
    const { G, g1, k, s } = this;
    const G2 = G * G;
    const sigma = G2 * G * s[0] * g1 + G2 * s[1] * g1 + G * s[2] * g1 + s[3] * g1;
    const G4 = G2 * G2;
    // Resonance thins the low end of a ladder; a little of the input back makes it up.
    const y4 = (G4 * x * (1 + k * 0.3) + sigma) / (1 + k * G4);
    let u = softClip((x * (1 + k * 0.3) - k * y4) * drive) / drive;
    for (let i = 0; i < 4; i++) {
      const v = (u - s[i]) * G;
      const y = v + s[i];
      s[i] = y + v;
      u = y;
    }
    return u;
  }

  clear(): void {
    this.s.fill(0);
  }
}

/** Zero-delay-feedback state-variable filter: low, band, high and notch at once. */
export class Svf {
  lp = 0;
  bp = 0;
  hp = 0;
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 2;

  set(cutoff: number, res: number, sr: number): void {
    const g = Math.tan(Math.PI * clamp(cutoff, 10, sr * 0.45) / sr);
    this.k = 2 - 1.96 * clamp(res, 0, 1);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  process(x: number): void {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1;
    this.hp = x - this.k * v1 - v2;
  }

  /** The band-pass at unity gain at its centre, whatever the resonance. */
  get bpNorm(): number {
    return this.bp * this.k;
  }

  get notch(): number {
    return this.lp + this.hp;
  }

  clear(): void {
    this.ic1 = this.ic2 = 0;
  }
}

/** Vowel formants (Hz) for a, e, i, o, u. */
const VOWELS = [
  [730, 1090, 2440],
  [530, 1840, 2480],
  [270, 2290, 3010],
  [570, 840, 2410],
  [300, 870, 2240],
];
const FORMANT_GAIN = [1, 0.6, 0.28];

/** Three band-passes tuned to a vowel; `vowel` 0-1 morphs a, e, i, o, u. */
export class Formant {
  private bands = [new Svf(), new Svf(), new Svf()];

  set(vowel: number, res: number, sr: number): void {
    const v = clamp(vowel, 0, 1) * 4;
    const i = Math.min(3, Math.floor(v));
    const f = v - i;
    for (let b = 0; b < 3; b++) {
      const hz = VOWELS[i][b] * (1 - f) + VOWELS[i + 1][b] * f;
      this.bands[b].set(hz, 0.75 + res * 0.22, sr);
    }
  }

  process(x: number): number {
    let y = 0;
    for (let b = 0; b < 3; b++) {
      this.bands[b].process(x);
      y += this.bands[b].bpNorm * FORMANT_GAIN[b];
    }
    return y * 1.6;
  }

  clear(): void {
    for (const b of this.bands) b.clear();
  }
}

function lfoValue(shape: Lfo['shape'], phase: number, held: number): number {
  switch (shape) {
    case 'tri':
      return 1 - 4 * Math.abs(phase - 0.5);
    case 'square':
      return phase < 0.5 ? 1 : -1;
    case 'saw':
      return 1 - 2 * phase;
    case 'random':
      return held;
    default:
      return Math.sin(TAU * phase);
  }
}

class LfoState {
  phase = 0;
  held = 0;
  value = 0;

  step(lfo: Lfo | undefined, seconds: number, bpm: number): void {
    if (!lfo) {
      this.value = 0;
      return;
    }
    const hz = lfo.beats ? bpm / 60 / lfo.beats : lfo.rate;
    this.phase += hz * seconds;
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase);
      this.held = Math.random() * 2 - 1;
    }
    this.value = lfoValue(lfo.shape, this.phase, this.held);
  }
}

/** Expression from a controller: mod wheel and aftertouch 0-1, bend -1..1. */
interface Expression {
  wheel: number;
  pressure: number;
  bend: number;
}

let noiseSeed = 22222;
function whiteNoise(): number {
  noiseSeed = (noiseSeed * 196314165 + 907633515) >>> 0;
  return noiseSeed / 2147483648 - 1;
}

class Voice {
  note = -1;
  vel = 0;
  age = 0;
  held = false;
  freq = 440;
  target = 440;
  glideCoef = 1;
  startedAt = 0;
  readonly copies: Oscillator[] = Array.from({ length: MAX_UNISON }, () => new Oscillator());
  readonly osc2 = new Oscillator();
  readonly sub = new Oscillator();
  readonly mod = new Oscillator();
  readonly amp = new Envelope();
  readonly fenv = new Envelope();
  readonly ladderL = new Ladder();
  readonly ladderR = new Ladder();
  readonly svfL = new Svf();
  readonly svfR = new Svf();
  readonly formantL = new Formant();
  readonly formantR = new Formant();
  /** Slow pitch wander, cents, and this voice's own fixed offset. */
  drift = 0;
  driftTarget = 0;
  slop = 0;
  fmIndex = 0;
  pitchEnv = 0;
  /** Seconds since the note started, for LFO delay. */
  time = 0;
  /** Smoothed control values, so a coefficient change never clicks. */
  cutoff = 1000;

  get active(): boolean {
    return this.amp.stage !== 0 && this.amp.stage !== 4;
  }

  clear(): void {
    this.ladderL.clear();
    this.ladderR.clear();
    this.svfL.clear();
    this.svfR.clear();
    this.formantL.clear();
    this.formantR.clear();
  }
}

/** Effects on the engine's stereo sum. */
class FxChain {
  private sr: number;
  private buf: Float32Array;
  private bufMask: number;
  private write = 0;
  private chorusPhase = 0;
  private chorusPhase2 = 0;
  private delayL: Float32Array;
  private delayR: Float32Array;
  private dWrite = 0;
  private dampL = 0;
  private dampR = 0;
  private phaserPhase = 0;
  private apL = [0, 0, 0, 0, 0, 0];
  private apR = [0, 0, 0, 0, 0, 0];
  private phFbL = 0;
  private phFbR = 0;
  private wahEnv = 0;
  private wahL = new Svf();
  private wahR = new Svf();
  private holdL = 0;
  private holdR = 0;
  private holdCount = 0;

  constructor(sr: number) {
    this.sr = sr;
    const size = 1 << Math.ceil(Math.log2(sr * 0.05));
    this.buf = new Float32Array(size);
    this.bufMask = size - 1;
    this.delayL = new Float32Array(Math.ceil(sr * 2.1));
    this.delayR = new Float32Array(Math.ceil(sr * 2.1));
  }

  private tap(delaySamples: number): number {
    const pos = this.write - delaySamples;
    const i = Math.floor(pos);
    const f = pos - i;
    const a = this.buf[i & this.bufMask];
    const b = this.buf[(i + 1) & this.bufMask];
    return a + (b - a) * f;
  }

  /** In place over two channels. */
  run(fx: ToneFx | undefined, L: Float32Array, R: Float32Array, n: number, bpm: number): void {
    if (!fx) return;
    const sr = this.sr;
    if (fx.drive) {
      const d = 1 + fx.drive * 8;
      const norm = 1 / softClip(d * 0.5) * 0.5;
      for (let i = 0; i < n; i++) {
        L[i] = softClip(L[i] * d) * norm;
        R[i] = softClip(R[i] * d) * norm;
      }
    }
    if (fx.wah) {
      const { amount, base, res } = fx.wah;
      const att = 1 - Math.exp(-1 / (0.004 * sr));
      const rel = 1 - Math.exp(-1 / (0.12 * sr));
      for (let i = 0; i < n; i++) {
        const level = Math.abs(L[i] + R[i]) * 0.5;
        this.wahEnv += (level - this.wahEnv) * (level > this.wahEnv ? att : rel);
        if ((i & 15) === 0) {
          const hz = base * Math.pow(2, clamp(this.wahEnv * amount * 14, 0, 5.5));
          this.wahL.set(hz, res, sr);
          this.wahR.set(hz, res, sr);
        }
        this.wahL.process(L[i]);
        this.wahR.process(R[i]);
        L[i] = this.wahL.bp * 1.8 + this.wahL.lp * 0.25;
        R[i] = this.wahR.bp * 1.8 + this.wahR.lp * 0.25;
      }
    }
    if (fx.phaser && fx.phaser.mix > 0) {
      const { mix, rate, depth, fb } = fx.phaser;
      for (let i = 0; i < n; i++) {
        this.phaserPhase += rate / sr;
        if (this.phaserPhase >= 1) this.phaserPhase -= 1;
        const sweep = 0.5 + 0.5 * Math.sin(TAU * this.phaserPhase);
        const hz = 220 * Math.pow(2, sweep * depth * 5);
        const t = Math.tan(Math.PI * Math.min(hz, sr * 0.45) / sr);
        const a = (t - 1) / (t + 1);
        let xl = L[i] + this.phFbL * fb;
        let xr = R[i] + this.phFbR * fb;
        for (let s = 0; s < 6; s++) {
          const yl = a * xl + this.apL[s];
          this.apL[s] = xl - a * yl;
          xl = yl;
          const yr = a * xr + this.apR[s];
          this.apR[s] = xr - a * yr;
          xr = yr;
        }
        this.phFbL = xl;
        this.phFbR = xr;
        L[i] = L[i] * (1 - mix * 0.5) + xl * mix * 0.7;
        R[i] = R[i] * (1 - mix * 0.5) + xr * mix * 0.7;
      }
    }
    if (fx.chorus && fx.chorus.mix > 0) {
      const { mix, mode } = fx.chorus;
      const rate = mode === 1 ? 0.52 : 0.86;
      const depth = (mode === 1 ? 0.0021 : 0.0013) * sr;
      const fast = mode === 2 ? 0.00025 * sr : 0;
      const base = 0.0068 * sr;
      for (let i = 0; i < n; i++) {
        this.buf[this.write & this.bufMask] = (L[i] + R[i]) * 0.5;
        this.chorusPhase += rate / sr;
        if (this.chorusPhase >= 1) this.chorusPhase -= 1;
        this.chorusPhase2 += 6.1 / sr;
        if (this.chorusPhase2 >= 1) this.chorusPhase2 -= 1;
        const wob = fast * Math.sin(TAU * this.chorusPhase2);
        const p = this.chorusPhase;
        const t1 = this.tap(base + depth * Math.sin(TAU * p) + wob);
        const t2 = this.tap(base + depth * Math.sin(TAU * (p + 1 / 3)) - wob);
        const t3 = this.tap(base + depth * Math.sin(TAU * (p + 2 / 3)) + wob);
        L[i] = L[i] * (1 - mix * 0.4) + (t1 * 0.7 + t2 * 0.5) * mix;
        R[i] = R[i] * (1 - mix * 0.4) + (t3 * 0.7 + t2 * 0.5) * mix;
        this.write++;
      }
    }
    if (fx.delay && fx.delay.mix > 0) {
      const { mix, beats, fb } = fx.delay;
      const size = this.delayL.length;
      const d = clamp(Math.round((beats * 60) / Math.max(30, bpm) * sr), 1, size - 1);
      const damp = 1 - Math.exp(-TAU * (1500 + (fx.delay.tone ?? 0.5) * 7000) / sr);
      for (let i = 0; i < n; i++) {
        const r = (this.dWrite - d + size) % size;
        const dl = this.delayL[r];
        const dr = this.delayR[r];
        this.dampL += (dl - this.dampL) * damp;
        this.dampR += (dr - this.dampR) * damp;
        // Ping-pong: each side feeds the other.
        this.delayL[this.dWrite] = (L[i] + R[i]) * 0.5 + this.dampR * fb;
        this.delayR[this.dWrite] = this.dampL * fb;
        this.dWrite = (this.dWrite + 1) % size;
        L[i] += dl * mix;
        R[i] += dr * mix;
      }
    }
    if (fx.crush) {
      const levels = Math.pow(2, clamp(fx.crush.bits, 2, 16));
      const hold = Math.max(1, Math.round(fx.crush.hold));
      for (let i = 0; i < n; i++) {
        if (this.holdCount++ % hold === 0) {
          this.holdL = Math.round(L[i] * levels) / levels;
          this.holdR = Math.round(R[i] * levels) / levels;
        }
        L[i] = this.holdL;
        R[i] = this.holdR;
      }
    }
  }
}

/** A queue of timed messages, played at their sample within the block. */
interface Timed {
  at: number;
  msg: ToneMessage;
  /** Played by the arpeggiator, so it goes straight to the voices. */
  arp?: boolean;
}

/** A polyphonic subtractive and FM tone engine. */
export class ToneEngine {
  readonly sr: number;
  private patch: TonePatch | null = null;
  private voices: Voice[] = Array.from({ length: 10 }, () => new Voice());
  private stack: number[] = [];
  private fx: FxChain;
  private lfo1 = new LfoState();
  private lfo2 = new LfoState();
  private expr: Expression = { wheel: 0, pressure: 0, bend: 0 };
  private bpm = 120;
  private queue: Timed[] = [];
  private counter = 0;
  private arp: Arpeggiator | null = null;
  private L: Float32Array = new Float32Array(128);
  private R: Float32Array = new Float32Array(128);

  constructor(sr: number) {
    this.sr = sr;
    this.fx = new FxChain(sr);
  }

  message(msg: ToneMessage, now: number): void {
    if (msg.t === 'on' || msg.t === 'off') {
      this.queue.push({ at: Math.max(now, msg.at), msg });
      this.queue.sort((a, b) => a.at - b.at);
      return;
    }
    if (msg.t === 'patch') {
      const was = this.patch;
      this.patch = msg.patch;
      if (!was || !!was.mono !== !!msg.patch.mono || !!was.arp !== !!msg.patch.arp) this.panic();
      if (msg.patch.arp) {
        if (this.arp) this.arp.settings = msg.patch.arp;
        else this.arp = new Arpeggiator(msg.patch.arp);
      } else this.arp = null;
    } else if (msg.t === 'expr') {
      if (msg.wheel !== undefined) this.expr.wheel = msg.wheel;
      if (msg.pressure !== undefined) this.expr.pressure = msg.pressure;
      if (msg.bend !== undefined) this.expr.bend = msg.bend;
    } else if (msg.t === 'tempo') this.bpm = msg.bpm;
    else if (msg.t === 'panic') this.panic();
  }

  panic(): void {
    this.queue = [];
    this.stack = [];
    this.arp?.clear();
    for (const v of this.voices) {
      v.amp.stage = 0;
      v.amp.value = 0;
      v.fenv.stage = 0;
      v.held = false;
      v.note = -1;
      v.clear();
    }
  }

  /** Whether anything is sounding or waiting. */
  get busy(): boolean {
    return this.queue.length > 0 || this.voices.some((v) => v.active);
  }

  private start(note: number, vel: number): void {
    const p = this.patch;
    if (!p) return;
    if (p.mono) {
      this.stack = this.stack.filter((n) => n !== note);
      this.stack.push(note);
      const v = this.voices[0];
      const sliding = v.active && v.held;
      v.target = mtof(note);
      if (!sliding || !p.glide) v.freq = v.target;
      v.glideCoef = p.glide ? 1 - Math.exp(-1 / (p.glide * this.sr * 0.3)) : 1;
      v.note = note;
      v.held = true;
      if (!(sliding && p.legato)) this.trigger(v, p, vel, sliding);
      return;
    }
    const poly = Math.min(this.voices.length, p.poly ?? 8);
    let v = this.voices.slice(0, poly).find((x) => !x.active);
    if (!v) {
      // Steal: the quietest released voice, else the oldest.
      const pool = this.voices.slice(0, poly);
      const released = pool.filter((x) => !x.held);
      v = released.length
        ? released.reduce((a, b) => (a.amp.value <= b.amp.value ? a : b))
        : pool.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b));
    }
    v.note = note;
    v.held = true;
    v.target = v.freq = mtof(note);
    v.glideCoef = 1;
    this.trigger(v, p, vel, false);
  }

  private trigger(v: Voice, p: TonePatch, vel: number, sliding: boolean): void {
    v.vel = vel;
    v.startedAt = this.counter;
    v.time = 0;
    v.amp.set(p.aenv, this.sr);
    v.fenv.set(p.fenv, this.sr, CONTROL);
    v.amp.gate(true);
    v.fenv.gate(true);
    v.fmIndex = p.fm ? p.fm.index * (1 - (p.fm.vel ?? 0.5) + (p.fm.vel ?? 0.5) * vel) : 0;
    v.pitchEnv = p.pitchEnv ? p.pitchEnv.cents : 0;
    const drift = p.drift ?? 0;
    v.slop = (Math.random() * 2 - 1) * drift * 7;
    if (!sliding) {
      if (p.sync || p.fm) {
        v.osc2.reset(0);
        v.mod.reset(0);
      }
      if (v.amp.value < 0.01) v.clear();
    }
  }

  private stop(note: number): void {
    const p = this.patch;
    if (!p) return;
    if (p.mono) {
      this.stack = this.stack.filter((n) => n !== note);
      const v = this.voices[0];
      if (v.note !== note) return;
      const back = this.stack[this.stack.length - 1];
      if (back !== undefined) {
        // Fall back to the note still held, gliding or retriggering like a mono synth.
        v.note = back;
        v.target = mtof(back);
        if (!p.glide) v.freq = v.target;
        if (!p.legato) this.trigger(v, p, v.vel, true);
        return;
      }
      v.held = false;
      v.amp.gate(false);
      v.fenv.gate(false);
      return;
    }
    for (const v of this.voices) {
      if (v.held && v.note === note) {
        v.held = false;
        v.amp.gate(false);
        v.fenv.gate(false);
      }
    }
  }

  /** Render `n` samples into L and R (added to what is there). `now` is the block's start in seconds. */
  process(outL: Float32Array, outR: Float32Array, n: number, now: number): void {
    if (this.L.length < n) {
      this.L = new Float32Array(n);
      this.R = new Float32Array(n);
    }
    const L = this.L;
    const R = this.R;
    L.fill(0, 0, n);
    R.fill(0, 0, n);
    const p = this.patch;
    if (this.arp) this.runArp(now, n);
    let i = 0;
    while (i < n) {
      // Events due before the next control step land on their sample.
      const t = now + i / this.sr;
      while (this.queue.length && this.queue[0].at <= t + 0.5 / this.sr) {
        const { msg, arp } = this.queue.shift()!;
        if (this.arp && !arp) {
          // Keys feed the arpeggiator; it plays the voices.
          if (msg.t === 'on') this.arp.press(msg.note, msg.vel);
          else if (msg.t === 'off') this.arp.release(msg.note);
        } else if (msg.t === 'on') this.start(msg.note, msg.vel);
        else if (msg.t === 'off') this.stop(msg.note);
      }
      let end = Math.min(n, i + CONTROL);
      if (this.queue.length) {
        const due = Math.ceil((this.queue[0].at - now) * this.sr);
        if (due > i && due < end) end = due;
      }
      if (p) this.renderSpan(p, L, R, i, end);
      i = end;
    }
    if (p) this.fx.run(p.fx, L, R, n, this.bpm);
    for (let j = 0; j < n; j++) {
      outL[j] += L[j];
      outR[j] += R[j];
    }
    this.counter += n;
  }

  /** Queue the arpeggio's notes for this block, on a grid at the engine's tempo. */
  private runArp(now: number, n: number): void {
    const arp = this.arp!;
    // A key pressed during this block starts the run on its own sample.
    const end = now + n / this.sr;
    let from = now;
    for (const q of this.queue) {
      if (q.at >= end) break;
      if (!q.arp && q.msg.t === 'on' && !arp.active) {
        from = Math.max(now, q.at);
        // Press it now so the first step lands on the key.
        arp.press(q.msg.note, q.msg.vel);
        this.queue.splice(this.queue.indexOf(q), 1);
        break;
      }
    }
    const spb = 60 / Math.max(1, this.bpm);
    const steps = arp.advance((end - from) / spb);
    if (!steps.length) return;
    for (const s of steps) {
      const at = from + s.at * spb;
      this.queue.push({ at, msg: { t: 'on', note: s.note, vel: s.vel, at }, arp: true });
      this.queue.push({ at: at + s.len * spb, msg: { t: 'off', note: s.note, at: at + s.len * spb }, arp: true });
    }
    this.queue.sort((a, b) => a.at - b.at);
  }

  private renderSpan(p: TonePatch, L: Float32Array, R: Float32Array, from: number, to: number): void {
    const sr = this.sr;
    const span = to - from;
    const seconds = span / sr;
    this.lfo1.step(p.lfo1, seconds, this.bpm);
    this.lfo2.step(p.lfo2, seconds, this.bpm);
    const e = this.expr;
    const unison = Math.max(1, Math.min(MAX_UNISON, p.unison?.voices ?? 1));
    const stereo = unison > 1 && (p.unison?.spread ?? 0) > 0;
    const velAmt = p.vel ?? 0.6;
    const bendCents = e.bend * (p.bend ?? 2) * 100;
    const fm = p.fm;
    for (const v of this.voices) {
      if (!v.active) continue;
      // ── Control rate ──
      v.time += seconds;
      const d1 = p.lfo1?.delay ? clamp(v.time / p.lfo1.delay, 0, 1) : 1;
      const d2 = p.lfo2?.delay ? clamp(v.time / p.lfo2.delay, 0, 1) : 1;
      const l1 = this.lfo1.value * d1;
      const l2 = this.lfo2.value * d2;
      const fe = v.fenv.next();
      if (p.drift) {
        if (Math.random() < seconds * 2) v.driftTarget = (Math.random() * 2 - 1) * p.drift * 9;
        v.drift += (v.driftTarget - v.drift) * Math.min(1, seconds * 1.5);
      }
      if (v.pitchEnv && p.pitchEnv) v.pitchEnv *= Math.exp(-seconds / Math.max(0.001, p.pitchEnv.time / 4.6));
      const wheelVib = p.wheel === 'vibrato' ? e.wheel * 30 * Math.sin(TAU * (this.counter / sr) * 5.5) : 0;
      const cents = (p.lfo1?.pitch ?? 0) * l1 + (p.lfo2?.pitch ?? 0) * l2 + bendCents + v.drift + v.slop + v.pitchEnv + wheelVib;
      const f = p.filter;
      const velOct = (f.vel ?? 0.3) * (v.vel - 0.7) * 3;
      const keyOct = (f.keyTrack ?? 0.5) * Math.log2(v.freq / 261.6);
      const wheelOct = p.wheel === 'cutoff' ? e.wheel * 3 : 0;
      const octaves = (f.env ?? 0) * fe + keyOct + velOct + (p.lfo1?.cutoff ?? 0) * l1 + (p.lfo2?.cutoff ?? 0) * l2 + e.pressure * 1.5 + wheelOct;
      const cutoff = clamp(f.cutoff * Math.pow(2, octaves), 20, sr * 0.45);
      v.cutoff += (cutoff - v.cutoff) * 0.6;
      if (f.mode === 'ladder') {
        v.ladderL.set(v.cutoff, f.res, sr);
        if (stereo) v.ladderR.set(v.cutoff, f.res, sr);
      } else if (f.mode === 'formant') {
        const vowel = clamp((f.vowel ?? 0) + (f.vowelEnv ?? 0) * fe + (p.lfo1?.vowel ?? 0) * l1 + (p.lfo2?.vowel ?? 0) * l2 + (p.wheel === 'vowel' ? e.wheel : 0), 0, 1);
        v.formantL.set(vowel, f.res, sr);
        if (stereo) v.formantR.set(vowel, f.res, sr);
      } else if (f.mode !== 'off') {
        v.svfL.set(v.cutoff, f.res, sr);
        if (stereo) v.svfR.set(v.cutoff, f.res, sr);
      }
      const pwMod = (p.lfo1?.pw ?? 0) * l1 + (p.lfo2?.pw ?? 0) * l2;
      const ampMod = 1 + (p.lfo1?.amp ?? 0) * l1 + (p.lfo2?.amp ?? 0) * l2;
      const velGain = 1 - velAmt + velAmt * v.vel;
      const pitchMul = Math.pow(2, cents / 1200);
      const drive = 1 + (f.drive ?? 0) * 4;
      const fmDecay = fm ? Math.exp(-span / Math.max(1, fm.decay * sr)) : 1;
      const fmFloor = fm ? fm.index * (fm.sustain ?? 0) : 0;
      // ── Audio rate ──
      const o1 = p.osc1;
      const o2 = p.osc2;
      const m1 = Math.pow(2, (o1.oct ?? 0) + (o1.semi ?? 0) / 12 + (o1.detune ?? 0) / 1200);
      const m2 = o2 ? Math.pow(2, (o2.oct ?? 0) + (o2.semi ?? 0) / 12 + (o2.detune ?? 0) / 1200) : 1;
      const pw1 = clamp((o1.pw ?? 0.5) + pwMod * 0.4, 0.05, 0.95);
      const pw2 = o2 ? clamp((o2.pw ?? 0.5) + pwMod * 0.4, 0.05, 0.95) : 0.5;
      const uDet = p.unison?.detune ?? 0;
      const spread = p.unison?.spread ?? 0;
      const uLevel = 1 / Math.sqrt(unison);
      for (let s = from; s < to; s++) {
        if (v.glideCoef < 1) v.freq += (v.target - v.freq) * v.glideCoef;
        const hz = v.freq * pitchMul;
        let pm = 0;
        if (fm) {
          const mod = v.mod.next('sine', (hz * fm.ratio) / sr, 0.5, 0, whiteNoise);
          pm = mod * v.fmIndex * 0.16;
        }
        let xl = 0;
        let xr = 0;
        const dt1 = (hz * m1) / sr;
        for (let u = 0; u < unison; u++) {
          const off = unison > 1 ? u / (unison - 1) - 0.5 : 0;
          const dt = dt1 * (unison > 1 ? Math.pow(2, (off * uDet) / 1200) : 1);
          const y = v.copies[u].next(o1.wave, dt, pw1, pm, whiteNoise) * o1.level * uLevel;
          if (stereo) {
            const pan = 0.5 + off * spread;
            xl += y * (1 - pan) * 1.4;
            xr += y * pan * 1.4;
          } else xl += y;
        }
        if (o2) {
          if (p.sync && v.copies[0].wrapped) v.osc2.reset(0);
          const y = v.osc2.next(o2.wave, (hz * m2) / sr, pw2, 0, whiteNoise) * o2.level;
          xl += y;
          if (stereo) xr += y;
        }
        if (p.sub) {
          const y = v.sub.next('square', (hz * 0.5) / sr, 0.5, 0, whiteNoise) * p.sub;
          xl += y;
          if (stereo) xr += y;
        }
        if (p.noise) {
          const y = whiteNoise() * p.noise;
          xl += y;
          if (stereo) xr += y;
        }
        let yl: number;
        let yr: number;
        switch (f.mode) {
          case 'ladder':
            yl = v.ladderL.process(xl, drive);
            yr = stereo ? v.ladderR.process(xr, drive) : yl;
            break;
          case 'formant':
            yl = v.formantL.process(xl);
            yr = stereo ? v.formantR.process(xr) : yl;
            break;
          case 'off':
            yl = xl;
            yr = stereo ? xr : yl;
            break;
          default: {
            v.svfL.process(xl);
            yl = f.mode === 'lp' ? v.svfL.lp : f.mode === 'bp' ? v.svfL.bp : f.mode === 'hp' ? v.svfL.hp : v.svfL.notch;
            if (stereo) {
              v.svfR.process(xr);
              yr = f.mode === 'lp' ? v.svfR.lp : f.mode === 'bp' ? v.svfR.bp : f.mode === 'hp' ? v.svfR.hp : v.svfR.notch;
            } else yr = yl;
          }
        }
        const a = v.amp.next() * velGain * ampMod * p.gain;
        L[s] += yl * a;
        R[s] += yr * a;
      }
      if (fm) v.fmIndex = fmFloor + (v.fmIndex - fmFloor) * fmDecay;
      if (!v.active) v.note = -1;
    }
  }
}

// ── Drums ────────────────────────────────────────────────────────────────

/** Hat and cymbal partials, as ratios of the base frequency. */
const METAL = [1, 1.4836, 1.8, 2.546, 2.63, 3.897];

class DrumHit {
  sound!: DrumSound;
  slot = 0;
  t = 0;
  vel = 1;
  freq = 100;
  decay = 0.3;
  tone = 0.5;
  drive = 0;
  level = 1;
  done = true;
  phase = 0;
  phase2 = 0;
  phase3 = 0;
  /** The glitch model's current step value. */
  held = 0;
  metal = new Float64Array(6);
  hp = new Svf();
  bp = new Svf();
  prevNoise = 0;
  /** Per-sample fade once a closed hat cuts this one, and where it has got to. */
  choke = 1;
  chokeGain = 1;
}

/** Synthesised drum kits: one sound per slot, played by hits. */
export class DrumEngine {
  readonly sr: number;
  private kit: DrumKit | null = null;
  private hits: DrumHit[] = Array.from({ length: 16 }, () => new DrumHit());
  private queue: Array<{ at: number; slot: number; vel: number; tweak: DrumTweak }> = [];
  private fx: FxChain;
  private bpm = 120;
  private L = new Float32Array(128);
  private R = new Float32Array(128);

  constructor(sr: number) {
    this.sr = sr;
    this.fx = new FxChain(sr);
  }

  message(msg: ToneMessage, now: number): void {
    if (msg.t === 'kit') this.kit = msg.kit;
    else if (msg.t === 'hit') {
      this.queue.push({ at: Math.max(now, msg.at), slot: msg.slot, vel: msg.vel, tweak: msg.tweak });
      this.queue.sort((a, b) => a.at - b.at);
    } else if (msg.t === 'tempo') this.bpm = msg.bpm;
    else if (msg.t === 'panic') {
      this.queue = [];
      for (const h of this.hits) h.done = true;
    }
  }

  get busy(): boolean {
    return this.queue.length > 0 || this.hits.some((h) => !h.done);
  }

  private strike(slot: number, vel: number, tw: DrumTweak): void {
    const kit = this.kit;
    const sound = kit?.sounds[slot];
    if (!sound) return;
    // A closed hat cuts an open one.
    if (slot === 3 || sound.cuts) for (const h of this.hits) if (!h.done && h.sound.choke) h.choke = Math.exp(-1 / (0.006 * this.sr));
    let h = this.hits.find((x) => x.done);
    if (!h) h = this.hits.reduce((a, b) => (a.t >= b.t ? a : b));
    // Each hit a hair different, so repeats breathe.
    const jitter = () => Math.random() * 2 - 1;
    h.sound = sound;
    h.slot = slot;
    h.t = 0;
    h.vel = vel;
    h.freq = sound.freq * Math.pow(2, (tw.tune - 0.5) * 2 + jitter() * 0.006);
    h.decay = Math.max(0.005, sound.decay * Math.pow(2, (tw.decay - 0.5) * 2) * (1 + jitter() * 0.04));
    h.tone = clamp(sound.tone + (tw.tone - 0.5) + (vel - 0.75) * 0.15, 0, 1);
    h.drive = clamp((sound.drive ?? 0) + (tw.drive - 0.5), 0, 1);
    h.level = sound.level * tw.level * (1 + jitter() * 0.06) * Math.pow(vel, 1.3);
    h.done = false;
    h.phase = 0;
    h.phase2 = 0;
    h.choke = 1;
    h.chokeGain = 1;
    for (let i = 0; i < 6; i++) h.metal[i] = Math.random();
    h.hp.clear();
    h.bp.clear();
    const sr = this.sr;
    const m = sound.model;
    if (m === 'hat' || m === 'cymbal') {
      h.bp.set(6500 + h.tone * 5000, 0.35, sr);
      h.hp.set(m === 'hat' ? 6800 : 4500, 0.1, sr);
    } else if (m === 'snare') h.hp.set(1200 + h.tone * 3500, 0.2, sr);
    else if (m === 'clap') h.bp.set(h.freq, 0.45, sr);
    else if (m === 'cowbell') h.bp.set(h.freq * 2.1, 0.55, sr);
    else if (m === 'rim') h.bp.set(h.freq * 1.6, 0.7, sr);
    else if (m === 'shaker' || m === 'scrape') {
      h.bp.set(h.freq * (0.8 + h.tone * 0.5), m === 'scrape' ? 0.55 : 0.3, sr);
      h.hp.set(1500, 0.1, sr);
    } else if (m === 'rise') h.bp.set(h.freq * 3, 0.5, sr);
    else h.hp.set(2500 + h.tone * 4000, 0.1, sr);
    h.held = 0;
    h.phase3 = 0;
  }

  process(outL: Float32Array, outR: Float32Array, n: number, now: number): void {
    if (this.L.length < n) {
      this.L = new Float32Array(n);
      this.R = new Float32Array(n);
    }
    const L = this.L;
    L.fill(0, 0, n);
    const sr = this.sr;
    const dt = 1 / sr;
    let i = 0;
    while (i < n) {
      const t = now + i / sr;
      while (this.queue.length && this.queue[0].at <= t + 0.5 / sr) {
        const q = this.queue.shift()!;
        this.strike(q.slot, q.vel, q.tweak);
      }
      let end = n;
      if (this.queue.length) {
        const due = Math.ceil((this.queue[0].at - now) * sr);
        if (due > i && due < end) end = due;
      }
      for (const h of this.hits) if (!h.done) this.renderHit(h, L, i, end, dt);
      i = end;
    }
    const R = this.R;
    R.set(L.subarray(0, n));
    if (this.kit) this.fx.run(this.kit.fx, L, R, n, this.bpm);
    const g = this.kit?.gain ?? 1;
    for (let j = 0; j < n; j++) {
      outL[j] += L[j] * g;
      outR[j] += R[j] * g;
    }
  }

  private renderHit(h: DrumHit, out: Float32Array, from: number, to: number, dt: number): void {
    const s = h.sound;
    const sr = this.sr;
    const drive = 1 + h.drive * 6;
    const norm = h.drive > 0 ? 1 / softClip(drive * 0.6) * 0.6 : 1;
    let t = h.t;
    for (let i = from; i < to; i++) {
      let y = 0;
      let alive = true;
      switch (s.model) {
        case 'kick':
        case 'tom':
        case 'zap': {
          const bendTime = s.model === 'zap' ? 0.012 : s.model === 'kick' ? 0.028 + (1 - h.tone) * 0.03 : 0.06;
          const hz = h.freq * Math.pow(2, (s.bend ?? 1.5) * Math.exp(-t / bendTime));
          h.phase += hz * dt;
          if (h.phase >= 1) h.phase -= 1;
          const amp = Math.exp(-t / (h.decay * 0.3));
          y = Math.sin(TAU * h.phase) * amp;
          if (s.click && t < 0.006) {
            const nz = whiteNoise();
            y += (nz - h.prevNoise) * s.click * (1 - t / 0.006) * 0.6;
            h.prevNoise = nz;
          }
          if (s.model === 'tom') y += whiteNoise() * 0.04 * Math.exp(-t / 0.02);
          alive = amp > 1e-3;
          break;
        }
        case 'snare': {
          h.phase += h.freq * Math.pow(2, 0.25 * Math.exp(-t / 0.01)) * dt;
          if (h.phase >= 1) h.phase -= 1;
          h.phase2 += h.freq * 1.47 * dt;
          if (h.phase2 >= 1) h.phase2 -= 1;
          const body = (Math.sin(TAU * h.phase) + 0.5 * Math.sin(TAU * h.phase2)) * Math.exp(-t / (0.035 + h.decay * 0.08));
          h.hp.process(whiteNoise());
          const snap = h.hp.hp * Math.exp(-t / (h.decay * 0.3));
          y = body * (1 - h.tone * 0.6) * 0.8 + snap * (0.4 + h.tone * 0.8);
          alive = t < h.decay * 2.5;
          break;
        }
        case 'clap': {
          // Three quick slaps, then the room.
          let env = 0;
          for (let b = 0; b < 3; b++) {
            const tb = t - b * 0.0105;
            if (tb >= 0 && tb < 0.0105) env = Math.max(env, Math.exp(-tb / 0.0032));
          }
          if (t >= 0.0315) env = Math.max(env, 0.8 * Math.exp(-(t - 0.0315) / (h.decay * 0.33)));
          h.bp.process(whiteNoise());
          y = h.bp.bp * env * 2.4;
          alive = t < 0.04 + h.decay * 2.5;
          break;
        }
        case 'hat':
        case 'cymbal': {
          let sq = 0;
          for (let p = 0; p < 6; p++) {
            h.metal[p] += h.freq * METAL[p] * dt;
            if (h.metal[p] >= 1) h.metal[p] -= 1;
            sq += h.metal[p] < 0.5 ? 1 : -1;
          }
          const x = sq / 6 + (s.model === 'cymbal' ? whiteNoise() * 0.35 : whiteNoise() * 0.1);
          h.bp.process(x);
          h.hp.process(h.bp.bp);
          h.chokeGain *= h.choke;
          const env = Math.exp(-t / (h.decay * 0.3)) * h.chokeGain;
          y = h.hp.hp * env * 2.2;
          alive = env > 1e-3;
          break;
        }
        case 'cowbell': {
          h.phase += h.freq * dt;
          if (h.phase >= 1) h.phase -= 1;
          h.phase2 += h.freq * 1.48 * dt;
          if (h.phase2 >= 1) h.phase2 -= 1;
          const x = (h.phase < 0.5 ? 1 : -1) + (h.phase2 < 0.5 ? 1 : -1);
          h.bp.process(x);
          const env = t < 0.012 ? 1 - (t / 0.012) * 0.4 : 0.6 * Math.exp(-(t - 0.012) / (h.decay * 0.3));
          y = h.bp.bp * env * 1.3;
          alive = env > 1e-3;
          break;
        }
        case 'rim': {
          h.phase += h.freq * dt;
          if (h.phase >= 1) h.phase -= 1;
          h.bp.process(Math.sin(TAU * h.phase) + whiteNoise() * 0.6);
          const env = Math.exp(-t / (h.decay * 0.25));
          y = h.bp.bp * env * 1.8;
          alive = env > 1e-3;
          break;
        }
        case 'blip': {
          h.phase += h.freq * Math.pow(2, (s.bend ?? 0.5) * (1 - Math.exp(-t / 0.01))) * dt;
          if (h.phase >= 1) h.phase -= 1;
          const env = Math.exp(-t / (h.decay * 0.3));
          y = (h.phase < 0.5 ? 0.6 : -0.6) * env;
          alive = env > 1e-3;
          break;
        }
        case 'membrane': {
          // A hand drum: the head's two lowest modes, a small drop in pitch as it settles, a slap on top.
          const hz = h.freq * Math.pow(2, (s.bend ?? 0.15) * Math.exp(-t / 0.018));
          h.phase += hz * dt;
          if (h.phase >= 1) h.phase -= 1;
          h.phase2 += hz * 1.59 * dt;
          if (h.phase2 >= 1) h.phase2 -= 1;
          const amp = Math.exp(-t / (h.decay * 0.3));
          y = (Math.sin(TAU * h.phase) + 0.35 * Math.sin(TAU * h.phase2) * Math.exp(-t / (h.decay * 0.12))) * amp;
          h.hp.process(whiteNoise());
          y += h.hp.hp * h.tone * 1.1 * Math.exp(-t / 0.012);
          alive = amp > 1e-3;
          break;
        }
        case 'shaker': {
          const rise = Math.min(1, t / Math.max(0.004, h.decay * 0.25));
          const env = rise * Math.exp(-Math.max(0, t - h.decay * 0.25) / (h.decay * 0.25));
          h.bp.process(whiteNoise());
          h.hp.process(h.bp.bp);
          y = h.hp.hp * env * 2.2;
          alive = t < h.decay * 0.25 || env > 1e-3;
          break;
        }
        case 'scrape': {
          // Ridges: a fast swell on each one, the whole stroke dying away.
          const ridge = (t * (s.rate ?? 38)) % 1;
          const env = Math.exp(-ridge * 7) * Math.min(1, t / 0.01) * Math.exp(-t / (h.decay * 0.6));
          h.bp.process(whiteNoise());
          y = h.bp.bp * env * 2.6;
          alive = t < h.decay * 3;
          break;
        }
        case 'bell': {
          h.phase += h.freq * dt;
          if (h.phase >= 1) h.phase -= 1;
          h.phase2 += h.freq * 2.76 * dt;
          if (h.phase2 >= 1) h.phase2 -= 1;
          h.phase3 += h.freq * 5.4 * dt;
          if (h.phase3 >= 1) h.phase3 -= 1;
          const amp = Math.exp(-t / (h.decay * 0.3));
          const hi = Math.exp(-t / (h.decay * 0.1));
          y = (Math.sin(TAU * h.phase) + h.tone * 0.6 * Math.sin(TAU * h.phase2) * hi + h.tone * 0.35 * Math.sin(TAU * h.phase3) * hi) * amp * 0.7;
          alive = amp > 1e-3;
          break;
        }
        case 'rise': {
          // A friction drum: the stick pulls the pitch up, then lets it fall back.
          const up = (s.bend ?? 1) * (1 - Math.exp(-t / (h.decay * 0.15))) * Math.exp(-t / (h.decay * 0.6));
          h.phase += h.freq * Math.pow(2, up) * dt;
          if (h.phase >= 1) h.phase -= 1;
          const env = Math.min(1, t / 0.008) * Math.exp(-t / (h.decay * 0.3));
          h.bp.process(whiteNoise());
          y = (Math.sin(TAU * h.phase) * 0.9 + h.bp.bp * h.tone * 0.5) * env;
          alive = t < 0.01 || env > 1e-3;
          break;
        }
        case 'glitch': {
          h.phase += (s.rate ?? 60) * dt;
          if (h.phase >= 1) {
            h.phase -= 1;
            h.held = Math.random() * 2 - 1;
          }
          h.phase2 += h.freq * (1 + h.held * 0.8) * dt;
          if (h.phase2 >= 1) h.phase2 -= 1;
          const env = Math.exp(-t / (h.decay * 0.3));
          const sq = h.phase2 < 0.5 ? 0.5 : -0.5;
          y = (sq * (1 - h.tone) + h.held * 0.5 * h.tone) * env;
          alive = env > 1e-3;
          break;
        }
        case 'fm': {
          h.phase2 += h.freq * (s.rate ?? 1.41) * dt;
          if (h.phase2 >= 1) h.phase2 -= 1;
          const index = (1 + h.tone * 6) * Math.exp(-t / (h.decay * 0.15));
          h.phase += h.freq * dt;
          if (h.phase >= 1) h.phase -= 1;
          const amp = Math.exp(-t / (h.decay * 0.3));
          y = Math.sin(TAU * h.phase + index * Math.sin(TAU * h.phase2)) * amp * 0.8;
          alive = amp > 1e-3;
          break;
        }
        case 'laser': {
          const hz = h.freq * Math.pow(2, (s.bend ?? 3) * Math.exp(-t / Math.max(0.01, h.decay * 0.2)));
          h.phase += hz * dt;
          if (h.phase >= 1) h.phase -= 1;
          const amp = Math.exp(-t / (h.decay * 0.3));
          y = (Math.sin(TAU * h.phase) * (1 - h.tone) + (h.phase < 0.5 ? 0.5 : -0.5) * h.tone) * amp;
          alive = amp > 1e-3;
          break;
        }
      }
      if (h.drive > 0) y = softClip(y * drive) * norm;
      out[i] += y * h.level * 0.8;
      t += dt;
      if (!alive) {
        h.done = true;
        break;
      }
    }
    h.t = t;
  }
}
