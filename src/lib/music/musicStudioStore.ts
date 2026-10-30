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
import {
  RECORD_LENGTHS,
  QUANTIZE_GRIDS,
  normalizeRecordedBeat,
  normalizeRecordedLoop,
  type QuantizeId,
  type RecordLength,
} from './loopRecorder';
import {
  MAX_SESSION_ROWS,
  clipFromRecording,
  defaultSession,
  firstEmptySlot,
  normalizeSession,
  sessionRows,
  updateClip,
  withClip,
  type Session,
  type SessionClip,
  type TrackId,
} from './session';
import { generateUUID } from '../utils/uuid';
import { normalizeScene, type MusicScene } from './scenes';
import type { LoopRole } from './loops';
import { createMacroFx, normalizeMacroFx, type MacroFxInstance, type MacroFxParam, type MacroFxType } from './macroFx';
import {
  SCALES,
  STUDIO_SETS,
  connect,
  defaultAcidSteps,
  defaultCables,
  defaultParams,
  disconnect,
  normalizeAcidSteps,
  normalizeCables,
  normalizeParams,
  type AcidStep,
  type Cable,
  type MusicKey,
  type ScaleId,
  type StudioSet,
} from './studioSets';
import { DEFAULT_OCTAVE, KEYBOARD_SIZES, clampOctave, type KeyboardSize } from './keyboardLayout';
import { KEYS_PATCHES, SYNTH_PATCHES, type KeysPatch, type SynthPatch } from './instruments';
import { DRUM_VOICES, type DrumVoice } from './noteEvents';

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
  scenes: MusicScene[];
  /** Which instrument set the Studio view shows. */
  set: StudioSet;
  /** Every Studio knob, "module.param" -> 0-1. */
  params: Record<string, number>;
  key: MusicKey;
  /** Letter keys and MIDI snap to the key for the drone and bowls. */
  scaleLock: boolean;
  acidSteps: AcidStep[];
  drumMutes: DrumVoice[];
  cables: Record<StudioSet, Cable[]>;
  /** Sound effects on each macro knob, by macro id. */
  macroFx: Record<string, MacroFxInstance[]>;
  /** The session grid: a track of clip slots per part. */
  session: Session;
  /** Bars the loop recorder takes (0 = until stopped), and how it snaps notes. */
  recordLength: RecordLength;
  quantize: QuantizeId;
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
  /** The full-screen Studio view is showing (it opens the studio too). */
  studioView: boolean;
  /** Scene playing, and the one waiting for the next bar. */
  sceneId: string | null;
  queuedSceneId: string | null;
  /** Loop playing in each slot, and loops waiting for the next bar. */
  playingLoops: Partial<Record<LoopRole, string>>;
  queuedLoops: Partial<Record<LoopRole, string | null>>;
  /** The scan synth is reading the picture. */
  scanOn: boolean;
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
  return perInstrument((id) => ({ ...visuals[id] }));
}

function perInstrument<T>(make: (id: InstrumentId) => T): Record<InstrumentId, T> {
  return Object.fromEntries(INSTRUMENTS.map((id) => [id, make(id)])) as Record<InstrumentId, T>;
}

const DEFAULT_VOLUMES: Record<InstrumentId, number> = { synth: 0.8, keys: 0.8, drums: 0.9, drone: 0.75, bowls: 0.8, acid: 0.75, xy: 0.7, dubbass: 0.85, siren: 0.6, shots: 0.7, analog: 0.75, scan: 0.6 };

export function defaultProjectState(): MusicStudioProjectState {
  return {
    instrument: 'synth',
    synthPatch: 'pad',
    keysPatch: 'epiano',
    volumes: { ...DEFAULT_VOLUMES },
    masterVolume: 0.85,
    visuals: cloneVisuals(DEFAULT_VISUAL_SETTINGS),
    octave: DEFAULT_OCTAVE,
    velocity: 0.8,
    pattern: starterPattern(),
    takes: [],
    scenes: [],
    set: 'bath',
    params: defaultParams(),
    key: { root: 2, scale: 'dorian' },
    scaleLock: true,
    acidSteps: defaultAcidSteps(),
    drumMutes: [],
    cables: defaultCables(),
    macroFx: {},
    session: defaultSession({ root: 2, scale: 'dorian' }, generateUUID),
    recordLength: 2,
    quantize: '1/16',
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
  const scenes: MusicScene[] = [];
  for (const raw of Array.isArray(input.scenes) ? input.scenes : []) {
    const scene = normalizeScene(raw);
    if (scene && !scenes.some((x) => x.id === scene.id)) scenes.push(scene);
  }
  return {
    instrument: INSTRUMENTS.includes(input.instrument as InstrumentId) ? (input.instrument as InstrumentId) : d.instrument,
    synthPatch: SYNTH_PATCHES.some((p) => p.id === input.synthPatch) ? (input.synthPatch as SynthPatch) : d.synthPatch,
    keysPatch: KEYS_PATCHES.some((p) => p.id === input.keysPatch) ? (input.keysPatch as KeysPatch) : d.keysPatch,
    volumes: perInstrument((id) => clamp01(volumes[id], d.volumes[id])),
    masterVolume: clamp01(input.masterVolume, d.masterVolume),
    visuals: perInstrument((id) => normalizeVisual(visuals[id], d.visuals[id])),
    octave: clampOctave(Number.isFinite(Number(input.octave)) ? Number(input.octave) : d.octave),
    velocity: Math.max(0.05, clamp01(input.velocity, d.velocity)),
    pattern: input.pattern ? normalizePattern(input.pattern) : d.pattern,
    takes,
    scenes,
    set: STUDIO_SETS.some((k) => k.id === input.set) ? (input.set as StudioSet) : d.set,
    params: input.params ? normalizeParams(input.params) : d.params,
    key: normalizeKey(input.key, d.key),
    scaleLock: input.scaleLock === undefined ? d.scaleLock : input.scaleLock === true,
    acidSteps: normalizeAcidSteps(input.acidSteps),
    drumMutes: Array.isArray(input.drumMutes) ? DRUM_VOICES.filter((v) => (input.drumMutes as unknown[]).includes(v)) : [],
    cables: input.cables ? normalizeCables(input.cables) : d.cables,
    macroFx: normalizeMacroFx(input.macroFx),
    session: normalizeSession((input as { session?: unknown }).session) ?? legacySession(input as Record<string, unknown>, normalizeKey(input.key, d.key)),
    recordLength: (RECORD_LENGTHS as readonly number[]).includes(Number(input.recordLength)) ? (Number(input.recordLength) as RecordLength) : d.recordLength,
    quantize: QUANTIZE_GRIDS.some((g) => g.id === input.quantize) ? (input.quantize as QuantizeId) : d.quantize,
  };
}

/** A project from before the session: a starter session with its recorded loops and kept beats added. */
function legacySession(input: Record<string, unknown>, key: MusicKey): Session {
  let session = defaultSession(key, generateUUID);
  const add = (track: TrackId, clip: SessionClip) => {
    session = withClip(session, track, firstEmptySlot(session, track), clip);
  };
  for (const raw of Array.isArray(input.myLoops) ? input.myLoops : []) {
    const loop = normalizeRecordedLoop(raw);
    if (loop) add(loop.role, clipFromRecording(loop));
  }
  for (const raw of Array.isArray(input.myBeats) ? input.myBeats : []) {
    const beat = normalizeRecordedBeat(raw);
    if (beat) add('beats', { kind: 'beat', id: beat.id, name: beat.name, pattern: beat.pattern });
  }
  return session;
}

function normalizeKey(raw: unknown, fallback: MusicKey): MusicKey {
  const k = (raw && typeof raw === 'object' ? raw : {}) as Partial<MusicKey>;
  const root = Number(k.root);
  return {
    root: Number.isInteger(root) && root >= 0 && root < 12 ? root : fallback.root,
    scale: k.scale && k.scale in SCALES ? (k.scale as ScaleId) : fallback.scale,
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
    studioView: false,
    sceneId: null,
    queuedSceneId: null,
    playingLoops: {},
    queuedLoops: {},
    scanOn: false,
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
    close: () => set({ isOpen: false, studioView: false }),
    toggleOpen: () => update((s) => ({ ...s, isOpen: !s.isOpen, studioView: false })),
    /** Show the full-screen Studio view, or go back to the tray. The studio stays open either way. */
    setStudioView: (studioView: boolean) => set({ studioView, isOpen: true }),
    // The keys switch to the set's own voice: the dub bass in the dub set, the synth in the analog set.
    setSet: (studioSet: StudioSet) =>
      update((s) => ({ ...s, set: studioSet, instrument: SET_KEYS_VOICE[studioSet] ?? s.instrument })),
    setParam: (key: string, value: number) =>
      update((s) => (key in s.params ? { ...s, params: { ...s.params, [key]: Math.max(0, Math.min(1, value)) } } : s)),
    setKey: (key: MusicKey) => set({ key }),
    setScaleLock: (scaleLock: boolean) => set({ scaleLock }),
    setAcidStep: (index: number, patch: Partial<AcidStep>) =>
      update((s) => ({ ...s, acidSteps: s.acidSteps.map((st, i) => (i === index ? { ...st, ...patch } : st)) })),
    toggleDrumMute: (voice: DrumVoice) =>
      update((s) => ({ ...s, drumMutes: s.drumMutes.includes(voice) ? s.drumMutes.filter((v) => v !== voice) : [...s.drumMutes, voice] })),
    connectCable: (cable: Cable) =>
      update((s) => ({ ...s, cables: { ...s.cables, [s.set]: connect(s.cables[s.set], cable) } })),
    addMacroFx: (macroId: string, id: string, type: MacroFxType) =>
      update((s) => ({ ...s, macroFx: { ...s.macroFx, [macroId]: [...(s.macroFx[macroId] ?? []), createMacroFx(id, type)] } })),
    removeMacroFx: (macroId: string, id: string) =>
      update((s) => ({ ...s, macroFx: { ...s.macroFx, [macroId]: (s.macroFx[macroId] ?? []).filter((fx) => fx.id !== id) } })),
    toggleMacroFx: (macroId: string, id: string) =>
      update((s) => ({ ...s, macroFx: { ...s.macroFx, [macroId]: (s.macroFx[macroId] ?? []).map((fx) => (fx.id === id ? { ...fx, enabled: !fx.enabled } : fx)) } })),
    setMacroFxParam: (macroId: string, id: string, key: string, patch: Partial<MacroFxParam>) =>
      update((s) => ({
        ...s,
        macroFx: {
          ...s.macroFx,
          [macroId]: (s.macroFx[macroId] ?? []).map((fx) => {
            if (fx.id !== id || !fx.params[key]) return fx;
            const next = { ...fx.params[key], ...patch };
            next.value = Math.max(0, Math.min(1, next.value));
            next.depth = Math.max(-1, Math.min(1, next.depth));
            return { ...fx, params: { ...fx.params, [key]: next } };
          }),
        },
      })),
    /** Replace a set's cables (a jam setup). */
    setCables: (studioSet: StudioSet, cables: Cable[]) =>
      update((s) => ({ ...s, cables: { ...s.cables, [studioSet]: cables.reduce(connect, [] as Cable[]) } })),
    disconnectCable: (id: string) =>
      update((s) => ({ ...s, cables: { ...s.cables, [s.set]: disconnect(s.cables[s.set], id) } })),

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

    setTransport: (patch: Partial<Pick<MusicStudioState, 'sequencerPlaying' | 'recording' | 'recordingSince' | 'playingTakeId' | 'loopTake' | 'sceneId' | 'queuedSceneId' | 'playingLoops' | 'queuedLoops' | 'scanOn'>>) =>
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

    /** Put a clip in a slot (null empties it). */
    setSessionClip: (track: TrackId, row: number, clip: SessionClip | null) =>
      update((s) => ({ ...s, session: withClip(s.session, track, row, clip) })),
    /** Put a clip in a track's first empty slot; returns the row. */
    addSessionClip: (track: TrackId, clip: SessionClip): number => {
      const row = firstEmptySlot(get(store).session, track);
      update((s) => ({ ...s, session: withClip(s.session, track, row, clip) }));
      return row;
    },
    updateSessionClip: (id: string, patch: (clip: SessionClip) => SessionClip) =>
      update((s) => ({ ...s, session: updateClip(s.session, id, patch) })),
    addSessionRow: () =>
      update((s) => {
        const rows = sessionRows(s.session);
        return rows >= MAX_SESSION_ROWS ? s : { ...s, session: withClip(s.session, 'beats', rows, null) };
      }),
    setRecordLength: (recordLength: RecordLength) => set({ recordLength }),
    setQuantize: (quantize: QuantizeId) => set({ quantize }),

    addScene: (scene: MusicScene) => update((s) => ({ ...s, scenes: [...s.scenes, scene] })),
    updateScene: (id: string, patch: Partial<Omit<MusicScene, 'id'>>) =>
      update((s) => ({ ...s, scenes: s.scenes.map((sc) => (sc.id === id ? { ...sc, ...patch } : sc)) })),
    removeScene: (id: string) =>
      update((s) => ({
        ...s,
        scenes: s.scenes.filter((sc) => sc.id !== id),
        sceneId: s.sceneId === id ? null : s.sceneId,
        queuedSceneId: s.queuedSceneId === id ? null : s.queuedSceneId,
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
        scenes: s.scenes.map((sc) => ({ ...sc, pattern: sc.pattern ? normalizePattern(sc.pattern) : null })),
        set: s.set,
        params: { ...s.params },
        key: { ...s.key },
        scaleLock: s.scaleLock,
        acidSteps: s.acidSteps.map((st) => ({ ...st })),
        drumMutes: [...s.drumMutes],
        cables: Object.fromEntries(Object.entries(s.cables).map(([set, list]) => [set, list.map((c) => ({ ...c }))])) as Record<StudioSet, Cable[]>,
        macroFx: JSON.parse(JSON.stringify(s.macroFx)),
        session: JSON.parse(JSON.stringify(s.session)),
        recordLength: s.recordLength,
        quantize: s.quantize,
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
        sceneId: null,
        queuedSceneId: null,
        playingLoops: {},
        queuedLoops: {},
        scanOn: false,
      }));
    },
  };
}

/** What the keys play when a set comes up, for sets built around their own voice. */
const SET_KEYS_VOICE: Partial<Record<StudioSet, InstrumentId>> = { dub: 'dubbass', analog: 'analog' };

export const musicStudio = createMusicStudioStore();

/** What the runtime publishes for the UI: the playhead and held notes. */
export interface MusicTransportState {
  step: number;
  /** 0-1 through the playing take. */
  takeProgress: number;
  /** `${instrument}:${note}` of every sounding note. */
  held: Set<string>;
  /** Scale degrees of the chords the drone is holding. */
  chords: number[];
  /** The beat loop last loaded into the grid, and one waiting for the next bar. */
  beatLoop: string | null;
  queuedBeat: string | null;
  /** The loop recorder: counting in to its first bar, or recording until `endBeat` (null: until stopped). */
  loopRec: { phase: 'off' | 'count' | 'rec'; startBeat: number; endBeat: number | null; beat: number };
}

export const LOOP_REC_OFF: MusicTransportState['loopRec'] = { phase: 'off', startBeat: 0, endBeat: null, beat: 0 };

export const musicTransport = writable<MusicTransportState>({
  step: -1,
  takeProgress: 0,
  held: new Set(),
  chords: [],
  beatLoop: null,
  queuedBeat: null,
  loopRec: LOOP_REC_OFF,
});
