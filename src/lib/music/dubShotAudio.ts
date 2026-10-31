/**
 * The dub shots' sound. Each pad has its own echo, built once and kept, so a
 * new hit drops into a tail that is still ringing instead of cutting it. The
 * echo's loop runs through its tone filters and a soft clipper, so even a
 * held "forever" echo can only saturate, never run away. Delay times follow
 * the studio's tempo as it changes.
 */

import { divisionBeats, type DubShot } from './dubShots';

const midiToHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** A gentle tanh curve: unity for small signals, a soft ceiling for loud ones. */
function softCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * 1.2) / Math.tanh(1.2);
  }
  return c;
}

/** A short metallic spring: decaying noise with a wobble in it. */
function springImpulse(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 1.6);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      const drip = 1 + 0.6 * Math.sin(2 * Math.PI * (420 + ch * 37) * t * (1 + t * 0.4));
      d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3.2) * drip * 0.5;
    }
  }
  return buf;
}

interface Chain {
  input: GainNode;
  dry: GainNode;
  wet: GainNode;
  delays: DelayNode[];
  fb: GainNode[];
  lp: BiquadFilterNode[];
  hp: BiquadFilterNode[];
  wow: { osc: OscillatorNode; depth: GainNode } | null;
  spring: ConvolverNode | null;
  echo: DubShot['echo'];
  division: DubShot['division'];
}

export class DubShotBank {
  private ctx: AudioContext;
  private out: AudioNode;
  private noise: AudioBuffer;
  private chains = new Map<number, Chain>();
  private shots: DubShot[] = [];
  private tempo = 120;
  private curve = softCurve();
  private springBuf: AudioBuffer | null = null;
  /** While a held pad keeps its echo going. */
  private holding = new Set<number>();

  constructor(ctx: AudioContext, out: AudioNode, noise: AudioBuffer) {
    this.ctx = ctx;
    this.out = out;
    this.noise = noise;
  }

  setShots(shots: DubShot[]): void {
    this.shots = shots;
    for (const [i, chain] of this.chains) {
      const s = shots[i];
      // A new echo type rebuilds the chain; the old tail rings out on its own.
      if (!s || s.echo !== chain.echo) {
        this.retire(i);
        continue;
      }
      this.tune(chain, s, this.ctx.currentTime);
    }
  }

  setTempo(bpm: number): void {
    if (!Number.isFinite(bpm) || bpm <= 0 || Math.abs(bpm - this.tempo) < 0.01) return;
    this.tempo = bpm;
    const t = this.ctx.currentTime;
    for (const [i, chain] of this.chains) {
      const s = this.shots[i];
      if (s) this.setTime(chain, s, t);
    }
  }

  /** Fire pad `index` at `time`. Returns the echo's repeat time in seconds, for the visuals. */
  fire(index: number, velocity: number, time: number, keyRoot: number): number {
    const s = this.shots[index];
    if (!s) return 0;
    const chain = this.chain(index, s);
    this.tune(chain, s, time);
    this.play(s, chain.input, velocity, time, keyRoot);
    // The echo builds from the hit, then lets go over the tail's length.
    const fb = this.feedbackGain(s);
    for (const g of chain.fb) {
      g.gain.cancelScheduledValues(time);
      g.gain.setValueAtTime(fb, time);
      if (!this.holding.has(index)) this.release(g, s, time);
    }
    if (s.echo === 'swell') {
      chain.wet.gain.cancelScheduledValues(time);
      chain.wet.gain.setValueAtTime(0.0001, time);
      chain.wet.gain.linearRampToValueAtTime(s.mix * 1.2, time + this.seconds(s) * 3);
    }
    return this.seconds(s);
  }

  /** A held pad with Hold on keeps its echo near endless until it is let go. */
  hold(index: number, on: boolean): void {
    const s = this.shots[index];
    const chain = this.chains.get(index);
    const t = this.ctx.currentTime;
    if (on) {
      if (!s?.hold) return;
      this.holding.add(index);
      if (chain) for (const g of chain.fb) {
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0.97, t, 0.05);
      }
      return;
    }
    if (!this.holding.delete(index) || !chain || !s) return;
    for (const g of chain.fb) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      this.release(g, s, t);
    }
  }

  /** Every echo stops (Kill). */
  silence(): void {
    for (const i of [...this.chains.keys()]) this.retire(i, 0.05);
    this.holding.clear();
  }

  private seconds(s: DubShot): number {
    return (divisionBeats(s.division) * 60) / this.tempo;
  }

  private feedbackGain(s: DubShot): number {
    // 0 is a single slap; 1 is close to endless (the clipper holds it).
    return Math.min(0.95, s.feedback * 0.95);
  }

  /** Tail length: from a quick clap-back to a long fade, the feedback eases off. */
  private release(g: GainNode, s: DubShot, t: number): void {
    const hold = 0.15 + s.fade * s.fade * 18;
    g.gain.setTargetAtTime(0, t + hold, 0.25 + s.fade * 3);
  }

  private setTime(chain: Chain, s: DubShot, t: number): void {
    const sec = Math.min(3.9, this.seconds(s));
    for (const d of chain.delays) d.delayTime.setTargetAtTime(sec, t, 0.03);
  }

  private tune(chain: Chain, s: DubShot, t: number): void {
    this.setTime(chain, s, t);
    const tape = s.echo === 'tape';
    const lp = (900 + s.tone * s.tone * 9000) * (tape ? 0.6 : 1);
    const hp = 60 + (1 - s.tone) * 380;
    for (const f of chain.lp) f.frequency.setTargetAtTime(lp, t, 0.02);
    for (const f of chain.hp) f.frequency.setTargetAtTime(hp, t, 0.02);
    if (s.echo !== 'swell') chain.wet.gain.setTargetAtTime(s.mix * 1.2, t, 0.02);
    chain.dry.gain.setTargetAtTime(s.level * (1 - s.mix * 0.4), t, 0.02);
  }

  private chain(index: number, s: DubShot): Chain {
    const existing = this.chains.get(index);
    if (existing && existing.echo === s.echo) return existing;
    if (existing) this.retire(index);
    const ctx = this.ctx;
    const input = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    input.connect(dry).connect(this.out);
    wet.connect(this.out);
    const pingpong = s.echo === 'pingpong';
    const delays: DelayNode[] = [];
    const fb: GainNode[] = [];
    const lps: BiquadFilterNode[] = [];
    const hps: BiquadFilterNode[] = [];
    const legs = pingpong ? 2 : 1;
    for (let i = 0; i < legs; i++) {
      const d = ctx.createDelay(4);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.5;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.Q.value = 0.5;
      const clip = ctx.createWaveShaper();
      clip.curve = this.curve;
      const g = ctx.createGain();
      g.gain.value = 0;
      d.connect(lp).connect(hp).connect(clip).connect(g);
      if (pingpong) {
        const pan = ctx.createStereoPanner();
        pan.pan.value = i === 0 ? -0.8 : 0.8;
        clip.connect(pan).connect(wet);
      } else clip.connect(wet);
      delays.push(d);
      fb.push(g);
      lps.push(lp);
      hps.push(hp);
    }
    if (pingpong) {
      input.connect(delays[0]);
      fb[0].connect(delays[1]);
      fb[1].connect(delays[0]);
    } else {
      input.connect(delays[0]);
      fb[0].connect(delays[0]);
    }
    let wow: Chain['wow'] = null;
    if (s.echo === 'tape') {
      // Wow and flutter: the tape's speed wanders a little.
      const osc = ctx.createOscillator();
      osc.frequency.value = 0.7;
      const depth = ctx.createGain();
      depth.gain.value = 0.0016;
      osc.connect(depth).connect(delays[0].delayTime);
      osc.start();
      wow = { osc, depth };
    }
    let spring: ConvolverNode | null = null;
    if (s.echo === 'spring') {
      spring = ctx.createConvolver();
      this.springBuf ??= springImpulse(ctx);
      spring.buffer = this.springBuf;
      input.connect(spring);
      fb[0].connect(spring);
      const sg = ctx.createGain();
      sg.gain.value = 0.55;
      spring.connect(sg).connect(wet);
    }
    const chain: Chain = { input, dry, wet, delays, fb, lp: lps, hp: hps, wow, spring, echo: s.echo, division: s.division };
    this.chains.set(index, chain);
    this.tune(chain, s, ctx.currentTime);
    return chain;
  }

  /** Let a chain's tail ring out, then take it apart. */
  private retire(index: number, fadeSeconds = 6): void {
    const chain = this.chains.get(index);
    if (!chain) return;
    this.chains.delete(index);
    const t = this.ctx.currentTime;
    for (const g of chain.fb) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, fadeSeconds / 5);
    }
    chain.input.disconnect();
    chain.wet.gain.setTargetAtTime(0, t + fadeSeconds * 0.6, fadeSeconds / 8);
    setTimeout(() => {
      try { chain.wet.disconnect(); chain.dry.disconnect(); chain.wow?.osc.stop(); } catch { /* gone */ }
    }, fadeSeconds * 1000 + 500);
  }

  // ── Sources ───────────────────────────────────────────────────────────

  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  private osc(type: OscillatorType, hz: number, t: number, dur: number, out: AudioNode): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    o.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private noiseHit(t: number, type: BiquadFilterType, hz: number, q: number, dur: number, out: AudioNode): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    src.connect(f).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private play(s: DubShot, out: AudioNode, velocity: number, t: number, keyRoot: number): void {
    const v = Math.max(0.1, velocity);
    const p = Math.pow(2, s.pitch / 12);
    const note = (n: number) => midiToHz(keyRoot + 12 + s.pitch + n);
    switch (s.source) {
      case 'rim': {
        const e = this.env(t, 0.7 * v, 0.001, 0.05);
        e.connect(out);
        this.osc('triangle', 1700 * p, t, 0.06, e);
        const click = this.env(t, 0.4 * v, 0.001, 0.03);
        click.connect(out);
        this.noiseHit(t, 'bandpass', 2500 * p, 3, 0.04, click);
        break;
      }
      case 'clap': {
        for (let i = 0; i < 3; i++) {
          const e = this.env(t + i * 0.011, 0.6 * v, 0.001, 0.012);
          e.connect(out);
          this.noiseHit(t + i * 0.011, 'bandpass', 1300 * p, 1.5, 0.02, e);
        }
        const tail = this.env(t + 0.033, 0.5 * v, 0.002, 0.12);
        tail.connect(out);
        this.noiseHit(t + 0.033, 'bandpass', 1200 * p, 1.2, 0.15, tail);
        break;
      }
      case 'snare': {
        const body = this.env(t, 0.5 * v, 0.001, 0.09);
        body.connect(out);
        const o = this.osc('triangle', 220 * p, t, 0.12, body);
        o.frequency.exponentialRampToValueAtTime(150 * p, t + 0.08);
        const snap = this.env(t, 0.6 * v, 0.001, 0.16);
        snap.connect(out);
        this.noiseHit(t, 'highpass', 1800, 0.7, 0.18, snap);
        break;
      }
      case 'hat': {
        const e = this.env(t, 0.45 * v, 0.001, 0.05);
        e.connect(out);
        this.noiseHit(t, 'highpass', 7500 * p, 0.8, 0.07, e);
        break;
      }
      case 'stab':
      case 'horn': {
        const horn = s.source === 'horn';
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.Q.value = horn ? 2 : 4;
        f.frequency.setValueAtTime(horn ? 900 : 3000, t);
        f.frequency.exponentialRampToValueAtTime(horn ? 2400 : 500, t + (horn ? 0.12 : 0.15));
        const e = this.env(t, (horn ? 0.28 : 0.22) * v, horn ? 0.03 : 0.002, horn ? 0.35 : 0.18);
        f.connect(e).connect(out);
        const chord = horn ? [0, 7, 12] : [0, 3, 7, 10];
        for (const n of chord) {
          this.osc('sawtooth', note(n), t, 0.5, f);
          if (horn) this.osc('sawtooth', note(n) * 1.004, t, 0.5, f);
        }
        break;
      }
      case 'blip': {
        const e = this.env(t, 0.35 * v, 0.003, 0.18);
        e.connect(out);
        const o = this.osc('square', 900 * p, t, 0.2, e);
        o.frequency.exponentialRampToValueAtTime(1400 * p, t + 0.15);
        break;
      }
      case 'zap': {
        const e = this.env(t, 0.5 * v, 0.001, 0.16);
        e.connect(out);
        const o = this.osc('sine', 2600 * p, t, 0.18, e);
        o.frequency.exponentialRampToValueAtTime(90 * p, t + 0.16);
        break;
      }
      case 'gun': {
        const crack = this.env(t, 0.9 * v, 0.001, 0.22);
        crack.connect(out);
        this.noiseHit(t, 'lowpass', 2200 * p, 0.6, 0.25, crack);
        const thump = this.env(t, 0.7 * v, 0.001, 0.15);
        thump.connect(out);
        const o = this.osc('sine', 120 * p, t, 0.18, thump);
        o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
        break;
      }
      case 'hey': {
        // A shouted vowel: buzz through two formants that close a little.
        const e = this.env(t, 0.5 * v, 0.01, 0.22);
        e.connect(out);
        for (const [hz, q, g] of [[750, 6, 1], [1250, 8, 0.6]] as const) {
          const f = this.ctx.createBiquadFilter();
          f.type = 'bandpass';
          f.frequency.setValueAtTime(hz * p, t);
          f.frequency.linearRampToValueAtTime(hz * p * 0.85, t + 0.2);
          f.Q.value = q;
          const fg = this.ctx.createGain();
          fg.gain.value = g;
          f.connect(fg).connect(e);
          const o = this.osc('sawtooth', note(-12), t, 0.25, f);
          o.frequency.linearRampToValueAtTime(note(-13), t + 0.22);
        }
        break;
      }
      case 'crash': {
        const e = this.env(t, 0.4 * v, 0.002, 1.1);
        e.connect(out);
        this.noiseHit(t, 'highpass', 3500 * p, 0.6, 1.2, e);
        break;
      }
      case 'melodica': {
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 2600;
        const e = this.env(t, 0.3 * v, 0.04, 0.45);
        f.connect(e).connect(out);
        const vib = this.ctx.createOscillator();
        vib.frequency.value = 5.5;
        const depth = this.ctx.createGain();
        depth.gain.value = 9;
        vib.connect(depth);
        vib.start(t);
        vib.stop(t + 0.6);
        for (const type of ['square', 'triangle'] as const) {
          const o = this.osc(type, note(12), t, 0.55, f);
          depth.connect(o.detune);
        }
        break;
      }
      case 'cowbell': {
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1100 * p;
        f.Q.value = 3;
        const e = this.env(t, 0.45 * v, 0.001, 0.22);
        f.connect(e).connect(out);
        this.osc('square', 540 * p, t, 0.25, f);
        this.osc('square', 800 * p, t, 0.25, f);
        break;
      }
      case 'shaker': {
        const e = this.env(t, 0.35 * v, 0.02, 0.07);
        e.connect(out);
        this.noiseHit(t, 'bandpass', 6500 * p, 1.5, 0.1, e);
        break;
      }
      case 'tom': {
        const e = this.env(t, 0.7 * v, 0.001, 0.35);
        e.connect(out);
        const o = this.osc('sine', 180 * p, t, 0.4, e);
        o.frequency.exponentialRampToValueAtTime(70 * p, t + 0.3);
        break;
      }
      case 'roll': {
        // Six quick snare hits, getting louder, into the echo.
        for (let i = 0; i < 6; i++) {
          const ti = t + i * 0.045;
          const e = this.env(ti, (0.15 + i * 0.07) * v, 0.001, 0.05);
          e.connect(out);
          this.noiseHit(ti, 'highpass', 1800 * p, 0.7, 0.06, e);
        }
        break;
      }
      case 'woodblock': {
        const e = this.env(t, 0.55 * v, 0.001, 0.06);
        e.connect(out);
        this.osc('sine', 1050 * p, t, 0.08, e);
        this.osc('triangle', 2400 * p, t, 0.05, e);
        break;
      }
      case 'organ': {
        // A short organ chord from drawbar-like sines: the bubble.
        const e = this.env(t, 0.16 * v, 0.004, 0.12);
        e.connect(out);
        for (const n of [0, 4, 7]) for (const h of [1, 2, 3]) this.osc('sine', note(n) * h, t, 0.18, e);
        break;
      }
      case 'skank': {
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1800;
        f.Q.value = 1.2;
        const e = this.env(t, 0.3 * v, 0.001, 0.07);
        f.connect(e).connect(out);
        for (const n of [12, 16, 19, 24]) this.osc('sawtooth', note(n), t, 0.1, f);
        break;
      }
      case 'boom': {
        const e = this.env(t, 0.9 * v, 0.002, 0.7);
        e.connect(out);
        const o = this.osc('sine', note(-12) * 2, t, 0.8, e);
        o.frequency.exponentialRampToValueAtTime(note(-24), t + 0.25);
        break;
      }
      case 'riser': {
        const e = this.env(t, 0.3 * v, 0.01, 0.55);
        e.connect(out);
        const o = this.osc('triangle', 500 * p, t, 0.6, e);
        o.frequency.exponentialRampToValueAtTime(1500 * p, t + 0.5);
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = 7;
        const d = this.ctx.createGain();
        d.gain.value = 40;
        lfo.connect(d).connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + 0.6);
        break;
      }
      case 'oi': {
        const e = this.env(t, 0.55 * v, 0.008, 0.16);
        e.connect(out);
        for (const [hz, q, g] of [[550, 6, 1], [1700, 9, 0.5]] as const) {
          const f = this.ctx.createBiquadFilter();
          f.type = 'bandpass';
          f.frequency.setValueAtTime(hz * p, t);
          f.frequency.linearRampToValueAtTime(hz * p * (hz > 1000 ? 1.35 : 0.8), t + 0.15);
          f.Q.value = q;
          const fg = this.ctx.createGain();
          fg.gain.value = g;
          f.connect(fg).connect(e);
          const o = this.osc('sawtooth', note(-10), t, 0.2, f);
          o.frequency.linearRampToValueAtTime(note(-12), t + 0.16);
        }
        break;
      }
      case 'whistle': {
        const e = this.env(t, 0.3 * v, 0.01, 0.3);
        e.connect(out);
        const o = this.osc('sine', 2100 * p, t, 0.35, e);
        o.frequency.linearRampToValueAtTime(2600 * p, t + 0.12);
        o.frequency.linearRampToValueAtTime(2300 * p, t + 0.3);
        break;
      }
      case 'airhorn': {
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 2200;
        const e = this.env(t, 0.22 * v, 0.01, 0.35);
        f.connect(e).connect(out);
        for (const hz of [440, 445, 554, 660]) this.osc('sawtooth', hz * p, t, 0.4, f);
        break;
      }
      case 'spinback': {
        // A record pulled back: a rising whoosh that speeds up and cuts.
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 3;
        f.frequency.setValueAtTime(300 * p, t);
        f.frequency.exponentialRampToValueAtTime(4000 * p, t + 0.4);
        const e = this.env(t, 0.5 * v, 0.3, 0.06);
        f.connect(e).connect(out);
        const src = this.ctx.createBufferSource();
        src.buffer = this.noise;
        src.connect(f);
        src.start(t);
        src.stop(t + 0.45);
        break;
      }
      case 'tapestop': {
        const e = this.env(t, 0.3 * v, 0.005, 0.5);
        e.connect(out);
        for (const n of [0, 7]) {
          const o = this.osc('sawtooth', note(n), t, 0.55, e);
          o.frequency.exponentialRampToValueAtTime(note(n) / 8, t + 0.5);
        }
        break;
      }
      case 'sweep': {
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 6;
        f.frequency.setValueAtTime(200 * p, t);
        f.frequency.exponentialRampToValueAtTime(6000 * p, t + 0.8);
        const e = this.env(t, 0.6 * v, 0.6, 0.25);
        f.connect(e).connect(out);
        const src = this.ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        src.connect(f);
        src.start(t);
        src.stop(t + 0.9);
        break;
      }
      case 'ping': {
        const e = this.env(t, 0.35 * v, 0.001, 0.6);
        e.connect(out);
        for (const [r, g] of [[1, 1], [2.76, 0.5], [5.4, 0.25]] as const) {
          const gg = this.ctx.createGain();
          gg.gain.value = g;
          gg.connect(e);
          this.osc('sine', 880 * p * r, t, 0.65, gg);
        }
        break;
      }
      case 'steel': {
        const e = this.env(t, 0.35 * v, 0.002, 0.5);
        e.connect(out);
        for (const [r, g] of [[1, 1], [2, 0.5], [3.01, 0.3], [4.2, 0.12]] as const) {
          const gg = this.ctx.createGain();
          gg.gain.value = g;
          gg.connect(e);
          this.osc('sine', note(12) * r, t, 0.55, gg);
        }
        break;
      }
      case 'thunder': {
        const e = this.env(t, 0.8 * v, 0.05, 1.6);
        e.connect(out);
        this.noiseHit(t, 'lowpass', 300 * p, 0.7, 1.7, e);
        const crack = this.env(t, 0.4 * v, 0.002, 0.2);
        crack.connect(out);
        this.noiseHit(t, 'highpass', 1500, 0.5, 0.25, crack);
        break;
      }
      case 'bird': {
        for (let i = 0; i < 3; i++) {
          const ti = t + i * 0.09;
          const e = this.env(ti, 0.25 * v, 0.004, 0.05);
          e.connect(out);
          const o = this.osc('sine', 3200 * p, ti, 0.07, e);
          o.frequency.exponentialRampToValueAtTime(4800 * p, ti + 0.05);
        }
        break;
      }
      case 'static': {
        const e = this.env(t, 0.4 * v, 0.002, 0.15);
        e.connect(out);
        this.noiseHit(t, 'bandpass', 2400 * p, 0.8, 0.18, e);
        const tone = this.env(t, 0.12 * v, 0.002, 0.12);
        tone.connect(out);
        this.osc('square', 1000 * p, t, 0.14, tone);
        break;
      }
    }
  }
}
