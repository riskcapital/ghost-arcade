/**
 * The pure parts of the Timeline's line editing: which lines go under which
 * row and how tall that makes it, hit testing (points, overlaid curves,
 * boxes), point drags (snap, clamps, neighbours), the parameter picker's
 * filter, and the "◆" next to panel controls.
 */
import { describe, expect, it } from 'vitest';
import type { ShowLayerTrack } from '../../../types';
import type { ControlLine } from '../../../timeline/lines/lineModel';
import type { ParamEntry } from '../../../timeline/lines/paramRegistry';
import {
  LINE_DEPTH_HEIGHT,
  LINE_LANE_HEIGHT,
  LINE_OVERLAY_HEIGHT,
  computeLineLayout,
  curveDistance,
  curvePath,
  deletePoints,
  dragPoints,
  filterParams,
  formatLineValue,
  hitOverlay,
  hitPoint,
  insertPoint,
  linesForTrack,
  pointsInRect,
  setPointCurves,
  valueToY,
  yToValue,
} from './lineUi';
import { lineKeyForControlPath, resolveControlTarget } from './lineDiamond';
import { trackHeight, TRACK_ROW_HEIGHT } from './trackLayout';

const H = 40;
const Z = 100; // px per second
const line = (over: Partial<ControlLine> = {}): ControlLine => ({
  id: 'l1', target: { scope: 'layer', id: 'A' }, key: 'layer:opacity', kind: 'continuous', min: 0, max: 1,
  points: [{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 2, v: 0.5 }], ...over,
});
const track = (over: Partial<ShowLayerTrack> = {}): ShowLayerTrack => ({
  id: 'row:A', layerId: 'A', layerName: 'A', clips: [], lanes: [], collapsed: false, muted: false, locked: false, gap: 'hide', template: null, ...over,
} as ShowLayerTrack);

describe('which lines go where', () => {
  it('a row has its piece\'s lines and its blocks\' lines; an added layer its own copy\'s', () => {
    const lines = [
      line({ id: 'piece' }),
      line({ id: 'block', target: { scope: 'block', id: 'c1' } }),
      line({ id: 'other', target: { scope: 'layer', id: 'B' } }),
      line({ id: 'sub', target: { scope: 'layer', id: 'showsub::A::S1' } }),
      line({ id: 'look', target: { scope: 'look', id: 'L' } }),
      line({ id: 'stage', target: { scope: 'stage' }, key: 'stage:fx:e:opacity' }),
    ];
    const row = track({ clips: [{ id: 'c1' } as any] });
    expect(linesForTrack(row, lines).map((l) => l.id)).toEqual(['piece', 'block']);
    expect(linesForTrack(track({ id: 'S1', subRow: true }), lines).map((l) => l.id)).toEqual(['sub']);
    const layout = computeLineLayout([row, track({ id: 'row:B', layerId: 'B' })], lines, new Set(['row:B']));
    expect(layout.lines.get('looks')!.map((l) => l.id)).toEqual(['look']);
    expect(layout.lines.get('stage')!.map((l) => l.id)).toEqual(['stage']);
    expect(layout.heights.get('row:A')).toBe(LINE_OVERLAY_HEIGHT);
    expect(layout.heights.get('row:B')).toBe(LINE_LANE_HEIGHT);
    expect(trackHeight(row, layout)).toBe(TRACK_ROW_HEIGHT + LINE_OVERLAY_HEIGHT);
    expect(trackHeight({ ...row, collapsed: true }, layout)).toBe(TRACK_ROW_HEIGHT);
    // A row with no lines adds nothing (lines appear only when used).
    expect(computeLineLayout([row], [], new Set()).heights.size).toBe(0);
  });

  it('expanded: one lane per line plus a depth lane for a drawn depth', () => {
    const lines = [line({ id: 'a' }), line({ id: 'b', follow: { source: { kind: 'audio', feature: 'kick' }, depth: 0.5, depthPoints: [] } })];
    expect(computeLineLayout([track()], lines, new Set(['row:A'])).heights.get('row:A')).toBe(LINE_LANE_HEIGHT * 2 + LINE_DEPTH_HEIGHT);
  });
});

describe('geometry and hit testing', () => {
  it('maps values to heights and back', () => {
    expect(valueToY(1, 0, 1, H)).toBe(4);
    expect(valueToY(0, 0, 1, H)).toBe(36);
    expect(yToValue(20, 0, 1, H)).toBeCloseTo(0.5);
  });

  it('finds the nearest point within the radius', () => {
    const l = line();
    expect(hitPoint(l, l.points, 100, valueToY(1, 0, 1, H), Z, H)).toBe(1);
    expect(hitPoint(l, l.points, 104, valueToY(1, 0, 1, H) + 3, Z, H)).toBe(1);
    expect(hitPoint(l, l.points, 150, 20, Z, H)).toBe(-1);
  });

  it('picks the line under the pointer among overlaid curves (points first)', () => {
    const a = line({ id: 'a' });
    const b = line({ id: 'b', points: [{ t: 0, v: 1 }, { t: 2, v: 1 }] });
    expect(hitOverlay([a, b], 100, valueToY(1, 0, 1, H), Z, H)).toEqual({ lineId: 'a', point: 1 });
    expect(hitOverlay([a, b], 160, valueToY(1, 0, 1, H), Z, H)).toEqual({ lineId: 'b', point: -1 });
    expect(hitOverlay([a, b], 0, valueToY(0, 0, 1, H), Z, H)).toEqual({ lineId: 'a', point: 0 });
    expect(hitOverlay([a, b], 50, valueToY(0.5, 0, 1, H), Z, H)).toEqual({ lineId: 'a', point: -1 });
    expect(hitOverlay([a, b], 50, valueToY(0.05, 0, 1, H), Z, H)).toBeNull();
    expect(curveDistance(a, 50, valueToY(0.5, 0, 1, H), Z, H)).toBeCloseTo(0);
  });

  it('selects the points inside a box', () => {
    const l = line();
    expect(pointsInRect(l, l.points, { x0: 50, y0: 0, x1: 250, y1: H }, Z, H)).toEqual([1, 2]);
  });

  it('draws through every point exactly, and steps at a hold', () => {
    const d = curvePath(line({ points: [{ t: 0, v: 0, c: 'hold' }, { t: 1, v: 1 }] }), 0, 2, Z, H, 50);
    expect(d).toContain('L100.0 36.0');
    expect(d).toContain('L100.0 4.0');
  });
});

describe('point edits', () => {
  it('adds a point, replacing one at the same time', () => {
    const r = insertPoint(line().points, 1.5, 0.2);
    expect(r.points.map((p) => p.t)).toEqual([0, 1, 1.5, 2]);
    expect(r.index).toBe(2);
    expect(insertPoint(r.points, 1.5, 0.9).points.find((p) => p.t === 1.5)!.v).toBe(0.9);
  });

  it('drags the selection: snapped by the grabbed point, clamped in value, never past a neighbour', () => {
    const pts = [{ t: 0, v: 0 }, { t: 1, v: 0.5 }, { t: 2, v: 0.5 }, { t: 3, v: 0 }];
    const snap = (t: number) => Math.round(t * 4) / 4;
    const r = dragPoints({ points: pts, indices: [1, 2], grabbed: 1 }, 0.3, 0.8, { min: 0, max: 1, snap });
    expect(r.points.map((p) => p.t)).toEqual([0, 1.25, 2.25, 3]);
    expect(r.points[1].v).toBe(1);
    const far = dragPoints({ points: pts, indices: [1], grabbed: 1 }, 5, 0, { min: 0, max: 1 });
    expect(far.points[1].t).toBeLessThan(2);
    const back = dragPoints({ points: pts, indices: [1], grabbed: 1 }, -5, 0, { min: 0, max: 1 });
    expect(back.points[1].t).toBeGreaterThan(0);
    const stepped = dragPoints({ points: pts, indices: [1], grabbed: 1 }, 0, 0.3, { min: 0, max: 4, step: 1 });
    expect(stepped.points[1].v).toBe(1);
  });

  it('deletes points and sets curves', () => {
    expect(deletePoints(line().points, [0, 2]).map((p) => p.t)).toEqual([1]);
    const c = setPointCurves(line().points, [0], 'smooth');
    expect(c[0].c).toBe('smooth');
    expect(setPointCurves(c, [0], 'linear')[0].c).toBeUndefined();
  });

  it('formats readouts', () => {
    expect(formatLineValue(line(), 0.456)).toBe('0.46');
    expect(formatLineValue(line({ kind: 'bool' }), 1)).toBe('on');
    expect(formatLineValue(line(), undefined)).toBe('—');
  });
});

describe('the parameter picker', () => {
  const entries: ParamEntry[] = [
    { key: 'layer:opacity', label: 'Opacity', group: 'Layer', min: 0, max: 1, step: 0.01, default: 1, kind: 'continuous' },
    { key: 'shader:speed', label: 'Speed', group: 'Shader', min: 0, max: 4, step: 0.01, default: 1, kind: 'continuous' },
    { key: 'shader:glow', label: 'Glow amount', group: 'Shader', min: 0, max: 1, step: 0.01, default: 0, kind: 'continuous' },
    { key: 'transform:x', label: 'Move X', group: 'Transform', min: -1, max: 1, step: 0.01, default: 0, kind: 'continuous' },
  ];
  it('groups, searches every word, and leaves out keys that have a line', () => {
    expect(filterParams(entries, '').map(([g]) => g)).toEqual(['Layer', 'Shader', 'Transform']);
    expect(filterParams(entries, 'shader glow')).toEqual([['Shader', [entries[2]]]]);
    expect(filterParams(entries, 'MOVE')[0][1][0].key).toBe('transform:x');
    expect(filterParams(entries, '', new Set(['layer:opacity'])).map(([g]) => g)).toEqual(['Shader', 'Transform']);
  });
});

describe('◆ next to a panel control', () => {
  it('reads the line key from the control\'s MIDI path', () => {
    expect(lineKeyForControlPath('map:layer:opacity')).toEqual({ scope: 'piece', key: 'layer:opacity' });
    expect(lineKeyForControlPath('map:shader:speed')).toEqual({ scope: 'piece', key: 'shader:speed' });
    expect(lineKeyForControlPath('map:effect:fx1:amount')).toEqual({ scope: 'piece', key: 'fx:fx1:amount' });
    expect(lineKeyForControlPath('map:edge:e1:stroke.width')).toEqual({ scope: 'piece', key: 'edge:e1:stroke.width' });
    expect(lineKeyForControlPath('map:gpu:planetX')).toEqual({ scope: 'piece', key: 'gpu:planetX' });
    expect(lineKeyForControlPath('map:stage-effect:s1:opacity')).toEqual({ scope: 'stage', key: 'stage:fx:s1:opacity' });
    expect(lineKeyForControlPath('map:stage-effect:s1:hold')).toBeNull();
    expect(lineKeyForControlPath('map:media:play')).toBeNull();
    expect(lineKeyForControlPath('vj:1:opacity')).toBeNull();
  });

  it('acts on the selected block for its media\'s keys, else the piece', () => {
    const ctx = { selectedLayerId: 'A', activeBlockClipId: 'c1' };
    expect(resolveControlTarget({ scope: 'piece', key: 'shader:speed' }, ctx)).toEqual({ scope: 'block', id: 'c1' });
    expect(resolveControlTarget({ scope: 'piece', key: 'layer:opacity' }, ctx)).toEqual({ scope: 'layer', id: 'A' });
    expect(resolveControlTarget({ scope: 'piece', key: 'shader:speed' }, { selectedLayerId: 'A', activeBlockClipId: null })).toEqual({ scope: 'layer', id: 'A' });
    expect(resolveControlTarget({ scope: 'piece', key: 'layer:opacity' }, { selectedLayerId: null, activeBlockClipId: null })).toBeNull();
    expect(resolveControlTarget({ scope: 'look', key: 'look:intensity', id: 'L' }, ctx)).toEqual({ scope: 'look', id: 'L' });
    expect(resolveControlTarget({ scope: 'stage', key: 'stage:fx:s:opacity' }, ctx)).toEqual({ scope: 'stage' });
  });
});
