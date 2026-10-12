/**
 * Sound for video clips on the VJ deck.
 *
 * Every video element in the app starts muted. A clip that is playing on a
 * deck row has its element routed through this mixer, so what is heard is the
 * same element that is seen and the two cannot drift apart. Each clip has a
 * volume, a pan and a mute; a row's mute and solo, the crossfader and the
 * master level apply on top.
 *
 * The mixer has its own AudioContext. An element can be wired to one context
 * only, for good, and the analyzer closes and reopens its context when the
 * audio input changes.
 */
import { writable } from 'svelte/store';

export interface ClipAudioVoice {
  /** The clip's id. */
  id: string;
  element: HTMLMediaElement;
  /** 0 to 1, before the master level. */
  gain: number;
  /** -1 (left) to 1 (right). */
  pan: number;
}

export interface ClipAudioMasterState {
  volume: number;
  muted: boolean;
  /** Clips being mixed right now. The master control shows itself above zero. */
  activeClips: number;
  /** Always false here; kept so the master control reads the same on both lines of the app. */
  exportSilenced: boolean;
}

const MASTER_KEY = 'ghost-arcade_clip_audio_master';
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(value) ? value : lo));

function savedMaster(): { volume: number; muted: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(MASTER_KEY) || '{}');
    return { volume: clamp(saved.volume ?? 1, 0, 1), muted: saved.muted === true };
  } catch {
    return { volume: 1, muted: false };
  }
}

export const clipAudioMaster = writable<ClipAudioMasterState>({ ...savedMaster(), activeClips: 0, exportSilenced: false });

type Wiring = { gain: GainNode; pan: StereoPannerNode };
/** How fast a level change lands: quick, without a click. */
const RAMP_SECONDS = 0.02;

/** The parts of a deck this needs: kept loose so the mix can be tested without the store. */
export interface ClipAudioDeckClip {
  id: string;
  type: string;
  src?: string;
  videoElement?: HTMLMediaElement;
  audioVolume?: number;
  audioPan?: number;
  audioMuted?: boolean;
}
export interface ClipAudioDeckRow { activeClip: ClipAudioDeckClip | null; mute?: boolean; solo?: boolean }
export interface ClipAudioDeckState {
  isOpen: boolean;
  isLive: boolean;
  stoppedAll: boolean;
  crossfaderEnabled: boolean;
  crossfaderValue: number;
  layerStates: ClipAudioDeckRow[];
  bankBLayerStates: ClipAudioDeckRow[];
}

/**
 * Which clips should sound, and how loud. A clip on both decks, or on two
 * rows, is one voice at its loudest level: it is one element.
 */
export function clipAudioVoices(state: ClipAudioDeckState): ClipAudioVoice[] {
  if ((!state.isOpen && !state.isLive) || state.stoppedAll) return [];
  const voices = new Map<HTMLMediaElement, ClipAudioVoice>();
  const x = clamp(state.crossfaderValue, 0, 1);
  const decks: [ClipAudioDeckRow[], number][] = state.crossfaderEnabled
    // Equal power, so the middle of the fade is not a dip.
    ? [[state.layerStates, Math.cos(x * Math.PI / 2)], [state.bankBLayerStates, Math.sin(x * Math.PI / 2)]]
    : [[state.layerStates, 1]];
  for (const [rows, deckGain] of decks) {
    const solo = rows.some((row) => row.solo);
    for (const row of rows) {
      const clip = row.activeClip;
      if (!clip || clip.type !== 'video' || !clip.videoElement || clip.src?.startsWith('live://')) continue;
      const silent = clip.audioMuted === true || row.mute === true || (solo && !row.solo);
      const gain = silent ? 0 : clamp(clip.audioVolume ?? 1, 0, 1) * deckGain;
      const before = voices.get(clip.videoElement);
      if (!before || gain > before.gain) {
        voices.set(clip.videoElement, { id: clip.id, element: clip.videoElement, gain, pan: clamp(clip.audioPan ?? 0, -1, 1) });
      }
    }
  }
  return [...voices.values()];
}

export class ClipAudioMixer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private wired = new WeakMap<HTMLMediaElement, Wiring>();
  private sounding = new Set<HTMLMediaElement>();
  private level = savedMaster();

  constructor(private createContext: () => AudioContext = () => new AudioContext()) {}

  private graph(): { context: AudioContext; master: GainNode } {
    if (!this.context || !this.master) {
      this.context = this.createContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.level.muted ? 0 : this.level.volume;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    return { context: this.context, master: this.master };
  }

  private wire(element: HTMLMediaElement): Wiring | null {
    const known = this.wired.get(element);
    if (known) return known;
    try {
      const { context, master } = this.graph();
      const source = context.createMediaElementSource(element);
      const gain = context.createGain();
      gain.gain.value = 0;
      const pan = context.createStereoPanner();
      source.connect(gain).connect(pan).connect(master);
      const wiring = { gain, pan };
      this.wired.set(element, wiring);
      return wiring;
    } catch (error) {
      console.warn('[ClipAudio] could not route a clip:', error);
      return null;
    }
  }

  /** Make exactly these clips sound. Everything else goes quiet and muted. */
  apply(voices: ClipAudioVoice[]): void {
    const wanted = new Set<HTMLMediaElement>();
    for (const voice of voices) {
      const wiring = this.wire(voice.element);
      if (!wiring) continue;
      wanted.add(voice.element);
      const now = this.context!.currentTime;
      wiring.gain.gain.setTargetAtTime(clamp(voice.gain, 0, 1), now, RAMP_SECONDS);
      wiring.pan.pan.setTargetAtTime(clamp(voice.pan, -1, 1), now, RAMP_SECONDS);
      if (voice.element.muted) voice.element.muted = false;
      if (voice.element.volume !== 1) voice.element.volume = 1;
    }
    for (const element of this.sounding) {
      if (wanted.has(element)) continue;
      const wiring = this.wired.get(element);
      if (wiring && this.context) wiring.gain.gain.setTargetAtTime(0, this.context.currentTime, RAMP_SECONDS);
      element.muted = true;
    }
    this.sounding = wanted;
    clipAudioMaster.update((state) => (state.activeClips === wanted.size ? state : { ...state, activeClips: wanted.size }));
  }

  private setLevel(level: { volume: number; muted: boolean }) {
    this.level = level;
    if (this.master && this.context) this.master.gain.setTargetAtTime(level.muted ? 0 : level.volume, this.context.currentTime, RAMP_SECONDS);
    try { localStorage.setItem(MASTER_KEY, JSON.stringify(level)); } catch { /* the level still holds for this session */ }
    clipAudioMaster.update((state) => ({ ...state, ...level }));
  }
  setMasterVolume(volume: number): void { this.setLevel({ ...this.level, volume: clamp(volume, 0, 1) }); }
  setMasterMuted(muted: boolean): void { this.setLevel({ ...this.level, muted }); }
}

export const clipAudio = new ClipAudioMixer();
