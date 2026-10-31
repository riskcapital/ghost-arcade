/**
 * Songs and set lists.
 *
 * A song is a whole setup kept under a name: the studio's sounds, key and
 * beat, the band inputs and their effects, and the visuals (the looks on
 * each instrument feed, the VJ block and column, the stage preset). A set
 * list is the songs in the order they are played tonight; a song can appear
 * in it more than once. Calling up a song puts its setup back at once (or on
 * the next bar).
 *
 * A song keeps all of its setup; `recall` says which parts calling it up
 * puts back, so a song can change only the visuals and leave the sound.
 *
 * This module is plain data. The store keeps the songs with the project;
 * calling one up (the tempo, the visuals, the VJ deck) is done by the runtime.
 */

import type { MusicStudioProjectState } from './musicStudioStore';
import { normalizeStudioVoice, MAX_STUDIO_VOICES, type StudioVoice } from './studioPlugin';

/** The parts of the studio a song keeps, by what calling it up puts back. */
export const SONG_SETUP_GROUPS = {
  sound: [
    'set',
    'key',
    'scaleLock',
    'instrument',
    'synthPatch',
    'keysPatch',
    'volumes',
    'params',
    'mixer',
    'cables',
    'macroFx',
    'pattern',
    'acidSteps',
    'drumMutes',
    'bowlSlots',
    'fxPads',
    'dronePatch',
  ],
  band: ['liveInputs', 'bandFx'],
  visuals: ['visuals'],
} as const;

export type SongRecallGroup = keyof typeof SONG_SETUP_GROUPS;
export const SONG_RECALL_GROUPS = Object.keys(SONG_SETUP_GROUPS) as SongRecallGroup[];

export type SongSetupKey = (typeof SONG_SETUP_GROUPS)[SongRecallGroup][number];
export const SONG_SETUP_KEYS: readonly SongSetupKey[] = SONG_RECALL_GROUPS.flatMap((g) => SONG_SETUP_GROUPS[g]);

export type SongSetup = Pick<MusicStudioProjectState, SongSetupKey>;

/** The visuals a song calls up beyond the note visuals in its setup. */
export interface SongVisuals {
  /** The looks on each instrument feed (the studio instance's voices); null leaves them. */
  voices: StudioVoice[] | null;
  /** The visual scene those voices came from. */
  sceneId: string | null;
  /** The VJ block (a page of the clip grid) to show, by id. */
  vjBlockId: string | null;
  /** The VJ column to launch on deck A. */
  vjColumn: number | null;
  /** The stage preset to call up, by id. */
  stagePresetId: string | null;
}

export interface Song {
  id: string;
  name: string;
  /** Tempo to set when it comes up; null leaves the tempo to the band, Link or tap. */
  bpm: number | null;
  /** The studio scene to launch with it (its first part), or null. */
  sceneId: string | null;
  /** A note for the performer: cues, who counts in. */
  notes: string;
  setup: SongSetup;
  visuals: SongVisuals;
  /** Which parts calling it up puts back. */
  recall: Record<SongRecallGroup, boolean>;
}

export interface Setlist {
  id: string;
  name: string;
  /** Songs in playing order; one can appear more than once. */
  songIds: string[];
}

export const MAX_SONGS = 200;
export const MAX_SETLISTS = 50;
export const MIN_SONG_BPM = 20;
export const MAX_SONG_BPM = 300;

export function emptySongVisuals(): SongVisuals {
  return { voices: null, sceneId: null, vjBlockId: null, vjColumn: null, stagePresetId: null };
}

export function defaultRecall(): Record<SongRecallGroup, boolean> {
  return { sound: true, band: true, visuals: true };
}

/** A deep copy of the studio's setup, from the store's state. */
export function captureSetup(state: SongSetup): SongSetup {
  const setup = {} as Record<SongSetupKey, unknown>;
  for (const key of SONG_SETUP_KEYS) setup[key] = copyJson(state[key]);
  return setup as SongSetup;
}

/** The parts of a setup that calling it up puts back, deep-copied. */
export function recalledSetup(song: Pick<Song, 'setup' | 'recall'>): Partial<SongSetup> {
  const out: Partial<Record<SongSetupKey, unknown>> = {};
  for (const group of SONG_RECALL_GROUPS) {
    if (!song.recall[group]) continue;
    for (const key of SONG_SETUP_GROUPS[group]) out[key] = copyJson(song.setup[key]);
  }
  return out as Partial<SongSetup>;
}

function copyJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** "Song 3" after "Song 1" and "Song 2". */
export function nextSongName(songs: readonly Pick<Song, 'name'>[]): string {
  let highest = 0;
  for (const song of songs) {
    const m = /^Song (\d+)$/.exec(song.name);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `Song ${Math.max(highest, songs.length) + 1}`;
}

/** "Set 2" after "Set 1". */
export function nextSetlistName(setlists: readonly Pick<Setlist, 'name'>[]): string {
  let highest = 0;
  for (const list of setlists) {
    const m = /^Set (\d+)$/.exec(list.name);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `Set ${Math.max(highest, setlists.length) + 1}`;
}

/**
 * The position `step` songs along the set list from `cursor` (-1: before
 * the first song), or null past either end.
 */
export function setlistStep(setlist: Pick<Setlist, 'songIds'> | null | undefined, cursor: number, step: number): number | null {
  if (!setlist || !setlist.songIds.length) return null;
  const at = cursor < 0 ? (step > 0 ? step - 1 : null) : cursor + step;
  if (at === null || at < 0 || at >= setlist.songIds.length) return null;
  return at;
}

// ── Reading saved songs ─────────────────────────────────────────────────

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function text(value: unknown, max: number, fallback: string): string {
  return typeof value === 'string' ? value.trim().slice(0, max) || fallback : fallback;
}

function optionalId(value: unknown): string | null {
  return typeof value === 'string' && ID.test(value) ? value : null;
}

function normalizeSongVisuals(raw: unknown): SongVisuals {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof SongVisuals, unknown>>;
  let voices: StudioVoice[] | null = null;
  if (Array.isArray(r.voices)) {
    voices = [];
    for (const v of r.voices) {
      const voice = normalizeStudioVoice(v);
      if (voice && voices.length < MAX_STUDIO_VOICES) voices.push(voice);
    }
  }
  const column = Number(r.vjColumn);
  return {
    voices,
    sceneId: typeof r.sceneId === 'string' && r.sceneId.length <= 64 ? r.sceneId : null,
    vjBlockId: optionalId(r.vjBlockId),
    vjColumn: r.vjColumn !== null && Number.isInteger(column) && column >= 0 && column < 1000 ? column : null,
    stagePresetId: optionalId(r.stagePresetId),
  };
}

/**
 * Read one saved song back. `normalizeSetup` fills in and checks the setup
 * the way the store reads its own state.
 */
export function normalizeSong(raw: unknown, normalizeSetup: (raw: unknown) => SongSetup): Song | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Record<keyof Song, unknown>>;
  const id = optionalId(r.id);
  if (!id) return null;
  const bpm = Number(r.bpm);
  const recall = (r.recall && typeof r.recall === 'object' ? r.recall : {}) as Partial<Record<SongRecallGroup, unknown>>;
  return {
    id,
    name: text(r.name, 60, 'Song'),
    bpm: r.bpm !== null && Number.isFinite(bpm) && bpm > 0 ? Math.max(MIN_SONG_BPM, Math.min(MAX_SONG_BPM, Math.round(bpm * 10) / 10)) : null,
    sceneId: optionalId(r.sceneId),
    notes: typeof r.notes === 'string' ? r.notes.slice(0, 2000) : '',
    setup: normalizeSetup(r.setup),
    visuals: normalizeSongVisuals(r.visuals),
    recall: Object.fromEntries(SONG_RECALL_GROUPS.map((g) => [g, recall[g] !== false])) as Record<SongRecallGroup, boolean>,
  };
}

export function normalizeSongs(raw: unknown, normalizeSetup: (raw: unknown) => SongSetup): Song[] {
  const songs: Song[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const song = normalizeSong(item, normalizeSetup);
    if (song && !songs.some((s) => s.id === song.id)) songs.push(song);
    if (songs.length >= MAX_SONGS) break;
  }
  return songs;
}

/** Set lists, keeping only songs that exist. */
export function normalizeSetlists(raw: unknown, songIds: ReadonlySet<string>): Setlist[] {
  const lists: Setlist[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Partial<Record<keyof Setlist, unknown>>;
    const id = optionalId(r.id);
    if (!id || lists.some((l) => l.id === id)) continue;
    const ids = Array.isArray(r.songIds) ? r.songIds.filter((s): s is string => typeof s === 'string' && songIds.has(s)).slice(0, 500) : [];
    lists.push({ id, name: text(r.name, 60, 'Set'), songIds: ids });
    if (lists.length >= MAX_SETLISTS) break;
  }
  return lists;
}
