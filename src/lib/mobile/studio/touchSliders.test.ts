import { describe, expect, it } from 'vitest';
import { faderValue, gestureAxis, isDoubleTap, relativeValue, SLIDER_SLOP } from './touchSliders';

describe('scroll-safe slider gestures', () => {
  it('waits inside the slop circle, then reads the dominant axis', () => {
    expect(gestureAxis(2, 3)).toBe('pending');
    expect(gestureAxis(SLIDER_SLOP + 1, 2)).toBe('adjust');
    expect(gestureAxis(-9, 4)).toBe('adjust');
    // The reviewed bug: a scroll swipe that starts on a slider must scroll, not edit.
    expect(gestureAxis(3, -40)).toBe('scroll');
    expect(gestureAxis(7, 7)).toBe('scroll');
  });
  it('adjusts relative to the starting value instead of jumping to the finger', () => {
    // Audio response 0..2 on a 300 px track: 50 px left of wherever it was grabbed is -0.333.
    expect(relativeValue(1.78, -50, 300, 0, 2, 0.01)).toBeCloseTo(1.45, 2);
    expect(relativeValue(1, 0, 300, 0, 2, 0.01)).toBe(1);
    expect(relativeValue(1, 150, 300, 0, 2, 0.01)).toBe(2);
    expect(relativeValue(1.9, 600, 300, 0, 2, 0.01)).toBe(2);
    expect(relativeValue(0.1, -600, 300, 0, 2, 0.01)).toBe(0);
  });
  it('snaps to the step grid and survives degenerate ranges', () => {
    expect(relativeValue(3, 31, 100, 0, 10, 1)).toBe(6);
    expect(relativeValue(0.5, 10, 100, 0, 1, 0)).toBeCloseTo(0.6, 8);
    expect(relativeValue(5, 10, 100, 4, 4, 1)).toBe(4);
    expect(relativeValue(0.5, 10, 0, 0, 1, 0)).toBe(1);
  });
  it('resets only on a quick second tap in the same place', () => {
    const first = { time: 1000, x: 100, y: 200 };
    expect(isDoubleTap(first, 1200, 104, 203)).toBe(true);
    expect(isDoubleTap(first, 1500, 104, 203)).toBe(false);
    expect(isDoubleTap(first, 1200, 160, 200)).toBe(false);
    expect(isDoubleTap(null, 1200, 100, 200)).toBe(false);
  });
});

describe('mixer fader', () => {
  it('moves by the distance dragged, wherever the thumb was grabbed', () => {
    // 104 px track at 100%: dragging down half the track is 50%, not "wherever the finger is".
    expect(faderValue(1, 52, 104)).toBeCloseTo(0.5, 5);
    expect(faderValue(0.5, -26, 104)).toBeCloseTo(0.75, 5);
    expect(faderValue(1, 0, 104)).toBe(1);
  });
  it('stays inside 0..1', () => {
    expect(faderValue(0.9, -500, 104)).toBe(1);
    expect(faderValue(0.1, 500, 104)).toBe(0);
  });
});
