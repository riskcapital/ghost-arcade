/**
 * The live looper on MIDI controllers, footswitches and the keyboard.
 *
 * MIDI learn (studioControls.ts) gets each track's Button, Stop, Undo, Clear,
 * Mute and level, the same for the selected track, Next and Previous track,
 * Start all and Stop all. Footswitches learn onto Pedal 1–3; the pedal
 * preset says what they do (2-switch: the selected track's button, hold to
 * undo · next track; 3-switch: button · next · stop, hold to undo).
 *
 * The keyboard map is for the looper panel when it has focus.
 */

import { get } from 'svelte/store';
import { registerStudioControls, type StudioControl } from './studioControls';
import { musicStudio } from './musicStudioStore';
import {
  clearLoopTrack,
  loopStationView,
  pressLoopTrack,
  redoLoopLayer,
  saveLoopTrack,
  selectLoopTrack,
  selectedLoopTrack,
  setLoopLevel,
  startAllLoopTracks,
  startLoopTrack,
  stopAllLoopTracks,
  stopLoopTrack,
  toggleLoopMute,
  undoLoopLayer,
  nextLoopSection,
} from './loopStation';
import { LOOP_TRACK_COUNT, trackForProgram, type PedalPreset } from './loopTrack';
import { onProgramChange } from '../midi/programChange';
import { addonUsable } from '../addons/addonAccess';

/** A footswitch held this long undoes instead of pressing. */
export const PEDAL_HOLD_MS = 500;

/** What each pedal does in a preset: [tap, hold]. */
export type PedalAction = 'button' | 'next' | 'stop' | 'undo' | null;

export function pedalActions(preset: PedalPreset, pedal: 1 | 2 | 3): [PedalAction, PedalAction] {
  if (preset === '2-switch') return pedal === 1 ? ['button', 'undo'] : pedal === 2 ? ['next', null] : [null, null];
  if (preset === '3-switch') return pedal === 1 ? ['button', 'undo'] : pedal === 2 ? ['next', null] : ['stop', 'undo'];
  return [null, null];
}

/** Which action a footswitch takes from how long it was held. */
export function pedalResolve(preset: PedalPreset, pedal: 1 | 2 | 3, heldMs: number): PedalAction {
  const [tap, hold] = pedalActions(preset, pedal);
  return heldMs >= PEDAL_HOLD_MS && hold ? hold : tap;
}

function run(action: PedalAction): void {
  const i = selectedLoopTrack();
  if (action === 'button') pressLoopTrack(i);
  else if (action === 'next') selectLoopTrack((i + 1) % LOOP_TRACK_COUNT);
  else if (action === 'stop') stopLoopTrack(i);
  else if (action === 'undo') undoLoopLayer(i);
}

const pedalDown = new Map<number, { at: number; timer: ReturnType<typeof setTimeout> | null; fired: boolean }>();

function pedal(n: 1 | 2 | 3, value: number): void {
  const preset = get(musicStudio).loopStation.pedal;
  if (value > 0) {
    const [, hold] = pedalActions(preset, n);
    const state = { at: performance.now(), timer: null as ReturnType<typeof setTimeout> | null, fired: false };
    // With no hold action the tap fires on the press, for the tightest timing.
    if (!hold) {
      run(pedalResolve(preset, n, 0));
      state.fired = true;
    } else {
      state.timer = setTimeout(() => {
        state.fired = true;
        run(hold);
      }, PEDAL_HOLD_MS);
    }
    pedalDown.set(n, state);
    return;
  }
  const state = pedalDown.get(n);
  pedalDown.delete(n);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  if (!state.fired) run(pedalResolve(preset, n, performance.now() - state.at));
}

function toggleTrackPlay(i: number): void {
  const phase = get(loopStationView).tracks[i]?.phase;
  if (phase === 'play' || phase === 'overdub') stopLoopTrack(i);
  else if (phase === 'stopped') startLoopTrack(i);
}

let learning: ((done: boolean) => void) | null = null;

/** The next Program Change sets the channel and offset: that program selects track 1. */
export function learnProgramSelect(done?: (ok: boolean) => void): void {
  learning = (ok) => done?.(ok);
}

export function cancelProgramLearn(): void {
  learning?.(false);
  learning = null;
}

function onProgram(channel: number, program: number): void {
  // Audio Lab is a paid add-on: locked, a pedal's Program Change does nothing.
  if (!addonUsable('addon.audio-lab')) {
    cancelProgramLearn();
    return;
  }
  if (learning) {
    const done = learning;
    learning = null;
    musicStudio.updateLoopStation((d) => ({ ...d, pc: { on: true, channel, offset: program } }));
    done(true);
    return;
  }
  const i = trackForProgram(get(musicStudio).loopStation.pc, channel, program);
  if (i >= get(musicStudio).loopStation.trackCount) return;
  if (i >= 0) selectLoopTrack(i);
}

let registered = false;

export function registerLoopControls(): void {
  if (registered) return;
  registered = true;
  onProgramChange(onProgram);
  const list: StudioControl[] = [];
  const g = 'Live looper';
  for (let i = 0; i < LOOP_TRACK_COUNT; i++) {
    const n = i + 1;
    list.push(
      { id: `loop.${n}.button`, label: `Loop ${n} button`, group: g, kind: 'trigger', run: () => pressLoopTrack(i) },
      { id: `loop.${n}.stop`, label: `Loop ${n} stop`, group: g, kind: 'trigger', run: () => stopLoopTrack(i) },
      { id: `loop.${n}.undo`, label: `Loop ${n} undo`, group: g, kind: 'trigger', run: () => void undoLoopLayer(i) },
      { id: `loop.${n}.clear`, label: `Loop ${n} clear`, group: g, kind: 'trigger', run: () => clearLoopTrack(i) },
      { id: `loop.${n}.mute`, label: `Loop ${n} mute`, group: g, kind: 'toggle', run: () => toggleLoopMute(i) },
      { id: `loop.${n}.level`, label: `Loop ${n} level`, group: g, kind: 'value', run: (v) => setLoopLevel(i, v) },
    );
  }
  list.push(
    { id: 'loop.sel.button', label: 'Selected loop button', group: g, kind: 'trigger', run: () => pressLoopTrack(selectedLoopTrack()) },
    { id: 'loop.sel.stop', label: 'Selected loop stop', group: g, kind: 'trigger', run: () => stopLoopTrack(selectedLoopTrack()) },
    { id: 'loop.sel.undo', label: 'Selected loop undo', group: g, kind: 'trigger', run: () => void undoLoopLayer(selectedLoopTrack()) },
    { id: 'loop.sel.redo', label: 'Selected loop redo', group: g, kind: 'trigger', run: () => void redoLoopLayer(selectedLoopTrack()) },
    { id: 'loop.sel.clear', label: 'Selected loop clear', group: g, kind: 'trigger', run: () => clearLoopTrack(selectedLoopTrack()) },
    { id: 'loop.sel.mute', label: 'Selected loop mute', group: g, kind: 'toggle', run: () => toggleLoopMute(selectedLoopTrack()) },
    { id: 'loop.next', label: 'Next loop track', group: g, kind: 'trigger', run: () => selectLoopTrack((selectedLoopTrack() + 1) % LOOP_TRACK_COUNT) },
    { id: 'loop.prev', label: 'Previous loop track', group: g, kind: 'trigger', run: () => selectLoopTrack((selectedLoopTrack() + LOOP_TRACK_COUNT - 1) % LOOP_TRACK_COUNT) },
    { id: 'loop.start-all', label: 'Start all loops', group: g, kind: 'trigger', run: () => startAllLoopTracks() },
    { id: 'loop.stop-all', label: 'Stop all loops', group: g, kind: 'trigger', run: () => stopAllLoopTracks() },
    // The old band looper's controls (A and B were its two loops): mappings learned on them drive the loop tracks.
    { id: 'looper.record', label: 'Looper record (selected loop track)', group: g, kind: 'trigger', run: () => pressLoopTrack(selectedLoopTrack()) },
    { id: 'looper.play-a', label: 'Play loop A (loop track 5)', group: g, kind: 'toggle', run: () => toggleTrackPlay(4) },
    { id: 'looper.play-b', label: 'Play loop B (loop track 6)', group: g, kind: 'toggle', run: () => toggleTrackPlay(5) },
    { id: 'loop.section.next', label: 'Next loop section', group: g, kind: 'trigger', run: () => nextLoopSection() },
    { id: 'loop.pedal.1', label: 'Loop pedal 1', group: g, kind: 'hold', run: (v) => pedal(1, v) },
    { id: 'loop.pedal.2', label: 'Loop pedal 2', group: g, kind: 'hold', run: (v) => pedal(2, v) },
    { id: 'loop.pedal.3', label: 'Loop pedal 3', group: g, kind: 'hold', run: (v) => pedal(3, v) },
  );
  registerStudioControls(list);
}

/**
 * The looper panel's keys: 1–8 select, Space the selected track's button,
 * Shift+Space stops it, Cmd+Z / Shift+Cmd+Z undo and redo its layer, M
 * mutes, S saves, Backspace clears, Cmd+. stops all. Returns true when the
 * key was the looper's.
 */
export function loopKey(e: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey' | 'repeat'>): boolean {
  if (!addonUsable('addon.audio-lab')) return false;
  const mod = e.metaKey || e.ctrlKey;
  const i = get(loopStationView).selected;
  if (e.repeat) return false;
  if (mod && e.key === '.') {
    stopAllLoopTracks();
    return true;
  }
  if (mod && (e.key === 'z' || e.key === 'Z')) {
    if (e.shiftKey) redoLoopLayer(i);
    else undoLoopLayer(i);
    return true;
  }
  if (mod || e.altKey) return false;
  if (/^Digit[1-8]$/.test(e.code)) {
    // Past the tracks showing, the key does nothing (selectLoopTrack checks).
    selectLoopTrack(Number(e.code.slice(5)) - 1);
    return true;
  }
  if (e.code === 'Space') {
    if (e.shiftKey) stopLoopTrack(i);
    else pressLoopTrack(i);
    return true;
  }
  if (e.code === 'KeyM') {
    toggleLoopMute(i);
    return true;
  }
  if (e.code === 'KeyS') {
    void saveLoopTrack(i);
    return true;
  }
  if (e.key === 'Backspace') {
    clearLoopTrack(i);
    return true;
  }
  return false;
}
