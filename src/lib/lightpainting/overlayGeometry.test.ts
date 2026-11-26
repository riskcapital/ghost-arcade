import { describe, it, expect } from 'vitest';
import {
  normToOverlayPx,
  overlayPxToNorm,
  streamLineStep,
  streamLineCatchUp,
  isViewportPanGesture,
  pathEditLayoutKey,
  type OverlayView,
} from './overlayGeometry';

const view: OverlayView = {
  canvasOffsetX: 40, canvasOffsetY: 30, canvasWidth: 800, canvasHeight: 450,
  viewportZoom: 2.5, viewportPanX: -120, viewportPanY: 60,
};

describe('light-painting overlay geometry', () => {
  it('path-edit handles land under the pointer when zoomed and panned', () => {
    // A pointer at overlay pixel (500, 400) maps to a canvas point; the
    // handle for that point must be drawn back at (500, 400).
    const n = overlayPxToNorm(500, 400, view);
    const px = normToOverlayPx(n.x, n.y, view);
    expect(px.x).toBeCloseTo(500, 6);
    expect(px.y).toBeCloseTo(400, 6);
  });

  it('applies zoom and pan (identity view reduces to offset + size)', () => {
    const id = { ...view, viewportZoom: 1, viewportPanX: 0, viewportPanY: 0 };
    expect(normToOverlayPx(0.5, 0.5, id)).toEqual({ x: 440, y: 255 });
    expect(normToOverlayPx(0.5, 0.5, view)).toEqual({ x: 440 * 2.5 - 120, y: 255 * 2.5 + 60 });
  });

  it('StreamLine lags while drawing and the catch-up point finishes at the pen', () => {
    let last: { x: number; y: number } | null = { x: 0, y: 0 };
    const raw = { x: 1, y: 0, pressure: 0.7, timestamp: 10 };
    for (let i = 0; i < 3; i++) last = streamLineStep(last, raw, 0.8);
    expect(last!.x).toBeLessThan(0.99);
    expect(streamLineCatchUp(last!, raw, 0.002)).toBe(raw);
    expect(streamLineCatchUp({ x: 1, y: 0 }, raw, 0.002)).toBeNull();
    expect(streamLineStep(last, raw, 0)).toEqual({ x: 1, y: 0 });
  });

  it('middle-click, Alt+drag and Space+drag are viewport pans', () => {
    expect(isViewportPanGesture({ button: 1, altKey: false }, false)).toBe(true);
    expect(isViewportPanGesture({ button: 0, altKey: true }, false)).toBe(true);
    expect(isViewportPanGesture({ button: 0, altKey: false }, true)).toBe(true);
    expect(isViewportPanGesture({ button: 0, altKey: false }, false)).toBe(false);
  });

  it('path-edit selection key is stable while points move', () => {
    expect(pathEditLayoutKey('s1', false, 24)).toBe(pathEditLayoutKey('s1', false, 24));
    expect(pathEditLayoutKey('s1', false, 24)).not.toBe(pathEditLayoutKey('s2', false, 24));
    expect(pathEditLayoutKey('s1', false, 24)).not.toBe(pathEditLayoutKey('s1', true, 24));
    expect(pathEditLayoutKey('s1', false, 24)).not.toBe(pathEditLayoutKey('s1', false, 23));
  });
});
