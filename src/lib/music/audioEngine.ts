/**
 * The studio's sound: Web Audio instruments played by note events.
 *
 * Runs on the app's shared AudioContext, so it plays to the output device
 * chosen in VJ mode and starts with the first gesture like the rest of the
 * audio. Every sound is synthesised (no samples to load or ship), and events
 * are played at their own clock time, so the sequencer and replay schedule
 * ahead with sample accuracy while live input plays at once.
 *
 * While audio analysis is running on a microphone or system input, the
 * studio's mix is also fed into the analyser, so the existing audio-reactive
 * shaders move with the music as well as the note-reactive ones.
 */

import { audioAnalyzer } from '../audio/analyzer';
import type { DrumVoice, InstrumentId, NoteEvent } from './noteEvents';
import type { KeysPatch, SynthPatch } from './instruments';

interface SubtractivePatch {
  osc1: OscillatorType;
  osc2: OscillatorType;
  detune: number;
  osc2Level: number;
  cutoff: number;
  envAmount: number;
  q: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  level: number;
}

const SUBTRACTIVE: Record<SynthPatch, SubtractivePatch> = {
  pad: { osc1: 'sawtooth', osc2: 'sawtooth', detune: 9, osc2Level: 0.8, cutoff: 900, envAmount: 1400, q: 1, attack: 0.35, decay: 1.2, sustain: 0.75, release: 1.6, level: 0.32 },
  pluck: { osc1: 'sawtooth', osc2: 'square', detune: 4, osc2Level: 0.35, cutoff: 500, envAmount: 4200, q: 4, attack: 0.003, decay: 0.28, sustain: 0.0, release: 0.25, level: 0.42 },
  bass: { osc1: 'sawtooth', osc2: 'square', detune: -1200, osc2Level: 0.6, cutoff: 260, envAmount: 900, q: 6, attack: 0.004, decay: 0.3, sustain: 0.55, release: 0.12, level: 0.5 },
  lead: { osc1: 'square', osc2: 'sawtooth', detune: 6, osc2Level: 0.7, cutoff: 1500, envAmount: 2600, q: 3, attack: 0.01, decay: 0.25, sustain: 0.7, release: 0.22, level: 0.3 },
};

const MAX_VOICES_PER_INSTRUMENT = 24;

interface MelodicVoice {
  key: string;
  startedAt: number;
  release: (time: number) => void;
  /** Stop at once (voice stealing). */
  kill: (time: number) => void;
}

function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** Loudness from velocity: a gentle curve so soft playing stays audible. */
function velocityGain(velocity: number): number {
  return Math.pow(Math.max(0, Math.min(1, velocity)), 1.4) * 0.9 + 0.1 * (velocity > 0 ? 1 : 0);
}

export class MusicAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  /** End of the chain (after the compressor): what reaches the speakers. */
  private output: DynamicsCompressorNode | null = null;
  private bus: Record<InstrumentId, GainNode> | null = null;
  private noise: AudioBuffer | null = null;
  private voices = new Map<string, MelodicVoice>();
  private openHat: { gain: GainNode; time: number } | null = null;
  private analyserTap: AnalyserNode | null = null;
  private unsubscribeGraph: (() => void) | null = null;

  private synthPatch: SynthPatch = 'pad';
  private keysPatch: KeysPatch = 'epiano';
  private volumes: Record<InstrumentId, number> = { synth: 0.8, keys: 0.8, drums: 0.9 };
  private masterVolume = 0.85;

  /** The music clock, in seconds. Creates the audio graph on first use. */
  now(): number {
    return this.ensure().currentTime;
  }

  /** Audio clock if the graph exists yet, without creating it. */
  peekNow(): number | null {
    return this.ctx ? this.ctx.currentTime : null;
  }

  setSynthPatch(patch: SynthPatch): void {
    this.synthPatch = patch;
  }

  setKeysPatch(patch: KeysPatch): void {
    this.keysPatch = patch;
  }

  setVolume(instrument: InstrumentId, volume: number): void {
    this.volumes[instrument] = Math.max(0, Math.min(1, volume));
    if (this.bus && this.ctx) this.bus[instrument].gain.setTargetAtTime(this.volumes[instrument], this.ctx.currentTime, 0.02);
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    if (this.masterGain && this.ctx) this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.02);
  }

  /** Play one event at its own time (or now, if that has passed). */
  play(event: NoteEvent): void {
    const ctx = this.ensure();
    const time = Math.max(ctx.currentTime, Number.isFinite(event.time) ? event.time : 0);
    if (event.instrument === 'drums') {
      if (event.type === 'on' && event.drum) this.playDrum(event.drum, event.velocity, time);
      return;
    }
    const key = `${event.instrument}:${event.note}`;
    if (event.type === 'off') {
      const voice = this.voices.get(key);
      if (voice) {
        voice.release(time);
        this.voices.delete(key);
      }
      return;
    }
    const existing = this.voices.get(key);
    if (existing) {
      existing.release(time);
      this.voices.delete(key);
    }
    this.stealIfFull(event.instrument, time);
    const voice = event.instrument === 'synth'
      ? this.synthVoice(key, event.note, event.velocity, time)
      : this.keysVoice(key, event.note, event.velocity, time);
    this.voices.set(key, voice);
  }

  /** Release every sounding note. */
  allNotesOff(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const voice of this.voices.values()) voice.release(t);
    this.voices.clear();
  }

  dispose(): void {
    this.allNotesOff();
    this.unsubscribeGraph?.();
    this.unsubscribeGraph = null;
    try { this.output?.disconnect(); } catch { /* already gone */ }
    this.output = null;
    this.masterGain = null;
    this.analyserTap = null;
    this.bus = null;
    this.ctx = null;
  }

  private ensure(): AudioContext {
    if (this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const ctx = audioAnalyzer.getOrCreateAudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.masterVolume;
    // Gentle bus compression keeps chords and drum stacks from clipping.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;
    master.connect(compressor);
    compressor.connect(ctx.destination);
    this.masterGain = master;
    this.output = compressor;
    const bus = {} as Record<InstrumentId, GainNode>;
    for (const id of ['synth', 'keys', 'drums'] as InstrumentId[]) {
      const g = ctx.createGain();
      g.gain.value = this.volumes[id];
      g.connect(master);
      bus[id] = g;
    }
    this.bus = bus;
    this.noise = makeNoise(ctx);
    this.syncAnalyserTap();
    this.unsubscribeGraph = audioAnalyzer.onGraphChange(() => this.syncAnalyserTap());
    return ctx;
  }

  /** Feed the mix into the audio analyser while it listens to an input that is not itself played out. */
  private syncAnalyserTap(): void {
    const output = this.output;
    if (!output) return;
    const analyser = audioAnalyzer.getAnalyserNode();
    const wanted = analyser && !audioAnalyzer.analyserFeedsDestination() ? analyser : null;
    if (wanted === this.analyserTap) return;
    if (this.analyserTap) {
      try { output.disconnect(this.analyserTap); } catch { /* not connected */ }
    }
    this.analyserTap = null;
    if (wanted) {
      try {
        output.connect(wanted);
        this.analyserTap = wanted;
      } catch { /* analyser on another context */ }
    }
  }

  private stealIfFull(instrument: InstrumentId, time: number): void {
    const mine = [...this.voices.values()].filter((v) => v.key.startsWith(`${instrument}:`));
    if (mine.length < MAX_VOICES_PER_INSTRUMENT) return;
    const oldest = mine.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b));
    oldest.kill(time);
    this.voices.delete(oldest.key);
  }

  private synthVoice(key: string, note: number, velocity: number, time: number): MelodicVoice {
    const ctx = this.ctx!;
    const p = SUBTRACTIVE[this.synthPatch];
    const freq = midiToHz(note);
    const peak = velocityGain(velocity) * p.level;

    const osc1 = ctx.createOscillator();
    osc1.type = p.osc1;
    osc1.frequency.value = freq;
    const osc2 = ctx.createOscillator();
    osc2.type = p.osc2;
    osc2.frequency.value = freq;
    osc2.detune.value = p.detune;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = p.osc2Level;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = p.q;
    // Brighter with velocity and a little with pitch, like a played synth.
    const base = Math.min(18000, p.cutoff * (0.7 + 0.6 * velocity) * Math.pow(freq / 261.6, 0.3));
    const top = Math.min(18000, base + p.envAmount * (0.4 + 0.6 * velocity));
    filter.frequency.setValueAtTime(base, time);
    filter.frequency.linearRampToValueAtTime(top, time + Math.max(0.003, p.attack));
    filter.frequency.setTargetAtTime(base + (top - base) * p.sustain, time + p.attack, Math.max(0.01, p.decay / 3));

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(peak, time + Math.max(0.003, p.attack));
    amp.gain.setTargetAtTime(peak * p.sustain, time + p.attack, Math.max(0.01, p.decay / 3));

    osc1.connect(filter);
    osc2.connect(osc2Gain).connect(filter);
    filter.connect(amp).connect(this.bus!.synth);
    osc1.start(time);
    osc2.start(time);

    const stopAll = (at: number) => {
      try { osc1.stop(at); osc2.stop(at); } catch { /* already stopped */ }
    };
    osc1.onended = () => { try { amp.disconnect(); } catch { /* gone */ } };
    return {
      key,
      startedAt: time,
      release: (at) => {
        holdAt(amp.gain, at);
        amp.gain.setTargetAtTime(0, at, Math.max(0.01, p.release / 4));
        stopAll(at + p.release * 1.6 + 0.05);
      },
      kill: (at) => {
        holdAt(amp.gain, at);
        amp.gain.linearRampToValueAtTime(0, at + 0.01);
        stopAll(at + 0.02);
      },
    };
  }

  private keysVoice(key: string, note: number, velocity: number, time: number): MelodicVoice {
    const ctx = this.ctx!;
    const patch = this.keysPatch;
    const freq = midiToHz(note);
    const peak = velocityGain(velocity) * (patch === 'organ' ? 0.22 : 0.38);
    const amp = ctx.createGain();
    const oscs: OscillatorNode[] = [];
    let release = 0.5;

    if (patch === 'organ') {
      // Drawbar-style: fundamental, octave and twelfth, held flat.
      for (const [ratio, level] of [[1, 1], [2, 0.55], [3, 0.3], [4, 0.15]] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * ratio;
        const g = ctx.createGain();
        g.gain.value = level;
        osc.connect(g).connect(amp);
        oscs.push(osc);
      }
      amp.gain.setValueAtTime(0, time);
      amp.gain.linearRampToValueAtTime(peak, time + 0.008);
      release = 0.12;
    } else {
      // Two-operator FM: a bright attack that mellows as the index falls.
      const ratio = patch === 'bell' ? 3.5 : 1;
      const index = (patch === 'bell' ? 5 : 2.4) * (0.5 + velocity);
      const carrier = ctx.createOscillator();
      carrier.type = 'sine';
      carrier.frequency.value = freq;
      const mod = ctx.createOscillator();
      mod.type = 'sine';
      mod.frequency.value = freq * ratio;
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(freq * index, time);
      modGain.gain.setTargetAtTime(freq * index * 0.12, time, patch === 'bell' ? 0.6 : 0.35);
      mod.connect(modGain).connect(carrier.frequency);
      carrier.connect(amp);
      oscs.push(carrier, mod);
      const decay = patch === 'bell' ? 2.2 : 1.1;
      amp.gain.setValueAtTime(0, time);
      amp.gain.linearRampToValueAtTime(peak, time + 0.004);
      amp.gain.setTargetAtTime(peak * 0.25, time + 0.004, decay);
      release = patch === 'bell' ? 1.4 : 0.45;
    }

    amp.connect(this.bus!.keys);
    for (const osc of oscs) osc.start(time);
    const stopAll = (at: number) => {
      for (const osc of oscs) { try { osc.stop(at); } catch { /* already stopped */ } }
    };
    oscs[0].onended = () => { try { amp.disconnect(); } catch { /* gone */ } };
    return {
      key,
      startedAt: time,
      release: (at) => {
        holdAt(amp.gain, at);
        amp.gain.setTargetAtTime(0, at, release / 4);
        stopAll(at + release * 1.6 + 0.05);
      },
      kill: (at) => {
        holdAt(amp.gain, at);
        amp.gain.linearRampToValueAtTime(0, at + 0.01);
        stopAll(at + 0.02);
      },
    };
  }

  private playDrum(voice: DrumVoice, velocity: number, time: number): void {
    const ctx = this.ctx!;
    const out = this.bus!.drums;
    const level = velocityGain(velocity);
    switch (voice) {
      case 'kick': {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(160, time);
        osc.frequency.exponentialRampToValueAtTime(42, time + 0.14);
        const amp = envelope(ctx, time, level * 1.0, 0.002, 0.42);
        osc.connect(amp).connect(out);
        // A short click on top keeps the kick audible on small speakers.
        this.noiseHit(time, level * 0.25, 0.012, 'highpass', 2500, out);
        osc.start(time);
        osc.stop(time + 0.5);
        break;
      }
      case 'snare': {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, time);
        osc.frequency.exponentialRampToValueAtTime(160, time + 0.08);
        const amp = envelope(ctx, time, level * 0.45, 0.001, 0.12);
        osc.connect(amp).connect(out);
        osc.start(time);
        osc.stop(time + 0.2);
        this.noiseHit(time, level * 0.6, 0.2, 'highpass', 1200, out);
        break;
      }
      case 'clap': {
        for (let i = 0; i < 3; i++) this.noiseHit(time + i * 0.011, level * 0.45, 0.02, 'bandpass', 1400, out);
        this.noiseHit(time + 0.033, level * 0.5, 0.22, 'bandpass', 1200, out);
        break;
      }
      case 'hatClosed': {
        if (this.openHat && this.openHat.time <= time) {
          // A closed hat chokes a ringing open one, like a real hi-hat.
          holdAt(this.openHat.gain.gain, time);
          this.openHat.gain.gain.linearRampToValueAtTime(0, time + 0.01);
          this.openHat = null;
        }
        this.noiseHit(time, level * 0.35, 0.05, 'highpass', 7500, out);
        break;
      }
      case 'hatOpen': {
        const gain = this.noiseHit(time, level * 0.32, 0.42, 'highpass', 7000, out);
        this.openHat = { gain, time };
        break;
      }
      case 'tom': {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(210, time);
        osc.frequency.exponentialRampToValueAtTime(110, time + 0.3);
        const amp = envelope(ctx, time, level * 0.8, 0.002, 0.36);
        osc.connect(amp).connect(out);
        osc.start(time);
        osc.stop(time + 0.45);
        break;
      }
      case 'rim': {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = 820;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1700;
        const amp = envelope(ctx, time, level * 0.35, 0.001, 0.035);
        osc.connect(filter).connect(amp).connect(out);
        osc.start(time);
        osc.stop(time + 0.08);
        break;
      }
      case 'crash': {
        this.noiseHit(time, level * 0.32, 1.6, 'highpass', 4500, out);
        break;
      }
    }
  }

  /** A filtered burst of noise with an exponential tail. Returns its gain, for choking. */
  private noiseHit(time: number, level: number, decay: number, type: BiquadFilterType, freq: number, out: AudioNode): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const amp = envelope(ctx, time, level, 0.001, decay);
    src.connect(filter).connect(amp).connect(out);
    src.start(time);
    src.stop(time + decay * 1.5 + 0.05);
    src.onended = () => { try { amp.disconnect(); } catch { /* gone */ } };
    return amp;
  }
}

/** Freeze a param at its current scheduled value from `time`, so a new ramp starts there. */
function holdAt(param: AudioParam, time: number): void {
  const p = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof p.cancelAndHoldAtTime === 'function') {
    p.cancelAndHoldAtTime(time);
  } else {
    param.cancelScheduledValues(time);
    param.setValueAtTime(param.value, time);
  }
}

/** A percussive gain envelope: fast attack, exponential decay to silence. */
function envelope(ctx: AudioContext, time: number, level: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, level), time + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
  return g;
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
