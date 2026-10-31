/**
 * Which sound each bowl and each FX pad plays, the drone's patch, and the
 * band effects: what the performer chooses, saved with the project.
 *
 * Sounds are named by their library id (sounds/library.ts). An id the
 * library does not know (a project from a later version) is kept as it is
 * and plays a fallback, so opening and saving never loses a choice.
 */

import type { StudioSet } from './studioSets';

export const BOWL_COUNT = 5;
export const FX_PAD_COUNT = 8;

export interface BowlSlot {
  /** Library id of the sound this bowl plays. */
  sound: string;
  /** Octaves above (+) or below (-) the bowl's note in the key, -2 to +2. */
  octave: number;
}

/** A ready-made set of five bowls, one tap away. */
export interface BowlKit {
  id: string;
  name: string;
  slots: BowlSlot[];
}

const kit = (id: string, name: string, sounds: string[], octaves: number[] = [0, 0, 0, 0, 0]): BowlKit => ({
  id,
  name,
  slots: sounds.map((sound, i) => ({ sound, octave: octaves[i] ?? 0 })),
});

export const BOWL_KITS: BowlKit[] = [
  kit('singing', 'Singing bowls', ['singing-bowl', 'singing-bowl', 'singing-bowl', 'singing-bowl', 'singing-bowl']),
  kit('crystal', 'Crystal bowls', ['crystal-bowl', 'crystal-bowl', 'crystal-bowl', 'crystal-bowl', 'crystal-bowl']),
  kit('temple', 'Temple', ['gong', 'temple-bell', 'singing-bowl', 'temple-bell', 'wind-chimes'], [-1, -1, 0, 0, 1]),
  kit('garden', 'Garden', ['handpan', 'kalimba', 'tongue-drum', 'kalimba', 'music-box'], [0, 0, 0, 1, 1]),
  kit('glass', 'Glass', ['glass', 'crystal-bowl', 'glass', 'music-box', 'wind-chimes'], [0, 0, 1, 1, 1]),
  kit('mallets', 'Mallets', ['marimba', 'marimba', 'tubular-bell', 'marimba', 'tubular-bell'], [-1, 0, 0, 1, 1]),
];

export function defaultBowlSlots(): BowlSlot[] {
  return BOWL_KITS[0].slots.map((slot) => ({ ...slot }));
}

/** What each set's eight FX pads hold in a new project. */
export const DEFAULT_FX_PADS: Record<StudioSet, string[]> = {
  bath: ['rain', 'ocean', 'wind', 'night', 'choir-breath', 'wind-chimes', 'reverse-swell', 'gong-crash'],
  berlin: ['noise-riser', 'snare-build', 'downlifter', 'impact', 'sub-drop', 'sweep-down', 'laser', 'glass-smash'],
  dub: ['laser', 'zap', 'riser', 'boing', 'crackle', 'boom', 'alarm', 'echo-clap'],
  analog: ['pitch-riser', 'long-riser', 'braam', 'sub-drop', 'impact', 'zap', 'radio', 'sweep-down'],
};

/** The eight dub shots every set's pads played before pads could be chosen. */
const LEGACY_PADS = DEFAULT_FX_PADS.dub;

export type FxPads = Record<StudioSet, string[]>;

export function defaultFxPads(): FxPads {
  return {
    bath: [...DEFAULT_FX_PADS.bath],
    berlin: [...DEFAULT_FX_PADS.berlin],
    dub: [...DEFAULT_FX_PADS.dub],
    analog: [...DEFAULT_FX_PADS.analog],
  };
}

export const DEFAULT_DRONE_PATCH = 'warm';

/** How far the band's echo is behind it, in beats. */
export const ECHO_TIMES = [
  { id: '1/8', label: '1/8', beats: 0.5 },
  { id: '3/16', label: 'Dotted 1/8', beats: 0.75 },
  { id: '1/4', label: '1/4', beats: 1 },
  { id: '3/8', label: 'Dotted 1/4', beats: 1.5 },
  { id: '1/2', label: '1/2', beats: 2 },
] as const;
export type EchoTimeId = (typeof ECHO_TIMES)[number]['id'];

/**
 * The band effects: the live input sent into an echo and a reverb of its
 * own, returned wet (the band's dry sound stays on the band's desk), and a
 * freeze that holds a moment of the band as a pad.
 */
export interface BandFxSettings {
  /** Steady echo send, 0-1 (a throw opens it fully while held). */
  echoSend: number;
  /** Steady reverb send, 0-1 (a wash opens it fully while held). */
  verbSend: number;
  echoTime: EchoTimeId;
  /** Echo repeats, 0-1 (near 1 the echo keeps going on its own). */
  feedback: number;
  /** Tone of the repeats, 0 dark to 1 bright. */
  echoTone: number;
  /** Level of the frozen sound, 0-1. */
  freezeLevel: number;
  /** The frozen sound an octave down (-12), as played (0) or an octave up (12). */
  freezePitch: -12 | 0 | 12;
  /** Level the band effects come back at, 0-1. */
  returnLevel: number;
  /** How far the drone, pads and bowls dip under the band's kick, 0 (off) to 1. */
  duckDepth: number;
  /** How quickly they come back after the kick, in seconds. */
  duckRelease: number;
  /** The drone plays the band's bass note (from the input playing the bass). */
  followBass: boolean;
}

export const DUCK_RELEASE_MIN = 0.05;
export const DUCK_RELEASE_MAX = 1.2;

export function defaultBandFx(): BandFxSettings {
  return {
    echoSend: 0,
    verbSend: 0,
    echoTime: '3/16',
    feedback: 0.55,
    echoTone: 0.45,
    freezeLevel: 0.7,
    freezePitch: 0,
    returnLevel: 0.8,
    duckDepth: 0,
    duckRelease: 0.25,
    followBass: false,
  };
}

// ── Normalising saved data ──────────────────────────────────────────────

const SOUND_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

function soundId(value: unknown, fallback: string): string {
  return typeof value === 'string' && SOUND_ID.test(value) ? value : fallback;
}

function clamp01(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

export function normalizeBowlSlots(raw: unknown): BowlSlot[] {
  const fallback = defaultBowlSlots();
  const list = Array.isArray(raw) ? raw : [];
  return fallback.map((d, i) => {
    const slot = (list[i] && typeof list[i] === 'object' ? list[i] : {}) as Partial<BowlSlot>;
    const octave = Math.round(Number(slot.octave));
    return { sound: soundId(slot.sound, d.sound), octave: Number.isFinite(octave) ? Math.max(-2, Math.min(2, octave)) : 0 };
  });
}

/**
 * A project saved before pads could be chosen has none: every set keeps the
 * eight shots it played then, so it sounds as it did.
 */
export function normalizeFxPads(raw: unknown): FxPads {
  if (!raw || typeof raw !== 'object') {
    return { bath: [...LEGACY_PADS], berlin: [...LEGACY_PADS], dub: [...LEGACY_PADS], analog: [...LEGACY_PADS] };
  }
  const input = raw as Partial<Record<StudioSet, unknown>>;
  const set = (id: StudioSet) => {
    const list = Array.isArray(input[id]) ? (input[id] as unknown[]) : [];
    return DEFAULT_FX_PADS[id].map((d, i) => soundId(list[i], d));
  };
  return { bath: set('bath'), berlin: set('berlin'), dub: set('dub'), analog: set('analog') };
}

export function normalizeDronePatch(raw: unknown): string {
  return soundId(raw, DEFAULT_DRONE_PATCH);
}

export function normalizeBandFx(raw: unknown): BandFxSettings {
  const d = defaultBandFx();
  const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<BandFxSettings>;
  return {
    echoSend: clamp01(input.echoSend, d.echoSend),
    verbSend: clamp01(input.verbSend, d.verbSend),
    echoTime: ECHO_TIMES.some((t) => t.id === input.echoTime) ? (input.echoTime as EchoTimeId) : d.echoTime,
    feedback: Math.min(0.92, clamp01(input.feedback, d.feedback)),
    echoTone: clamp01(input.echoTone, d.echoTone),
    freezeLevel: clamp01(input.freezeLevel, d.freezeLevel),
    freezePitch: input.freezePitch === -12 || input.freezePitch === 12 ? input.freezePitch : 0,
    returnLevel: clamp01(input.returnLevel, d.returnLevel),
    duckDepth: clamp01(input.duckDepth, d.duckDepth),
    duckRelease: Math.max(DUCK_RELEASE_MIN, Math.min(DUCK_RELEASE_MAX, Number.isFinite(Number(input.duckRelease)) ? Number(input.duckRelease) : d.duckRelease)),
    followBass: input.followBass === true,
  };
}

/** The note each bowl sounds: its note in the key, moved by its octave. */
export function bowlSlotNotes(keyNotes: number[], slots: BowlSlot[]): number[] {
  return keyNotes.map((note, i) => Math.max(12, Math.min(108, note + (slots[i]?.octave ?? 0) * 12)));
}
