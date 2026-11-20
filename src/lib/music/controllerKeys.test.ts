import { describe, expect, it } from 'vitest';
import { keyCountFromName, layoutForKeys, slideToNote } from './controllerKeys';

describe('the MIDI keyboard in your hands', () => {
  it('reads the number of keys from a name', () => {
    expect(keyCountFromName('Launchkey 49 MK3')).toBe(49);
    expect(keyCountFromName('MPK mini 25')).toBe(25);
    expect(keyCountFromName('KeyStation88')).toBe(88);
    expect(keyCountFromName('Minilab 3')).toBeNull();
    // A number that only contains a key count is not one.
    expect(keyCountFromName('Device 2500')).toBeNull();
    expect(keyCountFromName(null)).toBeNull();
  });

  it('knows the usual layouts, and assumes 49 keys otherwise', () => {
    expect(layoutForKeys(25)).toEqual({ low: 48, high: 72 });
    expect(layoutForKeys(88)).toEqual({ low: 21, high: 108 });
    expect(layoutForKeys(7)).toEqual({ low: 36, high: 84 });
  });

  it('slides by whole octaves to hold a note, as the octave buttons do', () => {
    const keys = layoutForKeys(25);
    expect(slideToNote(keys, 60)).toEqual(keys);
    expect(slideToNote(keys, 74)).toEqual({ low: 60, high: 84 });
    expect(slideToNote(keys, 30)).toEqual({ low: 24, high: 48 });
    // Never off the ends of MIDI.
    expect(slideToNote(layoutForKeys(88), 0).low).toBeGreaterThanOrEqual(0);
  });
});
