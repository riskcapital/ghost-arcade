import { describe, expect, it } from 'vitest';
import { arrangeVisuals, moveVisualRow, normalizeStackOff, normalizeStackPlace, visualOrder, type VisualRow } from './visualOrder';

const v = (index: number): VisualRow => ({ kind: 'voice', index });
const st = (index: number): VisualRow => ({ kind: 'stack', index });
const bass = { track: 'studio:bass', order: 1 };
const lead = { track: 'studio:lead', order: 3 };

describe('visualOrder', () => {
  it('puts clips with no place on top, the later track over the earlier', () => {
    expect(visualOrder(2, [bass, lead], {})).toEqual([st(1), st(0), v(0), v(1)]);
  });

  it('puts a clip where its track was placed', () => {
    expect(visualOrder(3, [bass], { 'studio:bass': 1.2 })).toEqual([v(0), st(0), v(1), v(2)]);
    expect(visualOrder(2, [bass], { 'studio:bass': 9 })).toEqual([v(0), v(1), st(0)]);
  });
});

describe('arrangeVisuals', () => {
  it('turns a dragged list into voice order and places that read back the same', () => {
    const stacks = [bass, lead];
    const start = visualOrder(3, stacks, {});
    // Drag the top clip (lead) down between the first and second voice.
    const next = moveVisualRow(start, 0, 2);
    expect(next).toEqual([st(0), v(0), st(1), v(1), v(2)]);
    const { voices, places } = arrangeVisuals(next, stacks);
    expect(voices).toEqual([0, 1, 2]);
    expect(visualOrder(3, stacks, places)).toEqual(next);
  });

  it('moves a voice above a clip by giving the clip a lower place', () => {
    const stacks = [bass];
    const next = moveVisualRow(visualOrder(2, stacks, {}), 2, 0);
    expect(next).toEqual([v(1), st(0), v(0)]);
    const { voices, places } = arrangeVisuals(next, stacks);
    expect(voices).toEqual([1, 0]);
    // Voices renumbered by their new order: the clip sits between them.
    expect(visualOrder(2, stacks, places)).toEqual([v(0), st(0), v(1)]);
  });

  it('keeps two clips in the same gap in the order they were dropped', () => {
    const stacks = [bass, lead];
    const rows = [v(0), st(0), st(1), v(1)];
    const { places } = arrangeVisuals(rows, stacks);
    expect(visualOrder(2, stacks, places)).toEqual(rows);
  });
});

describe('normalizeStackPlace', () => {
  it('keeps numbers by track and drops the rest', () => {
    expect(normalizeStackPlace({ 'studio:bass': 1.5, bad: 'x', '': 2 })).toEqual({ 'studio:bass': 1.5 });
    expect(normalizeStackPlace(null)).toEqual({});
  });
});

describe('normalizeStackOff', () => {
  it('keeps track keys once each', () => {
    expect(normalizeStackOff(['studio:bass', 'studio:bass', 3, ''])).toEqual(['studio:bass']);
    expect(normalizeStackOff('x')).toEqual([]);
  });
});
