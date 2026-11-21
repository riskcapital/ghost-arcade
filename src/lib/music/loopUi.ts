/**
 * What the looper panels show: the track button's words and colour, and a
 * beat clock read once per frame while a panel watches it.
 */

import { readable } from 'svelte/store';
import { launchClockPosition } from '../stores/launchClock';
import { BEATS_PER_BAR } from './loopRecorder';
import type { TrackView } from './loopStation';

/** The launch clock's beat, read every frame while something shows it. */
export const beatNow = readable(0, (set) => {
  if (typeof requestAnimationFrame === 'undefined') return;
  let handle = 0;
  const tick = () => {
    set(launchClockPosition().beat);
    handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(handle);
});

export type ButtonTone = 'idle' | 'rec' | 'play' | 'muted';

export function buttonTone(v: TrackView, muted = false): ButtonTone {
  if (v.phase === 'armed' || v.phase === 'record' || v.phase === 'overdub') return 'rec';
  if (v.phase === 'play') return muted ? 'muted' : 'play';
  return 'idle';
}

/** Where a track is in its loop, 0–1. */
export function trackProgress(v: TrackView, beat: number): number {
  if (v.phase === 'record' && v.endBeat !== null && v.endBeat > v.startBeat) return Math.max(0, Math.min(1, (beat - v.startBeat) / (v.endBeat - v.startBeat)));
  if (!(v.beats > 0) || (v.phase !== 'play' && v.phase !== 'overdub') || beat < v.origin) return 0;
  return (((beat - v.origin) % v.beats) + v.beats) % v.beats / v.beats;
}
