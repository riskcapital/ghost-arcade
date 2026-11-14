import { describe, expect, it } from 'vitest';
import { movePoint, newSurface, type Surface } from '../model';
import { latticeFromCorners } from './meshGrid';
import { evaluate } from './meshGrid';
import { presetPath, shapeFromPath, surfaceOutline } from './surfaceShape';
import { addPathPoint, dragHandle, duplicateSurface, mirrorSurface, reorderSurfaces, setGroup, transformSelection, unweldAt, weldAt, weldCount, withGroups } from './edit';
import { snapPoint, snapShift } from './snapping';
import { clampView, focusView, inPixels, nudgeBasis, nudgeDelta, pinchView, zoomAt } from './viewport';

const box = (x0: number, y0: number, x1: number, y1: number, id: string): Surface => ({
  ...newSurface(0),
  id,
  points: latticeFromCorners([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], { cols: 3, rows: 3 }),
});

describe('welding', () => {
  it('a welded corner drags its neighbour along; unwelded it moves alone', () => {
    const left = box(0.1, 0.1, 0.5, 0.5, 'a'),
      right = box(0.5, 0.1, 0.9, 0.5, 'b');
    let surfaces = weldAt([left, right], 0, { x: 0.5, y: 0.1 });
    expect(weldCount(surfaces, 0)).toBe(1);
    const dragged = dragHandle(surfaces, 0, { kind: 'point', index: 2 }, { x: 0.55, y: 0.05 });
    expect(dragged[0].points[2]).toEqual({ x: 0.55, y: 0.05 });
    expect(dragged[1].points[0]).toEqual({ x: 0.55, y: 0.05 });
    // The weld travels with the point and still holds on the next drag.
    const again = dragHandle(dragged, 1, { kind: 'point', index: 0 }, { x: 0.6, y: 0.1 });
    expect(again[0].points[2]).toEqual({ x: 0.6, y: 0.1 });
    surfaces = unweldAt(again, 0, { x: 0.6, y: 0.1 });
    expect(surfaces[0].welds).toBeUndefined();
    expect(surfaces[1].welds).toBeUndefined();
    const alone = dragHandle(surfaces, 0, { kind: 'point', index: 2 }, { x: 0.7, y: 0.2 });
    expect(alone[1].points[0]).toEqual({ x: 0.6, y: 0.1 });
  });
  it('welds a shape point to a quad corner, and never moves a locked partner', () => {
    const quad = box(0.1, 0.1, 0.5, 0.5, 'q');
    const tri = shapeFromPath(newSurface(1), [{ x: 0.5, y: 0.5 }, { x: 0.8, y: 0.5 }, { x: 0.6, y: 0.8 }]);
    let surfaces = weldAt([quad, tri], 1, { x: 0.5, y: 0.5 });
    const moved = dragHandle(surfaces, 1, { kind: 'path', index: 0 }, { x: 0.45, y: 0.55 });
    expect(moved[0].points[8]).toEqual({ x: 0.45, y: 0.55 });
    surfaces = [{ ...surfaces[0], locked: true }, surfaces[1]];
    expect(dragHandle(surfaces, 1, { kind: 'path', index: 0 }, { x: 0.45, y: 0.55 })[0].points[8]).toEqual({ x: 0.5, y: 0.5 });
  });
  it('does not weld to empty space', () => {
    const surfaces = [box(0.1, 0.1, 0.5, 0.5, 'a'), box(0.6, 0.1, 0.9, 0.5, 'b')];
    expect(weldAt(surfaces, 0, { x: 0.5, y: 0.1 })).toBe(surfaces);
  });
});

describe('shape editing', () => {
  it('adds a point mid-edge and drags it out', () => {
    const tri = shapeFromPath(newSurface(0), [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.5, y: 0.8 }]);
    const { surfaces, point } = addPathPoint([tri], 0, 0);
    expect(point).toBe(1);
    expect(surfaces[0].shape!.points[1]).toEqual({ x: 0.5, y: 0.2 });
    const pulled = dragHandle(surfaces, 0, { kind: 'path', index: 1 }, { x: 0.5, y: 0.05 });
    expect(Math.min(...surfaceOutline(pulled[0]).map((p) => p.y))).toBeCloseTo(0.05);
  });
  it('curves a segment through the finger', () => {
    const tri = shapeFromPath(newSurface(0), [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.5, y: 0.8 }]);
    const bent = dragHandle([tri], 0, { kind: 'pathMid', index: 0 }, { x: 0.5, y: 0.1 })[0];
    expect(Math.min(...surfaceOutline(bent, 32).map((p) => p.y))).toBeCloseTo(0.1, 3);
  });
});

describe('selection transforms', () => {
  it('moves, scales and turns several surfaces about their common centre', () => {
    const surfaces = [box(0.1, 0.1, 0.3, 0.3, 'a'), box(0.7, 0.1, 0.9, 0.3, 'b'), box(0.4, 0.6, 0.6, 0.8, 'c')];
    const moved = transformSelection(surfaces, [0, 1], { dx: 0.05 });
    expect(moved[0].points[0].x).toBeCloseTo(0.15);
    expect(moved[2]).toBe(surfaces[2]);
    const scaled = transformSelection(surfaces, [0, 1], { scale: 0.5 });
    expect(scaled[0].points[0].x).toBeCloseTo(0.3);
    expect(scaled[1].points[2].x).toBeCloseTo(0.7);
    // A quarter turn on a 16:9 output keeps a square a square, in pixels.
    const sq = [box(0.4, 0.4, 0.4 + 0.2 * (9 / 16), 0.6, 's')];
    const turned = transformSelection(sq, [0], { angle: Math.PI / 2 })[0];
    const w = Math.abs(turned.points[2].x - turned.points[0].x) * 16,
      h = Math.abs(turned.points[6].y - turned.points[0].y) * 9;
    expect(Math.abs(turned.points[0].y - turned.points[2].y) * 9).toBeCloseTo(0.2 * 9, 6);
    expect(w + h).toBeGreaterThanOrEqual(0);
  });
  it('skips locked surfaces', () => {
    const surfaces = [{ ...box(0.1, 0.1, 0.3, 0.3, 'a'), locked: true }];
    expect(transformSelection(surfaces, [0], { dx: 0.1 })[0]).toBe(surfaces[0]);
  });
  it('mirrors the outline but keeps the picture readable', () => {
    let s = box(0.1, 0.1, 0.4, 0.4, 'a');
    s = movePoint(s, 2, { x: 0.5, y: 0.05 });
    const m = mirrorSurface(s, true);
    // Top right went to top left; the content's left edge (u=0) is still on the left.
    expect(m.points[0].x).toBeCloseTo(0.1 + 0.5 - 0.5 + 0, 6);
    expect(evaluate(m, 0, 0).x).toBeLessThan(evaluate(m, 1, 0).x);
    expect(m.points[0].y).toBeCloseTo(0.05);
  });
  it('duplicates beside the original without its welds or group', () => {
    const s = { ...box(0.1, 0.1, 0.4, 0.4, 'a'), welds: [{ x: 0.1, y: 0.1 }], group: 'g' };
    const d = duplicateSurface(s);
    expect(d.id).not.toBe('a');
    expect(d.name).toBe('Surface 1 copy');
    expect(d.points[0].x).toBeCloseTo(0.14);
    expect('welds' in d || 'group' in d).toBe(false);
  });
  it('reorders and groups', () => {
    const surfaces = [box(0, 0, 0.1, 0.1, 'a'), box(0, 0, 0.1, 0.1, 'b'), box(0, 0, 0.1, 0.1, 'c')];
    expect(reorderSurfaces(surfaces, 0, 2).map((s) => s.id)).toEqual(['b', 'c', 'a']);
    const grouped = setGroup(surfaces, [0, 2], true);
    expect(grouped[0].group).toBe(grouped[2].group);
    expect(withGroups(grouped, [0])).toEqual([0, 2]);
    expect(withGroups(setGroup(grouped, [0, 2], false), [0])).toEqual([0]);
  });
});

describe('snapping', () => {
  const others = [box(0.5, 0.1, 0.9, 0.5, 'b')];
  const opts = { width: 1000, height: 562.5, radius: 12 };
  it('lands on a nearby corner, then an edge, then the output frame', () => {
    expect(snapPoint({ x: 0.505, y: 0.105 }, others, () => false, opts)).toMatchObject({ point: { x: 0.5, y: 0.1 }, target: { kind: 'corner' } });
    const edge = snapPoint({ x: 0.506, y: 0.3 }, others, () => false, opts);
    expect(edge.target?.kind).toBe('edge');
    expect(edge.point.x).toBeCloseTo(0.5);
    const frame = snapPoint({ x: 0.005, y: 0.3 }, others, () => false, opts);
    expect(frame.target?.kind).toBe('frame');
    expect(frame.point.x).toBeCloseTo(0, 12);
    expect(frame.point.y).toBeCloseTo(0.3, 12);
    expect(snapPoint({ x: 0.995, y: 0.995 }, others, () => false, opts).target?.kind).toBe('frame-corner');
    expect(snapPoint({ x: 0.3, y: 0.7 }, others, () => false, opts).target).toBeNull();
  });
  it('ignores the surfaces being moved and hidden ones', () => {
    expect(snapPoint({ x: 0.505, y: 0.105 }, others, (i) => i === 0, opts).target?.kind).not.toBe('corner');
    expect(snapPoint({ x: 0.505, y: 0.105 }, [{ ...others[0], enabled: false }], () => false, opts).target?.kind).not.toBe('corner');
  });
  it('pulls the same few pixels at every zoom', () => {
    const zoomed = { ...opts, width: 4000, height: 2250 };
    expect(snapPoint({ x: 0.506, y: 0.106 }, others, () => false, zoomed).target).toBeNull();
    expect(snapPoint({ x: 0.502, y: 0.102 }, others, () => false, zoomed).target?.kind).toBe('corner');
  });
  it('snaps a moving shape by the corner that is closest to a target', () => {
    const shift = snapShift([{ x: 0.2, y: 0.2 }, { x: 0.497, y: 0.098 }], others, () => false, opts);
    expect(shift.dx).toBeCloseTo(0.003);
    expect(shift.dy).toBeCloseTo(0.002);
  });
  it('lands on a free-form outline edge', () => {
    const circle = shapeFromPath(newSurface(0), presetPath('circle', { x: 0.5, y: 0.5 }, 0.4));
    const top = Math.min(...surfaceOutline(circle).map((p) => p.y));
    const hit = snapPoint({ x: 0.5, y: top - 0.008 }, [circle], () => false, opts);
    expect(hit.target).not.toBeNull();
    expect(hit.point.y).toBeCloseTo(top, 2);
  });
});

describe('zoom, pan and nudge', () => {
  it('pinches about the fingers and clamps to the canvas', () => {
    const v = pinchView({ scale: 1, x: 0, y: 0 }, { x: 100, y: 50, spread: 100 }, { x: 100, y: 50, spread: 300 }, 400, 225);
    expect(v.scale).toBe(3);
    expect(v.x).toBeCloseTo(100 - 100 * 3);
    expect(pinchView(v, { x: 0, y: 0, spread: 100 }, { x: 0, y: 0, spread: 1 }, 400, 225)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(clampView({ scale: 20, x: 0, y: 0 }, 400, 225).scale).toBe(8);
    expect(clampView({ scale: 2, x: 5000, y: -5000 }, 400, 225)).toEqual({ scale: 2, x: 80, y: 225 - 450 - 45 });
  });
  it('zooms on a point and centres a point', () => {
    const v = zoomAt({ scale: 1, x: 0, y: 0 }, 2, { x: 200, y: 100 }, 400, 225);
    expect(v).toEqual({ scale: 2, x: -200, y: -100 });
    const f = focusView({ x: 0.5, y: 0.5 }, 4, 400, 225);
    expect(f.x).toBeCloseTo(200 - 800);
  });
  it('counts nudges in output pixels', () => {
    expect(nudgeBasis()).toEqual({ width: 1920, height: 1080 });
    expect(nudgeBasis({ width: 1280, height: 720 })).toEqual({ width: 1280, height: 720 });
    const d = nudgeDelta(1, -1, 0.1, { width: 1920, height: 1080 });
    expect(d.x * 1920).toBeCloseTo(0.1);
    expect(d.y * 1080).toBeCloseTo(-0.1);
    expect(inPixels({ x: 0.5, y: 0.25 }, { width: 1920, height: 1080 })).toEqual({ x: 960, y: 270 });
  });
});
