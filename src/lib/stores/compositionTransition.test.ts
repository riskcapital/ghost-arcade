/**
 * A timed composition crossfade (preset tray, MIDI) published its store on
 * every animation frame for the whole window, so every subscriber ran 60
 * times a second. The store now publishes the start and the end; the frame
 * sync reads this instant's progress from `current()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compositionTransition } from './compositionTransition';

let clock = 1000;
let rafCallbacks: FrameRequestCallback[] = [];

function frames(count: number, stepMs = 1000 / 60): number[] {
  const seen: number[] = [];
  for (let i = 0; i < count; i++) {
    clock += stepMs;
    const pending = rafCallbacks;
    rafCallbacks = [];
    for (const cb of pending) cb(clock);
    vi.advanceTimersByTime(stepMs);
    const live = compositionTransition.current();
    if (live) seen.push(live.progress);
  }
  return seen;
}

beforeEach(() => {
  clock = 1000;
  rafCallbacks = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafCallbacks.push(cb); return rafCallbacks.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  compositionTransition._resetForTest();
});

afterEach(() => {
  compositionTransition._resetForTest();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('compositionTransition timed crossfade', () => {
  it('publishes its start and its end only, with the progress read from the clock in between', () => {
    const published: Array<number | null> = [];
    const unsub = compositionTransition.subscribe(($s) => published.push($s.active ? $s.active.progress : null));
    published.length = 0;

    compositionTransition.beginTimed('a', 'b', 'dissolve', 2);
    expect(published).toEqual([0]);
    const progress = frames(90); // 1.5 s of a 2 s fade
    expect(published).toEqual([0]);
    expect(progress).toHaveLength(90);
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThan(progress[i - 1]);
    expect(progress[59]).toBeCloseTo(0.5, 6);
    expect(compositionTransition.current()).toMatchObject({ style: 'dissolve', fromCompositionId: 'a', toCompositionId: 'b' });

    frames(40); // past the end
    expect(published).toEqual([0, null]);
    expect(compositionTransition.current()).toBeNull();
    unsub();
  });

  it('holds the last frame at 1, never past it, until the end is published', () => {
    compositionTransition.beginTimed('a', 'b', 'dipToBlack', 1);
    clock += 1500; // the clock ran past the end before the timer fired
    expect(compositionTransition.current()!.progress).toBe(1);
    expect(compositionTransition.current(clock - 1250)!.progress).toBeCloseTo(0.25, 9);
  });

  it('a timer that fires a moment early waits for the clock', () => {
    compositionTransition.beginTimed('a', 'b', 'dissolve', 1);
    clock += 990; // the timer is due (fake time 1000 ms) but the clock is 10 ms short
    vi.advanceTimersByTime(1000);
    expect(compositionTransition.current()?.progress).toBeCloseTo(0.99, 9);
    clock += 10;
    vi.advanceTimersByTime(10);
    expect(compositionTransition.current()).toBeNull();
  });

  it('the show timeline, a clear or a new ramp takes over and cancels the old end', () => {
    const published: Array<string | null> = [];
    const unsub = compositionTransition.subscribe(($s) => published.push($s.active ? `${$s.active.toCompositionId}@${$s.active.progress}` : null));
    published.length = 0;

    compositionTransition.beginTimed('a', 'b', 'dissolve', 1);
    compositionTransition.driveFromClock({ style: 'dissolve', fromCompositionId: 'a', toCompositionId: 'c', progress: 0.3 });
    // A clock-driven transition is never re-timed by the clock.
    clock += 400;
    expect(compositionTransition.current()!.progress).toBe(0.3);
    vi.advanceTimersByTime(2000);
    expect(published).toEqual(['b@0', 'c@0.3']);

    compositionTransition.beginTimed('c', 'd', 'dissolve', 1);
    compositionTransition.beginTimed('d', 'e', 'dissolve', 2);
    clock += 1100;
    vi.advanceTimersByTime(1100);
    // The first ramp's end did not end the second.
    expect(compositionTransition.current()?.toCompositionId).toBe('e');
    compositionTransition.clear();
    vi.advanceTimersByTime(5000);
    expect(published).toEqual(['b@0', 'c@0.3', 'd@0', 'e@0', null]);
    unsub();
  });

  it('no fade without a pair, a duration or a frame loop', () => {
    compositionTransition.beginTimed('a', 'a', 'dissolve', 1);
    expect(compositionTransition.current()).toBeNull();
    compositionTransition.beginTimed('a', 'b', 'dissolve', 0);
    expect(compositionTransition.current()).toBeNull();
    vi.stubGlobal('requestAnimationFrame', undefined);
    compositionTransition.beginTimed('a', 'b', 'dissolve', 1);
    expect(compositionTransition.current()).toBeNull();
  });
});
