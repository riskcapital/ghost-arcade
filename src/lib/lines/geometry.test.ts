import { describe, it, expect } from 'vitest';
import {
  applyLineCorners,
  canvasToLineElement,
  hitTestLineElements,
  lineElementToCanvas,
  lineShapeRenderPoints,
  nextLineZIndex,
  syncLineZIndex,
  trimDuplicateTailPoints,
} from './geometry';
import { createDefaultFreehandLine, createDefaultPointClickLine, createLineElement } from './types';
import { createDrawnLineShape, DEFAULT_NEW_LINE_SETTINGS } from '../stores/lines';

const uLine = () => createLineElement(createDefaultPointClickLine([
  { x: 0.2, y: 0.8 }, { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 },
]));

describe('lines hit-testing', () => {
  it('finds a duplicated (offset) line where it is drawn, not at its raw points', () => {
    const el = { ...uLine(), position: { x: 0.05, y: 0.05 } };
    // The left leg is drawn at x = 0.25 after the offset.
    expect(hitTestLineElements([el], { x: 0.25, y: 0.5 }, 0.01)?.id).toBe(el.id);
    expect(hitTestLineElements([el], { x: 0.2, y: 0.5 }, 0.01)).toBeNull();
  });

  it('an open line is not hit inside its gap; a closed one is hit inside', () => {
    const open = uLine();
    expect(hitTestLineElements([open], { x: 0.5, y: 0.5 }, 0.01)).toBeNull();
    const closed = { ...open, shape: { ...open.shape, closed: true } } as typeof open;
    expect(hitTestLineElements([closed], { x: 0.5, y: 0.5 }, 0.01)?.id).toBe(closed.id);
  });

  it('skips locked and hidden lines and prefers the top-most by zIndex', () => {
    const a = { ...uLine(), zIndex: 5 };
    const b = { ...uLine(), zIndex: 1 };
    const p = { x: 0.2, y: 0.5 };
    expect(hitTestLineElements([a, b], p)?.id).toBe(a.id);
    expect(hitTestLineElements([{ ...a, locked: true }, b], p)?.id).toBe(b.id);
    expect(hitTestLineElements([{ ...a, visible: false }, { ...b, locked: true }], p)).toBeNull();
  });

  it('canvas ↔ line-space round-trips through move/rotate/scale', () => {
    const el = { ...uLine(), position: { x: 0.1, y: -0.05 }, rotation: 30, scale: { x: 1.5, y: 0.75 } };
    const local = { x: 0.33, y: 0.71 };
    const back = canvasToLineElement(lineElementToCanvas(local, el), el);
    expect(back.x).toBeCloseTo(local.x, 9);
    expect(back.y).toBeCloseTo(local.y, 9);
  });
});

describe('line drawing helpers', () => {
  it('a double-click finish drops the repeated tail point', () => {
    const pts = [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.7, y: 0.2 }, { x: 0.7, y: 0.2 }];
    expect(trimDuplicateTailPoints(pts, 0.003)).toEqual(pts.slice(0, 3));
    expect(trimDuplicateTailPoints(pts.slice(0, 2), 0.003)).toHaveLength(2);
  });

  it('reordering keeps zIndex in list order, and new lines go on top', () => {
    const els = [{ ...uLine(), zIndex: 0 }, { ...uLine(), zIndex: 1 }, { ...uLine(), zIndex: 2 }];
    const moved = [els[2], els[0], els[1]];
    expect(syncLineZIndex(moved).map((e) => e.zIndex)).toEqual([0, 1, 2]);
    // After deleting the bottom line, a new one must not tie with the top.
    expect(nextLineZIndex([els[1], els[2]])).toBe(3);
  });

  it('Draw-tab settings reach the new line', () => {
    const pts = [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.1 }];
    const fh = createDrawnLineShape('freehand', pts, { ...DEFAULT_NEW_LINE_SETTINGS, smoothing: 0.9 });
    expect(fh).toMatchObject({ type: 'freehand', smoothing: 0.9 });
    const pc = createDrawnLineShape('pointClick', pts, { smoothing: 0.5, closed: true, cornerStyle: 'rounded', cornerRadius: 20 });
    expect(pc).toMatchObject({ type: 'pointClick', closed: true, cornerStyle: 'rounded', cornerRadius: 20 });
    // Two points cannot close.
    expect(createDrawnLineShape('pointClick', pts.slice(0, 2), { ...DEFAULT_NEW_LINE_SETTINGS, closed: true })).toMatchObject({ closed: false });
  });
});

describe('line corners and smoothing (shared by both renderers)', () => {
  const L = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];

  it('sharp or zero radius leaves the corner alone', () => {
    expect(applyLineCorners(L, false, 'sharp', 20)).toBe(L);
    expect(applyLineCorners(L, false, 'rounded', 0)).toBe(L);
  });

  it('chamfer cuts the corner at the radius', () => {
    const out = applyLineCorners(L, false, 'chamfer', 20);
    expect(out).toHaveLength(4);
    expect(out[1].x).toBeCloseTo(80); expect(out[1].y).toBeCloseTo(0);
    expect(out[2].x).toBeCloseTo(100); expect(out[2].y).toBeCloseTo(20);
  });

  it('rounded corner is a circular arc of the given radius', () => {
    const out = applyLineCorners(L, false, 'rounded', 20, 6);
    expect(out.length).toBe(2 + 7);
    // Arc centre for a 90° corner at (100,0) with r=20 is (80,20).
    for (const p of out.slice(1, -1)) expect(Math.hypot(p.x - 80, p.y - 20)).toBeCloseTo(20, 6);
  });

  it('radius is clamped to half the shorter leg', () => {
    const out = applyLineCorners(L, false, 'chamfer', 500);
    expect(out[1].x).toBeCloseTo(50);
  });

  it('closed shapes round every corner; endpoints of open lines stay put', () => {
    const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    expect(applyLineCorners(sq, true, 'chamfer', 10)).toHaveLength(8);
    const open = applyLineCorners(sq, false, 'chamfer', 10);
    expect(open[0]).toEqual(sq[0]);
    expect(open[open.length - 1]).toEqual(sq[3]);
  });

  it('freehand smoothing changes the drawn points with the Smoothing value', () => {
    const el = createLineElement(createDefaultFreehandLine([{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }]));
    const raw = lineShapeRenderPoints({ ...el, shape: { ...el.shape, smoothing: 0 } } as typeof el, 100, 100);
    const smooth = lineShapeRenderPoints({ ...el, shape: { ...el.shape, smoothing: 1 } } as typeof el, 100, 100);
    expect(raw).toHaveLength(3);
    expect(smooth.length).toBeGreaterThan(raw.length);
  });
});
