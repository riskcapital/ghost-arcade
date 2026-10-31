import { describe, expect, it } from 'vitest';
import { inKey, keyModeNote, whiteIndex } from './keyMode';

const aMinor = { root: 9, scale: 'minor' } as const;
const cMajor = { root: 0, scale: 'major' } as const;

describe('keyboard modes', () => {
  it('Show plays every note as it is', () => {
    for (let n = 48; n < 72; n++) expect(keyModeNote(n, aMinor, 'show')).toBe(n);
  });

  it('Lock moves every note into the key, and leaves notes in it alone', () => {
    for (let n = 36; n < 96; n++) {
      const out = keyModeNote(n, aMinor, 'lock');
      expect(inKey(out, aMinor), `note ${n}`).toBe(true);
      expect(Math.abs(out - n)).toBeLessThanOrEqual(1);
      if (inKey(n, aMinor)) expect(out).toBe(n);
    }
  });

  it('Scale on white keys plays the scale from C, in any key', () => {
    const whites = [60, 62, 64, 65, 67, 69, 71, 72];
    expect(whites.map((n) => keyModeNote(n, cMajor, 'scale'))).toEqual(whites);
    // A minor from the root at each C: A B C D E F G, then the next A.
    expect(whites.map((n) => keyModeNote(n, aMinor, 'scale'))).toEqual([69, 71, 72, 74, 76, 77, 79, 81]);
    expect(whiteIndex(61)).toBeNull();
    expect(inKey(keyModeNote(61, aMinor, 'scale'), aMinor)).toBe(true);
  });
});
