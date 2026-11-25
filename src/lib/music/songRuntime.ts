/**
 * Songs at the show: keeping the whole setup now as a song, and calling a
 * song back up (its sound, the band's settings, the tempo and the visuals)
 * on the next bar, or at once. Next and previous walk the set list.
 *
 * Calling a song up is playing the show, not editing it, so it never fills
 * the undo history: next, previous, Go and MIDI make no undo step at all. A
 * song called up by hand from the song list is one step for what it changed
 * on the map (a stage preset, the looks on a mapping layer), as a clicked
 * stage preset is. The studio's own settings are outside undo either way.
 */

import { get, writable, type Readable } from 'svelte/store';
import { isStudioPlaying, musicStudio, type MusicStudioState } from './musicStudioStore';
import { ensureMusicRuntime, freshStart, launchRow, launchScene, onKill, stopAll } from './musicRuntime';
import { nextBar } from './loops';
import {
  MAX_SONG_BPM,
  MIN_SONG_BPM,
  captureSetup,
  defaultRecall,
  nextSongName,
  recalledSetup,
  setlistStep,
  type Setlist,
  type Song,
  type SongVisuals,
} from './songs';
import { dominantColumn } from './scenes';
import { normalizeMix } from './studioMix';
import { normalizeFinish } from './studioFinish';
import { AUTO_PALETTE } from './studioPalettes';
import { editStudio, placeStudio, studioTargetNow } from './studioTarget';
import type { StudioVoice } from './studioPlugin';
import { registerStudioControls } from './studioControls';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { noteAutomatedRecall, project } from '../stores/layers';
import type { RecallSection } from '../stores/projectDirty';
import { globalStagePresets } from '../stores/globalPresets';
import { audioStore } from '../stores/audio';
import { launchClockFollowsLink, launchClockPosition, launchClockTempo, nextLaunchBoundary } from '../stores/launchClock';
import { recordDiscreteAction, runAsLiveControl } from '../stores/historyHooks';
import { generateUUID } from '../utils/uuid';
import type { StagePreset } from '../types';

/** Songs change on the bar, as scenes do. */
const SONG_GRID_BEATS = 4;

export interface QueuedSong {
  songId: string;
  /** Where in the set list it was called from (-1: not from the list). */
  cursor: number;
  /** performance.now() when it comes up. */
  fireAt: number;
}

const queue = writable<QueuedSong | null>(null);
/** The song waiting for the next bar. */
export const queuedSong: Readable<QueuedSong | null> = { subscribe: queue.subscribe };

const notice = writable<string | null>(null);
/** What the last song left alone and why (Ableton Link has the tempo), or null. */
export const songNotice: Readable<string | null> = { subscribe: notice.subscribe };

let timer: ReturnType<typeof setTimeout> | null = null;

type SongState = Pick<MusicStudioState, 'songs' | 'setlists' | 'activeSetlistId' | 'currentSongId' | 'setlistCursor'>;

export function activeSetlist(s: Pick<SongState, 'setlists' | 'activeSetlistId'>): Setlist | null {
  return s.setlists.find((l) => l.id === s.activeSetlistId) ?? null;
}

/** Where the song up now is in the set list: where it was called from, else its first place (-1: not in it). */
export function currentSetlistCursor(s: SongState): number {
  const list = activeSetlist(s);
  if (!list) return -1;
  if (s.setlistCursor >= 0 && s.setlistCursor < list.songIds.length) return s.setlistCursor;
  return s.currentSongId ? list.songIds.indexOf(s.currentSongId) : -1;
}

/** The song `step` places along the set list from the one up now, or null past either end. */
export function songAlongSetlist(s: SongState, step: number): { song: Song; cursor: number } | null {
  const list = activeSetlist(s);
  const cursor = setlistStep(list, currentSetlistCursor(s), step);
  if (!list || cursor === null) return null;
  const song = s.songs.find((x) => x.id === list.songIds[cursor]);
  return song ? { song, cursor } : null;
}

// ── Keeping a song ──────────────────────────────────────────────────────

function tempoNow(): number {
  return Math.max(MIN_SONG_BPM, Math.min(MAX_SONG_BPM, Math.round(launchClockTempo() * 10) / 10));
}

function copyVoices(voices: readonly StudioVoice[]): StudioVoice[] {
  return voices.map((v) => ({ ...v, params: { ...v.params } }));
}

function stagePresetById(id: string): { preset: StagePreset; global: boolean } | null {
  const own = (get(project).stagePresets ?? []).find((p) => p.id === id);
  if (own) return { preset: own, global: false };
  const shared = get(globalStagePresets).find((p) => p.id === id);
  return shared ? { preset: shared, global: true } : null;
}

/** The visuals on now: the studio instance's looks, the VJ block and column, the stage preset. */
function captureVisuals(): SongVisuals {
  const target = studioTargetNow();
  const vj = get(vjClipLauncher);
  // Only a preset that is on stage now, and still exists.
  const stagePresetId = vj.stageMode && vj.stagePresetId && stagePresetById(vj.stagePresetId) ? vj.stagePresetId : null;
  return {
    voices: target ? copyVoices(target.source.musicVoices) : null,
    sceneId: target?.source.musicSceneId ?? null,
    vjBlockId: vj.activeBlockId ?? null,
    vjColumn: dominantColumn(vj.layerStates.map((ls) => (ls?.activeClip ? ls.activeColumn : null))),
    stagePresetId,
    look: target
      ? { mix: normalizeMix(target.source.musicMix), palette: target.source.musicPalette || AUTO_PALETTE, finish: normalizeFinish(target.source.musicFinish) }
      : null,
  };
}

/**
 * Keep everything set up now as a new song (and add it to the end of the
 * set list being played). It becomes the song up now. Null when there are
 * too many songs.
 */
export function saveSong(name?: string): Song | null {
  const s = get(musicStudio);
  const song: Song = {
    id: generateUUID(),
    name: name?.trim().slice(0, 60) || nextSongName(s.songs),
    bpm: tempoNow(),
    sceneId: s.sceneId,
    notes: '',
    setup: captureSetup(s),
    visuals: captureVisuals(),
    recall: defaultRecall(),
    // The clip grid as it is now, and the arrangement of the song it was made from.
    grid: { session: JSON.parse(JSON.stringify(s.session)), key: { ...s.key }, sections: (s.songs.find((x) => x.id === s.currentSongId)?.grid?.sections ?? []).map((sec) => ({ ...sec })) },
  };
  keepGrid();
  if (!musicStudio.addSong(song)) return null;
  const list = activeSetlist(get(musicStudio));
  let cursor = -1;
  if (list) {
    musicStudio.setSetlistSongs(list.id, [...list.songIds, song.id]);
    cursor = list.songIds.length;
  }
  musicStudio.setCurrentSong(song.id, cursor);
  return song;
}

/** Keep what is set up now in a song, in place of what it had. Its name, notes, recall and "leave the tempo" stay. */
export function updateSongFromNow(id: string): boolean {
  const s = get(musicStudio);
  const song = s.songs.find((x) => x.id === id);
  if (!song) return false;
  musicStudio.updateSong(id, {
    bpm: song.bpm === null ? null : tempoNow(),
    sceneId: s.sceneId,
    setup: captureSetup(s),
    visuals: captureVisuals(),
  });
  return true;
}

// ── Calling a song up ───────────────────────────────────────────────────

export interface CallSongOptions {
  /** Where in the set list it is called from (-1 or left out: not from the list). */
  cursor?: number;
  /** Now, not on the next bar. */
  now?: boolean;
  /** Called up by hand from the song list: one undo step for the map. */
  history?: boolean;
}

/**
 * Call a song up on the next bar of the launch clock. Calling the song that
 * is waiting again, or `now`, brings it up at once. Returns false when there
 * is no such song.
 */
export function callSong(id: string, options: CallSongOptions = {}): boolean {
  if (!get(musicStudio).songs.some((x) => x.id === id)) return false;
  const waiting = get(queue);
  const again = waiting?.songId === id;
  const cursor = options.cursor ?? (waiting && again ? waiting.cursor : -1);
  const history = options.history === true;
  if (options.now || again) {
    fire(id, cursor, history);
    return true;
  }
  cancelQueuedSong();
  const fireAt = nextLaunchBoundary(SONG_GRID_BEATS);
  queue.set({ songId: id, cursor, fireAt });
  timer = setTimeout(() => {
    timer = null;
    fire(id, cursor, history);
  }, Math.max(0, fireAt - performance.now()));
  return true;
}

/** Forget the song waiting for the bar. */
export function cancelQueuedSong(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (get(queue)) queue.set(null);
}

function fire(id: string, cursor: number, history: boolean): void {
  cancelQueuedSong();
  const song = get(musicStudio).songs.find((x) => x.id === id);
  if (song) applySong(song, cursor, history);
}

/** The song up now keeps the clip grid as it is on the session (its clips are edited there). */
function keepGrid(): void {
  const s = get(musicStudio);
  const up = s.songs.find((x) => x.id === s.currentSongId);
  if (up?.grid) musicStudio.updateSong(up.id, { grid: { ...up.grid, session: JSON.parse(JSON.stringify(s.session)), key: { ...s.key } } });
}

function applySong(song: Song, cursor: number, history: boolean): void {
  ensureMusicRuntime();
  notice.set(null);
  let mapChanged = false;
  const before = get(musicStudio);
  const another = before.currentSongId !== song.id;
  const wasPlaying = isStudioPlaying(before);
  const wasPlayingThrough = get(playback) !== null;
  if (another) keepGrid();
  runAsLiveControl(() => {
    // A song is a new song: when it brings up another set, what was playing
    // stops and nothing is left held. (The set buttons alone keep the music
    // going; there a set is just another instrument.)
    const setup = recalledSetup(song);
    if (setup.set !== undefined && setup.set !== get(musicStudio).set) freshStart();
    if (Object.keys(setup).length) musicStudio.applySetup(setup, song.recall);
    // Its own clips take the grid, in their key.
    if (song.grid && another) musicStudio.setSessionGrid(song.grid.session, song.grid.key);
    applyTempo(song.bpm);
    // The block first, so the scene's own VJ column fires on it.
    if (song.recall.visuals) showBlock(song.visuals);
    // Its scene starts the music only with the studio open, as the studio's other controls do.
    const s = get(musicStudio);
    if (song.recall.sound && s.isOpen && song.sceneId && s.scenes.some((sc) => sc.id === song.sceneId)) launchScene(song.sceneId, true);
    if (song.recall.visuals) mapChanged = showVisuals(song.visuals, history);
  });
  musicStudio.setCurrentSong(song.id, cursor);
  // With music playing, the new song takes over from the old one: its first section comes in.
  if (another) {
    const first = song.grid?.sections[0];
    if (first && wasPlayingThrough) beginSection(song.id, 0, true);
    else {
      stopSongPlay();
      if (first && wasPlaying) launchRow(first.row);
    }
  }
  if (history && mapChanged) recordDiscreteAction();
  // Calling a song up is playing the show: the parts it put back read as saved until edited.
  const recalled: RecallSection[] = [];
  if (song.recall.sound) recalled.push('studioSound');
  if (song.recall.band) recalled.push('studioBand');
  if (song.recall.visuals) recalled.push('studioVisuals');
  noteAutomatedRecall(recalled);
}

function applyTempo(bpm: number | null): void {
  if (bpm === null) return;
  if (launchClockFollowsLink()) {
    notice.set(`Ableton Link has the tempo, so ${bpm} BPM was left to it.`);
    return;
  }
  if (get(audioStore).manualBPM === bpm) return;
  audioStore.setManualBPM(bpm);
}

function showBlock(visuals: SongVisuals): void {
  const vj = get(vjClipLauncher);
  if (visuals.vjBlockId && visuals.vjBlockId !== vj.activeBlockId && vj.blocks.some((b) => b.id === visuals.vjBlockId)) {
    vjClipLauncher.setActiveBlock(visuals.vjBlockId);
  }
}

/** The VJ column, the stage preset and the looks. True when the map changed (an undoable edit). */
function showVisuals(visuals: SongVisuals, history: boolean): boolean {
  let mapChanged = false;
  const vj = get(vjClipLauncher);
  // Already on the bar (or called for now), so the column fires at once.
  if (vj.isOpen && visuals.vjColumn !== null && visuals.vjColumn < vj.numColumns) vjClipLauncher.triggerColumnNow(visuals.vjColumn, 'A');
  // A preset already on stage stays as it is (reloading it would reset the map mid-song).
  if (visuals.stagePresetId && get(vjClipLauncher).stagePresetId !== visuals.stagePresetId) {
    const found = stagePresetById(visuals.stagePresetId);
    if (found) {
      if (found.global) project.loadStagePresetSnapshot(found.preset, { history });
      else project.loadStagePreset(found.preset.id, { history });
      mapChanged = true;
    }
  }
  // After the column and the preset: either can bring a different studio instance up.
  if (visuals.voices) {
    const voices = visuals.voices;
    const look = visuals.look ?? null;
    // A song with a look of its own puts the visuals up for it; otherwise only voices do.
    const target = studioTargetNow() ?? (voices.length || look ? placeStudio() : null);
    if (target) {
      const musicSet = get(musicStudio).set;
      const next = {
        musicSet,
        musicSceneId: visuals.sceneId,
        musicVoices: copyVoices(voices),
        ...(look ? { musicMix: { ...look.mix }, musicPalette: look.palette, musicFinish: { ...look.finish } } : {}),
      };
      const now = Object.fromEntries(Object.keys(next).map((k) => [k, target.source[k as keyof typeof target.source]]));
      const same = JSON.stringify(now) === JSON.stringify(next);
      // Without a look of its own, the looks come in the studio's own palette, as a scene's do.
      if (!same && editStudio((src) => ({ ...src, ...next }))) mapChanged ||= target.kind === 'layer';
    }
  }
  return mapChanged;
}

/**
 * The song up now puts its visuals back (when it brings them back at all):
 * for when the visuals have just been put on the deck after it was called up.
 */
export function showCurrentSongVisuals(): void {
  const s = get(musicStudio);
  const song = s.songs.find((x) => x.id === s.currentSongId);
  if (song?.recall.visuals) showVisuals(song.visuals, false);
}

/**
 * Add the demo set and call its first song up. Returns false when there was
 * no room for it (too many songs or set lists).
 */
export function loadDemoSongs(): boolean {
  const songs = musicStudio.loadDemoSet();
  if (!songs?.length) return false;
  stopSongPlay();
  return goToSong(0, { now: true, history: true });
}

/** Start clean: stop what plays, and every song, set list and clip goes. */
export function clearAllSongs(): void {
  cancelQueuedSong();
  stopSongPlay();
  stopAll();
  musicStudio.clearSongs();
}

// ── The set list ────────────────────────────────────────────────────────

function stepSong(step: number, now: boolean): boolean {
  const along = songAlongSetlist(get(musicStudio), step);
  return along ? callSong(along.song.id, { cursor: along.cursor, now }) : false;
}

/** The next song in the set list, on the next bar (again: now). False at the end. */
export function nextSong(options: { now?: boolean } = {}): boolean {
  return stepSong(1, options.now === true);
}

/** The previous song in the set list, on the next bar (again: now). False at the start. */
export function prevSong(options: { now?: boolean } = {}): boolean {
  return stepSong(-1, options.now === true);
}

/** The song at a place in the set list (play from here). */
export function goToSong(cursor: number, options: Omit<CallSongOptions, 'cursor'> = {}): boolean {
  const id = activeSetlist(get(musicStudio))?.songIds[cursor];
  return id ? callSong(id, { ...options, cursor }) : false;
}

/** Go: the song waiting for the bar, now; with none waiting, the next one now. */
export function songGo(): boolean {
  const waiting = get(queue);
  if (waiting) {
    fire(waiting.songId, waiting.cursor, false);
    return true;
  }
  return nextSong({ now: true });
}

// ── Playing a song through ──────────────────────────────────────────────

/** The song playing through its arrangement: which section, and the launch-clock beat it started on. */
export interface SongPlayback {
  songId: string;
  index: number;
  startBeat: number;
}

const playback = writable<SongPlayback | null>(null);
export const songPlayback: Readable<SongPlayback | null> = { subscribe: playback.subscribe };

/** At the end of a song, go on to the next one in the set list. */
export const songPlayThrough = writable(true);

/** Beats before the bar line the next row is queued (it starts on the line). */
const QUEUE_LEAD_BEATS = 1;
/** Beats before the bar line the next song comes up: late, as its tempo and key change at once. */
const SONG_LEAD_BEATS = 0.3;

let playTimer: ReturnType<typeof setTimeout> | null = null;

function sectionsOf(songId: string) {
  return get(musicStudio).songs.find((x) => x.id === songId)?.grid?.sections ?? [];
}

/** Launch a section's row and make it the one playing. `busy`: music is playing, so the row starts on the next bar. */
function beginSection(songId: string, index: number, busy: boolean): boolean {
  const section = sectionsOf(songId)[index];
  if (!section) return false;
  if (playTimer) clearTimeout(playTimer);
  const { beat } = launchClockPosition();
  launchRow(section.row);
  playback.set({ songId, index, startBeat: busy ? nextBar(beat) : Math.floor(beat / 4) * 4 });
  playTimer = setTimeout(watchSection, 50);
  return true;
}

function watchSection(): void {
  playTimer = null;
  const p = get(playback);
  if (!p) return;
  const sections = sectionsOf(p.songId);
  const section = sections[p.index];
  const s = get(musicStudio);
  const { beat, beatMs } = launchClockPosition();
  // The song was taken off, or the music was stopped: playing through ends there.
  if (!section || s.currentSongId !== p.songId || (beat > p.startBeat + 1 && !isStudioPlaying(s))) {
    playback.set(null);
    return;
  }
  const end = p.startBeat + section.bars * 4;
  const last = p.index + 1 >= sections.length;
  const along = last && get(songPlayThrough) ? songAlongSetlist(s, 1) : null;
  const onward = along?.song.grid?.sections.length ? along : null;
  const lead = !last ? QUEUE_LEAD_BEATS : onward ? SONG_LEAD_BEATS : 0;
  const wait = end - lead - beat;
  if (wait > 0.01) {
    // Short sleeps, so a tempo change on the way is followed.
    playTimer = setTimeout(watchSection, Math.max(5, Math.min(1500, wait * beatMs)));
    return;
  }
  if (!last) {
    launchRow(sections[p.index + 1].row);
    playback.set({ songId: p.songId, index: p.index + 1, startBeat: end });
    playTimer = setTimeout(watchSection, 50);
  } else if (onward) {
    fire(onward.song.id, onward.cursor, false);
  } else {
    playback.set(null);
    stopAll();
  }
}

/** Play the song up now through its arrangement, from a section (the first when left out). */
export function playSong(index = 0): boolean {
  const s = get(musicStudio);
  const song = s.songs.find((x) => x.id === s.currentSongId);
  if (!song?.grid?.sections[index]) return false;
  ensureMusicRuntime();
  runAsLiveControl(() => applyTempo(song.bpm));
  return beginSection(song.id, index, isStudioPlaying(s));
}

/** Stop following the arrangement; what is playing keeps playing. */
export function stopSongPlay(): void {
  if (playTimer) clearTimeout(playTimer);
  playTimer = null;
  if (get(playback)) playback.set(null);
}

/** Where the song playing through is: its section and the bars played of it. */
export function songPlaybackPosition(): { index: number; bar: number } | null {
  const p = get(playback);
  if (!p) return null;
  return { index: p.index, bar: Math.max(0, (launchClockPosition().beat - p.startBeat) / 4) };
}

onKill(stopSongPlay);

// A song waiting when the studio closes, or whose song went (deleted, another project), never comes up.
let wasOpen = false;
musicStudio.subscribe((s) => {
  const waiting = get(queue);
  if (waiting && ((wasOpen && !s.isOpen) || !s.songs.some((x) => x.id === waiting.songId))) cancelQueuedSong();
  wasOpen = s.isOpen;
});
// The kill switch drops a song waiting for the bar.
onKill(cancelQueuedSong);

registerStudioControls([
  { id: 'song.next', label: 'Next song', group: 'Songs', kind: 'trigger', run: () => void nextSong() },
  { id: 'song.prev', label: 'Previous song', group: 'Songs', kind: 'trigger', run: () => void prevSong() },
  { id: 'song.go', label: 'Go: the waiting or next song now', group: 'Songs', kind: 'trigger', run: () => void songGo() },
  { id: 'song.play', label: 'Play the song through', group: 'Songs', kind: 'trigger', run: () => void (get(playback) ? stopSongPlay() : playSong()) },
]);
