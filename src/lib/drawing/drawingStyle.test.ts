import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAWING_STYLE, drawingRotation, resolveDrawingStyle } from './drawingStyle';

const none = { type: 'none' } as const;

describe('drawing style resolution', () => {
  it('keeps the shape shader rule: fields an element lacks keep the previous value', () => {
    const first = resolveDrawingStyle({
      fill: none,
      stroke: { type: 'dashed', color: [1, 0, 0, 1], width: 7, dashLength: 0.5, gapLength: 0.25, animated: true, animationSpeed: 2 },
      animation: none,
    } as any);
    expect(first.strokeType).toBe(6);
    expect(first.dashLength).toBe(0.5);
    // A glow drawn next keeps the dash values it never mentions.
    const second = resolveDrawingStyle({
      fill: none,
      stroke: { type: 'glow', color: [0, 1, 0, 1], width: 3, glowSize: 12, glowIntensity: 2, pulseSpeed: 0 },
      animation: none,
    } as any, first);
    expect(second.dashLength).toBe(0.5);
    expect(second.glowSize).toBe(12);
    // Resolving from the defaults instead gives the documented values.
    const fresh = resolveDrawingStyle({ fill: none, stroke: { type: 'glow' } as any, animation: none });
    expect(fresh.dashLength).toBe(DEFAULT_DRAWING_STYLE.dashLength);
    expect(fresh.strokeColor).toEqual(DEFAULT_DRAWING_STYLE.strokeColor);
  });

  it('maps each field the way the renderer always has', () => {
    const neon = resolveDrawingStyle({ fill: none, stroke: { type: 'neon', color: [1, 0, 1, 1], width: 2, glowSize: 20, pulseSpeed: 0.5, flickerSpeed: 3 } as any, animation: none });
    expect(neon.pulseSpeed).toBe(3);
    const pulse = resolveDrawingStyle({ fill: none, stroke: { type: 'pulse', color: [1, 1, 1, 1], width: 3 } as any, animation: none });
    expect(pulse.strokeType).toBe(4);
    expect(pulse.snakeCount).toBe(1);
    // Noise reads color1 only when a second colour is present.
    const noise = resolveDrawingStyle({ fill: { type: 'noise', color1: [0.2, 0.3, 0.4, 1], color2: [1, 1, 1, 1], scale: 6 } as any, stroke: none, animation: none });
    expect(noise.fillColor).toEqual([0.2, 0.3, 0.4, 1]);
    expect(noise.noiseColor2).toEqual([1, 1, 1, 1]);
    expect(noise.noiseScale).toBe(6);
    const holo = resolveDrawingStyle({ fill: { type: 'holographic', scanlines: true, flicker: 0.3 } as any, stroke: none, animation: none });
    expect(holo.holoScanlines).toBe(1);
    const gradient = resolveDrawingStyle({ fill: { type: 'gradient', color: [1, 0, 0, 1], color2: [0, 0, 1, 1], gradientType: 'angular' } as any, stroke: none, animation: none });
    expect(gradient.gradType).toBe(2);
    expect(gradient.gradColor2).toEqual([0, 0, 1, 1]);
  });

  it('turns the rotate animation into a continuous angle', () => {
    const cw = resolveDrawingStyle({ fill: none, stroke: none, animation: { type: 'rotate', speed: 2, direction: 'cw' } as any });
    const ccw = resolveDrawingStyle({ fill: none, stroke: none, animation: { type: 'rotate', speed: 2, direction: 'ccw' } as any });
    expect(drawingRotation(cw, 1.5)).toBeCloseTo(3);
    expect(drawingRotation(ccw, 1.5)).toBeCloseTo(-3);
    expect(drawingRotation(resolveDrawingStyle({ fill: none, stroke: none, animation: none }), 1.5)).toBe(0);
  });
});
