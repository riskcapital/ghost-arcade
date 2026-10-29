/**
 * The computer keyboard as a piano.
 *
 * The home row is the white keys and the row above the black keys, the
 * layout most music software uses:
 *
 *    W E   T Y U   O P
 *   A S D F G H J K L ;
 *   C D E F G A B C D E
 *
 * Z / X shift the octave down / up; C / V lower / raise the velocity.
 * Keys are matched by physical position (KeyboardEvent.code), so the layout
 * stays a piano on AZERTY and other layouts.
 */

/** Semitones above the base C for each key. */
export const PIANO_KEY_SEMITONES: Record<string, number> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
  Quote: 17,
};

/** Printed letter for each key, for labelling the on-screen keys. */
export const PIANO_KEY_LABELS: Record<string, string> = {
  KeyA: 'A', KeyW: 'W', KeyS: 'S', KeyE: 'E', KeyD: 'D', KeyF: 'F', KeyT: 'T', KeyG: 'G', KeyY: 'Y',
  KeyH: 'H', KeyU: 'U', KeyJ: 'J', KeyK: 'K', KeyO: 'O', KeyL: 'L', KeyP: 'P', Semicolon: ';', Quote: "'",
};

export const OCTAVE_DOWN_KEY = 'KeyZ';
export const OCTAVE_UP_KEY = 'KeyX';
export const VELOCITY_DOWN_KEY = 'KeyC';
export const VELOCITY_UP_KEY = 'KeyV';

export const MIN_OCTAVE = 0;
export const MAX_OCTAVE = 8;
export const DEFAULT_OCTAVE = 4;
export const VELOCITY_STEP = 0.1;

/** MIDI note of the base C for an octave: octave 4 starts at middle C (60). */
export function octaveBaseNote(octave: number): number {
  return (Math.round(octave) + 1) * 12;
}

/** MIDI note a key plays at `octave`, or null when the key is not a piano key. */
export function noteForKey(code: string, octave: number): number | null {
  const semitone = PIANO_KEY_SEMITONES[code];
  if (semitone === undefined) return null;
  const note = octaveBaseNote(octave) + semitone;
  return note >= 0 && note <= 127 ? note : null;
}

/** The key that plays `note` at `octave`, if any (for labels on screen). */
export function keyForNote(note: number, octave: number): string | null {
  const semitone = note - octaveBaseNote(octave);
  for (const [code, s] of Object.entries(PIANO_KEY_SEMITONES)) if (s === semitone) return code;
  return null;
}

export type KeyboardSize = 'compact' | 'wide' | 'full';

export const KEYBOARD_SIZES: { id: KeyboardSize; label: string; title: string }[] = [
  { id: 'compact', label: '2 oct', title: 'Two octaves from the keyboard octave' },
  { id: 'wide', label: '4 oct', title: 'Four octaves around the keyboard octave' },
  { id: 'full', label: '88', title: 'A full 88-key piano' },
];

/** Lowest and highest note the on-screen keyboard shows. */
export function keyboardRange(size: KeyboardSize, octave: number): { low: number; high: number } {
  if (size === 'full') return { low: 21, high: 108 };
  const base = octaveBaseNote(clampOctave(octave));
  // The wide view starts an octave below so the letter keys sit in its middle.
  const low = size === 'wide' ? base - 12 : base;
  const span = size === 'wide' ? 48 : 24;
  const clampedLow = Math.max(0, Math.min(127 - span, low));
  return { low: clampedLow, high: clampedLow + span };
}

export function clampOctave(octave: number): number {
  return Math.max(MIN_OCTAVE, Math.min(MAX_OCTAVE, Math.round(octave)));
}

/** With the drum kit selected the home row plays the eight pads, in kit order. */
export const DRUM_PAD_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'] as const;

/** Pad index (0-7) a key plays on the drum kit, or null. */
export function drumPadForKey(code: string): number | null {
  const index = (DRUM_PAD_KEYS as readonly string[]).indexOf(code);
  return index >= 0 ? index : null;
}

export type KeyboardAction =
  | { kind: 'note'; note: number }
  | { kind: 'octave'; delta: -1 | 1 }
  | { kind: 'velocity'; delta: number }
  | null;

/** What a key does on the music keyboard. */
export function keyboardAction(code: string, octave: number): KeyboardAction {
  if (code === OCTAVE_DOWN_KEY) return { kind: 'octave', delta: -1 };
  if (code === OCTAVE_UP_KEY) return { kind: 'octave', delta: 1 };
  if (code === VELOCITY_DOWN_KEY) return { kind: 'velocity', delta: -VELOCITY_STEP };
  if (code === VELOCITY_UP_KEY) return { kind: 'velocity', delta: VELOCITY_STEP };
  const note = noteForKey(code, octave);
  return note === null ? null : { kind: 'note', note };
}
