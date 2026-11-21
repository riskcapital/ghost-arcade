/**
 * The live looper: six loop tracks, each driven by one button.
 *
 * MIDI tracks record what is played on the selected instrument into layers
 * (loopTrack.ts) and play them on the launch clock's beats through the
 * studio's own note path, scheduled ahead on the audio clock like every
 * other loop. Audio tracks record a band input sample-exactly into buffers
 * (audioLoopTracks.ts). Both punch in and out on bar lines.
 *
 * The music runtime hands this module what it needs (a `StationHost`) and
 * calls `scheduleStation` from its scheduler tick, so nothing here imports
 * the runtime back.
 *
 * Layers are kept in the project (MIDI) or in memory (audio); undo/redo is
 * the looper's own, as with every live control.
 */

import { get, writable } from 'svelte/store';
import { musicStudio, onMusicHydrate } from './musicStudioStore';
import { BEATS_PER_BAR, MAX_LOOP_BARS, quantizeBeats, roleForRecording, type PlayedNote, type RecordedLoop, type RecordedNote } from './loopRecorder';
import { clipFromRecording } from './session';
import { readUserLoop, saveUserLoop } from './userLoops';
import { generateUUID } from '../utils/uuid';
import { INSTRUMENTS, noteOff, noteOn, type InstrumentId, type NoteEvent } from './noteEvents';
import { INSTRUMENT_LABELS } from './instruments';
import { launchClockPosition, launchClockTempo, resyncLaunchClock } from '../stores/launchClock';
import { audioStore } from '../stores/audio';
import {
  LOOP_TRACK_COUNT,
  MAX_MIDI_LOOP_BARS,
  MIN_FREE_BEATS,
  autoLoopName,
  emptyStack,
  flattenMidi,
  freeRecordEnd,
  inferTempo,
  loopNotesInWindow,
  mergeMidiLayers,
  nextBarAt,
  notesForLayer,
  passEnd,
  phaseAfterRecord,
  pressTrackButton,
  punchAt,
  pushLayer,
  recordStart,
  redoLayer,
  undoLayer,
  uniqueName,
  type LayerStack,
  type LoopTrackData,
  type MidiLayer,
  type TrackPhase,
} from './loopTrack';
import type { AudioLoopTracks } from './audioLoopTracks';

/** What the music runtime lends the station. */
export interface StationHost {
  send(event: NoteEvent): void;
  /** The audio clock (starts the audio when it is not running). */
  now(): number;
  click(time: number, accent: boolean): void;
  /** Live notes played lately (the capture buffer). */
  played(): readonly PlayedNote[];
  /** Something else keeps the clock going (a beat, a loop, a take): recordings start on the bar without a count-in. */
  clockBusy(): boolean;
  /** Keep the scheduler and the frame loop running. */
  wake(): void;
  /** The audio loop tracks, created on first use; null where audio cannot record. */
  audioTracks(): AudioLoopTracks | null;
}

/** A track as the panels show it. */
export interface TrackView {
  phase: TrackPhase;
  /** Waiting for a bar: the beat it starts, or for a free first loop, -1. */
  startBeat: number;
  endBeat: number | null;
  /** Loop start (pass 0) and length in beats; 0 when empty. */
  origin: number;
  beats: number;
  layers: number;
  redo: number;
  /** A stop or start waiting for its bar. */
  pending: 'stop' | 'play' | null;
  /** Free first loop: it will set the tempo. */
  setsTempo: boolean;
  /** Audio: no input to record. */
  noInput: boolean;
}

export interface StationView {
  tracks: TrackView[];
  selected: number;
}

const EMPTY_VIEW: TrackView = { phase: 'empty', startBeat: 0, endBeat: null, origin: 0, beats: 0, layers: 0, redo: 0, pending: null, setsTempo: false, noInput: false };

export const loopStationView = writable<StationView>({ tracks: Array.from({ length: LOOP_TRACK_COUNT }, () => ({ ...EMPTY_VIEW })), selected: 0 });

interface Rt {
  phase: TrackPhase;
  /** Recording: where it starts and ends (null: free, until pressed). */
  recStart: number;
  recEnd: number | null;
  /** Free first loop with the clock idle: the wall time it started. */
  freeSince: number | null;
  origin: number;
  /** Overdub: the window being layered, and where it stops (null: keeps going). */
  dubFrom: number;
  dubTo: number | null;
  /** A play or stop waiting for its bar. */
  playAt: number | null;
  stopAt: number | null;
  scheduledBeat: number;
  pendingOffs: Array<{ note: number; offBeat: number; instrument: InstrumentId; tone?: string }>;
  redo: MidiLayer[];
  /** What Clear took, for one undo. */
  cleared: { layers: MidiLayer[]; beats: number } | null;
  clickBeat: number;
}

let host: StationHost | null = null;
const rts: Rt[] = Array.from({ length: LOOP_TRACK_COUNT }, () => freshRt());

function freshRt(): Rt {
  return { phase: 'empty', recStart: 0, recEnd: null, freeSince: null, origin: 0, dubFrom: 0, dubTo: null, playAt: null, stopAt: null, scheduledBeat: 0, pendingOffs: [], redo: [], cleared: null, clickBeat: 0 };
}

export function attachLoopStation(h: StationHost): void {
  host = h;
}

onMusicHydrate(() => resetLoopStation());

const data = () => get(musicStudio).loopStation;
const track = (i: number): LoopTrackData => data().tracks[i];
const isAudio = (i: number) => track(i)?.kind === 'audio';

function stackOf(i: number): LayerStack<MidiLayer> {
  return { layers: track(i).layers, redo: rts[i].redo };
}

function hasContent(i: number): boolean {
  if (isAudio(i)) return (host?.audioTracks()?.layerCount(i) ?? 0) > 0;
  return track(i).layers.length > 0 && track(i).beats > 0;
}

/** A track's phase, settled against what it holds (a project loaded with loops in it starts stopped). */
function phaseOf(i: number): TrackPhase {
  const rt = rts[i];
  if ((rt.phase === 'play' || rt.phase === 'overdub' || rt.phase === 'stopped') && !hasContent(i)) rt.phase = 'empty';
  if (rt.phase === 'empty' && hasContent(i)) rt.phase = 'stopped';
  return rt.phase;
}

/** True while any track records, overdubs, plays or waits for a bar. */
export function stationBusy(): boolean {
  return rts.some((rt, i) => rt.phase === 'armed' || rt.phase === 'record' || rt.phase === 'overdub' || rt.phase === 'play' || (isAudio(i) && rt.phase !== 'empty' && rt.phase !== 'stopped'));
}

/** The earliest beat a recording or overdub still needs from the live notes (`fallback` when none does). */
export function stationOldestBeat(fallback: number): number {
  let oldest = fallback;
  for (const rt of rts) {
    if (rt.phase === 'armed' || rt.phase === 'record') oldest = Math.min(oldest, rt.recStart - 1);
    if (rt.phase === 'overdub') oldest = Math.min(oldest, rt.dubFrom - 1);
  }
  return oldest;
}

export function selectLoopTrack(i: number): void {
  if (i < 0 || i >= LOOP_TRACK_COUNT) return;
  loopStationView.update((v) => ({ ...v, selected: i }));
}

export function selectedLoopTrack(): number {
  return get(loopStationView).selected;
}

const clockNow = () => launchClockPosition();

// ── The button ──

/** The one big button of a track. */
export function pressLoopTrack(i: number): void {
  if (!host || i < 0 || i >= LOOP_TRACK_COUNT) return;
  host.now();
  selectLoopTrack(i);
  const rt = rts[i];
  const { beat } = clockNow();
  const action = pressTrackButton(phaseOf(i));
  switch (action.type) {
    case 'arm':
      arm(i, beat);
      break;
    case 'cancel':
      if (isAudio(i)) host.audioTracks()?.cancel(i);
      rt.phase = hasContent(i) ? 'stopped' : 'empty';
      break;
    case 'close-record':
      closeRecord(i, beat);
      break;
    case 'punch-in':
      if (isAudio(i)) {
        if (!host.audioTracks()?.overdub(i, true)) break;
        rt.phase = 'overdub';
        break;
      }
      rt.dubFrom = punchAt(beat);
      rt.dubTo = null;
      rt.phase = 'overdub';
      break;
    case 'punch-out':
      if (isAudio(i)) {
        host.audioTracks()?.overdub(i, false);
        rt.phase = 'play';
        break;
      }
      rt.dubTo = Math.max(rt.dubFrom, punchAt(beat));
      break;
    case 'play':
      startTrack(i);
      break;
  }
  publish();
  host.wake();
}

function arm(i: number, beat: number): void {
  const rt = rts[i];
  const d = data();
  const busy = host!.clockBusy() || rts.some((r, j) => j !== i && (r.phase === 'play' || r.phase === 'overdub' || r.phase === 'record'));
  // Rec → next track: a track still recording closes on the next bar, and this one starts there.
  const recording = rts.findIndex((r, j) => j !== i && r.phase === 'record');
  let start = recordStart(beat, d.countIn, busy);
  if (recording >= 0) {
    closeRecord(recording, beat);
    start = rts[recording].recEnd ?? start;
  }
  if (isAudio(i)) {
    const audio = host!.audioTracks();
    if (!audio || !audio.canRecord(i)) {
      publish();
      return;
    }
    const bars = d.length || 0;
    const ok = audio.record(i, { startBeat: start, bars, free: bars === 0 && !busy });
    if (!ok) return;
    rt.recStart = start;
    rt.recEnd = bars ? start + bars * BEATS_PER_BAR : null;
    rt.freeSince = bars === 0 && !busy ? performance.now() : null;
    rt.phase = 'armed';
    return;
  }
  const t = track(i);
  if (!t.instrument) musicStudio.updateLoopTrack(i, { instrument: get(musicStudio).instrument });
  rt.freeSince = null;
  if (d.length === 0 && !busy) {
    // Nothing plays and the length is free: start now; the loop sets the tempo.
    rt.recStart = beat;
    rt.recEnd = null;
    rt.freeSince = performance.now();
    rt.phase = 'record';
  } else {
    rt.recStart = start;
    rt.recEnd = d.length ? start + d.length * BEATS_PER_BAR : null;
    rt.phase = 'armed';
  }
  rt.clickBeat = Math.ceil(beat);
}

function closeRecord(i: number, beat: number): void {
  const rt = rts[i];
  if (isAudio(i)) {
    const end = host!.audioTracks()?.closeRecording(i);
    if (end !== undefined && end !== null) rt.recEnd = end;
    return;
  }
  if (rt.freeSince !== null) {
    finishFree(i, beat);
    return;
  }
  const close = rt.recEnd === null ? freeRecordEnd(rt.recStart, beat) : Math.min(rt.recEnd, Math.max(rt.recStart + BEATS_PER_BAR, nextBarAt(beat)));
  rt.recEnd = Math.min(close, rt.recStart + MAX_MIDI_LOOP_BARS * BEATS_PER_BAR);
}

/** A free first loop with nothing else playing: its length sets the tempo, and now is its downbeat. */
function finishFree(i: number, beat: number): void {
  const rt = rts[i];
  const t = track(i);
  const seconds = (performance.now() - (rt.freeSince ?? performance.now())) / 1000;
  const recordedBeats = beat - rt.recStart;
  rt.freeSince = null;
  const tempo = inferTempo(seconds);
  if (!tempo || recordedBeats < MIN_FREE_BEATS) {
    rt.phase = hasContent(i) ? 'stopped' : 'empty';
    loopNotice('Too short');
    return;
  }
  const beats = tempo.bars * BEATS_PER_BAR;
  const scale = beats / recordedBeats;
  const from = rt.recStart;
  // The notes, read in the new tempo's beats from the loop's start.
  const played: PlayedNote[] = host!.played()
    .filter((n) => n.beat >= from - 0.125 && n.beat < beat)
    .map((n) => ({ ...n, beat: (n.beat - from) * scale, end: n.end === null ? null : (n.end - from) * scale }));
  const layer = notesForLayer(played, t.instrument ?? get(musicStudio).instrument, 0, beats, 0, beats, quantizeBeats(get(musicStudio).quantize));
  audioStore.setManualBPM(tempo.bpm);
  // Now is the downbeat: the loop just ended its first pass.
  const synced = resyncLaunchClock();
  const now = clockNow().beat;
  const origin = synced ? now - beats : nextBarAt(now);
  commitFirstLayer(i, layer, beats, origin, synced ? now : origin);
}

function commitFirstLayer(i: number, layer: MidiLayer, beats: number, origin: number, playFrom: number): void {
  const rt = rts[i];
  if (!layer.length) {
    rt.phase = hasContent(i) ? 'stopped' : 'empty';
    loopNotice('Nothing was played');
    return;
  }
  const t = track(i);
  const name = t.name || uniqueName(`${INSTRUMENT_LABELS[t.instrument ?? 'synth']}`, data().tracks.filter((_, j) => j !== i).map((x) => x.name));
  musicStudio.updateLoopTrack(i, { layers: [layer], beats, name, savedId: undefined });
  rt.redo = [];
  rt.cleared = null;
  rt.origin = origin;
  rt.scheduledBeat = playFrom;
  rt.stopAt = null;
  rt.playAt = null;
  rt.phase = phaseAfterRecord(t.afterRecord);
  if (rt.phase === 'overdub') {
    rt.dubFrom = playFrom;
    rt.dubTo = null;
  }
}

function startTrack(i: number): void {
  const rt = rts[i];
  const { beat } = clockNow();
  if (isAudio(i)) {
    host!.audioTracks()?.play(i);
    rt.phase = 'play';
    return;
  }
  const busy = host!.clockBusy() || rts.some((r, j) => j !== i && (r.phase === 'play' || r.phase === 'overdub'));
  const at = busy ? punchAt(beat) : beat;
  rt.origin = busy ? at : beat;
  rt.scheduledBeat = at;
  rt.stopAt = null;
  rt.playAt = null;
  rt.phase = 'play';
}

/** Stop a track on the next bar (now when `now`). */
export function stopLoopTrack(i: number, now = false): void {
  if (!host) return;
  const rt = rts[i];
  const phase = phaseOf(i);
  if (phase === 'armed' || phase === 'record') {
    if (isAudio(i)) host.audioTracks()?.cancel(i);
    rt.phase = hasContent(i) ? 'stopped' : 'empty';
  } else if (phase === 'play' || phase === 'overdub') {
    if (isAudio(i)) {
      host.audioTracks()?.stop(i, data().fadeBars, now);
      rt.phase = 'stopped';
    } else {
      if (phase === 'overdub') rt.dubTo = Math.max(rt.dubFrom, punchAt(clockNow().beat));
      rt.stopAt = now ? clockNow().beat : punchAt(clockNow().beat);
      if (now) endTrack(i, rt.stopAt);
    }
  }
  publish();
}

export function startLoopTrack(i: number): void {
  if (!host || phaseOf(i) !== 'stopped') return;
  host.now();
  startTrack(i);
  publish();
  host.wake();
}

export function stopAllLoopTracks(now = false): void {
  for (let i = 0; i < LOOP_TRACK_COUNT; i++) stopLoopTrack(i, now);
}

export function startAllLoopTracks(): void {
  for (let i = 0; i < LOOP_TRACK_COUNT; i++) if (phaseOf(i) === 'stopped') startLoopTrack(i);
}

/** Play exactly these tracks (a section): the others stop on the bar. */
export function playLoopSection(tracks: readonly number[]): void {
  for (let i = 0; i < LOOP_TRACK_COUNT; i++) {
    const want = tracks.includes(i);
    const p = phaseOf(i);
    if (want && p === 'stopped') startLoopTrack(i);
    else if (!want && (p === 'play' || p === 'overdub')) stopLoopTrack(i);
  }
}

export function toggleLoopMute(i: number): void {
  const muted = !track(i).muted;
  musicStudio.updateLoopTrack(i, { muted });
  if (isAudio(i)) host?.audioTracks()?.setLevel(i, muted ? 0 : track(i).level);
  else if (muted) cutPending(i, clockNow().beat);
}

export function setLoopLevel(i: number, level: number): void {
  const v = Math.max(0, Math.min(1, level));
  musicStudio.updateLoopTrack(i, { level: v });
  if (isAudio(i) && !track(i).muted) host?.audioTracks()?.setLevel(i, v);
}

/** Undo the last layer. Undoing the first layer empties the track. */
export function undoLoopLayer(i: number): boolean {
  const rt = rts[i];
  if (isAudio(i)) {
    const ok = host?.audioTracks()?.undo(i) ?? false;
    if (ok && !hasContent(i)) rt.phase = 'empty';
    publish();
    return ok;
  }
  if (rt.cleared && !track(i).layers.length) {
    musicStudio.updateLoopTrack(i, { layers: rt.cleared.layers, beats: rt.cleared.beats });
    rt.cleared = null;
    rt.phase = 'stopped';
    publish();
    return true;
  }
  const stack = stackOf(i);
  if (!stack.layers.length) return false;
  const next = undoLayer(stack);
  rt.redo = next.redo;
  musicStudio.updateLoopTrack(i, { layers: next.layers, ...(next.layers.length ? {} : { beats: track(i).beats }) });
  cutPending(i, clockNow().beat);
  if (!next.layers.length) rt.phase = 'empty';
  publish();
  return true;
}

export function redoLoopLayer(i: number): boolean {
  const rt = rts[i];
  if (isAudio(i)) {
    const ok = host?.audioTracks()?.redo(i) ?? false;
    if (ok && rt.phase === 'empty') rt.phase = 'stopped';
    publish();
    return ok;
  }
  if (!rt.redo.length || !(track(i).beats > 0)) return false;
  const next = redoLayer(stackOf(i));
  rt.redo = next.redo;
  musicStudio.updateLoopTrack(i, { layers: next.layers });
  if (rt.phase === 'empty') rt.phase = 'stopped';
  publish();
  return true;
}

/** Empty a track (one undo brings it back). */
export function clearLoopTrack(i: number): void {
  const rt = rts[i];
  stopLoopTrack(i, true);
  if (isAudio(i)) {
    host?.audioTracks()?.clear(i);
  } else {
    const t = track(i);
    rt.cleared = t.layers.length ? { layers: t.layers, beats: t.beats } : null;
    musicStudio.updateLoopTrack(i, { layers: [], name: '', savedId: undefined });
  }
  rt.redo = [];
  rt.phase = 'empty';
  publish();
}

/** Put notes on a MIDI track from outside (the library or the quick editor): replaces its layers with one. */
export function loadMidiIntoTrack(i: number, loop: { name: string; beats: number; notes: RecordedNote[]; instrument: InstrumentId | null; tone?: string; savedId?: string }, play = true): void {
  if (!host) return;
  const rt = rts[i];
  stopLoopTrack(i, true);
  musicStudio.updateLoopTrack(i, {
    kind: 'midi',
    name: loop.name,
    beats: loop.beats,
    layers: [loop.notes.map((n) => ({ ...n }))],
    instrument: loop.instrument ?? get(musicStudio).instrument,
    tone: loop.tone,
    savedId: loop.savedId,
  });
  rt.redo = [];
  rt.cleared = null;
  rt.phase = 'stopped';
  if (play) startLoopTrack(i);
  publish();
}

/** Replace a MIDI track's layers (the quick editor's edits). */
export function setTrackLayers(i: number, layers: MidiLayer[], beats = track(i).beats): void {
  musicStudio.updateLoopTrack(i, { layers, beats });
  cutPending(i, clockNow().beat);
  // Notes already scheduled ahead play as they were; the next window reads the edit.
  publish();
}

/** The first track with nothing on it, of a kind (or any), or -1. */
export function firstEmptyTrack(kind?: 'midi' | 'audio'): number {
  for (let i = 0; i < LOOP_TRACK_COUNT; i++) {
    if (phaseOf(i) === 'empty' && (!kind || track(i).kind === kind)) return i;
  }
  return -1;
}

/** Kill: recordings and layers not finished are dropped; what is kept stops. */
export function killLoopStation(): void {
  for (let i = 0; i < LOOP_TRACK_COUNT; i++) {
    const rt = rts[i];
    if (rt.phase === 'armed' || rt.phase === 'record') rt.phase = hasContent(i) ? 'stopped' : 'empty';
    if (rt.phase === 'overdub') rt.phase = 'play';
    if (rt.phase === 'play') {
      endTrack(i, clockNow().beat);
      rt.phase = 'stopped';
    }
  }
  host?.audioTracks()?.kill();
  publish();
}

/** A project was loaded: tracks start again from what it holds. */
export function resetLoopStation(): void {
  for (let i = 0; i < LOOP_TRACK_COUNT; i++) {
    const rt = rts[i];
    if (rt.phase === 'play' || rt.phase === 'overdub') endTrack(i, clockNow().beat);
    rts[i] = freshRt();
  }
  host?.audioTracks()?.clearAll();
  publish();
}

// ── Scheduling ──

function endTrack(i: number, at: number): void {
  cutPending(i, at);
  const rt = rts[i];
  rt.stopAt = null;
  rt.phase = 'stopped';
}

function cutPending(i: number, at: number): void {
  const rt = rts[i];
  const time = host?.now() ?? 0;
  for (const p of rt.pendingOffs) if (p.offBeat > at) host?.send(withTone(noteOff(p.instrument, p.note, 'sequencer', time), p.tone));
  rt.pendingOffs = [];
}

const withTone = (event: NoteEvent, tone?: string): NoteEvent => (tone ? { ...event, tone } : event);

/** Called from the runtime's scheduler tick. */
export function scheduleStation(lookaheadSeconds: number): void {
  if (!host) return;
  const now = host.now();
  const { beat, beatMs } = clockNow();
  const horizon = beat + (lookaheadSeconds * 1000) / beatMs;
  const timeAt = (b: number) => Math.max(now, now + ((b - beat) * beatMs) / 1000);
  let changed = false;
  for (let i = 0; i < LOOP_TRACK_COUNT; i++) {
    if (isAudio(i)) {
      changed = syncAudioPhase(i) || changed;
      continue;
    }
    changed = stepMidi(i, beat, horizon, timeAt) || changed;
  }
  scheduleClicks(beat, horizon, timeAt);
  if (changed) publish();
}

function stepMidi(i: number, beat: number, horizon: number, timeAt: (b: number) => number): boolean {
  const rt = rts[i];
  let changed = false;
  if (rt.phase === 'armed' && beat >= rt.recStart) {
    rt.phase = 'record';
    changed = true;
  }
  if (rt.phase === 'record' && rt.recEnd !== null && beat >= rt.recEnd - 0.02) {
    const t = track(i);
    const beats = rt.recEnd - rt.recStart;
    const layer = notesForLayer(host!.played(), t.instrument ?? get(musicStudio).instrument, rt.recStart, rt.recEnd, rt.recStart, beats, quantizeBeats(get(musicStudio).quantize));
    commitFirstLayer(i, layer, beats, rt.recStart, rt.recEnd);
    changed = true;
  }
  if (rt.phase === 'record' && rt.recEnd === null && beat - rt.recStart >= MAX_MIDI_LOOP_BARS * BEATS_PER_BAR) {
    closeRecord(i, beat);
  }
  if (rt.phase === 'overdub') changed = stepOverdub(i, beat) || changed;
  if ((rt.phase === 'play' || rt.phase === 'overdub') && track(i).beats > 0) {
    schedulePlay(i, beat, horizon, timeAt);
    if (rt.stopAt !== null && beat >= rt.stopAt) {
      endTrack(i, rt.stopAt);
      changed = true;
    }
  }
  return changed;
}

/** Overdub: each pass (or the part of it between punch in and out) that adds notes becomes a layer. */
function stepOverdub(i: number, beat: number): boolean {
  const rt = rts[i];
  const t = track(i);
  if (!(t.beats > 0) || beat < rt.dubFrom) return false;
  const end = Math.min(passEnd(rt.origin, t.beats, rt.dubFrom), rt.dubTo ?? Infinity);
  if (beat < end - 0.02) return false;
  const layer = notesForLayer(host!.played(), t.instrument ?? get(musicStudio).instrument, rt.dubFrom, end, rt.origin, t.beats, quantizeBeats(get(musicStudio).quantize));
  if (layer.length) {
    const next = pushLayer(stackOf(i), layer, mergeMidiLayers);
    rt.redo = next.redo;
    musicStudio.updateLoopTrack(i, { layers: next.layers, savedId: undefined });
    // Its notes from the window already scheduled ahead go out now.
    catchUp(i, layer, end);
  }
  rt.dubFrom = end;
  if (rt.dubTo !== null && end >= rt.dubTo) {
    rt.phase = 'play';
    rt.dubTo = null;
  }
  return true;
}

function catchUp(i: number, layer: MidiLayer, from: number): void {
  const rt = rts[i];
  if (rt.scheduledBeat <= from) return;
  const t = track(i);
  const { beat, beatMs } = clockNow();
  const now = host!.now();
  const timeAt = (b: number) => Math.max(now, now + ((b - beat) * beatMs) / 1000);
  for (const n of loopNotesInWindow(layer, rt.origin, t.beats, from, rt.scheduledBeat)) sendNote(i, n, n.at, timeAt);
}

function schedulePlay(i: number, beat: number, horizon: number, timeAt: (b: number) => number): void {
  const rt = rts[i];
  const t = track(i);
  const until = rt.stopAt === null ? horizon : Math.min(horizon, rt.stopAt);
  if (until > rt.scheduledBeat) {
    if (!t.muted) {
      const notes = loopNotesInWindow(flattenMidi({ layers: t.layers, redo: [] }), rt.origin, t.beats, rt.scheduledBeat, until);
      for (const n of notes) sendNote(i, n, n.at, timeAt);
    }
    rt.scheduledBeat = until;
  }
  rt.pendingOffs = rt.pendingOffs.filter((p) => p.offBeat > beat);
}

function sendNote(i: number, n: RecordedNote, at: number, timeAt: (b: number) => number): void {
  const rt = rts[i];
  const t = track(i);
  const instrument = t.instrument ?? 'synth';
  const offBeat = rt.stopAt === null ? at + n.dur : Math.min(at + n.dur, rt.stopAt);
  host!.send(withTone(noteOn(instrument, n.note, n.velocity * (0.25 + 0.75 * t.level), 'sequencer', timeAt(at)), t.tone));
  host!.send(withTone(noteOff(instrument, n.note, 'sequencer', timeAt(offBeat)), t.tone));
  rt.pendingOffs.push({ note: n.note, offBeat, instrument, tone: t.tone });
}

/** Count-in clicks, and a click while recording when nothing else keeps time. */
function scheduleClicks(beat: number, horizon: number, timeAt: (b: number) => number): void {
  const quiet = !host!.clockBusy() && !rts.some((r) => r.phase === 'play' || r.phase === 'overdub');
  for (const rt of rts) {
    if (rt.phase !== 'armed' && !(rt.phase === 'record' && rt.freeSince === null)) continue;
    for (let b = Math.max(rt.clickBeat, Math.ceil(beat - 1e-6)); b < horizon; b++) {
      if (b < rt.recStart || quiet) host!.click(timeAt(b), b % BEATS_PER_BAR === 0);
      rt.clickBeat = b + 1;
    }
  }
}

/** Audio tracks: their recorder says when a take has come back. */
function syncAudioPhase(i: number): boolean {
  const rt = rts[i];
  const audio = host!.audioTracks();
  if (!audio) return false;
  const state = audio.state(i);
  let next = rt.phase;
  if (rt.phase === 'armed' && state === 'record') next = 'record';
  if ((rt.phase === 'armed' || rt.phase === 'record') && (state === 'play' || state === 'overdub')) {
    next = phaseAfterRecord(track(i).afterRecord);
    if (next === 'overdub' && state !== 'overdub') audio.overdub(i, true);
    if (next === 'play' && state === 'overdub') audio.overdub(i, false);
    rt.freeSince = null;
  }
  if ((rt.phase === 'armed' || rt.phase === 'record') && state === 'empty') next = 'empty';
  if (rt.phase === 'overdub' && state === 'play') next = 'play';
  if (next === rt.phase) return false;
  rt.phase = next;
  return true;
}

// ── Saving ──

/** The name a save starts with: "Keys 3 · 4 bars · 120 · A min". */
export function suggestedLoopName(i: number): string {
  const t = track(i);
  const s = get(musicStudio);
  const bars = isAudio(i) ? host?.audioTracks()?.bars(i) ?? 0 : Math.round(t.beats / BEATS_PER_BAR);
  const label = t.name || (isAudio(i) ? `Audio ${i + 1}` : INSTRUMENT_LABELS[t.instrument ?? s.instrument]);
  return autoLoopName(label, Math.max(1, bars), launchClockTempo(), isAudio(i) ? null : s.key);
}

/**
 * Save a track to My loops (it stays on the track). MIDI goes in as notes
 * and is also kept in the session as a clip; audio as a WAV. Returns the id.
 */
export async function saveLoopTrack(i: number, name = suggestedLoopName(i)): Promise<string | null> {
  const t = track(i);
  const s = get(musicStudio);
  if (isAudio(i)) {
    const audio = host?.audioTracks();
    const wav = audio?.wav(i) ?? null;
    if (!audio || !wav) return null;
    const id = await saveUserLoop({ kind: 'audio', name, bars: audio.bars(i), beats: audio.bars(i) * BEATS_PER_BAR, bpm: audio.bpm(i), key: null, instrument: null, notes: [], createdAt: Date.now() }, wav);
    musicStudio.updateLoopTrack(i, { savedId: id, name: t.name || name });
    publish();
    return id;
  }
  if (!t.layers.length || !(t.beats > 0)) return null;
  const notes = flattenMidi({ layers: t.layers, redo: [] }).map(({ layer: _layer, ...n }) => n);
  const instrument = t.instrument ?? s.instrument;
  const id = await saveUserLoop({
    kind: 'midi',
    name,
    bars: Math.max(1, Math.round(t.beats / BEATS_PER_BAR)),
    beats: t.beats,
    bpm: launchClockTempo(),
    key: { ...s.key },
    instrument,
    ...(t.tone ? { tone: t.tone } : {}),
    notes,
    createdAt: Date.now(),
  });
  const loop: RecordedLoop = { kind: 'recorded', id: generateUUID(), name, role: roleForRecording(instrument, notes), instrument, beats: t.beats, notes, createdAt: Date.now() };
  musicStudio.addSessionClip(loop.role, clipFromRecording(loop));
  musicStudio.updateLoopTrack(i, { savedId: id, name: t.name || name.split(' · ')[0] });
  publish();
  return id;
}

/** Put a My loops loop on a track (the selected one when it fits, else the first empty one of its kind) and play it. */
export async function loadUserLoopToTrack(id: string, target?: number): Promise<number> {
  const loop = await readUserLoop(id);
  if (!loop) return -1;
  const kind = loop.kind;
  let i = target ?? selectedLoopTrack();
  if (track(i)?.kind !== kind || phaseOf(i) !== 'empty') i = firstEmptyTrack(kind);
  if (i < 0) {
    loopNotice('No empty loop track');
    return -1;
  }
  if (kind === 'audio') {
    const audio = host?.audioTracks();
    if (!audio || !loop.wav || !(await audio.load(i, loop.wav, loop.bars))) return -1;
    musicStudio.updateLoopTrack(i, { name: loop.name, savedId: loop.id });
    rts[i].phase = 'stopped';
    startLoopTrack(i);
    return i;
  }
  const instrument = INSTRUMENTS.includes(loop.instrument as InstrumentId) ? (loop.instrument as InstrumentId) : null;
  loadMidiIntoTrack(i, { name: loop.name, beats: loop.beats, notes: loop.notes, instrument, tone: loop.tone, savedId: loop.id });
  selectLoopTrack(i);
  return i;
}

/** Put a MIDI loop from My loops into the session grid, in its part's first empty slot. */
export async function insertUserLoopInSession(id: string): Promise<boolean> {
  const loop = await readUserLoop(id);
  if (!loop || loop.kind !== 'midi') return false;
  const instrument = INSTRUMENTS.includes(loop.instrument as InstrumentId) ? (loop.instrument as InstrumentId) : get(musicStudio).instrument;
  const rec: RecordedLoop = { kind: 'recorded', id: generateUUID(), name: loop.name, role: roleForRecording(instrument, loop.notes), instrument, beats: Math.min(loop.beats, MAX_LOOP_BARS * BEATS_PER_BAR), notes: loop.notes.filter((n) => n.beat < MAX_LOOP_BARS * BEATS_PER_BAR), createdAt: Date.now() };
  musicStudio.addSessionClip(rec.role, { ...clipFromRecording(rec), ...(loop.tone ? { tone: loop.tone } : {}) });
  return true;
}

function loopNotice(message: string): void {
  noticeListener?.(message);
}

let noticeListener: ((message: string) => void) | null = null;
/** Where the station's short notices ("Too short") go. */
export function onLoopNotice(listener: ((message: string) => void) | null): void {
  noticeListener = listener;
}

// ── Publishing ──

export function publish(): void {
  const audio = host?.audioTracks() ?? null;
  const tracks = rts.map((rt, i): TrackView => {
    const phase = phaseOf(i);
    const t = track(i);
    if (t.kind === 'audio') {
      const info = audio?.info(i);
      return {
        phase,
        startBeat: rt.recStart,
        endBeat: rt.recEnd,
        origin: info?.originBeat ?? 0,
        beats: (info?.bars ?? 0) * BEATS_PER_BAR,
        layers: info?.layers ?? 0,
        redo: info?.redo ?? 0,
        pending: null,
        setsTempo: rt.freeSince !== null,
        noInput: audio ? !audio.canRecord(i) : true,
      };
    }
    return {
      phase,
      startBeat: rt.recStart,
      endBeat: rt.recEnd,
      origin: rt.origin,
      beats: t.beats,
      layers: t.layers.length,
      redo: rt.redo.length,
      pending: rt.stopAt !== null ? 'stop' : rt.playAt !== null ? 'play' : null,
      setsTempo: rt.freeSince !== null,
      noInput: false,
    };
  });
  loopStationView.update((v) => {
    const same = v.tracks.length === tracks.length && v.tracks.every((x, i) => JSON.stringify(x) === JSON.stringify(tracks[i]));
    return same ? v : { ...v, tracks };
  });
}

/** For tests: the runtime state of a track. */
export function _trackRuntime(i: number): Readonly<Rt> {
  return rts[i];
}

/** For tests: forget everything. */
export function _resetStationForTests(): void {
  for (let i = 0; i < LOOP_TRACK_COUNT; i++) rts[i] = freshRt();
  host = null;
}

export { emptyStack };
