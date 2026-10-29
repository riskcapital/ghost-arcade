/**
 * The effects rack: four units in series, each with its own dry/wet mix.
 * Instruments patched into "FX in" run through it; the rest play dry.
 * Knob values arrive 0-1 and are mapped to useful ranges here.
 */

import { FX_RACKS, type StudioSet } from './studioSets';

interface Unit {
  input: GainNode;
  output: GainNode;
  set(params: Record<string, number>): void;
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

function reverbUnit(ctx: AudioContext, keys: { space: string; decay?: string; tone?: string; length?: string; mix: string }, options: { shimmer?: boolean; gated?: boolean } = {}): Unit {
  const convolver = ctx.createConvolver();
  const pre = ctx.createBiquadFilter();
  pre.type = 'highpass';
  pre.frequency.value = options.shimmer ? 500 : 120;
  const post = ctx.createGain();
  post.gain.value = options.shimmer ? 1.4 : 1;
  pre.connect(convolver).connect(post);
  const io = wetDry(ctx, pre, post);
  let shape = '';
  return {
    input: io.input,
    output: io.output,
    set(p) {
      const space = p[keys.space] ?? 0.5;
      const decay = keys.decay ? p[keys.decay] ?? 0.5 : 0.5;
      const bright = keys.tone ? p[keys.tone] ?? 0.5 : options.shimmer ? 0.9 : 0.55;
      const gate = keys.length ? 0.15 + (p[keys.length] ?? 0.4) * 0.6 : 1;
      const seconds = options.gated ? 0.25 + space * 1.2 : 0.6 + space * (options.shimmer ? 9 : 6);
      // Rebuilding the room is costly, so only when the knobs moved enough to hear.
      const next = [seconds.toFixed(1), decay.toFixed(1), bright.toFixed(1), gate.toFixed(2)].join(':');
      if (next !== shape) {
        shape = next;
        convolver.buffer = impulse(ctx, seconds, 1.5 + (1 - decay) * 5, bright, gate);
      }
      io.mix(p[keys.mix] ?? 0);
    },
  };
}

function delayUnit(ctx: AudioContext, keys: { time: string; feedback: string; mix: string }, dub: boolean): Unit {
  const delay = ctx.createDelay(2.5);
  const feedback = ctx.createGain();
  const tone = ctx.createBiquadFilter();
  tone.type = dub ? 'bandpass' : 'lowpass';
  tone.frequency.value = dub ? 1400 : 3200;
  tone.Q.value = dub ? 0.8 : 0.3;
  delay.connect(tone).connect(feedback).connect(delay);
  const io = wetDry(ctx, delay, tone);
  return {
    input: io.input,
    output: io.output,
    set(p) {
      const t = ctx.currentTime;
      delay.delayTime.setTargetAtTime(0.06 + (p[keys.time] ?? 0.5) * (dub ? 0.69 : 1.1), t, 0.08);
      feedback.gain.setTargetAtTime(Math.min(0.92, (p[keys.feedback] ?? 0.4) * 0.92), t, 0.05);
      io.mix(p[keys.mix] ?? 0);
    },
  };
}

function tapeUnit(ctx: AudioContext): Unit {
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
      depth.gain.setTargetAtTime((p['fx.tape.wow'] ?? 0.3) * 0.006, t, 0.1);
      const a = p['fx.tape.age'] ?? 0.4;
      warm.frequency.setTargetAtTime(9000 - a * 7000, t, 0.1);
      if (Math.abs(a - age) > 0.02) {
        age = a;
        sat.curve = softClip(1 + a * 4);
      }
      io.mix(p['fx.tape.mix'] ?? 0);
    },
  };
}

function driveUnit(ctx: AudioContext): Unit {
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
      const g = p['fx.drive.gain'] ?? 0.45;
      if (Math.abs(g - gain) > 0.02) {
        gain = g;
        shaper.curve = softClip(1 + g * 14);
      }
      tone.frequency.setTargetAtTime(800 + (p['fx.drive.tone'] ?? 0.5) * 9000, ctx.currentTime, 0.05);
      trim.gain.setTargetAtTime(1 / (1 + g * 1.5), ctx.currentTime, 0.05);
      io.mix(p['fx.drive.mix'] ?? 0);
    },
  };
}

function crushUnit(ctx: AudioContext): Unit {
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
      const b = Math.round(2 + (p['fx.crush.bits'] ?? 0.6) * 10);
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
      tone.frequency.setTargetAtTime(1200 + (p['fx.crush.rate'] ?? 0.7) * 14000, ctx.currentTime, 0.05);
      io.mix(p['fx.crush.mix'] ?? 0);
    },
  };
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

export class FxRack {
  readonly input: GainNode;
  readonly output: GainNode;
  private units: Unit[];

  constructor(ctx: AudioContext, set: StudioSet) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.units = FX_RACKS[set].map((def) => {
      switch (def.id) {
        case 'shimmer': return reverbUnit(ctx, { space: 'fx.shimmer.size', tone: 'fx.shimmer.tone', mix: 'fx.shimmer.mix' }, { shimmer: true });
        case 'tape': return tapeUnit(ctx);
        case 'delay': return delayUnit(ctx, { time: 'fx.delay.time', feedback: 'fx.delay.feedback', mix: 'fx.delay.mix' }, false);
        case 'reverb': return reverbUnit(ctx, { space: 'fx.reverb.space', decay: 'fx.reverb.decay', mix: 'fx.reverb.mix' });
        case 'drive': return driveUnit(ctx);
        case 'crush': return crushUnit(ctx);
        case 'dub': return delayUnit(ctx, { time: 'fx.dub.time', feedback: 'fx.dub.feedback', mix: 'fx.dub.mix' }, true);
        default: return reverbUnit(ctx, { space: 'fx.gate.space', length: 'fx.gate.length', mix: 'fx.gate.mix' }, { gated: true });
      }
    });
    let node: AudioNode = this.input;
    for (const unit of this.units) {
      node.connect(unit.input);
      node = unit.output;
    }
    node.connect(this.output);
  }

  setParams(params: Record<string, number>): void {
    for (const unit of this.units) unit.set(params);
  }

  dispose(): void {
    try { this.input.disconnect(); this.output.disconnect(); } catch { /* gone */ }
  }
}
