/**
 * What the Timeline's sound rows can be told to do (the tray calls these).
 * Each is one undo step of the document; drags pass a `continuousKey` so a
 * whole drag is one step.
 */
import { get } from 'svelte/store';
import { showTimeline } from '../../stores/showTimeline';
import { generateUUID } from '../../utils/uuid';
import { createAssetRefFromGeneratedBlob } from '../../storage/assetRegistry';
import { secondsAtBeat, beatAtSeconds } from '../../show/tempoMap';
import type { MacroFxType } from '../../music/macroFx';
import { BUILD_STYLES, type BuildStyle } from '../../music/buildDrop';
import type { ShowAudioTrack } from '../../types';
import { lineControlInput } from '../lines/timelineLines';
import {
  addRowFx,
  addSoundRow,
  materializeRows,
  moveSoundBlock,
  removeSoundRow,
  retimeBlock,
  setBlockFade,
  setRowFxParam,
  soundRowsFor,
  trimSoundBlock,
  updateSoundRow,
  type BuildBlock,
  type LiveClipBlock,
  type SoundDoc,
  type SoundRow,
  type SoundRowKind,
} from './soundModel';
import { renderLibrarySound, renderedWav } from './soundRender';
import { bpmAt } from './soundEngine';

const state = () => get(showTimeline);

export function soundRows(): SoundRow[] {
  const s = state();
  return soundRowsFor(s.sound, s.audioTracks);
}

function rowIndex(rowId: string): number {
  return soundRows().findIndex((r) => r.id === rowId);
}

function setDoc(doc: SoundDoc, continuousKey?: string): void {
  showTimeline.setSound(doc, { continuousKey });
}

// ── Rows ───────────────────────────────────────────────────────────────────

export function addRow(kind: SoundRowKind = 'audio'): string {
  const s = state();
  const id = generateUUID();
  setDoc(addSoundRow(s.sound, s.audioTracks, kind, id));
  return id;
}

export function removeRow(rowId: string): void {
  const s = state();
  const out = removeSoundRow(s.sound, s.audioTracks, rowId);
  showTimeline.setSoundBlocks(out.tracks, out.doc);
  showTimeline.editLines((lines) => {
    const next = lines.filter((l) => !(l.target.scope === 'sound' && l.target.id === rowId));
    return next.length === lines.length ? lines : next;
  });
}

export function updateRow(rowId: string, patch: Partial<SoundRow>, continuousKey?: string): void {
  const s = state();
  const next = updateSoundRow(s.sound, s.audioTracks, rowId, patch);
  if (next !== s.sound) setDoc(next, continuousKey);
}

export function setRowVolume(rowId: string, volume: number): void {
  const v = Math.max(0, Math.min(1, volume));
  updateRow(rowId, { volume: v }, `volume:${rowId}`);
  lineControlInput({ scope: 'sound', id: rowId }, 'sound:volume', v);
}

export function toggleMute(rowId: string): void {
  const row = soundRows().find((r) => r.id === rowId);
  if (row) updateRow(rowId, { muted: !row.muted });
}

export function toggleSolo(rowId: string): void {
  const row = soundRows().find((r) => r.id === rowId);
  if (row) updateRow(rowId, { solo: !row.solo });
}

export function renameRow(rowId: string, name: string): void {
  const n = name.trim();
  if (n) updateRow(rowId, { name: n.slice(0, 60) });
}

// ── Effects ────────────────────────────────────────────────────────────────

export function addFx(rowId: string, type: MacroFxType): string | null {
  const row = soundRows().find((r) => r.id === rowId);
  if (!row || row.kind === 'live') return null;
  const id = generateUUID();
  updateRow(rowId, { fx: addRowFx(row, type, id).fx });
  return id;
}

export function removeFx(rowId: string, fxId: string): void {
  const row = soundRows().find((r) => r.id === rowId);
  if (!row) return;
  updateRow(rowId, { fx: row.fx.filter((f) => f.id !== fxId) });
  showTimeline.editLines((lines) => {
    const next = lines.filter((l) => !(l.target.scope === 'sound' && l.target.id === rowId && l.key.startsWith(`sfx:${fxId}:`)));
    return next.length === lines.length ? lines : next;
  });
}

export function toggleFx(rowId: string, fxId: string): void {
  const row = soundRows().find((r) => r.id === rowId);
  if (!row) return;
  updateRow(rowId, { fx: row.fx.map((f) => (f.id === fxId ? { ...f, enabled: !f.enabled } : f)) });
}

export function moveFx(rowId: string, fxId: string, delta: -1 | 1): void {
  const row = soundRows().find((r) => r.id === rowId);
  if (!row) return;
  const i = row.fx.findIndex((f) => f.id === fxId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= row.fx.length) return;
  const fx = row.fx.slice();
  [fx[i], fx[j]] = [fx[j], fx[i]];
  updateRow(rowId, { fx });
}

export function setFxParam(rowId: string, fxId: string, key: string, value: number): void {
  const row = soundRows().find((r) => r.id === rowId);
  if (!row) return;
  updateRow(rowId, { fx: setRowFxParam(row, fxId, key, value).fx }, `fx:${rowId}:${fxId}:${key}`);
  lineControlInput({ scope: 'sound', id: rowId }, `sfx:${fxId}:${key}`, Math.max(0, Math.min(1, value)));
}

export function setDuck(rowId: string, duck: SoundRow['duck']): void {
  updateRow(rowId, { duck }, duck ? `duck:${rowId}` : undefined);
}

// ── Audio blocks ───────────────────────────────────────────────────────────

function editTrack(id: string, edit: (t: ShowAudioTrack) => ShowAudioTrack, continuousKey?: string): void {
  const s = state();
  const t = s.audioTracks.find((x) => x.id === id);
  if (!t) return;
  const next = edit(t);
  if (next === t) return;
  showTimeline.setSoundBlocks(s.audioTracks.map((x) => (x.id === id ? next : x)), materializeRows(s.sound, [...s.audioTracks, next]), { continuousKey });
}

export function moveAudioBlock(id: string, startTime: number, lane?: number): void {
  const t = showTimeline.snapTime(startTime, [id]);
  editTrack(id, (b) => moveSoundBlock(b, t, lane ?? b.lane), `block-move:${id}`);
}

export function trimAudioBlock(id: string, edge: 'start' | 'end', time: number): void {
  const t = showTimeline.snapTime(time, [id]);
  editTrack(id, (b) => trimSoundBlock(b, edge, t), `block-trim:${id}`);
}

export function setAudioFade(id: string, edge: 'in' | 'out', seconds: number): void {
  editTrack(id, (b) => setBlockFade(b, edge, seconds), `block-fade:${id}:${edge}`);
}

export function removeAudioBlock(id: string): void {
  showTimeline.removeAudioTrack(id);
}

/** Drop audio files on a row. */
export async function addFilesToRow(files: File[], rowId: string, at: number): Promise<void> {
  const lane = Math.max(0, rowIndex(rowId));
  let cursor = showTimeline.snapTime(at);
  for (const file of files) {
    await showTimeline.addAudioTrackFromFile(file, { startTime: cursor, lane });
    cursor += 0.001;
  }
}

/** A Music Studio library sound on a row at `at`, rendered to a file once. */
export async function addLibrarySound(rowId: string, soundId: string, at: number): Promise<string | null> {
  const s = state();
  const lane = Math.max(0, rowIndex(rowId));
  const start = showTimeline.snapTime(at);
  const rendered = await renderLibrarySound(soundId, { bpm: bpmAt(s.tempo, start) });
  if (!rendered) return null;
  const blob = new Blob([renderedWav(rendered) as BlobPart], { type: 'audio/wav' });
  const asset = await createAssetRefFromGeneratedBlob(blob, `${rendered.def.name}.wav`, 'audio/wav');
  return showTimeline.addAudioTrack({
    name: rendered.def.name,
    url: asset.runtimeUrl,
    assetRef: asset.assetRef,
    startTime: start,
    duration: rendered.duration,
    lane,
    extra: { sound: { id: soundId } },
  });
}

// ── Live rows and clip blocks ──────────────────────────────────────────────

export function bindLiveTrack(rowId: string, track: number, trackName: string): void {
  const row = soundRows().find((r) => r.id === rowId);
  if (!row) return;
  updateRow(rowId, { kind: 'live', live: { ...(row.live ?? { launch: 'beat', latencyMs: 20 }), track, trackName } as SoundRow['live'], name: row.name.startsWith('Live') || row.name.startsWith('Sound') ? trackName || row.name : row.name });
}

export function setLiveOptions(rowId: string, patch: Partial<NonNullable<SoundRow['live']>>): void {
  const row = soundRows().find((r) => r.id === rowId);
  if (!row?.live) return;
  updateRow(rowId, { live: { ...row.live, ...patch } });
}

/** Seconds a clip of `beats` (quarters) lasts from `start` on the Timeline's grid. */
export function clipSeconds(beats: number, start: number): number {
  const tempo = state().tempo;
  if (!(beats > 0)) return 4;
  if (!tempo) return (beats * 60) / 120;
  return secondsAtBeat(tempo, beatAtSeconds(tempo, start) + beats) - start;
}

export function addLiveBlock(rowId: string, clip: { slot: number; name: string; color: number; length: number }, at: number): string | null {
  const s = state();
  const lane = rowIndex(rowId);
  if (lane < 0) return null;
  const start = showTimeline.snapTime(at);
  const block: LiveClipBlock = { id: generateUUID(), lane, startTime: start, duration: Math.max(0.25, clipSeconds(clip.length, start)), slot: clip.slot, clipName: clip.name, color: clip.color };
  const doc = materializeRows(s.sound, s.audioTracks);
  showTimeline.setSound({ ...doc, live: [...doc.live, block] });
  showTimeline.select({ kind: 'liveClip', id: block.id });
  return block.id;
}

function editLive(id: string, edit: (b: LiveClipBlock) => LiveClipBlock, continuousKey?: string): void {
  const s = state();
  let changed = false;
  const live = s.sound.live.map((b) => {
    if (b.id !== id) return b;
    const n = edit(b);
    if (n !== b) changed = true;
    return n;
  });
  if (changed) showTimeline.setSound({ ...s.sound, live }, { continuousKey });
}

export function moveLiveBlock(id: string, time: number, lane?: number): void {
  const t = showTimeline.snapTime(time, [id]);
  const rows = soundRows();
  editLive(id, (b) => {
    const moved = retimeBlock(b, 'move', t);
    const l = lane !== undefined && rows[lane]?.kind === 'live' ? lane : b.lane;
    return l === b.lane ? moved : { ...moved, lane: l };
  }, `live-move:${id}`);
}

export function trimLiveBlock(id: string, edge: 'start' | 'end', time: number): void {
  const t = showTimeline.snapTime(time, [id]);
  editLive(id, (b) => retimeBlock(b, edge, t), `live-trim:${id}`);
}

export function setLiveBlockClip(id: string, clip: { slot: number; name: string; color: number }): void {
  editLive(id, (b) => ({ ...b, slot: clip.slot, clipName: clip.name, color: clip.color }));
}

export function setLiveBlockTiming(id: string, startTime: number, duration: number): void {
  editLive(id, (b) => ({ ...b, startTime: Math.max(0, startTime), duration: Math.max(0.25, duration) }));
}

export function removeLiveBlock(id: string): void {
  const s = state();
  if (!s.sound.live.some((b) => b.id === id)) return;
  showTimeline.setSound({ ...s.sound, live: s.sound.live.filter((b) => b.id !== id) });
  if (s.selection?.id === id) showTimeline.select(null);
}

// ── Build blocks ───────────────────────────────────────────────────────────

export function addBuildBlock(rowId: string, at: number, style: BuildStyle = 'edm', bars = 4): string | null {
  const s = state();
  const lane = rowIndex(rowId);
  if (lane < 0) return null;
  const start = showTimeline.snapTime(at);
  const preset = BUILD_STYLES.find((x) => x.id === style) ?? BUILD_STYLES[0];
  const block: BuildBlock = {
    id: generateUUID(),
    lane,
    startTime: start,
    duration: Math.max(0.5, clipSeconds(bars * 4, start)),
    style: preset.id,
    roll: preset.settings.roll,
    filter: preset.settings.filter,
    riser: preset.settings.riser,
    sends: preset.settings.sends,
    gap: preset.settings.gap,
    impact: preset.settings.impact,
  };
  const doc = materializeRows(s.sound, s.audioTracks);
  showTimeline.setSound({ ...doc, builds: [...doc.builds, block] });
  showTimeline.select({ kind: 'build', id: block.id });
  return block.id;
}

export function updateBuildBlock(id: string, patch: Partial<BuildBlock>, continuousKey?: string): void {
  const s = state();
  let changed = false;
  const builds = s.sound.builds.map((b) => {
    if (b.id !== id) return b;
    changed = true;
    return { ...b, ...patch };
  });
  if (changed) showTimeline.setSound({ ...s.sound, builds }, { continuousKey });
}

export function moveBuildBlock(id: string, time: number): void {
  const b = state().sound.builds.find((x) => x.id === id);
  if (!b) return;
  const t = showTimeline.snapTime(time, [id]);
  updateBuildBlock(id, retimeBlock(b, 'move', t), `build-move:${id}`);
}

export function trimBuildBlock(id: string, edge: 'start' | 'end', time: number): void {
  const b = state().sound.builds.find((x) => x.id === id);
  if (!b) return;
  const t = showTimeline.snapTime(time, [id]);
  updateBuildBlock(id, retimeBlock(b, edge, t), `build-trim:${id}`);
}

export function removeBuildBlock(id: string): void {
  const s = state();
  if (!s.sound.builds.some((b) => b.id === id)) return;
  showTimeline.setSound({ ...s.sound, builds: s.sound.builds.filter((b) => b.id !== id) });
  if (s.selection?.id === id) showTimeline.select(null);
}
