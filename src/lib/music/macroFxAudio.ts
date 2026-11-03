/**
 * The audio side of macro effects: one chain per macro, in macro order, on
 * the studio's master bus. The chain is rebuilt only when effects are added,
 * removed or switched; turning a knob or a macro just moves parameters.
 */

import { impulse, loopClip, softClip, wetDry } from './fxRack';
import { division, effectiveValue, type MacroFxInstance, type MacroFxType } from './macroFx';
import type { FxDspKind } from './fxDsp';

type Values = Record<string, number>;

interface Unit {
  input: AudioNode;
  output: AudioNode;
  set(v: Values, tempo: number): void;
  dispose(): void;
}

const t = (ctx: AudioContext) => ctx.currentTime;
const glide = (param: AudioParam, value: number, ctx: AudioContext, tc = 0.03) => param.setTargetAtTime(value, t(ctx), tc);
const expRange = (lo: number, hi: number, v: number) => lo * Math.pow(hi / lo, v);

function lfo(ctx: AudioContext): { osc: OscillatorNode; depth: GainNode } {
  const osc = ctx.createOscillator();
  const depth = ctx.createGain();
  osc.connect(depth);
  osc.start();
  return { osc, depth };
}

function delayUnit(ctx: AudioContext): Unit {
  // Ping-pong: left feeds right feeds left, panned apart by "spread".
  const inSplit = ctx.createGain();
  const left = ctx.createDelay(4);
  const right = ctx.createDelay(4);
  const fbL = ctx.createGain();
  const fbR = ctx.createGain();
  const toneL = ctx.createBiquadFilter();
  const toneR = ctx.createBiquadFilter();
  toneL.type = toneR.type = 'lowpass';
  const panL = ctx.createStereoPanner();
  const panR = ctx.createStereoPanner();
  const wetOut = ctx.createGain();
  inSplit.connect(left);
  left.connect(toneL).connect(fbL).connect(right);
  right.connect(toneR).connect(fbR).connect(left);
  toneL.connect(panL).connect(wetOut);
  toneR.connect(panR).connect(wetOut);
  const io = wetDry(ctx, inSplit, wetOut);
  return {
    input: io.input,
    output: io.output,
    set(v, tempo) {
      const seconds = (division(v.time).beats * 60) / Math.max(30, tempo);
      glide(left.delayTime, seconds, ctx, 0.05);
      glide(right.delayTime, seconds, ctx, 0.05);
      const fb = Math.min(0.95, v.feedback * 0.95);
      glide(fbL.gain, fb, ctx);
      glide(fbR.gain, fb, ctx);
      const tone = expRange(600, 16000, v.tone);
      glide(toneL.frequency, tone, ctx);
      glide(toneR.frequency, tone, ctx);
      glide(panL.pan, -v.spread, ctx);
      glide(panR.pan, v.spread, ctx);
      io.mix(v.mix);
    },
    dispose() {},
  };
}

function filterUnit(ctx: AudioContext): Unit {
  const shaper = ctx.createWaveShaper();
  const filter = ctx.createBiquadFilter();
  shaper.connect(filter);
  const io = wetDry(ctx, shaper, filter);
  let drive = -1;
  return {
    input: io.input,
    output: io.output,
    set(v) {
      filter.type = v.mode < 0.34 ? 'lowpass' : v.mode < 0.67 ? 'bandpass' : 'highpass';
      glide(filter.frequency, expRange(60, 18000, v.cutoff), ctx, 0.02);
      glide(filter.Q, 0.5 + v.reso * 18, ctx);
      if (Math.abs(v.drive - drive) > 0.02) {
        drive = v.drive;
        shaper.curve = softClip(1 + v.drive * 8);
      }
      io.mix(v.mix);
    },
    dispose() {},
  };
}

function reverbUnit(ctx: AudioContext): Unit {
  const pre = ctx.createDelay(0.3);
  const convolver = ctx.createConvolver();
  pre.connect(convolver);
  const io = wetDry(ctx, pre, convolver);
  let shape = '';
  return {
    input: io.input,
    output: io.output,
    set(v) {
      glide(pre.delayTime, v.predelay * 0.2, ctx);
      const seconds = 0.5 + v.size * 8;
      const next = [seconds.toFixed(1), v.decay.toFixed(1), v.damping.toFixed(1)].join(':');
      if (next !== shape) {
        shape = next;
        convolver.buffer = impulse(ctx, seconds, 1.2 + (1 - v.decay) * 5, 1 - v.damping * 0.85);
      }
      io.mix(v.mix);
    },
    dispose() {},
  };
}

function chorusUnit(ctx: AudioContext): Unit {
  const delay = ctx.createDelay(0.1);
  delay.delayTime.value = 0.018;
  const fb = ctx.createGain();
  delay.connect(fb).connect(delay);
  const mod = lfo(ctx);
  mod.depth.connect(delay.delayTime);
  const io = wetDry(ctx, delay, delay);
  return {
    input: io.input,
    output: io.output,
    set(v) {
      glide(mod.osc.frequency, expRange(0.05, 6, v.rate), ctx, 0.1);
      glide(mod.depth.gain, v.depth * 0.008, ctx, 0.1);
      glide(fb.gain, v.feedback * 0.7, ctx);
      io.mix(v.mix);
    },
    dispose() { try { mod.osc.stop(); } catch { /* stopped */ } },
  };
}

/**
 * Effects that run sample by sample on the audio thread (fxDsp.ts). The
 * processor module loads once per context; until it has, the unit passes the
 * sound through untouched, then splices the effect in.
 */
const fxModules = new WeakMap<BaseAudioContext, Promise<boolean>>();
export function loadStudioFx(ctx: BaseAudioContext): Promise<boolean> {
  let loading = fxModules.get(ctx);
  if (!loading) {
    loading = (async () => {
      try {
        if (!ctx.audioWorklet) return false;
        const { default: url } = await import('./fxWorklet.ts?worker&url');
        await ctx.audioWorklet.addModule(url);
        return true;
      } catch (err) {
        console.warn('[Studio FX] Sample-by-sample effects are not available:', err);
        return false;
      }
    })();
    fxModules.set(ctx, loading);
  }
  return loading;
}

function workletUnit(kind: FxDspKind): (ctx: AudioContext) => Unit {
  return (ctx) => {
    const input = ctx.createGain();
    const output = ctx.createGain();
    input.connect(output);
    let node: AudioWorkletNode | null = null;
    let disposed = false;
    let last: { values: Values; tempo: number } | null = null;
    void loadStudioFx(ctx).then((ok) => {
      if (!ok || disposed) return;
      node = new AudioWorkletNode(ctx, 'ga-studio-fx', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { kind },
      });
      if (last) node.port.postMessage(last);
      input.disconnect(output);
      input.connect(node).connect(output);
    });
    return {
      input,
      output,
      set(v, tempo) {
        last = { values: { ...v }, tempo };
        node?.port.postMessage(last);
      },
      dispose() {
        disposed = true;
        try { node?.disconnect(); } catch { /* none */ }
        node?.port.close();
        node = null;
      },
    };
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
    set(v) {
      const b = Math.round(2 + v.bits * 14);
      if (b !== bits) {
        bits = b;
        const steps = Math.pow(2, b - 1);
        const curve = new Float32Array(2048);
        for (let i = 0; i < curve.length; i++) {
          const x = (i / (curve.length - 1)) * 2 - 1;
          curve[i] = Math.round(x * steps) / steps;
        }
        shaper.curve = curve;
      }
      glide(tone.frequency, expRange(800, 18000, v.tone), ctx);
      io.mix(v.mix);
    },
    dispose() {},
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
    set(v) {
      if (Math.abs(v.gain - gain) > 0.02) {
        gain = v.gain;
        shaper.curve = softClip(1 + v.gain * 20);
      }
      glide(tone.frequency, expRange(700, 16000, v.tone), ctx);
      glide(trim.gain, 1 / (1 + v.gain * 1.8), ctx);
      io.mix(v.mix);
    },
    dispose() {},
  };
}

/** Beat repeat: while engaged, the last slice of sound loops; let go and the music carries on. */
function stutterUnit(ctx: AudioContext): Unit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const gate = ctx.createGain();
  const loop = ctx.createDelay(4);
  const fb = ctx.createGain();
  const wet = ctx.createGain();
  input.connect(dry).connect(output);
  input.connect(gate).connect(loop);
  loop.connect(fb).connect(loop);
  loop.connect(wet).connect(output);
  wet.gain.value = 0;
  fb.gain.value = 0;
  let engaged = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    input,
    output,
    set(v, tempo) {
      const seconds = (division(v.length).beats * 60) / Math.max(30, tempo);
      loop.delayTime.setValueAtTime(seconds, t(ctx));
      const on = v.engage > 0.5;
      if (on === engaged) return;
      engaged = on;
      if (timer) clearTimeout(timer);
      if (on) {
        // Record one slice, then close the input and let it repeat.
        gate.gain.setValueAtTime(1, t(ctx));
        fb.gain.setValueAtTime(0, t(ctx));
        timer = setTimeout(() => {
          gate.gain.setValueAtTime(0, t(ctx));
          fb.gain.setValueAtTime(1, t(ctx));
          dry.gain.setTargetAtTime(0, t(ctx), 0.005);
          wet.gain.setTargetAtTime(1, t(ctx), 0.005);
        }, seconds * 1000);
      } else {
        dry.gain.setTargetAtTime(1, t(ctx), 0.005);
        wet.gain.setTargetAtTime(0, t(ctx), 0.005);
        fb.gain.setValueAtTime(0, t(ctx) + 0.02);
        gate.gain.setValueAtTime(1, t(ctx));
      }
    },
    dispose() { if (timer) clearTimeout(timer); },
  };
}

function autopanUnit(ctx: AudioContext): Unit {
  const pan = ctx.createStereoPanner();
  const mod = lfo(ctx);
  mod.depth.connect(pan.pan);
  return {
    input: pan,
    output: pan,
    set(v) {
      glide(mod.osc.frequency, expRange(0.05, 10, v.rate), ctx, 0.1);
      glide(mod.depth.gain, v.depth, ctx, 0.05);
    },
    dispose() { try { mod.osc.stop(); } catch { /* stopped */ } },
  };
}

function eqUnit(ctx: AudioContext): Unit {
  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 180;
  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.Q.value = 0.9;
  const high = ctx.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = 5000;
  low.connect(mid).connect(high);
  const db = (v: number) => (v - 0.5) * 24;
  return {
    input: low,
    output: high,
    set(v) {
      glide(low.gain, db(v.low), ctx);
      glide(mid.gain, db(v.mid), ctx);
      glide(mid.frequency, expRange(200, 5000, v.midFreq), ctx);
      glide(high.gain, db(v.high), ctx);
    },
    dispose() {},
  };
}

function compressorUnit(ctx: AudioContext): Unit {
  const comp = ctx.createDynamicsCompressor();
  comp.knee.value = 6;
  comp.release.value = 0.18;
  const makeup = ctx.createGain();
  comp.connect(makeup);
  const io = wetDry(ctx, comp, makeup);
  return {
    input: io.input,
    output: io.output,
    set(v) {
      glide(comp.threshold, -v.threshold * 48, ctx);
      glide(comp.ratio, 1 + v.ratio * 19, ctx);
      glide(comp.attack, 0.001 + v.attack * 0.099, ctx);
      glide(makeup.gain, Math.pow(10, (v.makeup * 18) / 20), ctx);
      io.mix(v.mix);
    },
    dispose() {},
  };
}

/** A tape echo: darker each repeat, the tape's speed wandering, saturating instead of running away. */
function tapeUnit(ctx: AudioContext): Unit {
  const delay = ctx.createDelay(4);
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 120;
  const sat = ctx.createWaveShaper();
  sat.curve = loopClip(1.4);
  const fb = ctx.createGain();
  const wetOut = ctx.createGain();
  const wow = lfo(ctx);
  wow.osc.frequency.value = 0.6;
  wow.depth.connect(delay.delayTime);
  delay.connect(tone).connect(hp).connect(sat);
  sat.connect(fb).connect(delay);
  sat.connect(wetOut);
  const io = wetDry(ctx, delay, wetOut);
  return {
    input: io.input,
    output: io.output,
    set(v, tempo) {
      glide(delay.delayTime, (division(v.time).beats * 60) / Math.max(30, tempo), ctx, 0.05);
      glide(fb.gain, Math.min(0.95, v.feedback * 0.95), ctx);
      glide(tone.frequency, expRange(800, 9000, v.tone), ctx);
      glide(wow.depth.gain, v.wow * 0.003, ctx);
      io.mix(v.mix);
    },
    dispose() { try { wow.osc.stop(); } catch { /* stopped */ } },
  };
}

function springUnit(ctx: AudioContext): Unit {
  const verb = ctx.createConvolver();
  // A short, bright, drippy spring.
  const len = Math.floor(ctx.sampleRate * 1.6);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const s = i / ctx.sampleRate;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-s * 3) * (1 + 0.6 * Math.sin(2 * Math.PI * (430 + ch * 31) * s * (1 + s * 0.4))) * 0.5;
    }
  }
  verb.buffer = buf;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  verb.connect(tone);
  const io = wetDry(ctx, verb, tone);
  return {
    input: io.input,
    output: io.output,
    set(v) {
      glide(tone.frequency, expRange(1200, 12000, v.tone), ctx);
      io.mix(v.mix);
    },
    dispose() {},
  };
}

const BUILDERS: Record<MacroFxType, (ctx: AudioContext) => Unit> = {
  eq: eqUnit,
  compressor: compressorUnit,
  tape: tapeUnit,
  spring: springUnit,
  delay: delayUnit,
  filter: filterUnit,
  reverb: reverbUnit,
  chorus: chorusUnit,
  phaser: workletUnit('phaser'),
  grains: workletUnit('grains'),
  shimmer: workletUnit('shimmer'),
  freqshift: workletUnit('freqshift'),
  ring: workletUnit('ring'),
  resonator: workletUnit('resonator'),
  vowel: workletUnit('vowel'),
  fold: workletUnit('fold'),
  reverse: workletUnit('reverse'),
  glitch: workletUnit('glitch'),
  tapestop: workletUnit('tapestop'),
  harmony: workletUnit('harmony'),
  crush: crushUnit,
  drive: driveUnit,
  stutter: stutterUnit,
  autopan: autopanUnit,
};

export interface MacroFxSlot {
  macroValue: number;
  effects: MacroFxInstance[];
}

export class MacroFxChain {
  readonly input: GainNode;
  readonly output: GainNode;
  private units: Array<{ id: string; unit: Unit }> = [];
  private structure = '';

  constructor(private ctx: AudioContext) {
    // Load the sample-by-sample effects now, so adding one later is instant.
    void loadStudioFx(ctx);
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.output);
  }

  /** Bring the chain in line with the macros' effects and values. */
  sync(slots: MacroFxSlot[], tempo: number): void {
    const active = slots.flatMap((slot) => slot.effects.filter((fx) => fx.enabled).map((fx) => ({ fx, macro: slot.macroValue })));
    const structure = active.map(({ fx }) => `${fx.id}:${fx.type}`).join('|');
    if (structure !== this.structure) this.rebuild(active.map(({ fx }) => fx), structure);
    active.forEach(({ fx, macro }, i) => {
      const values: Values = {};
      for (const [key, param] of Object.entries(fx.params)) values[key] = effectiveValue(param, macro);
      this.units[i]?.unit.set(values, tempo);
    });
  }

  private rebuild(effects: MacroFxInstance[], structure: string): void {
    this.structure = structure;
    try { this.input.disconnect(); } catch { /* none */ }
    const keep = new Map(this.units.map((u) => [u.id, u.unit]));
    const next: Array<{ id: string; unit: Unit }> = [];
    for (const fx of effects) {
      const unit = keep.get(fx.id) ?? BUILDERS[fx.type](this.ctx);
      keep.delete(fx.id);
      try { unit.output.disconnect(); } catch { /* none */ }
      next.push({ id: fx.id, unit });
    }
    for (const unit of keep.values()) {
      unit.dispose();
      try { unit.output.disconnect(); } catch { /* none */ }
    }
    let node: AudioNode = this.input;
    for (const { unit } of next) {
      node.connect(unit.input);
      node = unit.output;
    }
    node.connect(this.output);
    this.units = next;
  }
}
