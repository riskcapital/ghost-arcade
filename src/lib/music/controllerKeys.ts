/**
 * The keys of the MIDI keyboard in your hands, so the keyboard on screen can
 * show the same ones: its number of keys, and the octave it is set to.
 *
 * MIDI does not say how many keys a keyboard has. Most say it in their name
 * ("Launchkey 49", "MPK mini 25"); without that, 49 keys is assumed. The
 * range then slides by whole octaves to hold every note you play, so pressing
 * the keyboard's octave buttons moves the keys on screen with it.
 */

import { writable } from 'svelte/store';

export interface KeyRange {
  low: number;
  high: number;
}

/** The usual lowest and highest notes of a keyboard with this many keys, at its middle octave setting. */
const LAYOUTS: Record<number, KeyRange> = {
  25: { low: 48, high: 72 },
  32: { low: 41, high: 72 },
  37: { low: 48, high: 84 },
  49: { low: 36, high: 84 },
  61: { low: 36, high: 96 },
  73: { low: 28, high: 100 },
  76: { low: 28, high: 103 },
  88: { low: 21, high: 108 },
};
const DEFAULT_KEYS = 49;

/** The number of keys a keyboard's name gives away, or null. */
export function keyCountFromName(name: string | null | undefined): number | null {
  const m = /(?:^|\D)(25|32|37|49|61|73|76|88)(?:\D|$)/.exec(name ?? '');
  return m ? Number(m[1]) : null;
}

export function layoutForKeys(keys: number): KeyRange {
  return { ...(LAYOUTS[keys] ?? LAYOUTS[DEFAULT_KEYS]) };
}

/** The range moved by whole octaves until it holds `note`. */
export function slideToNote(range: KeyRange, note: number): KeyRange {
  let { low, high } = range;
  while (note < low && low - 12 >= 0) { low -= 12; high -= 12; }
  while (note > high && high + 12 <= 127) { low += 12; high += 12; }
  return { low, high };
}

/** The keyboard's keys as far as they are known; null before any device or note has been seen. */
export const controllerRange = writable<KeyRange | null>(null);

let current: KeyRange | null = null;
let currentKeys = 0;

/** A keyboard is connected: start from the layout its name gives. */
export function sawController(name: string | null | undefined): void {
  const keys = keyCountFromName(name);
  if (!keys || keys === currentKeys) return;
  currentKeys = keys;
  current = layoutForKeys(keys);
  controllerRange.set(current);
}

/** A note came in from a keyboard: keep its keys on screen. Cheap, and only touches the store when the range moves. */
export function heardControllerNote(note: number, name?: string | null): void {
  sawController(name);
  const base = current ?? layoutForKeys(currentKeys || DEFAULT_KEYS);
  const next = slideToNote(base, note);
  if (current && next.low === current.low && next.high === current.high) return;
  current = next;
  controllerRange.set(next);
}
