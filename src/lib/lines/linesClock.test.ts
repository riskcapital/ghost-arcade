import { beforeEach, describe, expect, it } from 'vitest';
import { linesAnimationTime, resetLinesClock, restartLinesAnimation } from './linesClock';

describe('lines animation clock', () => {
  beforeEach(() => resetLinesClock());

  it('runs on the core clock until a restart, then from the restart', () => {
    expect(linesAnimationTime('a', 12.5)).toBe(12.5);
    restartLinesAnimation('a');
    expect(linesAnimationTime('a', 20)).toBe(0);
    expect(linesAnimationTime('a', 21.5)).toBe(1.5);
    // Other layers are untouched.
    expect(linesAnimationTime('b', 21.5)).toBe(21.5);
  });

  it('starts over when the clock goes back (a new session)', () => {
    restartLinesAnimation('a');
    linesAnimationTime('a', 30);
    expect(linesAnimationTime('a', 2)).toBe(2);
    expect(linesAnimationTime('a', 3)).toBe(3);
  });
});
