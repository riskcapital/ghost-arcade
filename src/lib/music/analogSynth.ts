/**
 * The analog set's synth: a semi-modular mono voice.
 *
 * Two oscillators, a sub and noise into a mixer; a four-pole low-pass (two
 * resonant stages) with drive; a VCA; an ADSR envelope and an LFO. Like a
 * real semi-modular it plays without any cables (the envelope is wired to the
 * filter and the amp), and its patch jacks add more:
 *  - its own LFO, envelope and oscillator 2 patch at audio rate into the
 *    filter cutoff, the pitch or the amp (oscillator 2 into pitch is FM);
 *  - any other control signal (a drum, the XY pad) reaches the same inputs
 *    at frame rate.
 */

type Params = Record<string, number>;

export type AnalogSource = 'lfo' | 'env' | 'vco2';
export type AnalogDest = 'cutoff' | 'pitch' | 'amp';

export const ANALOG_DESTS: AnalogDest[] = ['cutoff', 'pitch', 'amp'];

const WAVES: OscillatorType[] = ['sawtooth', 'square', 'triangle', 'sine'];
const waveFor = (v: number) => WAVES[Math.max(0, Math.min(3, Math.round(v * 3)))];
export const WAVE_LABELS = ['Saw', 'Square', 'Triangle', 'Sine'];

const midiToHz = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

function softCurve(amount: number): Float32Array<ArrayBuffer> {
  const c = new Float32Array(512);
  for (let i = 0; i < c.length; i++) {
    const x = (i / (c.length - 1)) * 2 - 1;
    c[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return c;
}

/** How hard each source pushes each input at full depth. */
const ROUTE_SCALE: Record<AnalogDest, number> = { cutoff: 4000, pitch: 1200, amp: 0.5 };

export class AnalogSynth {
  private vco1: OscillatorNode;
  private vco2: OscillatorNode;
  private sub: OscillatorNode;
  private noise: AudioBufferSourceNode;
  private mix1: GainNode;
  private mix2: GainNode;
  private mixSub: GainNode;
  private mixNoise: GainNode;
  private f1: BiquadFilterNode;
  private f2: BiquadFilterNode;
  private drive: WaveShaperNode;
  private vca: GainNode;
  private env: ConstantSourceNode;
  private envToCutoff: GainNode;
  private lfo: OscillatorNode;
  private lfoOut: GainNode;
  private vco2Out: GainNode;
  /** Frame-rate inputs for signals from outside the synth. */
  private external: Record<AnalogDest, ConstantSourceNode>;
  private routes = new Map<string, GainNode>();
  private held: number[] = [];
  private params: Params = {};
  private driveAmount = -1;

  constructor(private ctx: AudioContext, out: AudioNode, noise: AudioBuffer) {
    const c = ctx;
    this.vco1 = c.createOscillator();
    this.vco2 = c.createOscillator();
    this.sub = c.createOscillator();
    this.sub.type = 'square';
    this.noise = c.createBufferSource();
    this.noise.buffer = noise;
    this.noise.loop = true;
    this.mix1 = c.createGain();
    this.mix2 = c.createGain();
    this.mixSub = c.createGain();
    this.mixNoise = c.createGain();
    this.f1 = c.createBiquadFilter();
    this.f2 = c.createBiquadFilter();
    this.f1.type = this.f2.type = 'lowpass';
    this.drive = c.createWaveShaper();
    this.vca = c.createGain();
    this.vca.gain.value = 0;
    this.vco1.connect(this.mix1).connect(this.f1);
    this.vco2.connect(this.mix2).connect(this.f1);
    this.sub.connect(this.mixSub).connect(this.f1);
    this.noise.connect(this.mixNoise).connect(this.f1);
    this.f1.connect(this.f2).connect(this.drive).connect(this.vca).connect(out);

    // The envelope is a moving DC level: normalled to the amp and, by its amount, the filter.
    this.env = c.createConstantSource();
    this.env.offset.value = 0;
    this.env.connect(this.vca.gain);
    this.envToCutoff = c.createGain();
    this.env.connect(this.envToCutoff);
    this.envToCutoff.connect(this.f1.frequency);
    this.envToCutoff.connect(this.f2.frequency);

    this.lfo = c.createOscillator();
    this.lfo.type = 'triangle';
    this.lfoOut = c.createGain();
    this.lfo.connect(this.lfoOut);
    this.vco2Out = c.createGain();
    this.vco2.connect(this.vco2Out);

    this.external = {
      cutoff: c.createConstantSource(),
      pitch: c.createConstantSource(),
      amp: c.createConstantSource(),
    };
    for (const d of ANALOG_DESTS) {
      this.external[d].offset.value = 0;
      for (const target of this.targets(d)) this.external[d].connect(target);
      this.external[d].start();
    }
    for (const node of [this.vco1, this.vco2, this.sub, this.noise, this.env, this.lfo]) node.start();
    this.setNote(48, 0);
  }

  private targets(dest: AnalogDest): AudioParam[] {
    if (dest === 'cutoff') return [this.f1.frequency, this.f2.frequency];
    if (dest === 'pitch') return [this.vco1.detune, this.vco2.detune, this.sub.detune];
    return [this.vca.gain];
  }

  setParams(p: Params): void {
    this.params = p;
    const t = this.ctx.currentTime;
    const v = (k: string, d: number) => p[`analog.${k}`] ?? d;
    this.vco1.type = waveFor(v('wave1', 0));
    this.vco2.type = waveFor(v('wave2', 0.34));
    this.vco1.detune.setTargetAtTime((v('tune1', 0.5) - 0.5) * 2400, t, 0.02);
    this.vco2.detune.setTargetAtTime((v('tune2', 0.5) - 0.5) * 2400, t, 0.02);
    this.mix1.gain.setTargetAtTime(0.32, t, 0.02);
    this.mix2.gain.setTargetAtTime(v('mix2', 0.5) * 0.32, t, 0.02);
    this.mixSub.gain.setTargetAtTime(v('sub', 0.4) * 0.25, t, 0.02);
    this.mixNoise.gain.setTargetAtTime(v('noise', 0) * 0.3, t, 0.02);
    const cutoff = 40 * Math.pow(400, v('cutoff', 0.45));
    this.f1.frequency.setTargetAtTime(cutoff, t, 0.015);
    this.f2.frequency.setTargetAtTime(cutoff, t, 0.015);
    const q = 0.5 + v('reso', 0.35) * 14;
    this.f1.Q.setTargetAtTime(q, t, 0.02);
    this.f2.Q.setTargetAtTime(q * 0.5, t, 0.02);
    this.envToCutoff.gain.setTargetAtTime(v('envamt', 0.5) * 6000, t, 0.02);
    this.lfo.frequency.setTargetAtTime(0.05 * Math.pow(400, v('lforate', 0.3)), t, 0.05);
    const drive = v('drive', 0.2);
    if (Math.abs(drive - this.driveAmount) > 0.02) {
      this.driveAmount = drive;
      this.drive.curve = softCurve(1 + drive * 8);
    }
    for (const [key, gain] of this.routes) gain.gain.setTargetAtTime(this.routeGain(key), t, 0.03);
  }

  private routeGain(key: string): number {
    const [from, to] = key.split('>') as [AnalogSource, AnalogDest];
    const depth = this.params['analog.lfodepth'] ?? 0.5;
    const scale = ROUTE_SCALE[to];
    if (from === 'vco2' && to === 'pitch') return depth * 1800; // FM, in Hz of deviation
    if (from === 'env') return scale * (to === 'amp' ? 0.5 : 1);
    return scale * depth;
  }

  /** The cables between the synth's own jacks: rewire only what changed. */
  setRoutes(routes: Array<{ from: AnalogSource; to: AnalogDest }>): void {
    const wanted = new Set(routes.map((r) => `${r.from}>${r.to}`));
    for (const [key, gain] of this.routes) {
      if (wanted.has(key)) continue;
      try { gain.disconnect(); } catch { /* gone */ }
      this.routes.delete(key);
    }
    for (const key of wanted) {
      if (this.routes.has(key)) continue;
      const [from, to] = key.split('>') as [AnalogSource, AnalogDest];
      const gain = this.ctx.createGain();
      gain.gain.value = this.routeGain(key);
      const source = from === 'lfo' ? this.lfoOut : from === 'env' ? this.env : this.vco2Out;
      source.connect(gain);
      // Oscillator 2 into pitch is FM: it pushes oscillator 1's frequency itself.
      if (from === 'vco2' && to === 'pitch') gain.connect(this.vco1.frequency);
      else for (const target of this.targets(to)) gain.connect(target);
      this.routes.set(key, gain);
    }
  }

  /** A signal from outside the synth, 0-1, or null to let go. */
  setExternal(dest: AnalogDest, value: number | null): void {
    const offset = value === null ? 0 : (value - (dest === 'amp' ? 0 : 0.5)) * ROUTE_SCALE[dest] * (dest === 'amp' ? 1 : 2);
    this.external[dest].offset.setTargetAtTime(offset, this.ctx.currentTime, 0.015);
  }

  /** The LFO's value now, for patching it to a visual. */
  lfoValue(time: number): number {
    const rate = 0.05 * Math.pow(400, this.params['analog.lforate'] ?? 0.3);
    const phase = (time * rate) % 1;
    return phase < 0.5 ? phase * 2 : 2 - phase * 2;
  }

  noteOn(note: number, velocity: number, time: number): void {
    const legato = this.held.length > 0;
    this.held = [...this.held.filter((n) => n !== note), note];
    this.setNote(note, legato ? (this.params['analog.glide'] ?? 0.08) * 0.4 : 0, time);
    // Legato notes keep the envelope going, like a real mono synth.
    if (!legato) this.gate(true, velocity, time);
  }

  noteOff(note: number, time: number): void {
    const wasTop = this.held[this.held.length - 1] === note;
    this.held = this.held.filter((n) => n !== note);
    if (!this.held.length) this.gate(false, 0, time);
    else if (wasTop) this.setNote(this.held[this.held.length - 1], (this.params['analog.glide'] ?? 0.08) * 0.4, time);
  }

  allOff(time: number): void {
    this.held = [];
    this.gate(false, 0, time);
  }

  private setNote(note: number, glide: number, time = this.ctx.currentTime): void {
    const f = midiToHz(note);
    for (const [osc, ratio] of [[this.vco1, 1], [this.vco2, 1], [this.sub, 0.5]] as Array<[OscillatorNode, number]>) {
      osc.frequency.cancelScheduledValues(time);
      if (glide > 0.005) osc.frequency.setTargetAtTime(f * ratio, time, glide / 3);
      else osc.frequency.setValueAtTime(f * ratio, time);
    }
  }

  private gate(on: boolean, velocity: number, time: number): void {
    const p = this.params;
    const env = this.env.offset;
    const hold = env as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
    if (typeof hold.cancelAndHoldAtTime === 'function') hold.cancelAndHoldAtTime(time);
    else {
      env.cancelScheduledValues(time);
      env.setValueAtTime(env.value, time);
    }
    if (on) {
      const attack = 0.002 + Math.pow(p['analog.attack'] ?? 0.02, 2) * 3;
      const decay = 0.02 + Math.pow(p['analog.decay'] ?? 0.3, 2) * 3;
      const peak = 0.5 + velocity * 0.5;
      env.linearRampToValueAtTime(peak, time + attack);
      env.setTargetAtTime(peak * (p['analog.sustain'] ?? 0.6), time + attack, decay / 3);
    } else {
      const release = 0.01 + Math.pow(p['analog.release'] ?? 0.25, 2) * 4;
      env.setTargetAtTime(0, time, release / 3);
    }
  }
}
