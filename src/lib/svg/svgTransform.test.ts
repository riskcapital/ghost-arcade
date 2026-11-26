import { describe, expect, it } from 'vitest';
import { clampSvgPan, clampSvgScale, gizmoShortcutFor, svgPanDelta } from './svgTransform';

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

describe('gizmo shortcuts', () => {
  it('maps the bare keys', () => {
    expect(gizmoShortcutFor(key('w'))).toEqual({ kind: 'mode', mode: 'move' });
    expect(gizmoShortcutFor(key('E'))).toEqual({ kind: 'mode', mode: 'rotate' });
    expect(gizmoShortcutFor(key('s'))).toEqual({ kind: 'mode', mode: 'scale' });
    expect(gizmoShortcutFor(key('z'))).toEqual({ kind: 'axis', axis: 'z' });
    expect(gizmoShortcutFor(key('f'))).toEqual({ kind: 'frame' });
    expect(gizmoShortcutFor(key('q'))).toBeNull();
  });

  it('leaves Cmd/Ctrl/Alt combinations to the app (Undo, Save, Cut, Close)', () => {
    for (const k of ['z', 's', 'x', 'w', 'e', 'f', 'y']) {
      expect(gizmoShortcutFor(key(k, { metaKey: true }))).toBeNull();
      expect(gizmoShortcutFor(key(k, { ctrlKey: true }))).toBeNull();
      expect(gizmoShortcutFor(key(k, { altKey: true }))).toBeNull();
    }
  });
});

describe('svg pan drag', () => {
  it('follows the pointer at any viewport zoom', () => {
    // 100 screen px at 2x zoom is 50 canvas px: a quarter of half a 400 px canvas.
    expect(svgPanDelta(100, 0, 400, 200, 2).x).toBeCloseTo(0.25);
    expect(svgPanDelta(100, 0, 400, 200, 1).x).toBeCloseTo(0.5);
    expect(svgPanDelta(0, 50, 400, 200, 0.5).y).toBeCloseTo(1);
  });

  it('treats a missing zoom as 1', () => {
    expect(svgPanDelta(100, 0, 400, 200, 0).x).toBeCloseTo(0.5);
    expect(svgPanDelta(100, 0, 400, 200, Number.NaN).x).toBeCloseTo(0.5);
  });

  it('clamps to the renderer limits', () => {
    expect(clampSvgPan(3)).toBe(2);
    expect(clampSvgPan(-3)).toBe(-2);
    expect(clampSvgScale(0)).toBe(0.05);
    expect(clampSvgScale(20)).toBe(8);
  });
});
