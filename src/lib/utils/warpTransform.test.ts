import { describe, expect, it } from 'vitest';
import type { WarpCorners } from '../types';
import { cornersBoundsCenter, cornersCentroid, rotateCornersOnScreen, scaleCornersAround } from './warpTransform';

const frame = { width: 1600, height: 900 };

function quad(x0: number, y0: number, x1: number, y1: number): WarpCorners {
  return {
    topLeft: { x: x0, y: y1 }, topRight: { x: x1, y: y1 },
    bottomLeft: { x: x0, y: y0 }, bottomRight: { x: x1, y: y0 },
  };
}

function px(p: { x: number; y: number }) {
  return { x: p.x * frame.width, y: p.y * frame.height };
}

describe('rotateCornersOnScreen', () => {
  it('turns the same way as the pointer (clockwise on screen)', () => {
    // A point right of the pivot, turned 90 degrees clockwise on screen
    // (pointer going from right to below), ends up below the pivot: lower
    // y in the y-up corner space.
    const c = quad(0.5, 0.5, 0.6, 0.6);
    const pivot = { x: 0.5, y: 0.5 };
    const r = rotateCornersOnScreen(c, pivot, Math.PI / 2, frame);
    // bottomRight (0.6, 0.5) is 160 px right of the pivot.
    expect(r.bottomRight.x).toBeCloseTo(0.5, 6);
    expect(r.bottomRight.y).toBeCloseTo(0.5 - 160 / 900, 6);
  });

  it('keeps the on-screen shape on a 16:9 canvas', () => {
    const c = quad(0.4, 0.4, 0.6, 0.6);
    const pivot = cornersCentroid(c);
    const before = px(c.topRight);
    const beforeOther = px(c.bottomLeft);
    const r = rotateCornersOnScreen(c, pivot, 0.7, frame);
    const dBefore = Math.hypot(before.x - beforeOther.x, before.y - beforeOther.y);
    const a = px(r.topRight);
    const b = px(r.bottomLeft);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(dBefore, 6);
    // Edges stay square to each other.
    const tl = px(r.topLeft), tr = px(r.topRight), bl = px(r.bottomLeft);
    const dot = (tr.x - tl.x) * (bl.x - tl.x) + (tr.y - tl.y) * (bl.y - tl.y);
    expect(Math.abs(dot)).toBeLessThan(1e-6);
  });

  it('a zero turn changes nothing', () => {
    const c = quad(0.1, 0.2, 0.3, 0.5);
    expect(rotateCornersOnScreen(c, { x: 0.2, y: 0.3 }, 0, frame)).toEqual(c);
  });
});

describe('shared pivots', () => {
  it('bounds centre covers every quad', () => {
    expect(cornersBoundsCenter([quad(0, 0, 0.2, 0.2), quad(0.6, 0.4, 0.8, 1)])).toEqual({ x: 0.4, y: 0.5 });
    expect(cornersBoundsCenter([])).toBeNull();
  });

  it('scales round the pivot', () => {
    const s = scaleCornersAround(quad(0.4, 0.4, 0.6, 0.6), { x: 0.5, y: 0.5 }, 2);
    expect(s.topLeft.x).toBeCloseTo(0.3);
    expect(s.topLeft.y).toBeCloseTo(0.7);
  });
});
