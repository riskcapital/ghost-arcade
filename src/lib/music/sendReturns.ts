/**
 * The mixer's shared effect returns: a reverb, a tape echo (timed to the
 * tempo) and a spring. Every channel strip has a send to each, after its
 * fader and pan; the returns play into the master with their own levels.
 * One of each for the whole studio, however many channels send to it.
 */

import { impulse, loopClip } from './fxRack';
import { LazyConvolver } from './lazyConvolver';
import { holdAt } from './sounds/kit';

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
  private echoTone: BiquadFilterNode;
  private echoFb: GainNode;
  private ctx: AudioContext;
  /** The reverb and the spring are built when a channel first sends to them. */
  private rooms: Record<'reverb' | 'spring', LazyConvolver>;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;
    const mk = () => ctx.createGain();
    this.inputs = { reverb: mk(), echo: mk(), spring: mk() };
    this.levels = { reverb: mk(), echo: mk(), spring: mk() };
    // Reverb: a long, soft hall.
    const verb = new LazyConvolver(ctx, () => impulse(ctx, 3.2, 2.4, 0.45));
    this.inputs.reverb.connect(verb.input);
    verb.output.connect(this.levels.reverb);
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
    this.echoTone = tone;
    this.echoFb = fb;
    this.inputs.echo.connect(this.delay);
    this.delay.connect(tone).connect(hp).connect(sat);
    sat.connect(fb).connect(this.delay);
    sat.connect(this.levels.echo);
    // Spring: short and drippy.
    const spring = new LazyConvolver(ctx, () => springBuffer(ctx));
    this.inputs.spring.connect(spring.input);
    spring.output.connect(this.levels.spring);
    this.rooms = { reverb: verb, spring };
    for (const id of RETURN_IDS) this.levels[id].connect(out);
  }

  /**
   * Which returns some channel sends to. The reverb and spring are built the
   * first time one does; `immediate` when the engine is being set up, so a
   * saved mix comes back at full level from the first note.
   */
  route(used: Record<ReturnId, boolean>, immediate = false): void {
    if (used.reverb) this.rooms.reverb.arm(immediate);
    if (used.spring) this.rooms.spring.arm(immediate);
  }

  /**
   * Kill: the echo gets an empty delay line at once (its settings kept), and
   * the reverb and spring returns stay shut until their tails have gone,
   * then come back at their levels.
   */
  kill(): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const old = this.delay;
    const fresh = ctx.createDelay(3);
    fresh.delayTime.value = old.delayTime.value;
    try { this.inputs.echo.disconnect(old); } catch { /* gone */ }
    try { this.echoFb.disconnect(old); } catch { /* gone */ }
    try { old.disconnect(); } catch { /* gone */ }
    this.inputs.echo.connect(fresh);
    fresh.connect(this.echoTone);
    this.echoFb.connect(fresh);
    this.delay = fresh;
    for (const [id, tail] of [['reverb', 3.4], ['spring', 1.7]] as const) {
      const g = this.levels[id].gain;
      const level = g.value;
      holdAt(g, t);
      g.setValueAtTime(0, t);
      g.setValueAtTime(0, t + tail);
      g.linearRampToValueAtTime(level, t + tail + 0.05);
    }
  }

  /** Each return's level into the master, 0-1, and the echo's time from the tempo. */
  set(levels: Record<ReturnId, number>, tempo: number): void {
    const t = this.ctx.currentTime;
    for (const id of RETURN_IDS) this.levels[id].gain.setTargetAtTime(Math.max(0, Math.min(1.2, levels[id] * 1.2)), t, 0.03);
    this.delay.delayTime.setTargetAtTime(Math.min(2.9, (0.75 * 60) / Math.max(40, tempo)), t, 0.05);
  }
}
