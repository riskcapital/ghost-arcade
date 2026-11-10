/**
 * The launch clock runs on from the show's last published playhead. Store
 * updates that do not move the playhead (selection, zoom) must not
 * re-anchor it, or the beat steps backwards.
 */
import { describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

const state = writable<Record<string, unknown>>({ isPlaying: false, tempo: null, currentTime: 0, zoom: 50, selection: null });
let source: ((nowMs: number) => { beat: number; bpm: number } | null) | null = null;

vi.mock('../../stores/showTimeline', () => ({ showTimeline: { subscribe: (fn: (v: unknown) => void) => state.subscribe(fn) } }));
vi.mock('../../stores/launchClock', () => ({ setShowBeatSource: (s: typeof source) => { source = s; } }));

const { installShowLaunchClock } = await import('./showLaunchClock');

const tempo = { offset: 0, segments: [{ bar: 1, bpm: 120, beatsPerBar: 4, beatUnit: 4 }], source: 'manual' };

describe('show launch clock anchor', () => {
  it('keeps the beat moving forward through unrelated store updates', () => {
    let now = 1000;
    const uninstall = installShowLaunchClock(() => now);
    state.set({ isPlaying: true, tempo, currentTime: 10, zoom: 50, selection: null });
    now = 1010;
    const before = source!(now)!.beat;
    // A selection change 10 ms after the frame: same playhead.
    state.update((s) => ({ ...s, selection: { kind: 'layerClip', id: 'x' } }));
    state.update((s) => ({ ...s, zoom: 60 }));
    const after = source!(now)!.beat;
    expect(after).toBeCloseTo(before, 12);
    // 20 beats per 10 s at 120 BPM: 10.01 s is beat 20.02.
    expect(after).toBeCloseTo(20.02, 9);
    uninstall();
  });

  it('re-anchors when the playhead, the play state or the map changes', () => {
    let now = 0;
    const uninstall = installShowLaunchClock(() => now);
    state.set({ isPlaying: true, tempo, currentTime: 5, zoom: 50, selection: null });
    now = 100;
    state.update((s) => ({ ...s, currentTime: 5.1 }));
    expect(source!(100)!.beat).toBeCloseTo(10.2, 9);
    const faster = { ...tempo, segments: [{ bar: 1, bpm: 60, beatsPerBar: 4, beatUnit: 4 }] };
    now = 150;
    state.update((s) => ({ ...s, tempo: faster }));
    expect(source!(150)!.beat).toBeCloseTo(5.1, 9);
    state.update((s) => ({ ...s, isPlaying: false }));
    expect(source!(200)).toBeNull();
    now = 300;
    state.update((s) => ({ ...s, isPlaying: true }));
    expect(source!(300)!.beat).toBeCloseTo(5.1, 9);
    uninstall();
  });
});
