/**
 * Which MIDI inputs the app listens to, and what for.
 *
 * Any number of inputs can be in use at once. A controller's messages go to
 * the mappings and MIDI learn; the band's keys play their notes into the
 * visuals (and the studio, when asked). The choices are kept on this
 * computer by input name, because Web MIDI ids change between sessions.
 *
 * The input picked before several could be (the old single choice) stays a
 * controller. While no controller is plugged in, the first input nobody has
 * given a use stands in for one without being saved, as it always has.
 */

import { writable } from 'svelte/store';
import type { MidiDevice, MidiInputSetup, MidiInputUse, MidiMapping } from './midiTypes';

const SETUP_KEY = 'ghost-arcade_midi_inputs';
const MAX_SETUPS = 64;
const MAX_NAME = 120;
const USES: readonly MidiInputUse[] = ['control', 'keys', 'off'];

function normalizeSetup(raw: unknown): MidiInputSetup | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || !r.name || r.name.length > MAX_NAME) return null;
  if (!USES.includes(r.use as MidiInputUse)) return null;
  const setup: MidiInputSetup = { name: r.name, use: r.use as MidiInputUse };
  if (typeof r.role === 'string' && /^[a-z]{1,16}$/.test(r.role)) setup.role = r.role;
  if (r.play === true) setup.play = true;
  if (typeof r.instrument === 'string' && /^[a-z]{0,16}$/.test(r.instrument)) setup.instrument = r.instrument;
  return setup;
}

function loadSetups(): MidiInputSetup[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SETUP_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    const out: MidiInputSetup[] = [];
    for (const item of raw.slice(0, MAX_SETUPS)) {
      const setup = normalizeSetup(item);
      if (setup && !out.some((s) => s.name === setup.name)) out.push(setup);
    }
    return out;
  } catch {
    return [];
  }
}

function saveSetups(list: MidiInputSetup[]): void {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

/** What each input is used for, by name. Saved on this computer. */
export const midiInputSetups = writable<MidiInputSetup[]>(loadSetups());

let currentSetups: MidiInputSetup[] = [];
midiInputSetups.subscribe((list) => (currentSetups = list));

export function setupFor(setups: readonly MidiInputSetup[], name: string | undefined): MidiInputSetup | undefined {
  return name ? setups.find((s) => s.name === name) : undefined;
}

/** The saved setup of one input now, if it has one. */
export function midiInputSetup(name: string | undefined): MidiInputSetup | undefined {
  return setupFor(currentSetups, name);
}

/** Change how one input is used (a new input starts as a controller). */
export function setMidiInputSetup(name: string, patch: Partial<Omit<MidiInputSetup, 'name'>>): void {
  if (!name) return;
  midiInputSetups.update((list) => {
    const current = setupFor(list, name);
    const next = normalizeSetup({ ...(current ?? { use: 'control' }), ...patch, name });
    if (!next) return list;
    const updated = current ? list.map((s) => (s.name === name ? next : s)) : [...list, next].slice(-MAX_SETUPS);
    saveSetups(updated);
    return updated;
  });
}

export interface MidiInputsInUse {
  /** Inputs whose messages go to the mappings now, a stand-in included. */
  control: string[];
  /** Inputs playing as the band's keys now. */
  keys: string[];
  /** The input standing in while no controller is plugged in. */
  standIn: string | null;
  /** Names of the controllers in use, for matching mappings to the input they were learned on. */
  controlNames: string[];
}

export const midiInputsInUse = writable<MidiInputsInUse>({ control: [], keys: [], standIn: null, controlNames: [] });

/**
 * Who does what, from the inputs there are, the saved setups and the input
 * picked before several could be (`chosenId`). `primary` is the first
 * controller: the chosen one when it is in use, else the first in use.
 */
export function resolveMidiInputs(devices: readonly MidiDevice[], setups: readonly MidiInputSetup[], chosenId: string | null | undefined): MidiInputsInUse & { primary: string | null } {
  const connected = devices.filter((d) => d.state === 'connected');
  const useOf = (d: MidiDevice): MidiInputUse | undefined => setupFor(setups, d.name)?.use ?? (d.id === chosenId ? 'control' : undefined);
  const controllers = connected.filter((d) => useOf(d) === 'control');
  const keys = connected.filter((d) => useOf(d) === 'keys').map((d) => d.id);
  const standIn = controllers.length ? null : connected.find((d) => useOf(d) === undefined) ?? null;
  const control = standIn ? [standIn] : controllers;
  return {
    control: control.map((d) => d.id),
    keys,
    standIn: standIn?.id ?? null,
    controlNames: control.map((d) => d.name),
    primary: (control.find((d) => d.id === chosenId) ?? control[0])?.id ?? null,
  };
}

export function sameInputsInUse(a: MidiInputsInUse, b: MidiInputsInUse): boolean {
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
  return a.standIn === b.standIn && same(a.control, b.control) && same(a.keys, b.keys) && same(a.controlNames, b.controlNames);
}

/**
 * Whether a mapping answers a message from the input called `device`. One
 * learned on an input answers only it while it is in use; while it is not
 * (unplugged, renamed), and for mappings from before inputs were recorded,
 * any controller does.
 */
export function mappingHearsDevice(mapping: Pick<MidiMapping, 'device'>, device: string | undefined, controlNames: readonly string[]): boolean {
  if (!mapping.device || !device || mapping.device === device) return true;
  return !controlNames.includes(mapping.device);
}

// ── The band's keys ─────────────────────────────────────────────────────

export interface BandKeysListener {
  /** A message from an input used as band keys. */
  message(data: ArrayLike<number>, setup: MidiInputSetup): void;
  /** The input went away or stopped being band keys: let go of its notes. */
  release(name: string): void;
}

const bandKeysListeners = new Set<BandKeysListener>();

/** Hear the band's keys. Returns a function that stops listening. */
export function onBandKeys(listener: BandKeysListener): () => void {
  bandKeysListeners.add(listener);
  return () => bandKeysListeners.delete(listener);
}

export function emitBandKeys(data: ArrayLike<number>, setup: MidiInputSetup): void {
  for (const listener of bandKeysListeners) {
    try {
      listener.message(data, setup);
    } catch (err) {
      console.warn('[MIDI] band keys listener failed:', err);
    }
  }
}

export function releaseBandKeys(name: string): void {
  for (const listener of bandKeysListeners) {
    try {
      listener.release(name);
    } catch (err) {
      console.warn('[MIDI] band keys listener failed:', err);
    }
  }
}
