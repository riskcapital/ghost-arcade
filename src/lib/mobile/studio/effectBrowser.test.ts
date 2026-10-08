import { describe, expect, it } from 'vitest';
import { MOBILE_EFFECTS } from '../standaloneEffects';
import { EFFECT_SHELVES, browseEffects, effectEntries, effectLabel, effectShelves, moveEffect, shelfFor } from './effectBrowser';
import { moveItem, reorderShifts, reorderTarget } from './reorder';

const entries = effectEntries(MOBILE_EFFECTS);

describe('effect browser catalogue', () => {
  it('lists every effect a performer can add, once, and no internal ones', () => {
    const visible = MOBILE_EFFECTS.filter((e) => !e.internal);
    expect(entries.length).toBe(visible.length);
    expect(entries.length).toBeGreaterThan(100);
    expect(entries.some((e) => e.type.startsWith('_'))).toBe(false);
  });
  it('puts every engine category on a named shelf', () => {
    const known = new Set(EFFECT_SHELVES.map((s) => s.id));
    for (const e of MOBILE_EFFECTS.filter((x) => !x.internal)) expect(known.has(shelfFor(e.category)), e.category).toBe(true);
    const shelves = effectShelves(entries);
    expect(shelves.reduce((n, s) => n + s.count, 0)).toBe(entries.length);
    expect(shelves.map((s) => s.label)).not.toContain('New Hero');
    expect(shelves.length).toBeLessThanOrEqual(10);
  });
  it('shows plain labels', () => {
    expect(effectLabel('brightness')).toBe('Brightness');
    expect(entries.every((e) => e.label[0] === e.label[0].toUpperCase())).toBe(true);
  });
  it('filters by shelf, and searches across shelves with prefix matches first', () => {
    expect(browseEffects(entries, 'blur').every((e) => e.shelf === 'blur')).toBe(true);
    expect(browseEffects(entries, 'all').length).toBe(entries.length);
    expect(browseEffects(entries, 'all')[0].shelf).toBe('featured');
    expect(new Set(browseEffects(entries, 'all').map((e) => e.type)).size).toBe(entries.length);
    const blur = browseEffects(entries, 'color', 'blur');
    expect(blur[0].label).toBe('Blur');
    expect(blur.some((e) => e.label === 'Zoom Blur')).toBe(true);
    expect(blur.some((e) => e.label === 'Sharpen')).toBe(true); // found by its shelf name
    expect(browseEffects(entries, 'all', 'zzzz')).toEqual([]);
    expect(browseEffects(entries, 'all', '  KALEIDO ').map((e) => e.label)).toEqual(['Kaleidoscope']);
  });
});

describe('reordering', () => {
  it('moves one item and leaves the rest in order', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
    expect(moveEffect(['a', 'b', 'c'], 1, 9)).toEqual(['a', 'c', 'b']);
  });
  it('lands on a neighbour once the dragged centre passes its centre', () => {
    const spans = [0, 110, 220, 330].map((start) => ({ start, size: 100 }));
    expect(reorderTarget(spans, 0, 100)).toBe(0); // centre 150 has not passed 160
    expect(reorderTarget(spans, 0, 115)).toBe(1);
    expect(reorderTarget(spans, 0, 400)).toBe(3);
    expect(reorderTarget(spans, 3, -230)).toBe(1);
    expect(reorderTarget(spans, 2, 0)).toBe(2);
  });
  it('slides the items in between by one slot', () => {
    const spans = [0, 110, 220, 330].map((start) => ({ start, size: 100 }));
    expect(reorderShifts(spans, 0, 2, 10)).toEqual([0, -110, -110, 0]);
    expect(reorderShifts(spans, 3, 1, 10)).toEqual([0, 110, 110, 0]);
    expect(reorderShifts(spans, 1, 1, 10)).toEqual([0, 0, 0, 0]);
  });
});
