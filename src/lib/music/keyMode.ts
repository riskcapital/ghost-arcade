/**
 * What the keys do with the studio's key. Show marks the notes in it and
 * plays every note; Lock moves each note to the nearest note in the key;
 * Scale plays the scale on the white keys, a degree a key, so a run from C to
 * C plays the whole scale in any key (the black keys lock).
 */

import { scaleNote, snapToScale, type MusicKey } from './studioSets';

export type KeyMode = 'show' | 'lock' | 'scale';

export const KEY_MODES: { id: KeyMode; label: string; title: string }[] = [
  { id: 'show', label: 'Show key', title: 'Mark the notes in the key; every note plays' },
  { id: 'lock', label: 'Lock to key', title: 'Every note moves to the nearest note in the key' },
  { id: 'scale', label: 'Scale on white keys', title: 'Each white key plays the next note of the scale, from the root at C' },
];

const WHITE = [0, 2, 4, 5, 7, 9, 11];

/** White keys from C-1, or null for a black key. */
export function whiteIndex(note: number): number | null {
  const pc = ((note % 12) + 12) % 12;
  const i = WHITE.indexOf(pc);
  return i < 0 ? null : Math.floor(note / 12) * 7 + i;
}

/** The note that sounds when `note` is played in `mode`. */
export function keyModeNote(note: number, key: MusicKey, mode: KeyMode): number {
  if (mode === 'show') return note;
  if (mode === 'scale') {
    const w = whiteIndex(note);
    if (w !== null) {
      // Degrees counted from each octave's C, so every C plays the root in its octave.
      // (A five-note scale runs into the next octave on A and B.)
      const octave = Math.floor(note / 12);
      return Math.max(0, Math.min(127, scaleNote(key, w - octave * 7, octave * 12)));
    }
  }
  return Math.max(0, Math.min(127, snapToScale(note, key)));
}

/** Whether `note` is in the key. */
export function inKey(note: number, key: MusicKey): boolean {
  return snapToScale(note, key) === note;
}
