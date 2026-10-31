import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../stores/launchClock', () => ({ launchClockTempo: () => 120 }));

import { BandFxVisuals, type BandFxTiming } from './bandFxVisuals';

describe("the band's throws and freezes in the visuals", () => {
  const notes: string[] = [];
  // Half a second between repeats, half of each coming back.
  const timing: BandFxTiming = { echo: () => ({ period: 0.5, feedback: 0.5 }), root: () => 2 };
  let fx: BandFxVisuals;

  beforeEach(() => {
    vi.useFakeTimers();
    notes.length = 0;
    fx = new BandFxVisuals((type, note, velocity, role, delay) => notes.push(`${type} ${note} ${role} ${velocity.toFixed(2)}${delay ? ` +${delay}` : ''}`), timing);
  });
  afterEach(() => vi.useRealTimers());

  it('holds a note while thrown, flashing on every repeat, then lets the repeats fade', () => {
    fx.throw(true);
    expect(notes).toEqual(['on 86 fx 1.00']);
    vi.advanceTimersByTime(500);
    expect(notes).toEqual(['on 86 fx 1.00', 'on 86 fx 1.00']);
    fx.throw(false);
    notes.length = 0;
    vi.advanceTimersByTime(5000);
    expect(notes).toEqual([
      'on 98 fx 0.50', 'off 98 fx 0.00 +0.12',
      'on 98 fx 0.25', 'off 98 fx 0.00 +0.12',
      'on 98 fx 0.13', 'off 98 fx 0.00 +0.12',
      'on 98 fx 0.06', 'off 98 fx 0.00 +0.12',
    ]);
    expect(fx.busy).toBe(false);
  });

  it('holds the pads up while frozen, and lets everything go at once', () => {
    fx.freeze(true);
    fx.freeze(true);
    fx.wash(true);
    fx.throw(true);
    fx.releaseAll();
    expect(notes).toEqual(['on 74 pad 0.90', 'on 93 fx 0.85', 'on 86 fx 1.00', 'off 86 fx 0.00', 'off 93 fx 0.00', 'off 74 pad 0.00']);
    expect(fx.busy).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(notes).toHaveLength(6);
  });
});
