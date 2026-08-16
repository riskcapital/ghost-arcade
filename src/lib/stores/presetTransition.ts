/**
 * Preset-player transition settings — the "Transition [style] [duration]"
 * controls in the Mapping Presets tray header.
 *
 * These used to be three component-local `let`s inside PresetTray.svelte with
 * their own localStorage read/write. They moved here because a SECOND caller
 * now needs them: the show timeline inherits the tray's style + duration as
 * the default for every preset clip it creates, so a crossfade set once in
 * the tray is the crossfade a programmed show uses.
 *
 * Same three localStorage keys as before, so an existing install keeps its
 * settings across this refactor.
 *
 * Deliberately free of any renderer import: `showTimeline.ts` reads this at
 * clip-creation time, and that store must stay loadable in vitest's node
 * environment without pulling three.js in behind it.
 */

import { writable, get } from 'svelte/store';
import type { TransitionStyle } from '../types';

const KEY_TYPE = 'ghostarcade-transition-type';
const KEY_DURATION = 'ghostarcade-transition-duration';
const KEY_ENABLED = 'ghostarcade-transition-enabled';

export interface PresetTransitionSettings {
  /** Master on/off. Off means preset changes hard-cut. */
  enabled: boolean;
  style: TransitionStyle;
  /** Seconds. */
  duration: number;
}

/** Every style the UI offers, in menu order. */
export const TRANSITION_OPTIONS: { value: TransitionStyle; label: string }[] = [
  { value: 'dissolve',  label: 'Dissolve' },
  { value: 'wave',      label: 'Wave (Disney)' },
  { value: 'wipeUp',    label: 'Wipe Up' },
  { value: 'wipeDown',  label: 'Wipe Down' },
  { value: 'wipeLeft',  label: 'Wipe Left' },
  { value: 'wipeRight', label: 'Wipe Right' },
  { value: 'iris',      label: 'Iris' },
  { value: 'voxelize',  label: 'Voxelize' },
  { value: 'warp',      label: 'Warp' },
  { value: 'explode',   label: 'Explode' },
  { value: 'pixelMelt', label: 'Pixel Melt' },
];

export function isTransitionStyle(value: unknown): value is TransitionStyle {
  return typeof value === 'string' && TRANSITION_OPTIONS.some((o) => o.value === value);
}

const DEFAULTS: PresetTransitionSettings = { enabled: true, style: 'dissolve', duration: 2 };

function load(): PresetTransitionSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  const next = { ...DEFAULTS };
  try {
    const t = localStorage.getItem(KEY_TYPE);
    if (isTransitionStyle(t)) next.style = t;
    const d = parseFloat(localStorage.getItem(KEY_DURATION) || '');
    if (Number.isFinite(d) && d > 0) next.duration = d;
    const e = localStorage.getItem(KEY_ENABLED);
    if (e !== null) next.enabled = e === '1';
  } catch {
    /* private mode / no storage — defaults are fine */
  }
  return next;
}

function persist(s: PresetTransitionSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY_TYPE, s.style);
    localStorage.setItem(KEY_DURATION, String(s.duration));
    localStorage.setItem(KEY_ENABLED, s.enabled ? '1' : '0');
  } catch {
    /* best effort */
  }
}

const store = writable<PresetTransitionSettings>(load());

export const presetTransition = {
  subscribe: store.subscribe,
  set(next: PresetTransitionSettings) {
    store.set(next);
    persist(next);
  },
  patch(patch: Partial<PresetTransitionSettings>) {
    const next = { ...get(store), ...patch };
    store.set(next);
    persist(next);
  },
  /** Test seam. */
  _resetForTest() {
    store.set({ ...DEFAULTS });
  },
};

/** Snapshot for non-reactive callers (the show timeline reads this when it
 *  creates a clip, to seed that clip's own transition fields). */
export function getPresetTransitionSettings(): PresetTransitionSettings {
  return { ...get(store) };
}
