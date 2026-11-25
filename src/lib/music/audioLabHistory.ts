/**
 * Audio Lab's undo and redo: one history for the studio's edits, on
 * Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z and Ctrl+Y while Audio Lab is where you work.
 *
 * What it covers: the effect chains (inserts on every channel, pad, clip and
 * loop track, and the macro knobs' effects: add, remove, reorder, bypass,
 * every knob), the drum machine's beat (rows, steps, kits, parts), the step
 * pattern, the session's clips and their notes (the clip editor), the acid
 * line's steps, the Live clips' visuals, and the looper: a MIDI track's notes
 * (record, overdub, the quick editor's draw and erase, quantise, halve and
 * double, Clear, rename), an audio track's takes and overdub passes, its
 * Undo, Redo and Clear.
 *
 * How: the studio's state is changed only by replacing parts, never in
 * place, so a step keeps the parts as they were before and after (no copies)
 * and putting them back goes through the same store the panels write to:
 * the audio follows as it follows any edit, without a gap. An audio take is
 * kept by the looper (its own undo, within its memory budget); a step there
 * asks it to take the layer off or put it back, and does nothing when the
 * track has moved on since.
 *
 * Edits made during one press (a knob turned, a fader drawn, a note dragged)
 * are one step, as are edits in the same moment (a pattern and the beat clip
 * it mirrors). Calling up a song or scene, a studio cell or a controller
 * move is playing the show, not editing (historyGate.ts, runAsLiveControl):
 * no step, and the parts it changed come out of the history so no later undo
 * walks them back. Loading a project starts the history afresh.
 *
 * Outside it: the mixer, volumes, the knobs of the sets, the songs and set
 * lists, the takes list, the scenes, settings like the key and tempo.
 */

import { get, writable, type Readable } from 'svelte/store';
import { musicStudio, onMusicHydrate, type HistoryParts, type MusicStudioState } from './musicStudioStore';
import type { MacroFxInstance } from './macroFx';
import {
  audioLoopLayerCount,
  clearLoopTrack,
  onAudioLoopStep,
  redoLoopLayer,
  restoreLoopNotes,
  undoLoopLayer,
  type AudioLoopStep,
  type LoopNotes,
} from './loopStation';
import { historyQuiet } from './historyGate';
import { isLiveControl } from '../stores/historyHooks';
import { isTextEntryTarget, undoShortcut, type UndoKeyEvent } from '../utils/undoShortcut';

/** Steps kept. */
export const MAX_AUDIO_LAB_STEPS = 100;
/** Wheel turns this close together are one step. */
const WHEEL_GAP_MS = 400;

type Parts = Map<string, unknown>;

interface Step {
  before: Parts;
  after: Parts;
  audio: AudioLoopStep[];
}

const undoStack: Step[] = [];
const redoStack: Step[] = [];
let baseline: Parts = new Map();
let open: Step | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let pointerDown = false;
let lastWheel = 0;
let applying = false;
let started = false;

const counts = writable({ undo: 0, redo: 0 });
/** How many steps can be undone and redone. */
export const audioLabHistory: Readable<{ undo: number; redo: number }> = { subscribe: counts.subscribe };
const publishCounts = () => counts.set({ undo: undoStack.length + (open ? 1 : 0), redo: redoStack.length });

function loopNotes(s: MusicStudioState, i: number): LoopNotes | undefined {
  const t = s.loopStation.tracks[i];
  return t && t.kind === 'midi' ? { layers: t.layers, beats: t.beats, xy: t.xy, name: t.name } : undefined;
}

/** The parts the history keeps, by key. */
function partsOf(s: MusicStudioState): Parts {
  const out: Parts = new Map<string, unknown>([
    ['machine', s.machine],
    ['pattern', s.pattern],
    ['session', s.session],
    ['acidSteps', s.acidSteps],
    ['liveStacks', s.liveStacks],
  ]);
  for (const [ch, chain] of Object.entries(s.inserts)) out.set(`inserts:${ch}`, chain);
  for (const [id, chain] of Object.entries(s.macroFx)) out.set(`macroFx:${id}`, chain);
  s.loopStation.tracks.forEach((_, i) => {
    const n = loopNotes(s, i);
    if (n) out.set(`loop:${i}`, n);
  });
  return out;
}

function same(key: string, a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!key.startsWith('loop:') || !a || !b) return false;
  const x = a as LoopNotes;
  const y = b as LoopNotes;
  return x.layers === y.layers && x.beats === y.beats && x.xy === y.xy && x.name === y.name;
}

function changedKeys(a: Parts, b: Parts): string[] {
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys].filter((k) => !same(k, a.get(k), b.get(k)));
}

/** Take `keys` out of every step (they were changed outside the history). */
function forget(keys: string[]): void {
  const strip = (list: Step[]) => {
    for (let k = list.length - 1; k >= 0; k--) {
      for (const key of keys) {
        list[k].before.delete(key);
        list[k].after.delete(key);
      }
      if (!list[k].before.size && !list[k].audio.length) list.splice(k, 1);
    }
  };
  strip(undoStack);
  strip(redoStack);
  if (open) for (const key of keys) { open.before.delete(key); open.after.delete(key); }
}

function scheduleClose(): void {
  if (pointerDown) return;
  if (closeTimer) clearTimeout(closeTimer);
  const wheel = Date.now() - lastWheel < WHEEL_GAP_MS;
  closeTimer = setTimeout(closeStep, wheel ? WHEEL_GAP_MS : 0);
}

function openStep(): Step {
  if (!open) {
    open = { before: new Map(), after: new Map(), audio: [] };
    redoStack.length = 0;
  }
  scheduleClose();
  return open;
}

/** End the step being made: the next edit is a step of its own. */
export function closeStep(): void {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
  const step = open;
  open = null;
  if (step) {
    // An edit taken back within the press is no change.
    for (const key of [...step.before.keys()]) if (same(key, step.before.get(key), step.after.get(key))) { step.before.delete(key); step.after.delete(key); }
    if (step.before.size || step.audio.length) {
      undoStack.push(step);
      while (undoStack.length > MAX_AUDIO_LAB_STEPS) undoStack.shift();
    }
  }
  publishCounts();
}

function onStudio(s: MusicStudioState): void {
  const now = partsOf(s);
  const keys = changedKeys(baseline, now);
  const was = baseline;
  baseline = now;
  if (!keys.length || applying) return;
  if (historyQuiet() || isLiveControl()) {
    forget(keys);
    publishCounts();
    return;
  }
  // A loop track turned audio or MIDI: its notes start over outside the history.
  const kindChanged = keys.filter((k) => k.startsWith('loop:') && (!was.has(k) || !now.has(k)));
  if (kindChanged.length) forget(kindChanged);
  const edits = keys.filter((k) => !kindChanged.includes(k));
  if (!edits.length) return;
  const step = openStep();
  for (const key of edits) {
    if (!step.before.has(key)) step.before.set(key, was.get(key));
    step.after.set(key, now.get(key));
  }
  publishCounts();
}

function onAudioStep(step: AudioLoopStep): void {
  if (applying) return;
  openStep().audio.push(step);
  publishCounts();
}

/** Put `parts` back through the store, and walk the audio steps. */
function apply(parts: Parts, audio: AudioLoopStep[], dir: 'undo' | 'redo'): void {
  applying = true;
  try {
    const patch: HistoryParts = {};
    const inserts: Record<string, MacroFxInstance[] | undefined> = {};
    const macroFx: Record<string, MacroFxInstance[] | undefined> = {};
    const loops: Array<[number, LoopNotes]> = [];
    for (const [key, value] of parts) {
      if (key.startsWith('inserts:')) inserts[key.slice(8)] = value as MacroFxInstance[] | undefined;
      else if (key.startsWith('macroFx:')) macroFx[key.slice(8)] = value as MacroFxInstance[] | undefined;
      else if (key.startsWith('loop:')) { if (value) loops.push([Number(key.slice(5)), value as LoopNotes]); }
      else (patch as Record<string, unknown>)[key] = value;
    }
    if (Object.keys(inserts).length) patch.inserts = inserts;
    if (Object.keys(macroFx).length) patch.macroFx = macroFx;
    if (Object.keys(patch).length) musicStudio.restoreParts(patch);
    for (const [i, notes] of loops) restoreLoopNotes(i, notes);
    const steps = dir === 'undo' ? [...audio].reverse() : audio;
    for (const a of steps) applyAudio(a, dir);
  } finally {
    baseline = partsOf(get(musicStudio));
    // What the studio does in answer to the restore (the full editor
    // following its clip) is part of it, not a new step.
    setTimeout(() => {
      baseline = partsOf(get(musicStudio));
      applying = false;
    }, 0);
  }
}

function applyAudio(a: AudioLoopStep, dir: 'undo' | 'redo'): void {
  const from = dir === 'undo' ? a.after : a.before;
  // The track moved on since (a new take, memory folding layers): leave it.
  if (audioLoopLayerCount(a.track) !== from) return;
  const forward = { layer: redoLoopLayer, undo: undoLoopLayer, redo: redoLoopLayer, clear: (i: number) => { clearLoopTrack(i); return true; } };
  const back = { layer: undoLoopLayer, undo: redoLoopLayer, redo: undoLoopLayer, clear: undoLoopLayer };
  (dir === 'undo' ? back : forward)[a.cause](a.track);
}

/** Undo the last Audio Lab edit. False when there is none. */
export function undoAudioLab(): boolean {
  closeStep();
  const step = undoStack.pop();
  if (!step) return false;
  apply(step.before, step.audio, 'undo');
  redoStack.push(step);
  publishCounts();
  return true;
}

/** Redo the last undone edit. False when there is none. */
export function redoAudioLab(): boolean {
  closeStep();
  const step = redoStack.pop();
  if (!step) return false;
  apply(step.after, step.audio, 'redo');
  undoStack.push(step);
  publishCounts();
  return true;
}

/** Forget every step (a project loaded or a new one). */
export function clearAudioLabHistory(): void {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
  open = null;
  undoStack.length = 0;
  redoStack.length = 0;
  baseline = partsOf(get(musicStudio));
  publishCounts();
}

/** Start keeping the history. Safe to call again. */
export function startAudioLabHistory(): void {
  if (started) return;
  started = true;
  baseline = partsOf(get(musicStudio));
  musicStudio.subscribe(onStudio);
  onAudioLoopStep(onAudioStep);
  onMusicHydrate(clearAudioLabHistory);
}

/** For tests: the step being made ends now, and restores settle at once. */
export function _settleAudioLabHistoryForTests(): void {
  closeStep();
  applying = false;
  baseline = partsOf(get(musicStudio));
}

// ── The keys ──

/** Where Audio Lab's own panels and editors are. */
const AUDIO_LAB = '.studio-tokens, [data-audio-lab]';

/**
 * The undo keys are Audio Lab's: the full-screen Studio is up, or the last
 * press was in its tray or one of its editors. Never in a text field.
 */
export function audioLabOwnsUndo(e: UndoKeyEvent & { target?: EventTarget | null }, pressedInLab: boolean, studioShowing = false): 'undo' | 'redo' | null {
  const which = undoShortcut(e);
  if (!which || isTextEntryTarget(e.target)) return null;
  const s = get(musicStudio);
  if (!s.isOpen) return null;
  if (!((s.studioView && studioShowing) || pressedInLab)) return null;
  return which;
}

let keysInstalled = false;
/**
 * Listen for the undo keys and the presses that make steps. Installed once,
 * with Audio Lab (it never stands in the way of the app's own undo while
 * another part of the app is being worked on).
 */
export function installAudioLabUndoKeys(): void {
  startAudioLabHistory();
  if (keysInstalled || typeof window === 'undefined') return;
  keysInstalled = true;
  let pressedInLab = false;
  window.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement | null;
    pressedInLab = !!t?.closest?.(AUDIO_LAB);
    // A press already under way ends the step before (a new press is a new step).
    if (!pointerDown) closeStep();
    pointerDown = true;
  }, true);
  const up = () => {
    if (!pointerDown) return;
    pointerDown = false;
    // The click that follows the release is part of the same press.
    if (open) scheduleClose();
  };
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  window.addEventListener('wheel', () => { lastWheel = Date.now(); }, { capture: true, passive: true });
  window.addEventListener('keydown', (e) => {
    // The full-screen Studio is on screen (it shows over the VJ deck only).
    const which = audioLabOwnsUndo(e, pressedInLab, !!document.querySelector('.studio-view'));
    if (!which) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (which === 'undo') undoAudioLab();
    else redoAudioLab();
  }, true);
}
