/**
 * The dub set's sounds: a deep mono bass, the siren, and eight shots to
 * launch (laser, zap, riser, spring boing, crackle, boom, alarm, echo clap).
 * Each is plain Web Audio, built on the shared context and played into its
 * instrument's bus, so it can run through the echo chamber like the rest.
 */

type Params = Record<string, number>;

const midiToHz = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

function hold(param: AudioParam, time: number): void {
  const p = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(time);
  else {
    param.cancelScheduledValues(time);
    param.setValueAtTime(param.value, time);
  }
}

function curve(amount: number): Float32Array<ArrayBuffer> {
  const c = new Float32Array(512);
  for (let i = 0; i < c.length; i++) {
    const x = (i / (c.length - 1)) * 2 - 1;
    c[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return c;
}

/** The dub bass: sine and sub with a little grit, mono, sliding between tied notes. */
export class DubBass {
  private voice: { osc: OscillatorNode; sub: OscillatorNode; filter: BiquadFilterNode; amp: GainNode; note: number } | null = null;

  constructor(private ctx: AudioContext, private out: AudioNode) {}

  on(note: number, velocity: number, time: number, p: Params): void {
    const ctx = this.ctx;
    const freq = midiToHz(note);
    const glide = (p['dubbass.glide'] ?? 0.15) * 0.25;
    if (this.voice && glide > 0.01) {
      const v = this.voice;
      v.osc.frequency.cancelScheduledValues(time);
      v.osc.frequency.setTargetAtTime(freq, time, glide / 3);
      v.sub.frequency.cancelScheduledValues(time);
      v.sub.frequency.setTargetAtTime(freq / 2, time, glide / 3);
      v.note = note;
      hold(v.amp.gain, time);
      v.amp.gain.setTargetAtTime(this.peak(velocity), time, 0.01);
      return;
    }
    this.off(time, 0.02);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq / 2;
    const subGain = ctx.createGain();
    subGain.gain.value = (p['dubbass.sub'] ?? 0.7) * 0.8;
    const drive = ctx.createWaveShaper();
    drive.curve = curve(1 + (p['dubbass.drive'] ?? 0.3) * 6);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 90 + Math.pow(p['dubbass.tone'] ?? 0.35, 2) * 2400 + velocity * 200;
    filter.Q.value = 0.8;
    const amp = ctx.createGain();
    const peak = this.peak(velocity);
    const decay = 0.15 + (p['dubbass.decay'] ?? 0.6) * 2.5;
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(peak, time + 0.006);
    amp.gain.setTargetAtTime(peak * 0.55, time + 0.006, decay / 3);
    osc.connect(drive);
    sub.connect(subGain).connect(drive);
    drive.connect(filter).connect(amp).connect(this.out);
    osc.start(time);
    sub.start(time);
    this.voice = { osc, sub, filter, amp, note };
  }

  /** Releases if `note` is the sounding one (or any note when omitted). */
  off(time: number, release = 0.12, note?: number): void {
    const v = this.voice;
    if (!v || (note !== undefined && v.note !== note)) return;
    this.voice = null;
    hold(v.amp.gain, time);
    v.amp.gain.setTargetAtTime(0, time, release / 3);
    try { v.osc.stop(time + release * 2 + 0.05); v.sub.stop(time + release * 2 + 0.05); } catch { /* stopped */ }
    v.osc.onended = () => { try { v.amp.disconnect(); } catch { /* gone */ } };
  }

  private peak(velocity: number): number {
    return 0.25 + velocity * 0.35;
  }
}

/** The dub siren: one oscillator swept by an LFO, sine to square, held while pressed. */
export class Siren {
  private voice: { osc: OscillatorNode; square: OscillatorNode; lfo: OscillatorNode; lfoDepth: GainNode; mixSine: GainNode; mixSquare: GainNode; amp: GainNode } | null = null;

  constructor(private ctx: AudioContext, private out: AudioNode) {}

  get sounding(): boolean {
    return this.voice !== null;
  }

  on(velocity: number, time: number, p: Params): void {
    if (this.voice) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const square = ctx.createOscillator();
    square.type = 'square';
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    const lfoDepth = ctx.createGain();
    lfo.connect(lfoDepth);
    lfoDepth.connect(osc.detune);
    lfoDepth.connect(square.detune);
    const mixSine = ctx.createGain();
    const mixSquare = ctx.createGain();
    const amp = ctx.createGain();
    osc.connect(mixSine).connect(amp);
    square.connect(mixSquare).connect(amp);
    amp.connect(this.out);
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(0.16 + velocity * 0.12, time + 0.03);
    for (const o of [osc, square, lfo]) o.start(time);
    this.voice = { osc, square, lfo, lfoDepth, mixSine, mixSquare, amp };
    this.set(p);
  }

  /** Follow the knobs while it sounds: pitch, sweep rate, sweep depth, shape. */
  set(p: Params): void {
    const v = this.voice;
    if (!v) return;
    const t = this.ctx.currentTime;
    const base = 150 * Math.pow(2, (p['siren.pitch'] ?? 0.55) * 4);
    v.osc.frequency.setTargetAtTime(base, t, 0.05);
    v.square.frequency.setTargetAtTime(base, t, 0.05);
    v.lfo.frequency.setTargetAtTime(0.3 * Math.pow(40, p['siren.rate'] ?? 0.45), t, 0.05);
    v.lfoDepth.gain.setTargetAtTime((p['siren.depth'] ?? 0.6) * 2400, t, 0.05);
    const shape = p['siren.shape'] ?? 0.2;
    v.mixSine.gain.setTargetAtTime(1 - shape, t, 0.03);
    v.mixSquare.gain.setTargetAtTime(shape * 0.35, t, 0.03);
  }

  off(time: number): void {
    const v = this.voice;
    if (!v) return;
    this.voice = null;
    hold(v.amp.gain, time);
    v.amp.gain.setTargetAtTime(0, time, 0.12);
    for (const o of [v.osc, v.square, v.lfo]) { try { o.stop(time + 0.8); } catch { /* stopped */ } }
    v.osc.onended = () => { try { v.amp.disconnect(); } catch { /* gone */ } };
  }
}

export const SHOT_NAMES = ['Laser', 'Zap', 'Riser', 'Boing', 'Crackle', 'Boom', 'Alarm', 'Echo clap'];

/** Fire one shot. `size` scales pitch and length, `tail` how long it rings. */
export function fireShot(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, index: number, velocity: number, time: number, p: Params): void {
  const size = p['shots.size'] ?? 0.5;
  const tail = 0.5 + (p['shots.tail'] ?? 0.5) * 1.5;
  const scale = Math.pow(2, (0.5 - size) * 2);
  const level = 0.2 + velocity * 0.3;
  const amp = ctx.createGain();
  amp.connect(out);
  const env = (peak: number, attack: number, decay: number) => {
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(peak, time + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay * tail);
  };
  const end = (seconds: number) => time + seconds * tail + 0.2;
  const osc = (type: OscillatorType) => {
    const o = ctx.createOscillator();
    o.type = type;
    return o;
  };
  const noiseSrc = () => {
    const n = ctx.createBufferSource();
    n.buffer = noise;
    n.loop = true;
    return n;
  };
  switch (index) {
    case 0: { // Laser: a fast falling square.
      const o = osc('square');
      o.frequency.setValueAtTime(2400 * scale, time);
      o.frequency.exponentialRampToValueAtTime(120 * scale, time + 0.25 * tail);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1500 * scale;
      o.connect(f).connect(amp);
      env(level * 0.6, 0.003, 0.3);
      o.start(time);
      o.stop(end(0.35));
      break;
    }
    case 1: { // Zap: a long dive through a closing filter.
      const o = osc('sawtooth');
      o.frequency.setValueAtTime(900 * scale, time);
      o.frequency.exponentialRampToValueAtTime(40 * scale, time + 0.6 * tail);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(6000, time);
      f.frequency.exponentialRampToValueAtTime(200, time + 0.6 * tail);
      o.connect(f).connect(amp);
      env(level * 0.6, 0.005, 0.7);
      o.start(time);
      o.stop(end(0.8));
      break;
    }
    case 2: { // Riser: noise and a tone climbing together, cut at the top.
      const n = noiseSrc();
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 4;
      f.frequency.setValueAtTime(200, time);
      f.frequency.exponentialRampToValueAtTime(7000 * scale, time + 2 * tail);
      const o = osc('sine');
      o.frequency.setValueAtTime(100 * scale, time);
      o.frequency.exponentialRampToValueAtTime(900 * scale, time + 2 * tail);
      const og = ctx.createGain();
      og.gain.value = 0.4;
      n.connect(f).connect(amp);
      o.connect(og).connect(amp);
      amp.gain.setValueAtTime(0.0001, time);
      amp.gain.exponentialRampToValueAtTime(level, time + 2 * tail);
      amp.gain.linearRampToValueAtTime(0, time + 2 * tail + 0.03);
      n.start(time);
      o.start(time);
      n.stop(time + 2 * tail + 0.1);
      o.stop(time + 2 * tail + 0.1);
      break;
    }
    case 3: { // Boing: a spring shaken once, its wobble dying away.
      const o = osc('sine');
      o.frequency.value = 140 * scale;
      const wobble = osc('sine');
      wobble.frequency.value = 22;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(900, time);
      depth.gain.exponentialRampToValueAtTime(10, time + 1.2 * tail);
      wobble.connect(depth).connect(o.detune);
      o.connect(amp);
      env(level * 0.9, 0.004, 1.2);
      o.start(time);
      wobble.start(time);
      o.stop(end(1.3));
      wobble.stop(end(1.3));
      break;
    }
    case 4: { // Crackle: sparse clicks, like dust on a record.
      const n = noiseSrc();
      const gate = ctx.createGain();
      gate.gain.value = 0;
      const length = 1.5 * tail;
      for (let t = 0; t < length; t += 0.02 + Math.random() * 0.08) {
        gate.gain.setValueAtTime(Math.random() * 0.9, time + t);
        gate.gain.setValueAtTime(0, time + t + 0.003);
      }
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 1800;
      n.connect(gate).connect(f).connect(amp);
      amp.gain.value = level;
      n.start(time);
      n.stop(time + length + 0.05);
      break;
    }
    case 5: { // Boom: a huge low drop with rumble.
      const o = osc('sine');
      o.frequency.setValueAtTime(70 * scale, time);
      o.frequency.exponentialRampToValueAtTime(28 * scale, time + 1.8 * tail);
      const n = noiseSrc();
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 300;
      const ng = ctx.createGain();
      ng.gain.value = 0.5;
      o.connect(amp);
      n.connect(f).connect(ng).connect(amp);
      env(level * 1.4, 0.01, 2);
      o.start(time);
      n.start(time);
      o.stop(end(2.1));
      n.stop(end(2.1));
      break;
    }
    case 6: { // Alarm: two tones swapping fast.
      const o = osc('square');
      for (let i = 0, t = 0; t < 1 * tail; i++, t += 0.12) o.frequency.setValueAtTime((i % 2 ? 660 : 880) * scale, time + t);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 3500;
      o.connect(f).connect(amp);
      amp.gain.setValueAtTime(level * 0.35, time);
      amp.gain.setValueAtTime(level * 0.35, time + 1 * tail);
      amp.gain.linearRampToValueAtTime(0, time + 1 * tail + 0.05);
      o.start(time);
      o.stop(time + 1 * tail + 0.1);
      break;
    }
    default: { // Echo clap: a hard clap made to be thrown into the echo.
      const n = noiseSrc();
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1300 * scale;
      f.Q.value = 1.2;
      n.connect(f).connect(amp);
      amp.gain.setValueAtTime(0.0001, time);
      for (let i = 0; i < 3; i++) {
        amp.gain.setValueAtTime(level * 1.2, time + i * 0.011);
        amp.gain.exponentialRampToValueAtTime(0.05, time + i * 0.011 + 0.01);
      }
      amp.gain.setValueAtTime(level, time + 0.034);
      amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.034 + 0.25 * tail);
      n.start(time);
      n.stop(end(0.35));
      break;
    }
  }
  setTimeout(() => { try { amp.disconnect(); } catch { /* gone */ } }, (time - ctx.currentTime + 4 * tail + 1) * 1000);
}
