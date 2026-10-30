/**
 * The effects rack: four units in series, each with its own dry/wet mix.
 * Instruments patched into "FX in" run through it; the rest play dry.
 * Knob values arrive 0-1 under "fx.<unit>.<param>" and are mapped to useful
 * ranges here. Units of the same kind work the same in every rack.
 */

import { FX_RACKS, type FxKind, type StudioSet } from './studioSets';

type Params = Record<string, number>;

interface Unit {
  input: GainNode;
  output: GainNode;
  set(params: Params, tempo: number): void;
}

/** A unit with a dry path and a wet path, crossfaded by its "mix" knob. */
export function wetDry(ctx: AudioContext, wetIn: AudioNode, wetOut: AudioNode): { input: GainNode; output: GainNode; mix: (v: number) => void } {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  input.connect(dry).connect(output);
  input.connect(wetIn);
  wetOut.connect(wet).connect(output);
  return {
    input,
    output,
    mix: (v) => {
      const t = ctx.currentTime;
      // Equal-power so the level holds steady across the sweep.
      dry.gain.setTargetAtTime(Math.cos((v * Math.PI) / 2), t, 0.03);
      wet.gain.setTargetAtTime(Math.sin((v * Math.PI) / 2), t, 0.03);
    },
  };
}

/** A decaying stereo noise burst: the impulse response of a room. */
export function impulse(ctx: AudioContext, seconds: number, decay: number, bright: number, gateAt = 1): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = t > gateAt ? 0 : Math.pow(1 - t, decay);
      const white = Math.random() * 2 - 1;
      // A one-pole filter darkens the tail when "bright" is low.
      last = last + (white - last) * (0.15 + bright * 0.85);
      data[i] = last * env;
    }
  }
  return buffer;
}

/**
 * A spring tank: a ringing, dispersive tail (high notes arrive first, the
 * "boing"), made from swept sines under a noisy decay.
 */
function springImpulse(ctx: AudioContext, seconds: number, tone: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let phase = 0;
    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const env = Math.pow(1 - i / length, 2.2);
      // The chirp falls from a few kHz and repeats as the wave bounces in the spring.
      const bounce = (t * (6 + c)) % 1;
      const freq = 300 + (2500 + tone * 3000) * Math.pow(1 - bounce, 3);
      phase += (2 * Math.PI * freq) / ctx.sampleRate;
      data[i] = (Math.sin(phase) * 0.6 + (Math.random() * 2 - 1) * 0.4) * env * 0.5;
    }
  }
  return buffer;
}

export function softClip(amount: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1024);
  const norm = Math.tanh(amount);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / norm;
  }
  return curve;
}

/**
 * Saturation for inside a feedback loop: unity gain for quiet signals and
 * squashing only loud ones, so the loop decays at the feedback setting and
 * runs away only near the top of the knob. (`softClip` boosts quiet signals,
 * which in a loop would make it oscillate on its own.)
 */
export function loopClip(amount: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / amount;
  }
  return curve;
}

/** Beat divisions for tempo-locked echoes, shortest first. */
const ECHO_DIVISIONS = [0.25, 0.375, 0.5, 0.75, 1, 1.5, 2];

function reverbUnit(ctx: AudioContext, key: (p: string) => string, kind: FxKind): Unit {
  const convolver = ctx.createConvolver();
  const pre = ctx.createBiquadFilter();
  pre.type = 'highpass';
  pre.frequency.value = kind === 'shimmer' ? 500 : 120;
  const post = ctx.createGain();
  post.gain.value = kind === 'shimmer' ? 1.4 : 1;
  pre.connect(convolver).connect(post);
  const io = wetDry(ctx, pre, post);
  let shape = '';
  return {
    input: io.input,
    output: io.output,
    set(p) {
      let next: string;
      let build: () => AudioBuffer;
      if (kind === 'spring') {
        const seconds = 0.8 + (p[key('decay')] ?? 0.6) * 3;
        const tone = p[key('tone')] ?? 0.5;
        next = `s:${seconds.toFixed(1)}:${tone.toFixed(1)}`;
        build = () => springImpulse(ctx, seconds, tone);
      } else {
        const space = p[key(kind === 'shimmer' ? 'size' : 'space')] ?? 0.5;
        const decay = kind === 'reverb' ? p[key('decay')] ?? 0.5 : 0.5;
        const bright = kind === 'shimmer' ? p[key('tone')] ?? 0.6 : 0.55;
        const gate = kind === 'gate' ? 0.15 + (p[key('length')] ?? 0.4) * 0.6 : 1;
        const seconds = kind === 'gate' ? 0.25 + space * 1.2 : 0.6 + space * (kind === 'shimmer' ? 9 : 6);
        next = [seconds.toFixed(1), decay.toFixed(1), bright.toFixed(1), gate.toFixed(2)].join(':');
        build = () => impulse(ctx, seconds, 1.5 + (1 - decay) * 5, bright, gate);
      }
      // Rebuilding the room is costly, so only when the knobs moved enough to hear.
      if (next !== shape) {
        shape = next;
        convolver.buffer = build();
      }
      io.mix(p[key('mix')] ?? 0);
    },
  };
}

function delayUnit(ctx: AudioContext, key: (p: string) => string, kind: FxKind): Unit {
  const delay = ctx.createDelay(4);
  const feedback = ctx.createGain();
  const tone = ctx.createBiquadFilter();
  const dub = kind === 'dubdelay';
  const echo = kind === 'echo';
  tone.type = dub ? 'bandpass' : 'lowpass';
  tone.frequency.value = dub ? 1400 : 3200;
  tone.Q.value = dub ? 0.8 : 0.3;
  // The tape echo saturates and wobbles in its loop, so repeats darken and drift.
  const sat = ctx.createWaveShaper();
  sat.curve = loopClip(echo ? 2.2 : 1);
  delay.connect(tone).connect(sat).connect(feedback).connect(delay);
  const wow = ctx.createOscillator();
  wow.frequency.value = 0.7;
  const wowDepth = ctx.createGain();
  wowDepth.gain.value = 0;
  wow.connect(wowDepth).connect(delay.delayTime);
  wow.start();
  const io = wetDry(ctx, delay, sat);
  return {
    input: io.input,
    output: io.output,
    set(p, tempo) {
      const t = ctx.currentTime;
      const time = p[key('time')] ?? 0.5;
      const seconds = echo
        ? (ECHO_DIVISIONS[Math.round(time * (ECHO_DIVISIONS.length - 1))] * 60) / Math.max(30, tempo)
        : 0.06 + time * (dub ? 0.69 : 1.1);
      delay.delayTime.setTargetAtTime(seconds, t, 0.08);
      // At the top of its knob a tape echo just passes unity: the dub
      // runaway, held in check by its saturation.
      const ceiling = echo ? 1.04 : 0.92;
      feedback.gain.setTargetAtTime(Math.min(ceiling, (p[key('feedback')] ?? 0.4) * ceiling), t, 0.05);
      if (echo) {
        tone.frequency.setTargetAtTime(500 + Math.pow(p[key('tone')] ?? 0.45, 2) * 7000, t, 0.05);
        wowDepth.gain.setTargetAtTime((p[key('wow')] ?? 0.3) * 0.004, t, 0.1);
      }
      io.mix(p[key('mix')] ?? 0);
    },
  };
}

function tapeUnit(ctx: AudioContext, key: (p: string) => string): Unit {
  const wobble = ctx.createDelay(0.1);
  wobble.delayTime.value = 0.012;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.6;
  const depth = ctx.createGain();
  lfo.connect(depth).connect(wobble.delayTime);
  lfo.start();
  const warm = ctx.createBiquadFilter();
  warm.type = 'lowpass';
  const sat = ctx.createWaveShaper();
  wobble.connect(sat).connect(warm);
  const io = wetDry(ctx, wobble, warm);
  let age = -1;
  return {
    input: io.input,
    output: io.output,
    set(p) {
      const t = ctx.currentTime;
      depth.gain.setTargetAtTime((p[key('wow')] ?? 0.3) * 0.006, t, 0.1);
      const a = p[key('age')] ?? 0.4;
      warm.frequency.setTargetAtTime(9000 - a * 7000, t, 0.1);
      if (Math.abs(a - age) > 0.02) {
        age = a;
        sat.curve = softClip(1 + a * 4);
      }
      io.mix(p[key('mix')] ?? 0);
    },
  };
}

function driveUnit(ctx: AudioContext, key: (p: string) => string): Unit {
  const shaper = ctx.createWaveShaper();
  shaper.oversample = '2x';
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  const trim = ctx.createGain();
  shaper.connect(tone).connect(trim);
  const io = wetDry(ctx, shaper, trim);
  let gain = -1;
  return {
    input: io.input,
    output: io.output,
    set(p) {
      const g = p[key('gain')] ?? 0.45;
      if (Math.abs(g - gain) > 0.02) {
        gain = g;
        shaper.curve = softClip(1 + g * 14);
      }
      tone.frequency.setTargetAtTime(800 + (p[key('tone')] ?? 0.5) * 9000, ctx.currentTime, 0.05);
      trim.gain.setTargetAtTime(1 / (1 + g * 1.5), ctx.currentTime, 0.05);
      io.mix(p[key('mix')] ?? 0);
    },
  };
}

function crushUnit(ctx: AudioContext, key: (p: string) => string): Unit {
  const shaper = ctx.createWaveShaper();
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  shaper.connect(tone);
  const io = wetDry(ctx, shaper, tone);
  let bits = -1;
  return {
    input: io.input,
    output: io.output,
    set(p) {
      const b = Math.round(2 + (p[key('bits')] ?? 0.6) * 10);
      if (b !== bits) {
        bits = b;
        const steps = Math.pow(2, b);
        const curve = new Float32Array(1024);
        for (let i = 0; i < curve.length; i++) {
          const x = (i / (curve.length - 1)) * 2 - 1;
          curve[i] = Math.round(x * steps) / steps;
        }
        shaper.curve = curve;
      }
      // Without a sample-rate reducer, "rate" closes a filter for the same lo-fi dulling.
      tone.frequency.setTargetAtTime(1200 + (p[key('rate')] ?? 0.7) * 14000, ctx.currentTime, 0.05);
      io.mix(p[key('mix')] ?? 0);
    },
  };
}

/** The dub sweep: a resonant low-pass you ride down and back up. */
function sweepUnit(ctx: AudioContext, key: (p: string) => string): Unit {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  const io = wetDry(ctx, filter, filter);
  return {
    input: io.input,
    output: io.output,
    set(p) {
      filter.frequency.setTargetAtTime(80 * Math.pow(18000 / 80, p[key('cutoff')] ?? 1), ctx.currentTime, 0.02);
      filter.Q.setTargetAtTime(0.5 + (p[key('reso')] ?? 0.4) * 16, ctx.currentTime, 0.03);
      io.mix(p[key('mix')] ?? 1);
    },
  };
}

function chorusUnit(ctx: AudioContext, key: (p: string) => string): Unit {
  const delay = ctx.createDelay(0.1);
  delay.delayTime.value = 0.018;
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  lfo.connect(depth).connect(delay.delayTime);
  lfo.start();
  const io = wetDry(ctx, delay, delay);
  return {
    input: io.input,
    output: io.output,
    set(p) {
      lfo.frequency.setTargetAtTime(0.05 * Math.pow(120, p[key('rate')] ?? 0.3), ctx.currentTime, 0.1);
      depth.gain.setTargetAtTime((p[key('depth')] ?? 0.4) * 0.008, ctx.currentTime, 0.1);
      io.mix(p[key('mix')] ?? 0);
    },
  };
}

function buildUnit(ctx: AudioContext, kind: FxKind, key: (p: string) => string): Unit {
  switch (kind) {
    case 'shimmer':
    case 'reverb':
    case 'gate':
    case 'spring':
      return reverbUnit(ctx, key, kind);
    case 'delay':
    case 'dubdelay':
    case 'echo':
      return delayUnit(ctx, key, kind);
    case 'tape':
      return tapeUnit(ctx, key);
    case 'drive':
      return driveUnit(ctx, key);
    case 'crush':
      return crushUnit(ctx, key);
    case 'sweep':
      return sweepUnit(ctx, key);
    case 'chorus':
      return chorusUnit(ctx, key);
  }
}

export class FxRack {
  readonly input: GainNode;
  readonly output: GainNode;
  private units: Unit[];
  private tempo = 120;

  constructor(ctx: AudioContext, set: StudioSet) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.units = FX_RACKS[set].map((def) => buildUnit(ctx, def.kind, (p) => `fx.${def.id}.${p}`));
    let node: AudioNode = this.input;
    for (const unit of this.units) {
      node.connect(unit.input);
      node = unit.output;
    }
    node.connect(this.output);
  }

  setParams(params: Params, tempo = this.tempo): void {
    this.tempo = tempo;
    for (const unit of this.units) unit.set(params, tempo);
  }

  dispose(): void {
    try { this.input.disconnect(); this.output.disconnect(); } catch { /* gone */ }
  }
}
