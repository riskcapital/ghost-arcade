/**
 * The audio side of macro effects: one chain per macro, in macro order, on
 * the studio's master bus. The chain is rebuilt only when effects are added,
 * removed or switched; turning a knob or a macro just moves parameters.
 */

import { impulse, softClip, wetDry } from './fxRack';
import { division, effectiveValue, type MacroFxInstance, type MacroFxType } from './macroFx';

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

function phaserUnit(ctx: AudioContext): Unit {
  const stages = Array.from({ length: 4 }, () => {
    const f = ctx.createBiquadFilter();
    f.type = 'allpass';
    f.frequency.value = 800;
    f.Q.value = 0.7;
    return f;
  });
  for (let i = 0; i < stages.length - 1; i++) stages[i].connect(stages[i + 1]);
  const last = stages[stages.length - 1];
  const fb = ctx.createGain();
  last.connect(fb).connect(stages[0]);
  const mod = lfo(ctx);
  for (const st of stages) mod.depth.connect(st.frequency);
  const io = wetDry(ctx, stages[0], last);
  return {
    input: io.input,
    output: io.output,
    set(v) {
      glide(mod.osc.frequency, expRange(0.05, 8, v.rate), ctx, 0.1);
      glide(mod.depth.gain, 200 + v.depth * 1800, ctx, 0.1);
      glide(fb.gain, v.feedback * 0.75, ctx);
      io.mix(v.mix);
    },
    dispose() { try { mod.osc.stop(); } catch { /* stopped */ } },
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

const BUILDERS: Record<MacroFxType, (ctx: AudioContext) => Unit> = {
  delay: delayUnit,
  filter: filterUnit,
  reverb: reverbUnit,
  chorus: chorusUnit,
  phaser: phaserUnit,
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
