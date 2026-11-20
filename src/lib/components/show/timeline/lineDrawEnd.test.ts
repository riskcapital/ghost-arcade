import { describe, expect, it } from 'vitest';
import { lineDrawEnd } from './lineUi';

describe('a line lane stops where the show ends', () => {
  it('a 90 s show on a wider view: the line draws to 90 s, not the edge', () => {
    expect(lineDrawEnd(0, 140, 89.9)).toBe(89.9);
  });
  it('scrolled inside the show, or an empty show: the visible stretch', () => {
    expect(lineDrawEnd(20, 60, 89.9)).toBe(60);
    expect(lineDrawEnd(0, 60, 0)).toBe(60);
  });
  it('scrolled past the end: nothing to draw (a hair, never negative)', () => {
    expect(lineDrawEnd(100, 140, 89.9)).toBeCloseTo(100.001, 6);
  });
});
