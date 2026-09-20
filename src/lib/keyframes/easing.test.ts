import { describe, expect, it } from 'vitest';
import { applyEasing, evaluateNumericTrack, KEYFRAME_EASINGS } from './easing';
describe('keyframe easing', () => {
  it.each(KEYFRAME_EASINGS)('$label reaches both endpoints exactly', ({ value }) => {
    expect(applyEasing(0, value)).toBe(0);
    expect(applyEasing(1, value)).toBe(1);
    for (let i = 0; i <= 100; i++) expect(Number.isFinite(applyEasing(i / 100, value))).toBe(true);
  });
  it('preserves existing interpolation and hold semantics', () => {
    expect(applyEasing(.25, 'linear')).toBe(.25);
    expect(applyEasing(.25, 'ease-in')).toBe(.0625);
    expect(applyEasing(.25, 'ease-out')).toBe(.4375);
    expect(applyEasing(.25, 'ease-in-out')).toBe(.125);
    expect(applyEasing(.999, 'step')).toBe(0);
  });
  it('provides distinct sine, fast exponential, bounded bounce and elastic overshoot', () => {
    expect(applyEasing(.5, 'sine')).toBeCloseTo(.5);
    expect(applyEasing(.5, 'exponential')).toBeGreaterThan(.95);
    const bounce = Array.from({ length: 101 }, (_, i) => applyEasing(i / 100, 'bounce'));
    expect(bounce.every(value => value >= 0 && value <= 1)).toBe(true);
    expect(bounce.some((value, i) => i > 0 && value < bounce[i - 1])).toBe(true);
    expect(applyEasing(.15, 'elastic')).toBeGreaterThan(1);
  });
  it.each(KEYFRAME_EASINGS)('retains $label through serialization and evaluates descending tracks', ({ value }) => {
    const frames = JSON.parse(JSON.stringify([{ time: 1, value: 10, easing: value }, { time: 3, value: 2, easing: 'linear' }]));
    expect(evaluateNumericTrack(frames, 0)).toBe(10);
    expect(evaluateNumericTrack(frames, 2)).toBeCloseTo(10 - 8 * applyEasing(.5, value));
    expect(evaluateNumericTrack(frames, 3)).toBe(2);
  });
});
