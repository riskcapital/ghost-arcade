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
import { INSTRUMENTS, type DrumVoice, type InstrumentId, type NoteEvent } from './noteEvents';
import type { KeysPatch, SynthPatch } from './instruments';
import { FxRack } from './fxRack';
import { MacroFxChain, type MacroFxSlot } from './macroFxAudio';
import { DubBass, Siren, fireShot } from './dubSounds';
import { AnalogSynth, type AnalogDest, type AnalogSource } from './analogSynth';
import { ScanSynth } from './scanSynth';
import { defaultParams, type StudioSet } from './studioSets';
import { EQ_BANDS, EQ_BAND_IDS, channelAudible, meterLevel, stripFor, type ChannelId, type EqBand, type MixerState } from './mixer';

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

/** Changing sets fades the old set's effect tails out over this long. */
const SET_CHANGE_FADE_SECONDS = 1.5;
/** Kill: how fast everything goes, and how long the mix stays down before it comes back. */
const KILL_FADE_SECONDS = 0.03;
const KILL_HOLD_SECONDS = 0.6;

interface MelodicVoice {
  key: string;
  startedAt: number;
  release: (time: number) => void;
  /** Stop at once (voice stealing). */
  kill: (time: number) => void;
}

/** One mixer channel: its bus feeds the EQ, pan and mute/solo gate, and a meter reads after the gate. */
interface Strip {
  input: GainNode;
  eq: Record<EqBand, BiquadFilterNode>;
  pan: StereoPannerNode;
  gate: GainNode;
  meter: AnalyserNode;
}

const MIXER_RAMP_SECONDS = 0.015;

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
  private strips = new Map<ChannelId, Strip>();
  private mixer: MixerState = {};
  private mixerChannels: readonly ChannelId[] = [];
  /** Studio instruments go quiet while Live is in control; the input stays. */
  private instrumentsSilenced = false;
  private inputMonitor = true;
  private inputVolume = 0.5;
  private meterBuffer: Float32Array<ArrayBuffer> | null = null;
  private noise: AudioBuffer | null = null;
  private voices = new Map<string, MelodicVoice>();
  private openHat: { gain: GainNode; time: number } | null = null;
  private analyserTap: AnalyserNode | null = null;
  private unsubscribeGraph: (() => void) | null = null;

  private synthPatch: SynthPatch = 'pad';
  private keysPatch: KeysPatch = 'epiano';
  private volumes: Record<InstrumentId, number> = { synth: 0.8, keys: 0.8, drums: 0.9, drone: 0.75, bowls: 0.8, acid: 0.75, xy: 0.7, dubbass: 0.85, siren: 0.6, shots: 0.7, analog: 0.75, scan: 0.6 };
  private masterVolume = 0.85;
  /** Every Studio knob, "module.param" -> 0-1. */
  private params: Record<string, number> = defaultParams();
  private racks: Partial<Record<StudioSet, FxRack>> = {};
  private activeSet: StudioSet = 'bath';
  private throughFx = new Set<InstrumentId>();
  private droneLfo: { osc: OscillatorNode; depth: GainNode } | null = null;
  private droneVoices = new Set<{ filter: BiquadFilterNode; shimmer: GainNode; air: GainNode; note: number }>();
  private acid: { osc: OscillatorNode; filter: BiquadFilterNode; amp: GainNode; note: number } | null = null;
  private xyTone: { oscs: OscillatorNode[]; filter: BiquadFilterNode; amp: GainNode; note: number } | null = null;
  private dubBass: DubBass | null = null;
  private siren: Siren | null = null;
  private analog: AnalogSynth | null = null;
  private scan: ScanSynth | null = null;
  private analogRoutes: Array<{ from: AnalogSource; to: AnalogDest }> = [];
  private macroChain: MacroFxChain | null = null;
  private macroSlots: MacroFxSlot[] = [];
  private tempo = 120;
  /** Pitch factor of the drum being played, from its mixer tune knob. */
  private drumRate = 1;

  /** The music clock, in seconds. Creates the audio graph on first use. */
  now(): number {
    return this.ensure().currentTime;
  }

  /** The audio context once the graph exists. */
  context(): AudioContext | null {
    return this.ctx;
  }

  /** Audio clock if the graph exists yet, without creating it. */
  peekNow(): number | null {
    return this.ctx ? this.ctx.currentTime : null;
  }

  /** The recorder's count-in click: a short blip straight to the speakers, higher on the bar. */
  click(time: number, accent: boolean): void {
    const ctx = this.ensure();
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1320;
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(accent ? 0.22 : 0.14, time + 0.002);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(amp).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
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

  /** Update the Studio knobs. Live drone voices and the racks follow at once. */
  setParams(params: Record<string, number>): void {
    this.params = params;
    if (!this.ctx) return;
    for (const rack of Object.values(this.racks)) rack?.setParams(params, this.tempo);
    this.siren?.set(params);
    this.analog?.setParams(params);
    const t = this.ctx.currentTime;
    if (this.droneLfo) {
      const motion = params['drone.motion'] ?? 0.6;
      this.droneLfo.osc.frequency.setTargetAtTime(0.03 + motion * 0.35, t, 0.2);
      this.droneLfo.depth.gain.setTargetAtTime(motion * 900, t, 0.2);
    }
    for (const v of this.droneVoices) {
      v.filter.frequency.setTargetAtTime(this.droneCutoff(v.note), t, 0.15);
      v.shimmer.gain.setTargetAtTime((params['drone.shimmer'] ?? 0.5) * 0.35, t, 0.2);
      v.air.gain.setTargetAtTime((params['drone.air'] ?? 0.25) * 0.05, t, 0.2);
    }
    if (this.acid) this.acid.filter.Q.setTargetAtTime(1 + (params['acid.reso'] ?? 0.75) * 20, t, 0.02);
    if (this.xyTone) this.xyTone.filter.frequency.setTargetAtTime(this.xyCutoff(), t, 0.03);
  }

  /** The macros' sound effects and how far each macro is turned. */
  setMacroFx(slots: MacroFxSlot[], tempo: number): void {
    this.macroSlots = slots;
    const tempoMoved = Math.abs(tempo - this.tempo) > 0.05;
    this.tempo = tempo;
    this.macroChain?.sync(slots, tempo);
    // Tempo-locked echoes follow the clock.
    if (tempoMoved) for (const rack of Object.values(this.racks)) rack?.setParams(this.params, tempo);
  }

  /** Cables between the analog synth's own jacks (audio-rate). */
  setAnalogRoutes(routes: Array<{ from: AnalogSource; to: AnalogDest }>): void {
    this.analogRoutes = routes;
    this.analog?.setRoutes(routes);
  }

  /** A signal from outside the analog synth into one of its inputs, or null to let go. */
  setAnalogExternal(dest: AnalogDest, value: number | null): void {
    this.analog?.setExternal(dest, value);
  }

  analogLfo(): number {
    return this.ctx && this.analog ? this.analog.lfoValue(this.ctx.currentTime) : 0;
  }

  get sirenSounding(): boolean {
    return this.siren?.sounding ?? false;
  }

  /** The scan synth's partials: start, stop and feed them. */
  scanRunning(on: boolean): void {
    this.ensure();
    if (on) this.scan?.start();
    else this.scan?.stop();
  }

  scanPlay(frequencies: number[], levels: number[], level: number): void {
    this.scan?.play(frequencies, levels, level);
  }

  /**
   * Which set's rack is in use, and which instruments its cables send through
   * it. A new set starts on a fresh rack; the old set's echoes and reverb
   * tails fade out and are cleared.
   */
  setRouting(set: StudioSet, throughFx: Set<InstrumentId>): void {
    const changed = set !== this.activeSet;
    this.activeSet = set;
    this.throughFx = new Set(throughFx);
    if (changed) this.retireRacks(SET_CHANGE_FADE_SECONDS);
    if (this.ctx) this.applyRouting();
  }

  /** Fade every effects rack out over `seconds` and drop it; the next routing builds a fresh one. */
  private retireRacks(seconds: number): void {
    const ctx = this.ctx;
    const racks = Object.values(this.racks).filter((r): r is FxRack => !!r);
    this.racks = {};
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const rack of racks) {
      holdAt(rack.output.gain, t);
      rack.output.gain.linearRampToValueAtTime(0, t + Math.max(0.005, seconds));
      setTimeout(() => rack.dispose(), (seconds + 0.1) * 1000);
    }
  }

  /**
   * Silence now: every note let go, every effects tail cut, and the mix
   * dipped for a moment so release tails do not ring on.
   */
  kill(): void {
    if (!this.ctx || !this.masterGain) return;
    this.allNotesOff();
    this.scan?.stop();
    this.retireRacks(KILL_FADE_SECONDS);
    this.applyRouting();
    const t = this.ctx.currentTime;
    const gain = this.masterGain.gain;
    holdAt(gain, t);
    gain.linearRampToValueAtTime(0, t + KILL_FADE_SECONDS);
    gain.setValueAtTime(0, t + KILL_HOLD_SECONDS);
    gain.linearRampToValueAtTime(this.masterVolume, t + KILL_HOLD_SECONDS + 0.05);
  }

  /** The mixer's strips, and which channels are in play (for solo). */
  setMixer(mixer: MixerState, channels: readonly ChannelId[]): void {
    this.mixer = mixer;
    this.mixerChannels = channels;
    this.applyMixer();
  }

  setInstrumentsSilenced(on: boolean): void {
    this.instrumentsSilenced = on;
    this.applyMixer();
  }

  /** The input channel's fader, 0-1 (up to +6 dB at the top). */
  setInputVolume(volume: number): void {
    this.inputVolume = Math.max(0, Math.min(1, volume));
    const strip = this.strips.get('input');
    if (strip && this.ctx) strip.input.gain.setTargetAtTime(this.inputVolume * 2, this.ctx.currentTime, 0.02);
  }

  /** Hear the live input through the mix, or only let it drive the visuals. */
  setInputMonitor(on: boolean): void {
    this.inputMonitor = on;
    this.applyMixer();
  }

  /** Where the live input connects: the input channel's strip. Creates the graph on first use. */
  inputChannel(): AudioNode {
    this.ensure();
    return this.strips.get('input')!.input;
  }

  /** Meter levels after each strip, 0-1. */
  channelLevels(ids: readonly ChannelId[]): Partial<Record<ChannelId, number>> {
    const out: Partial<Record<ChannelId, number>> = {};
    for (const id of ids) {
      const strip = this.strips.get(id);
      if (!strip) continue;
      if (!this.meterBuffer || this.meterBuffer.length !== strip.meter.fftSize) this.meterBuffer = new Float32Array(strip.meter.fftSize);
      strip.meter.getFloatTimeDomainData(this.meterBuffer);
      out[id] = meterLevel(this.meterBuffer);
    }
    return out;
  }

  private applyMixer(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [id, strip] of this.strips) {
      const settings = stripFor(this.mixer, id);
      for (const band of EQ_BAND_IDS) strip.eq[band].gain.setTargetAtTime(settings[band], t, MIXER_RAMP_SECONDS);
      strip.pan.pan.setTargetAtTime(settings.pan, t, MIXER_RAMP_SECONDS);
      let open = channelAudible(this.mixer, id, this.mixerChannels);
      if (id === 'input') open = open && this.inputMonitor;
      else if (this.instrumentsSilenced) open = false;
      strip.gate.gain.setTargetAtTime(open ? 1 : 0, t, MIXER_RAMP_SECONDS);
    }
  }

  private makeStrip(ctx: AudioContext, input: GainNode): Strip {
    const eq = {} as Record<EqBand, BiquadFilterNode>;
    let last: AudioNode = input;
    for (const band of EQ_BAND_IDS) {
      const f = ctx.createBiquadFilter();
      f.type = EQ_BANDS[band].type;
      f.frequency.value = EQ_BANDS[band].frequency;
      f.Q.value = EQ_BANDS[band].q;
      f.gain.value = 0;
      last.connect(f);
      last = f;
      eq[band] = f;
    }
    const pan = ctx.createStereoPanner();
    const gate = ctx.createGain();
    const meter = ctx.createAnalyser();
    meter.fftSize = 512;
    last.connect(pan).connect(gate);
    return { input, eq, pan, gate, meter };
  }

  private applyRouting(): void {
    if (!this.ctx || !this.bus || !this.masterGain) return;
    let rack = this.racks[this.activeSet];
    if (!rack) {
      rack = new FxRack(this.ctx, this.activeSet);
      rack.setParams(this.params, this.tempo);
      rack.output.connect(this.masterGain);
      this.racks[this.activeSet] = rack;
    }
    for (const [id, strip] of this.strips) {
      try { strip.gate.disconnect(); } catch { /* not connected */ }
      strip.gate.connect(id !== 'input' && this.throughFx.has(id) ? rack.input : this.masterGain);
      strip.gate.connect(strip.meter);
    }
  }

  /** Play one event at its own time (or now, if that has passed). */
  play(event: NoteEvent): void {
    const ctx = this.ensure();
    const time = Math.max(ctx.currentTime, Number.isFinite(event.time) ? event.time : 0);
    if (event.instrument === 'drums') {
      if (event.type === 'on' && event.drum) this.playDrum(event.drum, event.velocity, time);
      return;
    }
    if (event.instrument === 'bowls') {
      // A bowl rings out on its own; letting go does not stop it.
      if (event.type === 'on') this.strikeBowl(event.note, event.velocity, time);
      return;
    }
    if (event.instrument === 'dubbass') {
      if (event.type === 'on') this.dubBass?.on(event.note, event.velocity, time, this.params);
      else this.dubBass?.off(time, 0.12, event.note);
      return;
    }
    if (event.instrument === 'siren') {
      if (event.type === 'on') this.siren?.on(event.velocity, time, this.params);
      else this.siren?.off(time);
      return;
    }
    if (event.instrument === 'shots') {
      if (event.type === 'on' && this.noise) fireShot(ctx, this.bus!.shots, this.noise, event.note - 60, event.velocity, time, this.params);
      return;
    }
    if (event.instrument === 'analog') {
      if (event.type === 'on') this.analog?.noteOn(event.note, event.velocity, time);
      else this.analog?.noteOff(event.note, time);
      return;
    }
    if (event.instrument === 'xy') {
      if (event.type === 'on') this.xyOn(event.note, event.velocity, time);
      else if (this.xyTone?.note === event.note) this.xyOff(time);
      return;
    }
    if (event.instrument === 'acid') {
      if (event.type === 'on') this.acidOn(event.note, event.velocity, time);
      else if (this.acid?.note === event.note) this.acidOff(time);
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
      : event.instrument === 'drone'
        ? this.droneVoice(key, event.note, event.velocity, time)
        : this.keysVoice(key, event.note, event.velocity, time);
    this.voices.set(key, voice);
  }

  /** Release every sounding note. */
  allNotesOff(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const voice of this.voices.values()) voice.release(t);
    this.voices.clear();
    this.acidOff(t);
    this.xyOff(t);
    this.dubBass?.off(t);
    this.siren?.off(t);
    this.analog?.allOff(t);
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
    this.strips.clear();
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
    // The macros' sound effects sit between the mix and the bus compressor.
    this.macroChain = new MacroFxChain(ctx);
    master.connect(this.macroChain.input);
    this.macroChain.output.connect(compressor);
    this.macroChain.sync(this.macroSlots, this.tempo);
    compressor.connect(ctx.destination);
    this.masterGain = master;
    this.output = compressor;
    const bus = {} as Record<InstrumentId, GainNode>;
    this.strips.clear();
    for (const id of INSTRUMENTS) {
      const g = ctx.createGain();
      g.gain.value = this.volumes[id];
      bus[id] = g;
      this.strips.set(id, this.makeStrip(ctx, g));
    }
    const inputGain = ctx.createGain();
    inputGain.gain.value = this.inputVolume * 2;
    this.strips.set('input', this.makeStrip(ctx, inputGain));
    this.bus = bus;
    this.noise = makeNoise(ctx);
    this.dubBass = new DubBass(ctx, bus.dubbass);
    this.siren = new Siren(ctx, bus.siren);
    this.analog = new AnalogSynth(ctx, bus.analog, this.noise);
    this.analog.setParams(this.params);
    this.analog.setRoutes(this.analogRoutes);
    this.scan = new ScanSynth(ctx, bus.scan);
    this.applyRouting();
    this.applyMixer();
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
    const p = this.params;
    const level = velocityGain(velocity) * (p[`mix.${voice}.level`] ?? 0.8) * 1.25;
    const cents = ((p[`mix.${voice}.tune`] ?? 0.5) - 0.5) * 1200;
    this.drumRate = Math.pow(2, cents / 1200);
    switch (voice) {
      case 'kick': {
        const osc = ctx.createOscillator();
        osc.detune.value = cents;
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
        osc.detune.value = cents;
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
        osc.detune.value = cents;
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
        osc.detune.value = cents;
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

  private droneCutoff(note: number): number {
    const tone = this.params['drone.tone'] ?? 0.35;
    return Math.min(12000, 180 + tone * tone * 5000 + midiToHz(note) * 0.5);
  }

  /** A slow pad: detuned saws, a sub, shimmer an octave and a twelfth up, a touch of air. */
  private droneVoice(key: string, note: number, velocity: number, time: number): MelodicVoice {
    const ctx = this.ctx!;
    const p = this.params;
    if (!this.droneLfo) {
      const osc = ctx.createOscillator();
      osc.frequency.value = 0.03 + (p['drone.motion'] ?? 0.6) * 0.35;
      const depth = ctx.createGain();
      depth.gain.value = (p['drone.motion'] ?? 0.6) * 900;
      osc.connect(depth);
      osc.start();
      this.droneLfo = { osc, depth };
    }
    const freq = midiToHz(note);
    const detune = (p['drone.detune'] ?? 0.25) * 22;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.value = this.droneCutoff(note);
    this.droneLfo.depth.connect(filter.frequency);
    const panner = ctx.createStereoPanner();
    panner.pan.value = (Math.random() * 2 - 1) * (p['drone.width'] ?? 0.8) * 0.8;
    const amp = ctx.createGain();
    const sources: AudioScheduledSourceNode[] = [];
    for (const cents of [-detune, 0, detune]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = cents;
      const g = ctx.createGain();
      g.gain.value = 0.22;
      o.connect(g).connect(filter);
      sources.push(o);
    }
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq / 2;
    const subGain = ctx.createGain();
    subGain.gain.value = (p['drone.depth'] ?? 0.6) * 0.5;
    sub.connect(subGain).connect(amp);
    sources.push(sub);
    const shimmer = ctx.createGain();
    shimmer.gain.value = (p['drone.shimmer'] ?? 0.5) * 0.35;
    for (const ratio of [2, 3]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * ratio;
      o.detune.value = ratio === 3 ? 4 : -3;
      o.connect(shimmer);
      sources.push(o);
    }
    shimmer.connect(amp);
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise;
    noise.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.value = 6000;
    airFilter.Q.value = 0.6;
    const air = ctx.createGain();
    air.gain.value = (p['drone.air'] ?? 0.25) * 0.05;
    noise.connect(airFilter).connect(air).connect(amp);
    sources.push(noise);
    filter.connect(amp);
    amp.connect(panner).connect(this.bus!.drone);
    const peak = velocityGain(velocity) * 0.32;
    const swell = 0.4 + (p['drone.swell'] ?? 0.55) * 6;
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(peak, time + swell);
    for (const src of sources) src.start(time);
    const handle = { filter, shimmer, air, note };
    this.droneVoices.add(handle);
    const stopAll = (at: number) => {
      for (const src of sources) { try { src.stop(at); } catch { /* stopped */ } }
      setTimeout(() => {
        this.droneVoices.delete(handle);
        try { amp.disconnect(); this.droneLfo?.depth.disconnect(filter.frequency); } catch { /* gone */ }
      }, Math.max(0, (at - ctx.currentTime) * 1000 + 100));
    };
    const release = 1.5 + (p['drone.swell'] ?? 0.55) * 5;
    return {
      key,
      startedAt: time,
      release: (at) => {
        holdAt(amp.gain, at);
        amp.gain.setTargetAtTime(0, at, release / 4);
        stopAll(at + release * 1.5 + 0.1);
      },
      kill: (at) => {
        holdAt(amp.gain, at);
        amp.gain.linearRampToValueAtTime(0, at + 0.05);
        stopAll(at + 0.1);
      },
    };
  }

  /** A singing bowl: inharmonic partials, each a slowly beating pair, ringing for seconds. */
  private strikeBowl(note: number, velocity: number, time: number): void {
    const ctx = this.ctx!;
    const p = this.params;
    const freq = midiToHz(note);
    const ring = 2 + (p['bowls.ring'] ?? 0.7) * 18;
    const tone = p['bowls.tone'] ?? 0.5;
    const spread = (p['bowls.spread'] ?? 0.5) * 3;
    const out = ctx.createGain();
    out.gain.value = velocityGain(velocity) * 0.3;
    out.connect(this.bus!.bowls);
    const partials: Array<[number, number, number]> = [[1, 1, 1], [2.76, 0.45 + tone * 0.4, 0.7], [5.4, 0.15 + tone * 0.4, 0.45], [8.93, tone * 0.25, 0.3]];
    let longest = 0;
    for (const [ratio, level, decayShare] of partials) {
      const decay = ring * decayShare;
      longest = Math.max(longest, decay);
      for (const beat of [-spread / 2, spread / 2]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = freq * ratio + beat * ratio;
        const g = envelope(ctx, time, level * 0.5, 0.004, decay);
        o.connect(g).connect(out);
        o.start(time);
        o.stop(time + decay + 0.1);
      }
    }
    setTimeout(() => { try { out.disconnect(); } catch { /* gone */ } }, (time - ctx.currentTime + longest + 0.5) * 1000);
  }

  /** The acid line: one voice, a resonant filter swept by an accented envelope, glide between tied notes. */
  private acidOn(note: number, velocity: number, time: number): void {
    const ctx = this.ctx!;
    const p = this.params;
    const freq = midiToHz(note);
    const accent = velocity > 0.9 ? 1 : 0;
    const cutoff = 60 + Math.pow(p['acid.cutoff'] ?? 0.35, 2) * 3500;
    const env = (p['acid.env'] ?? 0.6) * (3000 + accent * (p['acid.accent'] ?? 0.7) * 4000);
    const decay = 0.06 + (p['acid.decay'] ?? 0.35) * 0.6;
    if (this.acid) {
      // Tied to the step before: slide the pitch and keep the voice.
      const v = this.acid;
      v.osc.frequency.cancelScheduledValues(time);
      v.osc.frequency.setValueAtTime(midiToHz(v.note), time);
      v.osc.frequency.exponentialRampToValueAtTime(freq, time + 0.06);
      v.note = note;
      v.filter.frequency.cancelScheduledValues(time);
      v.filter.frequency.setValueAtTime(cutoff + env * 0.5, time);
      v.filter.frequency.setTargetAtTime(cutoff, time, decay / 3);
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1 + (p['acid.reso'] ?? 0.75) * 20;
    filter.frequency.setValueAtTime(cutoff + env, time);
    filter.frequency.setTargetAtTime(cutoff, time + 0.005, decay / 3);
    const drive = ctx.createWaveShaper();
    const amount = 1 + (p['acid.drive'] ?? 0.4) * 8;
    const curve = new Float32Array(512);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / 511) * 2 - 1;
      curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    drive.curve = curve;
    const amp = ctx.createGain();
    const level = (0.28 + accent * 0.12) * velocityGain(velocity);
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(level, time + 0.004);
    osc.connect(filter).connect(drive).connect(amp).connect(this.bus!.acid);
    osc.start(time);
    this.acid = { osc, filter, amp, note };
  }

  private xyCutoff(): number {
    return 250 + Math.pow(this.params['xy.y'] ?? 0.5, 2) * 7000;
  }

  /** The XY pad's own voice: a soft gliding tone, brighter towards the top of the pad. */
  private xyOn(note: number, velocity: number, time: number): void {
    const ctx = this.ctx!;
    const freq = midiToHz(note);
    if (this.xyTone) {
      for (const [i, o] of this.xyTone.oscs.entries()) {
        o.frequency.cancelScheduledValues(time);
        o.frequency.setTargetAtTime(freq * (i === 1 ? 2 : 1), time, 0.06);
      }
      this.xyTone.note = note;
      return;
    }
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    filter.frequency.value = this.xyCutoff();
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(velocityGain(velocity) * 0.28, time + 0.08);
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.2;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = 6;
    vibrato.connect(vibratoDepth);
    const oscs = (['triangle', 'sine'] as OscillatorType[]).map((type, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * (i === 1 ? 2 : 1);
      vibratoDepth.connect(o.detune);
      const g = ctx.createGain();
      g.gain.value = i === 1 ? 0.3 : 1;
      o.connect(g).connect(filter);
      o.start(time);
      return o;
    });
    vibrato.start(time);
    oscs.push(vibrato);
    filter.connect(amp).connect(this.bus!.xy);
    this.xyTone = { oscs, filter, amp, note };
  }

  private xyOff(time: number): void {
    const v = this.xyTone;
    if (!v) return;
    this.xyTone = null;
    holdAt(v.amp.gain, time);
    v.amp.gain.setTargetAtTime(0, time, 0.25);
    for (const o of v.oscs) { try { o.stop(time + 1.5); } catch { /* stopped */ } }
    v.oscs[0].onended = () => { try { v.amp.disconnect(); } catch { /* gone */ } };
  }

  private acidOff(time: number): void {
    const v = this.acid;
    if (!v) return;
    this.acid = null;
    holdAt(v.amp.gain, time);
    v.amp.gain.setTargetAtTime(0, time, 0.015);
    try { v.osc.stop(time + 0.15); } catch { /* stopped */ }
    v.osc.onended = () => { try { v.amp.disconnect(); } catch { /* gone */ } };
  }

  /** A filtered burst of noise with an exponential tail. Returns its gain, for choking. */
  private noiseHit(time: number, level: number, decay: number, type: BiquadFilterType, freq: number, out: AudioNode): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = this.drumRate;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq * this.drumRate;
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
