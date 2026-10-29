/**
 * Music studio state.
 *
 * The instruments, the note-visual behaviour, the beat pattern and the
 * recorded takes are part of the project: they save in the .gha, come back
 * with autosave recovery, ride Export Package and reset with File > New.
 * Whether the panel is open, which MIDI input is used and what is playing
 * right now are session state.
 *
 * This module only holds state. The sound, the clocks and the link to the
 * VJ clips live in musicRuntime.ts.
 */

import { get, writable } from 'svelte/store';
import { INSTRUMENTS, type InstrumentId } from './noteEvents';
import { DEFAULT_VISUAL_SETTINGS, type NoteVisualMode, type NoteVisualSettings } from './noteVisuals';
import {
  clearPattern,
  normalizePattern,
  resizePattern,
  starterPattern,
  toggleStep,
  type DrumPattern,
  type PatternLength,
} from './drumPattern';
import { normalizeTake, type Take } from './recording';
import { DEFAULT_OCTAVE, KEYBOARD_SIZES, clampOctave, type KeyboardSize } from './keyboardLayout';
import { KEYS_PATCHES, SYNTH_PATCHES, type KeysPatch, type SynthPatch } from './instruments';
import type { DrumVoice } from './noteEvents';

export const MUSIC_STUDIO_SCHEMA = 1;

export interface MusicStudioProjectState {
  instrument: InstrumentId;
  synthPatch: SynthPatch;
  keysPatch: KeysPatch;
  volumes: Record<InstrumentId, number>;
  masterVolume: number;
  visuals: Record<InstrumentId, NoteVisualSettings>;
  octave: number;
  velocity: number;
  pattern: DrumPattern;
  takes: Take[];
}

export interface MusicStudioState extends MusicStudioProjectState {
  isOpen: boolean;
  /** Letter keys play the selected instrument. */
  keysArmed: boolean;
  /** MIDI input id, '' for every input. Machine wiring, kept per computer. */
  midiInput: string;
  /** How much of the piano the panel shows. A view preference, kept per computer. */
  keyboardSize: KeyboardSize;
  sequencerPlaying: boolean;
  recording: boolean;
  /** performance.now() when recording started, for the timer. */
  recordingSince: number | null;
  playingTakeId: string | null;
  loopTake: boolean;
}

/** The saved section of a project file. */
export interface MusicStudioProjectSection extends MusicStudioProjectState {
  schemaVersion: number;
}

const MIDI_INPUT_KEY = 'ghostarcade-music-midi-input';
const KEYBOARD_SIZE_KEY = 'ghostarcade-music-keyboard-size';

function loadPref(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch { /* private mode / no storage: the choice lasts the session */ }
}

function loadKeyboardSize(): KeyboardSize {
  const saved = loadPref(KEYBOARD_SIZE_KEY);
  return KEYBOARD_SIZES.some((k) => k.id === saved) ? (saved as KeyboardSize) : 'compact';
}

function cloneVisuals(visuals: Record<InstrumentId, NoteVisualSettings>): Record<InstrumentId, NoteVisualSettings> {
  return {
    synth: { ...visuals.synth },
    keys: { ...visuals.keys },
    drums: { ...visuals.drums },
  };
}

export function defaultProjectState(): MusicStudioProjectState {
  return {
    instrument: 'synth',
    synthPatch: 'pad',
    keysPatch: 'epiano',
    volumes: { synth: 0.8, keys: 0.8, drums: 0.9 },
    masterVolume: 0.85,
    visuals: cloneVisuals(DEFAULT_VISUAL_SETTINGS),
    octave: DEFAULT_OCTAVE,
    velocity: 0.8,
    pattern: starterPattern(),
    takes: [],
  };
}

function clamp01(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

function positive(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(max, n) : fallback;
}

function normalizeVisual(raw: unknown, fallback: NoteVisualSettings): NoteVisualSettings {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<NoteVisualSettings>;
  return {
    mode: v.mode === 'build' || v.mode === 'fade' ? v.mode : fallback.mode,
    attack: positive(v.attack, fallback.attack, 4),
    decay: positive(v.decay, fallback.decay, 8),
    sustain: clamp01(v.sustain, fallback.sustain),
    release: positive(v.release, fallback.release, 12),
    linger: positive(v.linger, fallback.linger, 60),
    growth: clamp01(v.growth, fallback.growth),
  };
}

/** Read the saved section back, filling in anything missing or out of range. */
export function normalizeProjectState(raw: unknown): MusicStudioProjectState {
  const d = defaultProjectState();
  if (!raw || typeof raw !== 'object') return d;
  const input = raw as Partial<MusicStudioProjectSection>;
  const volumes = (input.volumes ?? {}) as Partial<Record<InstrumentId, number>>;
  const visuals = (input.visuals ?? {}) as Partial<Record<InstrumentId, unknown>>;
  const takes: Take[] = [];
  for (const t of Array.isArray(input.takes) ? input.takes : []) {
    const take = normalizeTake(t);
    if (take && !takes.some((x) => x.id === take.id)) takes.push(take);
  }
  return {
    instrument: INSTRUMENTS.includes(input.instrument as InstrumentId) ? (input.instrument as InstrumentId) : d.instrument,
    synthPatch: SYNTH_PATCHES.some((p) => p.id === input.synthPatch) ? (input.synthPatch as SynthPatch) : d.synthPatch,
    keysPatch: KEYS_PATCHES.some((p) => p.id === input.keysPatch) ? (input.keysPatch as KeysPatch) : d.keysPatch,
    volumes: {
      synth: clamp01(volumes.synth, d.volumes.synth),
      keys: clamp01(volumes.keys, d.volumes.keys),
      drums: clamp01(volumes.drums, d.volumes.drums),
    },
    masterVolume: clamp01(input.masterVolume, d.masterVolume),
    visuals: {
      synth: normalizeVisual(visuals.synth, d.visuals.synth),
      keys: normalizeVisual(visuals.keys, d.visuals.keys),
      drums: normalizeVisual(visuals.drums, d.visuals.drums),
    },
    octave: clampOctave(Number.isFinite(Number(input.octave)) ? Number(input.octave) : d.octave),
    velocity: Math.max(0.05, clamp01(input.velocity, d.velocity)),
    pattern: input.pattern ? normalizePattern(input.pattern) : d.pattern,
    takes,
  };
}

function initialState(): MusicStudioState {
  return {
    ...defaultProjectState(),
    isOpen: false,
    keysArmed: true,
    midiInput: loadPref(MIDI_INPUT_KEY),
    keyboardSize: loadKeyboardSize(),
    sequencerPlaying: false,
    recording: false,
    recordingSince: null,
    playingTakeId: null,
    loopTake: false,
  };
}

/** "Take 3" after "Take 1" and "Take 2". */
export function nextTakeName(takes: Take[]): string {
  let highest = 0;
  for (const take of takes) {
    const m = /^Take (\d+)$/.exec(take.name);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `Take ${Math.max(highest, takes.length) + 1}`;
}

function createMusicStudioStore() {
  const store = writable<MusicStudioState>(initialState());
  const { subscribe, update } = store;
  const set = (patch: Partial<MusicStudioState>) => update((s) => ({ ...s, ...patch }));

  return {
    subscribe,

    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
    toggleOpen: () => update((s) => ({ ...s, isOpen: !s.isOpen })),

    setInstrument: (instrument: InstrumentId) => set({ instrument }),
    setSynthPatch: (synthPatch: SynthPatch) => set({ synthPatch }),
    setKeysPatch: (keysPatch: KeysPatch) => set({ keysPatch }),
    setVolume: (instrument: InstrumentId, volume: number) =>
      update((s) => ({ ...s, volumes: { ...s.volumes, [instrument]: clamp01(volume, s.volumes[instrument]) } })),
    setMasterVolume: (volume: number) => update((s) => ({ ...s, masterVolume: clamp01(volume, s.masterVolume) })),

    setVisual: (instrument: InstrumentId, patch: Partial<NoteVisualSettings>) =>
      update((s) => ({
        ...s,
        visuals: { ...s.visuals, [instrument]: normalizeVisual({ ...s.visuals[instrument], ...patch }, s.visuals[instrument]) },
      })),
    setVisualMode: (instrument: InstrumentId, mode: NoteVisualMode) =>
      update((s) => ({ ...s, visuals: { ...s.visuals, [instrument]: { ...s.visuals[instrument], mode } } })),

    setOctave: (octave: number) => set({ octave: clampOctave(octave) }),
    shiftOctave: (delta: number) => update((s) => ({ ...s, octave: clampOctave(s.octave + delta) })),
    setVelocity: (velocity: number) => set({ velocity: Math.max(0.05, clamp01(velocity, 0.8)) }),
    shiftVelocity: (delta: number) => update((s) => ({ ...s, velocity: Math.max(0.05, clamp01(s.velocity + delta, s.velocity)) })),
    setKeysArmed: (keysArmed: boolean) => set({ keysArmed }),
    setMidiInput: (midiInput: string) => {
      savePref(MIDI_INPUT_KEY, midiInput);
      set({ midiInput });
    },
    setKeyboardSize: (keyboardSize: KeyboardSize) => {
      savePref(KEYBOARD_SIZE_KEY, keyboardSize);
      set({ keyboardSize });
    },

    toggleStep: (voice: DrumVoice, step: number, velocity?: number) =>
      update((s) => ({ ...s, pattern: toggleStep(s.pattern, voice, step, velocity) })),
    setPatternLength: (steps: PatternLength) => update((s) => ({ ...s, pattern: resizePattern(s.pattern, steps) })),
    setSwing: (swing: number) => update((s) => ({ ...s, pattern: { ...s.pattern, swing: Math.max(0, Math.min(0.5, swing)) } })),
    clearPattern: () => update((s) => ({ ...s, pattern: clearPattern(s.pattern) })),
    setPattern: (pattern: DrumPattern) => set({ pattern: normalizePattern(pattern) }),

    setTransport: (patch: Partial<Pick<MusicStudioState, 'sequencerPlaying' | 'recording' | 'recordingSince' | 'playingTakeId' | 'loopTake'>>) =>
      set(patch),

    addTake: (take: Take) => update((s) => ({ ...s, takes: [...s.takes, take] })),
    renameTake: (id: string, name: string) =>
      update((s) => ({ ...s, takes: s.takes.map((t) => (t.id === id ? { ...t, name: name.trim() || t.name } : t)) })),
    removeTake: (id: string) =>
      update((s) => ({
        ...s,
        takes: s.takes.filter((t) => t.id !== id),
        playingTakeId: s.playingTakeId === id ? null : s.playingTakeId,
      })),

    /** The project section. */
    serialize(): MusicStudioProjectSection {
      const s = get(store);
      return {
        schemaVersion: MUSIC_STUDIO_SCHEMA,
        instrument: s.instrument,
        synthPatch: s.synthPatch,
        keysPatch: s.keysPatch,
        volumes: { ...s.volumes },
        masterVolume: s.masterVolume,
        visuals: cloneVisuals(s.visuals),
        octave: s.octave,
        velocity: s.velocity,
        pattern: normalizePattern(s.pattern),
        takes: s.takes.map((t) => ({ ...t, events: t.events.map((e) => ({ ...e })), pattern: t.pattern ? normalizePattern(t.pattern) : null })),
      };
    },

    /** Load a project section; null resets to a new project's studio. Stops what was playing. */
    hydrate(raw: unknown): void {
      const next = normalizeProjectState(raw);
      update((s) => ({
        ...s,
        ...next,
        sequencerPlaying: false,
        recording: false,
        recordingSince: null,
        playingTakeId: null,
      }));
    },
  };
}

export const musicStudio = createMusicStudioStore();

/** What the runtime publishes for the UI: the playhead and held notes. */
export interface MusicTransportState {
  step: number;
  /** 0-1 through the playing take. */
  takeProgress: number;
  /** `${instrument}:${note}` of every sounding note. */
  held: Set<string>;
}

export const musicTransport = writable<MusicTransportState>({ step: -1, takeProgress: 0, held: new Set() });
