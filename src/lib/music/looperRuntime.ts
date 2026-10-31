/**
 * The band looper as the studio plays it: the record, play and chop actions
 * the Looper panel and a MIDI controller use, what the panel shows, and the
 * chops put on (and taken off) the FX pads.
 *
 * The studio's runtime attaches its audio engine (attachLooper), which also
 * registers the looper's studio controls, so they answer a MIDI controller
 * while the Studio view is hidden. Loops and chops are this session's
 * audio: the kill switch stops them, and closing the studio lets them go
 * and puts the pads back.
 */

import { get, writable } from 'svelte/store';
import type { MusicAudioEngine } from './audioEngine';
import { LOOP_SLOT_IDS, LOOP_SLOT_NAMES, type BandLooper, type LoopSlotId, type LoopSlotState } from './bandLooper';
import { MAX_RECORD_SECONDS, countInBeats, longestLength, recordProgress, type LoopLength } from './looperMath';
import { launchClockPosition } from '../stores/launchClock';
import { musicStudio } from './musicStudioStore';
import type { FxPads } from './soundSlots';
import { clearChops, forgetPadsBefore, isChopId, rememberPadsBefore, setChops, stopChops, unchoppedPads } from './sounds/chops';
import { registerStudioControls } from './studioControls';
import type { StudioSet } from './studioSets';

export interface LooperSlotView {
  bars: number;
  state: LoopSlotState;
  level: number;
  /** Playing at its own length: the tempo has moved too far since it was recorded. */
  ownLength: boolean;
}

export interface LooperView {
  /** Bars the next recording takes. */
  length: LoopLength;
  /** The loop Record records into and Chop slices. */
  slot: LoopSlotId;
  /** arming: the recorder is getting ready; count: waiting for the bar line; rec: recording. */
  phase: 'off' | 'arming' | 'count' | 'rec';
  recordingSlot: LoopSlotId | null;
  /** Bars being recorded, the bar it is in (from 1), and how far through it is, 0-1. */
  bars: number;
  bar: number;
  progress: number;
  /** Whole beats to go while counting in. */
  countIn: number;
  slots: LooperSlotView[];
  /** About the last recording (it was cut to fit). */
  note: string | null;
  error: string | null;
}

const DEFAULT_LEVEL = 0.8;

let engine: MusicAudioEngine | null = null;
let current: BandLooper | null = null;
let controlsRegistered = false;
/** The press being got ready (0: none): a press, cancel or kill meanwhile drops it. */
let arming = 0;
let serial = 0;
let progressTimer: ReturnType<typeof setInterval> | null = null;
let length: LoopLength = 2;
let selected: LoopSlotId = 0;
const levels = LOOP_SLOT_IDS.map(() => DEFAULT_LEVEL);
let note: string | null = null;
let error: string | null = null;

export const looperState = writable<LooperView>(view());

function view(): LooperView {
  const l = current;
  const rec = l?.recording ?? null;
  const now = l?.now() ?? 0;
  let phase: LooperView['phase'] = arming ? 'arming' : 'off';
  let bar = 0;
  let progress = 0;
  let countIn = 0;
  if (rec) {
    if (now < rec.window.startTime) {
      phase = 'count';
      countIn = countInBeats(rec.window, now, launchClockPosition().beatMs);
    } else {
      phase = 'rec';
      ({ progress, bar } = recordProgress(rec.window, now));
    }
  }
  return {
    length,
    slot: selected,
    phase,
    recordingSlot: rec?.slot ?? (arming ? selected : null),
    bars: rec?.window.bars ?? 0,
    bar,
    // Half a percent is as fine as the bar shows.
    progress: Math.round(progress * 200) / 200,
    countIn,
    slots: LOOP_SLOT_IDS.map((id) => {
      const info = l?.slotInfo(id);
      return { bars: info?.bars ?? 0, state: info?.state ?? 'empty', level: levels[id], ownLength: info?.ownLength ?? false };
    }),
    note,
    error,
  };
}

function publish(): void {
  const next = view();
  if (JSON.stringify(next) !== JSON.stringify(get(looperState))) looperState.set(next);
}

function startProgress(): void {
  if (progressTimer) return;
  progressTimer = setInterval(() => {
    publish();
    if (!current?.recording && !arming) stopProgress();
  }, 50);
}

function stopProgress(): void {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = null;
}

/** The engine's looper (creating the audio graph if need be), wired to the clock and the panel. */
function looper(): BandLooper | null {
  if (!engine) return null;
  const l = engine.bandLooper();
  if (l !== current) {
    current = l;
    l.setClock(() => launchClockPosition());
    l.onChange = publish;
    for (const id of LOOP_SLOT_IDS) l.setLevel(id, levels[id]);
  }
  return l;
}

/** Called once by the studio's runtime with its audio engine. */
export function attachLooper(audio: MusicAudioEngine): void {
  engine = audio;
  if (controlsRegistered) return;
  controlsRegistered = true;
  registerStudioControls([
    { id: 'looper.record', label: 'Looper record', group: 'Looper', kind: 'trigger', run: () => toggleLooperRecord() },
    { id: 'looper.play-a', label: 'Play loop A', group: 'Looper', kind: 'toggle', run: () => toggleLoopPlay(0) },
    { id: 'looper.play-b', label: 'Play loop B', group: 'Looper', kind: 'toggle', run: () => toggleLoopPlay(1) },
    { id: 'looper.chop', label: 'Chop loop to pads', group: 'Looper', kind: 'trigger', run: () => void chopToPads() },
  ]);
}

// ── Recording ──

/**
 * Record: counts in to the next bar line and records the chosen bars of the
 * band into the chosen loop, which then plays on from the bar line where it
 * ends. Pressed while counting in it cancels; while recording, it ends on
 * the next bar line.
 */
export function toggleLooperRecord(): void {
  const rec = current?.recording;
  if (arming || (rec && current!.now() < rec.window.startTime)) {
    cancelLooperRecord();
    return;
  }
  if (rec) {
    current!.endRecordingSoon();
    publish();
    return;
  }
  void armRecord();
}

async function armRecord(): Promise<void> {
  const l = looper();
  if (!l) return;
  const mine = ++serial;
  arming = mine;
  error = null;
  note = null;
  const slot = selected;
  const want = length;
  publish();
  const ready = await l.prepare();
  if (arming !== mine) return;
  arming = 0;
  const window = ready ? l.record(slot, want, (ok) => recorded(ok)) : null;
  if (!window) {
    error = ready && longestLength(launchClockPosition().beatMs) < 1 ? 'The tempo is too slow to record a whole bar.' : 'Recording is not available here.';
    publish();
    return;
  }
  if (window.bars < want) note = `${want} bars would run over ${MAX_RECORD_SECONDS} seconds at this tempo, so this records ${window.bars}.`;
  startProgress();
  publish();
}

function recorded(ok: boolean): void {
  stopProgress();
  if (!ok) error = 'The recording did not come back. Check that the audio is running and try again.';
  publish();
}

export function cancelLooperRecord(): void {
  arming = 0;
  current?.cancelRecording();
  stopProgress();
  publish();
}

export function setLooperLength(bars: LoopLength): void {
  length = bars;
  publish();
}

/** Which loop Record records into and Chop slices. */
export function selectLoopSlot(id: LoopSlotId): void {
  selected = id;
  publish();
}

// ── Playing ──

/** Start a loop on the next bar line, or stop it now. */
export function toggleLoopPlay(id: LoopSlotId): void {
  const l = looper();
  if (!l || l.slotInfo(id).state === 'empty') return;
  l.toggle(id);
  publish();
}

export function setLoopLevel(id: LoopSlotId, level: number): void {
  levels[id] = Math.max(0, Math.min(1, level));
  current?.setLevel(id, levels[id]);
  publish();
}

// ── Chops ──

/**
 * Slice the chosen loop (the other one when it is empty) into eight and put
 * the slices on the current set's FX pads. What the pads held is kept, so
 * Put back pads brings it back. False when there is no loop to chop.
 */
export function chopToPads(): boolean {
  const l = current;
  const order: LoopSlotId[] = selected === 0 ? [0, 1] : [1, 0];
  const id = order.find((i) => l?.buffer(i));
  const buffer = id === undefined ? null : l?.buffer(id);
  if (id === undefined || !buffer) {
    error = 'Record a loop first, then chop it onto the pads.';
    publish();
    return false;
  }
  const ids = setChops(buffer, `loop ${LOOP_SLOT_NAMES[id]}`);
  const s = get(musicStudio);
  const pads = s.fxPads[s.set];
  // Chopping again keeps what the pads held before the first chop.
  rememberPadsBefore(s.set, pads);
  ids.forEach((chop, i) => {
    if (pads[i] !== chop) musicStudio.setFxPad(i, chop);
  });
  error = null;
  publish();
  return true;
}

/** Put back the sounds the current set's FX pads held before they were chopped. */
export function putBackPads(): void {
  const s = get(musicStudio);
  const back = unchoppedPads(s.set, s.fxPads[s.set]);
  back.forEach((sound, i) => {
    if (s.fxPads[s.set][i] !== sound) musicStudio.setFxPad(i, sound);
  });
  forgetPadsBefore(s.set);
}

/** Every set's chopped pads back as they were (the chops are going). */
function putBackAllPads(): void {
  const s = get(musicStudio);
  const fxPads = { ...s.fxPads } as FxPads;
  let changed = false;
  for (const set of Object.keys(fxPads) as StudioSet[]) {
    if (!fxPads[set].some(isChopId)) continue;
    fxPads[set] = unchoppedPads(set, fxPads[set]);
    changed = true;
  }
  forgetPadsBefore();
  if (changed) musicStudio.applySetup({ fxPads });
}

// ── Clean-up ──

/** The kill switch: the recording is dropped, the loops and any sounding chops stop. Loops and chops are kept. */
export function killLooper(): void {
  arming = 0;
  stopProgress();
  current?.kill();
  stopChops();
  publish();
}

/** The studio is closing: the loops, the recorder and the chops go, and the pads are put back. */
export function stopLooper(): void {
  arming = 0;
  stopProgress();
  current?.clear();
  stopChops();
  clearChops();
  putBackAllPads();
  note = null;
  error = null;
  publish();
}
