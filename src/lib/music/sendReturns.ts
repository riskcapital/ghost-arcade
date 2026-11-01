/**
 * The mixer's shared effect returns: a reverb, a tape echo (timed to the
 * tempo) and a spring. Every channel strip has a send to each, after its
 * fader and pan; the returns play into the master with their own levels.
 * One of each for the whole studio, however many channels send to it.
 */

import { impulse, loopClip } from './fxRack';

export type ReturnId = 'reverb' | 'echo' | 'spring';
export const RETURN_IDS: ReturnId[] = ['reverb', 'echo', 'spring'];
export const RETURN_LABELS: Record<ReturnId, string> = { reverb: 'Reverb', echo: 'Echo', spring: 'Spring' };

function springBuffer(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 1.8);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const s = i / ctx.sampleRate;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-s * 2.8) * (1 + 0.6 * Math.sin(2 * Math.PI * (410 + ch * 33) * s * (1 + s * 0.35))) * 0.45;
    }
  }
  return buf;
}

export class SendReturns {
  /** Where each send goes. */
  readonly inputs: Record<ReturnId, GainNode>;
  private levels: Record<ReturnId, GainNode>;
  private delay: DelayNode;
  private ctx: AudioContext;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;
    const mk = () => ctx.createGain();
    this.inputs = { reverb: mk(), echo: mk(), spring: mk() };
    this.levels = { reverb: mk(), echo: mk(), spring: mk() };
    // Reverb: a long, soft hall.
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 3.2, 2.4, 0.45);
    this.inputs.reverb.connect(verb).connect(this.levels.reverb);
    // Echo: a dotted-eighth tape echo that darkens and saturates instead of running away.
    this.delay = ctx.createDelay(3);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 140;
    const sat = ctx.createWaveShaper();
    sat.curve = loopClip(1.3);
    const fb = ctx.createGain();
    fb.gain.value = 0.48;
    this.inputs.echo.connect(this.delay);
    this.delay.connect(tone).connect(hp).connect(sat);
    sat.connect(fb).connect(this.delay);
    sat.connect(this.levels.echo);
    // Spring: short and drippy.
    const spring = ctx.createConvolver();
    spring.buffer = springBuffer(ctx);
    this.inputs.spring.connect(spring).connect(this.levels.spring);
    for (const id of RETURN_IDS) this.levels[id].connect(out);
  }

  /** Each return's level into the master, 0-1, and the echo's time from the tempo. */
  set(levels: Record<ReturnId, number>, tempo: number): void {
    const t = this.ctx.currentTime;
    for (const id of RETURN_IDS) this.levels[id].gain.setTargetAtTime(Math.max(0, Math.min(1.2, levels[id] * 1.2)), t, 0.03);
    this.delay.delayTime.setTargetAtTime(Math.min(2.9, (0.75 * 60) / Math.max(40, tempo)), t, 0.05);
  }
}
