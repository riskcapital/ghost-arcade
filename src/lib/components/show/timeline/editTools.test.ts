import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { showTimeline, setShowCompositionLoader } from '../../../stores/showTimeline';
import { REVERSE_SEEKS_PER_SECOND, _resetEditToolsForTest, shuttleBack, shuttleForward, shuttleReverse, shuttleStop } from './editTools';

let frames: Array<(now: number) => void> = [];
let now = 0;
/** Run `seconds` of 60 fps animation frames. */
function run(seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    now += 1000 / 60;
    const due = frames;
    frames = [];
    for (const f of due) f(now);
  }
}

beforeEach(() => {
  showTimeline._resetForTest();
  setShowCompositionLoader(() => {});
  frames = [];
  now = 1000;
  vi.stubGlobal('requestAnimationFrame', (f: (now: number) => void) => { frames.push(f); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
  showTimeline.addPresetClip('c1', 60);
  showTimeline.seek(30);
});
afterEach(() => {
  _resetEditToolsForTest();
  vi.unstubAllGlobals();
  setShowCompositionLoader(null);
  showTimeline._resetForTest();
});

describe('the backwards shuttle', () => {
  it('moves back at its speed, seeking only as often as songs and videos can follow', () => {
    const seek = vi.spyOn(showTimeline, 'seek');
    shuttleBack();
    run(1);
    expect(seek.mock.calls.length).toBeLessThanOrEqual(REVERSE_SEEKS_PER_SECOND + 1);
    expect(seek.mock.calls.length).toBeGreaterThanOrEqual(REVERSE_SEEKS_PER_SECOND - 1);
    expect(get(showTimeline).currentTime).toBeGreaterThan(28.9);
    expect(get(showTimeline).currentTime).toBeLessThan(29.1);
    // J again: twice as fast.
    shuttleBack();
    expect(get(shuttleReverse)).toBe(2);
    run(1);
    expect(get(showTimeline).currentTime).toBeGreaterThan(26.8);
    expect(get(showTimeline).currentTime).toBeLessThan(27.2);
  });

  it('K stops it, L plays forward, a click elsewhere is where it goes on from, and it stops at 0', () => {
    shuttleBack();
    run(0.5);
    shuttleStop();
    const at = get(showTimeline).currentTime;
    run(0.5);
    expect(get(showTimeline).currentTime).toBe(at);
    expect(get(shuttleReverse)).toBe(0);
    shuttleBack();
    run(0.2);
    showTimeline.seek(2);
    run(1);
    expect(get(showTimeline).currentTime).toBeLessThan(1.1);
    run(2);
    expect(get(showTimeline).currentTime).toBe(0);
    expect(get(shuttleReverse)).toBe(0);
    shuttleForward();
    expect(get(showTimeline).isPlaying).toBe(true);
  });
});
