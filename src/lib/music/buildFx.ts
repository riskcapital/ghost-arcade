/**
 * The sound of a build-up and its drop, on the studio's master between the
 * mix and the macro effects. At rest it passes the mix untouched. A build
 * sweeps a filter over the whole mix, opens an echo and reverb send, plays a
 * roll that speeds up and climbs, a riser and a reverse cymbal, and can leave
 * a gap; on the downbeat everything snaps back with an impact. A cancel puts
 * it all back at once.
 */

import type { BuildSettings } from './buildDrop';

export interface BuildPlanAudio {
  /** Audio times. */
  start: number;
  land: number;
  beatSeconds: number;
  hits: Array<{ time: number; velocity: number; pitch: number }>;
  settings: BuildSettings;
}

const REST_HP = 10;
const REST_LP = 20000;

function reverbImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3) * 0.6;
  }
  return buf;
}

export class BuildFx {
  readonly input: GainNode;
  readonly output: GainNode;
  private ctx: AudioContext;
  private noise: AudioBuffer;
  private hp: BiquadFilterNode;
  private lp: BiquadFilterNode;
  private gap: GainNode;
  private send: GainNode;
  private delay: DelayNode;
  private fb: GainNode;
  /** The roll, riser and impact: after the filter, into the send too. */
  private fxBus: GainNode;
  private sources = new Set<AudioScheduledSourceNode>();

  constructor(ctx: AudioContext, noise: AudioBuffer) {
    this.ctx = ctx;
    this.noise = noise;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = REST_HP;
    this.hp.Q.value = 0.9;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = REST_LP;
    this.lp.Q.value = 1.2;
    this.gap = ctx.createGain();
    this.input.connect(this.hp).connect(this.lp).connect(this.gap).connect(this.output);
    // The send: an echo and a reverb that open during the build and ring on after the drop.
    this.send = ctx.createGain();
    this.send.gain.value = 0;
    this.delay = ctx.createDelay(2);
    this.fb = ctx.createGain();
    this.fb.gain.value = 0.45;
    const verb = ctx.createConvolver();
    verb.buffer = reverbImpulse(ctx, 2.5);
    const clip = ctx.createWaveShaper();
    const curve = new Float32Array(new ArrayBuffer(512 * 4));
    for (let i = 0; i < 512; i++) curve[i] = Math.tanh(((i / 511) * 2 - 1) * 1.2) / Math.tanh(1.2);
    clip.curve = curve;
    this.input.connect(this.send);
    this.send.connect(this.delay).connect(clip).connect(this.fb).connect(this.delay);
    clip.connect(this.output);
    this.send.connect(verb).connect(this.output);
    this.fxBus = ctx.createGain();
    this.fxBus.connect(this.output);
    this.fxBus.connect(this.send);
  }

  /** Start (or restart) a build. Anything scheduled by an earlier one is dropped. */
  start(plan: BuildPlanAudio): void {
    this.cancel(plan.start, true);
    const { start, land, beatSeconds: beat, settings: s } = plan;
    const t0 = Math.max(this.ctx.currentTime, start);
    // The whole mix: filter sweep and the send opening, snapping back on the downbeat.
    if (s.filter === 'highpass') this.sweep(this.hp.frequency, REST_HP, 40, 1400, t0, land);
    if (s.filter === 'lowpass') this.sweep(this.lp.frequency, REST_LP, 9000, 380, t0, land);
    this.delay.delayTime.setValueAtTime(beat * 0.75, t0);
    this.send.gain.setValueAtTime(0, t0);
    this.send.gain.linearRampToValueAtTime(0.55 * s.sends, land - 0.01);
    this.send.gain.setValueAtTime(0, land);
    if (s.gap) {
      const g = land - beat * 0.5;
      this.gap.gain.setValueAtTime(1, g);
      this.gap.gain.linearRampToValueAtTime(0, g + 0.01);
      this.gap.gain.setValueAtTime(0, land - 0.005);
      this.gap.gain.linearRampToValueAtTime(1, land);
    }
    for (const h of plan.hits) if (h.time >= this.ctx.currentTime) this.roll(s.roll, h.time, h.velocity, h.pitch);
    if (s.riser > 0) this.riser(t0, land, s.riser, s.gap ? beat * 0.5 : 0);
    this.reverseCymbal(land - beat, land);
    this.impact(land, s.impact);
  }

  /** Put everything back now: filters open, the send closed, nothing still to come. */
  cancel(at = this.ctx.currentTime, quiet = false): void {
    const t = Math.max(this.ctx.currentTime, at);
    for (const p of [this.hp.frequency, this.lp.frequency, this.send.gain, this.gap.gain]) p.cancelScheduledValues(t);
    this.hp.frequency.setTargetAtTime(REST_HP, t, quiet ? 0.001 : 0.05);
    this.lp.frequency.setTargetAtTime(REST_LP, t, quiet ? 0.001 : 0.05);
    this.send.gain.setTargetAtTime(0, t, 0.05);
    this.gap.gain.setTargetAtTime(1, t, 0.01);
    for (const src of this.sources) {
      try { src.stop(t); } catch { /* already done */ }
    }
    this.sources.clear();
  }

  private sweep(param: AudioParam, rest: number, from: number, to: number, start: number, land: number): void {
    param.cancelScheduledValues(start);
    param.setValueAtTime(from, start);
    param.exponentialRampToValueAtTime(to, land - 0.01);
    param.setValueAtTime(rest, land);
  }

  private track<T extends AudioScheduledSourceNode>(src: T): T {
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
    return src;
  }

  private noiseThrough(type: BiquadFilterType, hz: number, q: number, t: number, dur: number, out: AudioNode): BiquadFilterNode {
    const src = this.track(this.ctx.createBufferSource());
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    src.connect(f).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
    return f;
  }

  private env(t: number, peak: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(this.fxBus);
    return g;
  }

  private roll(kind: BuildSettings['roll'], t: number, velocity: number, pitch: number): void {
    if (kind === 'none') return;
    const up = Math.pow(2, pitch / 12);
    if (kind === 'hats') {
      this.noiseThrough('highpass', 7000 * up, 0.8, t, 0.06, this.env(t, 0.35 * velocity, 0.05));
      return;
    }
    if (kind === 'clap') {
      this.noiseThrough('bandpass', 1200 * up, 1.4, t, 0.1, this.env(t, 0.55 * velocity, 0.09));
      return;
    }
    // Snare: a body that climbs with the build and a noise snap.
    const body = this.env(t, 0.4 * velocity, 0.08);
    const o = this.track(this.ctx.createOscillator());
    o.type = 'triangle';
    o.frequency.value = 200 * up;
    o.connect(body);
    o.start(t);
    o.stop(t + 0.1);
    this.noiseThrough('highpass', 1600 * up, 0.7, t, 0.12, this.env(t, 0.5 * velocity, 0.1));
  }

  private riser(start: number, land: number, amount: number, stopBefore: number): void {
    const end = land - stopBefore;
    if (end <= start) return;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.32 * amount, end);
    g.gain.setValueAtTime(0, end + 0.005);
    g.connect(this.fxBus);
    const f = this.noiseThrough('bandpass', 300, 4, start, end - start + 0.01, g);
    f.frequency.setValueAtTime(300, start);
    f.frequency.exponentialRampToValueAtTime(8000, end);
    const o = this.track(this.ctx.createOscillator());
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, start);
    o.frequency.exponentialRampToValueAtTime(880, end);
    const og = this.ctx.createGain();
    og.gain.value = 0.18;
    o.connect(og).connect(g);
    o.start(start);
    o.stop(end + 0.01);
  }

  /** A cymbal played backwards: noise that swells into the downbeat. */
  private reverseCymbal(from: number, land: number): void {
    const t = Math.max(this.ctx.currentTime, from);
    if (land <= t) return;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, land - 0.005);
    g.gain.setValueAtTime(0, land);
    g.connect(this.fxBus);
    this.noiseThrough('highpass', 4500, 0.6, t, land - t + 0.01, g);
  }

  /** The drop: a sub boom and a crash on the downbeat. */
  private impact(t: number, amount: number): void {
    if (amount <= 0) return;
    const boom = this.env(t, 0.9 * amount, 0.9);
    const o = this.track(this.ctx.createOscillator());
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    o.connect(boom);
    o.start(t);
    o.stop(t + 1);
    this.noiseThrough('highpass', 3000, 0.5, t, 1.8, this.env(t, 0.35 * amount, 1.7));
  }
}
