import { describe, expect, it } from 'vitest';
import { displayFingerprint, resolveSavedDisplay, savedDisplayMissing, type DisplayLike } from './displayMatch';

const laptop: DisplayLike = { id: 1, label: 'Built-in Display', width: 1512, height: 982, isPrimary: true, scaleFactor: 2 };
const epson: DisplayLike = { id: 2, label: 'EPSON PJ', width: 1920, height: 1080, isPrimary: false, scaleFactor: 1 };
const monitor: DisplayLike = { id: 3, label: 'DELL U2720Q', width: 2560, height: 1440, isPrimary: false, scaleFactor: 1.5 };

describe('resolveSavedDisplay', () => {
  it('finds the saved id when it is still the same screen', () => {
    const r = resolveSavedDisplay([laptop, epson], 2, displayFingerprint(epson));
    expect(r).toEqual({ status: 'found', display: epson });
  });

  it('finds the saved id when no fingerprint was saved (older projects)', () => {
    expect(resolveSavedDisplay([laptop, epson], 2)).toEqual({ status: 'found', display: epson });
  });

  it('follows the projector to its new id after it was re-plugged', () => {
    const replugged = { ...epson, id: 7 };
    const r = resolveSavedDisplay([laptop, replugged], 2, displayFingerprint(epson));
    expect(r).toEqual({ status: 'renumbered', display: replugged });
  });

  it('follows the projector when the ids were swapped between two screens', () => {
    const swappedEpson = { ...epson, id: 3 };
    const swappedMonitor = { ...monitor, id: 2 };
    const r = resolveSavedDisplay([laptop, swappedMonitor, swappedEpson], 2, displayFingerprint(epson));
    expect(r).toEqual({ status: 'renumbered', display: swappedEpson });
  });

  it('keeps the screen whose resolution changed', () => {
    const lower = { ...epson, width: 1280, height: 720 };
    expect(resolveSavedDisplay([laptop, lower], 2, displayFingerprint(epson)).display).toBe(lower);
    const moved = { ...lower, id: 9 };
    expect(resolveSavedDisplay([laptop, moved], 2, displayFingerprint(epson))).toEqual({ status: 'renumbered', display: moved });
  });

  it('reports a display that is not connected as missing, never the main display', () => {
    const r = resolveSavedDisplay([laptop, monitor], 2, displayFingerprint(epson));
    expect(r).toEqual({ status: 'missing', display: null });
    expect(resolveSavedDisplay([laptop], 42)).toEqual({ status: 'missing', display: null });
  });

  it('does not guess between two identical projectors', () => {
    const a = { ...epson, id: 10 };
    const b = { ...epson, id: 11 };
    expect(resolveSavedDisplay([laptop, a, b], 2, displayFingerprint(epson)).status).toBe('missing');
    // ...but the saved id still wins when it is one of them.
    expect(resolveSavedDisplay([laptop, a, b], 11, displayFingerprint(epson)).display).toBe(b);
  });

  it('is unset when nothing was saved', () => {
    expect(resolveSavedDisplay([laptop], null).status).toBe('unset');
  });
});

describe('savedDisplayMissing', () => {
  it('is false while the display list is unknown', () => {
    expect(savedDisplayMissing([], 2, displayFingerprint(epson))).toBe(false);
  });
  it('is true only for a saved display nobody matches', () => {
    expect(savedDisplayMissing([laptop], 2, displayFingerprint(epson))).toBe(true);
    expect(savedDisplayMissing([laptop, { ...epson, id: 5 }], 2, displayFingerprint(epson))).toBe(false);
    expect(savedDisplayMissing([laptop], null)).toBe(false);
  });
});
