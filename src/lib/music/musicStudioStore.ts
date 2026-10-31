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
import {
  INPUT_CHANNELS,
  MAX_LIVE_INPUTS,
  isInputChannel,
  defaultLiveInput,
  defaultStrip,
  normalizeLiveInput,
  normalizeLiveInputs,
  normalizeMixer,
  type ChannelId,
  type ChannelStrip,
  type LiveInputSettings,
  type MixerState,
} from './mixer';
import { normalizeLiveRoles, type LiveRoles } from './liveControl';
import {
  BOWL_COUNT,
  FX_PAD_COUNT,
  defaultBandFx,
  defaultBowlSlots,
  defaultFxPads,
  DEFAULT_DRONE_PATCH,
  normalizeBandFx,
  normalizeBowlSlots,
  normalizeDronePatch,
  normalizeFxPads,
  type BandFxSettings,
  type BowlSlot,
  type FxPads,
} from './soundSlots';
import type { VoiceSourceId } from './visualVoices';
import { unchoppedFxPads } from './sounds/chops';
import {
  MAX_SETLISTS,
  MAX_SONGS,
  SONG_SETUP_KEYS,
  normalizeSetlists,
  normalizeSongs,
  type Setlist,
  type Song,
  type SongSetup,
} from './songs';

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
  /** EQ, pan, mute and solo per channel. */
  mixer: MixerState;
  /** The band inputs, one to four (each one's device is kept per computer). */
  liveInputs: LiveInputSettings[];
  /** Ableton Live is in control: the studio's instruments are off and the session grid fires Live. */
  liveControl: boolean;
  /** Live track name -> the sound it feeds the visual voices as. */
  liveRoles: LiveRoles;
  /** The sound and octave of each of the five bowls. */
  bowlSlots: BowlSlot[];
  /** The sound on each of a set's eight FX pads. */
  fxPads: FxPads;
  /** The drone's sound (sounds/padPatches.ts). */
  dronePatch: string;
  /** The band's echo, reverb and freeze, and how the studio sits with the band. */
  bandFx: BandFxSettings;
  /** Setups kept per song. */
  songs: Song[];
  /** The songs in playing order, one list per show. */
  setlists: Setlist[];
  /** The set list being played. */
  activeSetlistId: string | null;
  /** The song called up last, and where in the set list that was (-1: not from the list). */
  currentSongId: string | null;
  setlistCursor: number;
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
  /** Audio input id of each band input, '' for the default. Machine wiring, kept per computer. */
  inputDevices: string[];
  /** The live input is listening, and why it could not if it failed. */
  inputOn: boolean;
  inputError: string | null;
}

/** The saved section of a project file. */
export interface MusicStudioProjectSection extends MusicStudioProjectState {
  schemaVersion: number;
}

const MIDI_INPUT_KEY = 'ghostarcade-music-midi-input';
const KEYBOARD_SIZE_KEY = 'ghostarcade-music-keyboard-size';
const INPUT_DEVICE_KEY = 'ghostarcade-music-input-device';
const INPUT_DEVICES_KEY = 'ghostarcade-music-input-devices';

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

/** Each band input's device. The single input's choice from before carries over as the first. */
function loadInputDevices(): string[] {
  try {
    const saved = JSON.parse(loadPref(INPUT_DEVICES_KEY) || 'null');
    if (Array.isArray(saved)) return saved.slice(0, MAX_LIVE_INPUTS).map((id) => (typeof id === 'string' ? id : ''));
  } catch { /* unreadable: start over */ }
  const first = loadPref(INPUT_DEVICE_KEY);
  return first ? [first] : [];
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
    mixer: {},
    liveInputs: [defaultLiveInput()],
    liveControl: false,
    liveRoles: {},
    bowlSlots: defaultBowlSlots(),
    fxPads: defaultFxPads(),
    dronePatch: DEFAULT_DRONE_PATCH,
    bandFx: defaultBandFx(),
    songs: [],
    setlists: [],
    activeSetlistId: null,
    currentSongId: null,
    setlistCursor: -1,
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
    mixer: normalizeMixer(input.mixer),
    liveInputs: normalizeLiveInputs(input.liveInputs, (input as { liveInput?: unknown }).liveInput),
    liveControl: input.liveControl === true,
    liveRoles: normalizeLiveRoles(input.liveRoles),
    bowlSlots: normalizeBowlSlots(input.bowlSlots),
    // Chops are this session's audio; a file saved with one on a pad gets the set's default there.
    fxPads: unchoppedFxPads(normalizeFxPads(input.fxPads), false),
    dronePatch: normalizeDronePatch(input.dronePatch),
    bandFx: normalizeBandFx(input.bandFx),
    ...normalizeSongState(input),
  };
}

/** A song's setup, read the way the studio reads its own state. */
export function normalizeSongSetup(raw: unknown): SongSetup {
  return pickSetup(normalizeProjectState(raw && typeof raw === 'object' ? { ...(raw as object), songs: [], setlists: [] } : null));
}

function pickSetup(state: MusicStudioProjectState): SongSetup {
  return Object.fromEntries(SONG_SETUP_KEYS.map((key) => [key, state[key]])) as SongSetup;
}

function normalizeSongState(input: Partial<MusicStudioProjectSection>): Pick<MusicStudioProjectState, 'songs' | 'setlists' | 'activeSetlistId' | 'currentSongId' | 'setlistCursor'> {
  const songs = normalizeSongs(input.songs, normalizeSongSetup);
  const setlists = normalizeSetlists(input.setlists, new Set(songs.map((s) => s.id)));
  const activeSetlistId = setlists.some((l) => l.id === input.activeSetlistId) ? (input.activeSetlistId as string) : (setlists[0]?.id ?? null);
  const currentSongId = songs.some((s) => s.id === input.currentSongId) ? (input.currentSongId as string) : null;
  const active = setlists.find((l) => l.id === activeSetlistId);
  const cursor = Math.round(Number(input.setlistCursor));
  const setlistCursor = active && Number.isInteger(cursor) && cursor >= 0 && cursor < active.songIds.length ? cursor : -1;
  return { songs, setlists, activeSetlistId, currentSongId, setlistCursor };
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
    inputDevices: loadInputDevices(),
    inputOn: false,
    inputError: null,
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
    setStrip: (id: ChannelId, patch: Partial<ChannelStrip>) =>
      update((s) => ({ ...s, mixer: { ...s.mixer, [id]: { ...(s.mixer[id] ?? defaultStrip()), ...patch } } })),
    resetStrip: (id: ChannelId) =>
      update((s) => {
        const mixer = { ...s.mixer };
        delete mixer[id];
        return { ...s, mixer };
      }),
    /** Change one band input's settings. */
    setLiveInput: (index: number, patch: Partial<LiveInputSettings>) =>
      update((s) => (index < 0 || index >= s.liveInputs.length ? s : { ...s, liveInputs: s.liveInputs.map((input, i) => (i === index ? normalizeLiveInput({ ...input, ...patch }) : input)) })),
    /** Add a band input (up to four); returns its index, or -1 when there are four already. */
    addLiveInput: (settings: Partial<LiveInputSettings> = {}): number => {
      const count = get(store).liveInputs.length;
      if (count >= MAX_LIVE_INPUTS) return -1;
      update((s) => ({ ...s, liveInputs: [...s.liveInputs, normalizeLiveInput({ ...defaultLiveInput(), ...settings })] }));
      return count;
    },
    /** Remove a band input (one always stays). Later inputs move up, their mixer strips and devices with them. */
    removeLiveInput: (index: number) =>
      update((s) => {
        if (s.liveInputs.length <= 1 || index < 0 || index >= s.liveInputs.length) return s;
        const mixer = { ...s.mixer };
        for (let i = index; i < INPUT_CHANNELS.length; i++) {
          const next = s.mixer[INPUT_CHANNELS[i + 1] as ChannelId];
          if (next) mixer[INPUT_CHANNELS[i]] = next;
          else delete mixer[INPUT_CHANNELS[i]];
        }
        const inputDevices = s.inputDevices.filter((_, i) => i !== index);
        savePref(INPUT_DEVICES_KEY, JSON.stringify(inputDevices));
        return { ...s, liveInputs: s.liveInputs.filter((_, i) => i !== index), mixer, inputDevices };
      }),
    /** The audio device a band input listens to ('' for the default). Kept per computer. */
    setInputDevice: (index: number, device: string) =>
      update((s) => {
        if (index < 0 || index >= MAX_LIVE_INPUTS) return s;
        const inputDevices = [...s.inputDevices];
        while (inputDevices.length <= index) inputDevices.push('');
        inputDevices[index] = device;
        savePref(INPUT_DEVICES_KEY, JSON.stringify(inputDevices));
        return { ...s, inputDevices };
      }),
    setInputStatus: (inputOn: boolean, inputError: string | null = null) => set({ inputOn, inputError }),
    setLiveControl: (liveControl: boolean) => set({ liveControl }),
    /** Put a sound on one bowl (and move it up or down octaves). */
    setBowlSlot: (index: number, patch: Partial<BowlSlot>) =>
      update((s) => {
        if (index < 0 || index >= BOWL_COUNT) return s;
        const bowlSlots = normalizeBowlSlots(s.bowlSlots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
        return { ...s, bowlSlots };
      }),
    /** All five bowls at once (a bowl set). */
    setBowlSlots: (slots: BowlSlot[]) => update((s) => ({ ...s, bowlSlots: normalizeBowlSlots(slots) })),
    /** Put a sound on one of the current set's FX pads. */
    setFxPad: (index: number, sound: string) =>
      update((s) => {
        if (index < 0 || index >= FX_PAD_COUNT) return s;
        const pads = s.fxPads[s.set].map((id, i) => (i === index ? sound : id));
        return { ...s, fxPads: normalizeFxPads({ ...s.fxPads, [s.set]: pads }) };
      }),
    setDronePatch: (dronePatch: string) => set({ dronePatch: normalizeDronePatch(dronePatch) }),
    setBandFx: (patch: Partial<BandFxSettings>) => update((s) => ({ ...s, bandFx: normalizeBandFx({ ...s.bandFx, ...patch }) })),

    // ── Songs and set lists ──
    /** Keep a song (its setup captured by the caller). False when there are too many. */
    addSong: (song: Song): boolean => {
      if (get(store).songs.length >= MAX_SONGS) return false;
      update((s) => (s.songs.some((x) => x.id === song.id) ? s : { ...s, songs: [...s.songs, song] }));
      return true;
    },
    updateSong: (id: string, patch: Partial<Omit<Song, 'id'>>) =>
      update((s) => ({ ...s, songs: s.songs.map((song) => (song.id === id ? { ...song, ...patch, name: (patch.name ?? song.name).trim() || song.name } : song)) })),
    /** Forget a song, and take it out of every set list. */
    removeSong: (id: string) =>
      update((s) => {
        const setlists = s.setlists.map((l) => ({ ...l, songIds: l.songIds.filter((x) => x !== id) }));
        const currentSongId = s.currentSongId === id ? null : s.currentSongId;
        return { ...s, songs: s.songs.filter((song) => song.id !== id), setlists, currentSongId, setlistCursor: keptCursor(setlists, s.activeSetlistId, s.setlistCursor, currentSongId) };
      }),
    /** Start a set list; it becomes the one being played. False when there are too many. */
    addSetlist: (setlist: Setlist): boolean => {
      if (get(store).setlists.length >= MAX_SETLISTS) return false;
      update((s) => (s.setlists.some((l) => l.id === setlist.id) ? s : { ...s, setlists: [...s.setlists, setlist], activeSetlistId: setlist.id, setlistCursor: -1 }));
      return true;
    },
    renameSetlist: (id: string, name: string) =>
      update((s) => ({ ...s, setlists: s.setlists.map((l) => (l.id === id ? { ...l, name: name.trim() || l.name } : l)) })),
    removeSetlist: (id: string) =>
      update((s) => {
        const setlists = s.setlists.filter((l) => l.id !== id);
        const leaving = s.activeSetlistId === id;
        return { ...s, setlists, activeSetlistId: leaving ? (setlists[0]?.id ?? null) : s.activeSetlistId, setlistCursor: leaving ? -1 : s.setlistCursor };
      }),
    /** Put a set list's songs in a new order (or add and take out songs). */
    setSetlistSongs: (id: string, songIds: string[]) =>
      update((s) => {
        const known = new Set(s.songs.map((song) => song.id));
        const setlists = s.setlists.map((l) => (l.id === id ? { ...l, songIds: songIds.filter((x) => known.has(x)) } : l));
        return { ...s, setlists, setlistCursor: keptCursor(setlists, s.activeSetlistId, s.setlistCursor, s.currentSongId) };
      }),
    setActiveSetlist: (id: string | null) =>
      update((s) => (id === s.activeSetlistId || (id !== null && !s.setlists.some((l) => l.id === id)) ? s : { ...s, activeSetlistId: id, setlistCursor: -1 })),
    /** The song now up, and where in the set list it was called from (-1: not from the list). */
    setCurrentSong: (currentSongId: string | null, setlistCursor = -1) => set({ currentSongId, setlistCursor }),
    /**
     * Put a song's setup back. A band input keeps its name and channel (the
     * wiring of tonight's stage) and takes the song's role, levels and sends;
     * inputs the song does not know stay as they are.
     */
    applySetup: (setup: Partial<SongSetup>, parts: { sound: boolean; band: boolean } = { sound: true, band: true }) =>
      update((s) => {
        const next: MusicStudioState = { ...s, ...setup };
        if (setup.mixer) {
          // Instrument strips come with the sound, band input strips with the band.
          const recalled = (id: string) => (isInputChannel(id) ? parts.band : parts.sound);
          const mixer: MixerState = {};
          for (const [id, strip] of Object.entries(s.mixer)) if (!recalled(id)) mixer[id as ChannelId] = strip;
          for (const [id, strip] of Object.entries(setup.mixer)) if (recalled(id)) mixer[id as ChannelId] = strip;
          next.mixer = mixer;
        }
        if (setup.liveInputs) {
          const saved = setup.liveInputs;
          next.liveInputs = s.liveInputs.map((current, i) => (saved[i] ? normalizeLiveInput({ ...saved[i], name: current.name, channel: current.channel }) : current));
        }
        return next;
      }),
    setLiveRole: (track: string, role: VoiceSourceId | null) =>
      update((s) => {
        const liveRoles = { ...s.liveRoles };
        if (role) liveRoles[track] = role;
        else delete liveRoles[track];
        return { ...s, liveRoles };
      }),

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
        mixer: JSON.parse(JSON.stringify(s.mixer)),
        liveInputs: s.liveInputs.map((input) => ({ ...input })),
        liveControl: s.liveControl,
        liveRoles: { ...s.liveRoles },
        bowlSlots: s.bowlSlots.map((slot) => ({ ...slot })),
        // What the pads held before any chops went on them (chops are not saved).
        fxPads: unchoppedFxPads(s.fxPads),
        dronePatch: s.dronePatch,
        bandFx: { ...s.bandFx },
        songs: JSON.parse(JSON.stringify(s.songs)),
        setlists: s.setlists.map((l) => ({ ...l, songIds: [...l.songIds] })),
        activeSetlistId: s.activeSetlistId,
        currentSongId: s.currentSongId,
        setlistCursor: s.setlistCursor,
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

/**
 * Where in the set list the song now up still is after the list changed:
 * the same place if that place still holds it, else none (-1), so next and
 * previous then find the song by its id.
 */
function keptCursor(setlists: Setlist[], activeId: string | null, cursor: number, currentSongId: string | null): number {
  const active = setlists.find((l) => l.id === activeId);
  return active && cursor >= 0 && currentSongId !== null && active.songIds[cursor] === currentSongId ? cursor : -1;
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
