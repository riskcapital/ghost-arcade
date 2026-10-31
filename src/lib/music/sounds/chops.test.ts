/**
 * The chops of a band loop: registered under their own ids for this
 * session, found before the library, and gone again without a trace, so a
 * pad holding a chop id from a saved project plays its fallback.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CHOP_COUNT, chopId, chopSound, clearChops, hasChops, isChopId, setChops, stopChops } from './chops';
import { SOUND_LIBRARY, soundById } from './library';
import { DEFAULT_FX_PADS, normalizeFxPads } from '../soundSlots';

/** Enough of an AudioBuffer for slicing (playing it needs Web Audio). */
const loop = (length = 192000, sampleRate = 48000) => ({ length, sampleRate, duration: length / sampleRate, numberOfChannels: 2 }) as unknown as AudioBuffer;

afterEach(() => clearChops());

describe('chops', () => {
  it('have ids of their own that no library sound uses', () => {
    expect(chopId(0)).toBe('chop-1');
    expect(chopId(7)).toBe('chop-8');
    expect(isChopId('chop-3')).toBe(true);
    expect(isChopId('chop-')).toBe(false);
    expect(isChopId('chopper')).toBe(false);
    expect(isChopId(null)).toBe(false);
    for (const s of SOUND_LIBRARY) expect(isChopId(s.id), s.id).toBe(false);
  });

  it('are found before the library while they last', () => {
    const ids = setChops(loop(), 'loop A');
    expect(ids).toEqual(Array.from({ length: CHOP_COUNT }, (_, i) => `chop-${i + 1}`));
    expect(hasChops()).toBe(true);
    for (const id of ids) {
      const def = soundById(id);
      expect(def, id).toBeDefined();
      expect(def).toBe(chopSound(id));
      expect(def?.kind).toBe('shot');
      expect(def?.name.length).toBeLessThanOrEqual(16);
      expect(def?.blurb).toContain('loop A');
    }
    // The library is untouched.
    expect(soundById('laser')?.id).toBe('laser');
  });

  it('replace the chops before', () => {
    setChops(loop(192000));
    const first = soundById('chop-1');
    setChops(loop(96000));
    expect(soundById('chop-1')).not.toBe(first);
  });

  it('leave nothing under their ids once cleared, so a pad plays its fallback', () => {
    setChops(loop());
    clearChops();
    expect(hasChops()).toBe(false);
    expect(soundById('chop-1')).toBeUndefined();
    expect(soundById('chop-8')).toBeUndefined();
    expect(() => stopChops()).not.toThrow();
  });

  it('survive a project being opened with them on a pad, and play nothing', () => {
    const pads = normalizeFxPads({ dub: ['chop-1', 'chop-2', ...DEFAULT_FX_PADS.dub.slice(2)] });
    expect(pads.dub.slice(0, 2)).toEqual(['chop-1', 'chop-2']);
    // No chops this session: the engine's pad lookup finds nothing and plays the pad's old shot.
    expect(soundById(pads.dub[0])).toBeUndefined();
  });
});

describe('what a save or a song keeps of chopped pads', () => {
  it('keeps what the pads held before, or the set default when that is not known', async () => {
    const { rememberPadsBefore, forgetPadsBefore, unchoppedPads, unchoppedFxPads } = await import('./chops');
    const { DEFAULT_FX_PADS, defaultFxPads } = await import('../soundSlots');
    const own = ['thunder', 'rain', 'wind', 'night', 'impact', 'braam', 'zap', 'laser'];
    rememberPadsBefore('bath', own);
    const chopped = ['chop-1', 'chop-2', 'wind', 'chop-4', 'chop-5', 'chop-6', 'chop-7', 'chop-8'];
    expect(unchoppedPads('bath', chopped)).toEqual(own);
    // Chopping again remembers the pads' own sounds, not the chops.
    rememberPadsBefore('bath', chopped);
    expect(unchoppedPads('bath', chopped)).toEqual(own);
    // A file opened from disk never trusts this session's memory.
    expect(unchoppedPads('bath', chopped, false)).toEqual(DEFAULT_FX_PADS.bath.map((d, i) => (i === 2 ? 'wind' : d)));
    forgetPadsBefore();
    const pads = { ...defaultFxPads(), dub: ['chop-3', ...DEFAULT_FX_PADS.dub.slice(1)] };
    expect(unchoppedFxPads(pads).dub).toEqual(DEFAULT_FX_PADS.dub);
  });
});
