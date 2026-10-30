/**
 * The studio's sound library: what every sound is given to play with and
 * what it hands back.
 *
 * A sound is plain Web Audio built on whatever context it is handed (the
 * studio's live AudioContext, or an OfflineAudioContext when sounds are
 * rendered to be checked), played into one output node: an instrument's
 * bus, so it runs through the mixer strip, the set's effects and the
 * cables like everything else. Each sound schedules all of its own nodes
 * from `time` and lets them go when it has finished.
 */

/** What a sound is played with. */
export interface SoundContext {
  ctx: BaseAudioContext;
  /** Where the sound goes: its instrument's bus. */
  out: AudioNode;
  /** One second of white noise, looped wherever a sound needs noise. */
  noise: AudioBuffer;
  /** Tempo in beats per minute: transitions are measured in bars. */
  tempo: number;
  /**
   * Seconds from `time` to the next bar line, when the studio knows it, so
   * a riser can land on the one. Undefined: the sound picks its own length.
   */
  toNextBar?: number;
  /** The key's root as a MIDI note (C3 = 48), for sounds tuned to the music but not played at a pitch. */
  keyRoot: number;
  /** The FX pads' knobs, each 0-1: Size (pitch and scale), Tail (how long it rings), Tone (dark to bright). */
  size: number;
  tail: number;
  tone: number;
}

/** A sounding sound. */
export interface SoundHandle {
  /** Seconds the sound lasts from its start; Infinity for a loop, which plays until stopped. */
  duration: number;
  /**
   * Let it go from `at`, fading over `fade` seconds (a loop's own release
   * when omitted). A one-shot that has already finished ignores it.
   */
  stop(at: number, fade?: number): void;
}

export type SoundCategory = 'resonant' | 'dub' | 'rise' | 'impact' | 'atmos';

/**
 * strike: a struck, pitched resonance that rings out (bowls, bells, kalimba).
 * shot: a one-shot effect (a laser, a riser, an impact).
 * loop: a texture that plays until it is pressed again (rain, wind, crackle).
 */
export type SoundKind = 'strike' | 'shot' | 'loop';

export interface SoundDef {
  /** Stable id: saved in projects, never renamed. */
  id: string;
  /** What the pad and the menu show. Short (fits a pad): one or two words. */
  name: string;
  category: SoundCategory;
  kind: SoundKind;
  /** Played at the note's pitch. Unpitched sounds ignore `note` (a few use `keyRoot`). */
  pitched: boolean;
  /** One plain sentence for the tooltip. */
  blurb: string;
  play(sc: SoundContext, note: number, velocity: number, time: number): SoundHandle;
}

export const SOUND_CATEGORY_LABELS: Record<SoundCategory, string> = {
  resonant: 'Bowls and bells',
  dub: 'Dub',
  rise: 'Risers and drops',
  impact: 'Impacts',
  atmos: 'Atmospheres',
};

// ── Helpers ─────────────────────────────────────────────────────────────

export function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** Loudness from velocity: a gentle curve so soft playing stays audible. */
export function velocityGain(velocity: number): number {
  return Math.pow(Math.max(0, Math.min(1, velocity)), 1.4) * 0.9 + 0.1 * (velocity > 0 ? 1 : 0);
}

/** Freeze a param at its current scheduled value from `time`, so a new ramp starts there. */
export function holdAt(param: AudioParam, time: number): void {
  const p = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof p.cancelAndHoldAtTime === 'function') {
    p.cancelAndHoldAtTime(time);
  } else {
    param.cancelScheduledValues(time);
    param.setValueAtTime(param.value, time);
  }
}

/** A percussive gain envelope: fast attack, exponential decay to silence. */
export function envelope(ctx: BaseAudioContext, time: number, level: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, level), time + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
  return g;
}

/** One second of white noise. */
export function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** A looping noise source on the shared buffer, started at a random point so layers do not phase. */
export function noiseSource(sc: SoundContext, time: number): AudioBufferSourceNode {
  const n = sc.ctx.createBufferSource();
  n.buffer = sc.noise;
  n.loop = true;
  n.start(time, Math.random() * Math.max(0, sc.noise.duration - 0.01));
  return n;
}

/** Seconds per beat at the context's tempo. */
export function beatSeconds(sc: SoundContext): number {
  return 60 / Math.max(30, Math.min(300, sc.tempo || 120));
}

/**
 * Disconnect `node` once the sound is over, so finished sounds leave no
 * nodes behind. Uses the context's clock (works offline too).
 */
export function releaseAfter(sc: SoundContext, node: AudioNode, endTime: number): void {
  const ctx = sc.ctx;
  // A silent constant source stopped at the end time: its `ended` event is
  // timed by the audio clock, on any kind of context.
  const timer = ctx.createConstantSource();
  timer.offset.value = 0;
  timer.onended = () => {
    try { node.disconnect(); } catch { /* already gone */ }
    try { timer.disconnect(); } catch { /* already gone */ }
  };
  timer.connect(ctx.destination);
  timer.start(Math.max(ctx.currentTime, endTime - 0.05));
  timer.stop(Math.max(ctx.currentTime, endTime) + 0.05);
}

/** A handle for a one-shot that cannot be cut short (it rings out). */
export function oneShotHandle(duration: number): SoundHandle {
  return { duration, stop: () => {} };
}

/** A handle for a one-shot that can be faded early through `amp`. */
export function fadeableHandle(duration: number, amp: GainNode, start: number): SoundHandle {
  return {
    duration,
    stop(at, fade = 0.08) {
      if (at >= start + duration) return;
      holdAt(amp.gain, at);
      amp.gain.setTargetAtTime(0, at, Math.max(0.005, fade / 4));
    },
  };
}

/** Soft saturation curve: tanh normalised to ±1. */
export function softCurve(amount: number): Float32Array<ArrayBuffer> {
  const c = new Float32Array(512);
  const a = Math.max(0.01, amount);
  for (let i = 0; i < c.length; i++) {
    const x = (i / (c.length - 1)) * 2 - 1;
    c[i] = Math.tanh(x * a) / Math.tanh(a);
  }
  return c;
}

// ── Pad patches (the drone's sounds) ────────────────────────────────────

/** What a pad voice is played with: the drone's knobs, each 0-1. */
export interface PadContext {
  ctx: BaseAudioContext;
  out: AudioNode;
  noise: AudioBuffer;
  /**
   * The drone module's knobs: drone.tone (dark to bright), drone.motion
   * (slow movement), drone.shimmer (upper partials), drone.width (stereo),
   * drone.detune, drone.swell (attack and release), drone.air (breath and
   * noise), drone.depth (sub and body). Every patch reads all eight in its
   * own way, so the knobs always do something.
   */
  params: Record<string, number>;
}

/** A held pad note. */
export interface PadVoice {
  /** Let it go: it fades over the patch's release (longer with drone.swell). */
  release(at: number): void;
  /** Cut it now (a stolen voice, the kill switch): silent within ~50 ms. */
  kill(at: number): void;
  /** Follow knob moves while held (optional but expected for tone and shimmer). */
  update?(params: Record<string, number>, at: number): void;
}

export interface PadPatchDef {
  /** Stable id: saved in projects, never renamed. */
  id: string;
  name: string;
  blurb: string;
  voice(pc: PadContext, note: number, velocity: number, time: number): PadVoice;
}
