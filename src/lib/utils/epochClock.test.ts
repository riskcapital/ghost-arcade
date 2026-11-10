import { describe, expect, it } from 'vitest';
import { createEpochClock } from './epochClock';

/** Two windows on one machine: the same wall clock, monotonic clocks with
 *  their own origins (and one that stopped while the laptop slept). */
function machine() {
  let wall = 1_700_000_000_000;
  return {
    advance(ms: number) { wall += ms; },
    wall: () => Math.floor(wall),
    window(monoOriginWall: number) {
      let slept = 0;
      return {
        sleep(ms: number) { slept += ms; },
        sources: { monotonic: () => wall - monoOriginWall - slept, wall: () => Math.floor(wall) },
      };
    },
  };
}

describe('epoch clock', () => {
  it('two windows agree within a millisecond, also after one of them slept through a sleep', () => {
    const m = machine();
    const editor = m.window(1_700_000_000_000 - 50_000); // opened 50 s ago
    const editorClock = createEpochClock(editor.sources);
    // The editor's monotonic clock misses a 120 s sleep (macOS stops it).
    editor.sleep(120_000);
    const stage = m.window(1_700_000_000_000 - 2_000); // opened after the sleep
    const stageClock = createEpochClock(stage.sources);
    for (let i = 0; i < 50; i++) {
      m.advance(16.7);
      expect(Math.abs(editorClock.now() - stageClock.now())).toBeLessThan(1.5);
      expect(Math.abs(stageClock.now() - m.wall())).toBeLessThan(1.5);
    }
    // The old reading (timeOrigin + performance.now) put them 120 s apart.
    const oldEditor = (1_700_000_000_000 - 50_000) + editor.sources.monotonic();
    const oldStage = (1_700_000_000_000 - 2_000) + stage.sources.monotonic();
    expect(Math.round((oldStage - oldEditor) / 1000)).toBe(120);
  });

  it('follows a sleep that happens while it runs, at once', () => {
    const m = machine();
    const w = m.window(1_700_000_000_000);
    const clock = createEpochClock(w.sources);
    m.advance(1000);
    expect(Math.abs(clock.now() - m.wall())).toBeLessThan(1.5);
    w.sleep(30_000); // the monotonic clock stops for 30 s of wall time
    m.advance(30_000);
    expect(Math.abs(clock.now() - m.wall())).toBeLessThan(1.5);
  });

  it('keeps sub-millisecond steps between readings and maps performance times', () => {
    const m = machine();
    const w = m.window(1_700_000_000_000);
    const clock = createEpochClock(w.sources);
    const a = clock.now();
    m.advance(0.25);
    const b = clock.now();
    expect(b - a).toBeGreaterThan(0.1);
    expect(b - a).toBeLessThan(0.5);
    const mono = w.sources.monotonic();
    expect(Math.abs(clock.fromMonotonic(mono) - clock.now())).toBeLessThan(0.01);
  });
});
