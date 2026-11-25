/**
 * What the looper panels show: the track button's words and colour, and a
 * beat clock read once per frame while a panel watches it. @ui-text
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

/**
 * The looper's colours, as on a hardware looper: armed pulses red, recording
 * is solid red, overdubbing amber, playing green. `pending` blinks the ring
 * while a stop, start or punch waits for its bar.
 */
export type ButtonTone = 'idle' | 'armed' | 'rec' | 'dub' | 'play' | 'muted';

export function buttonTone(v: TrackView, muted = false): ButtonTone {
  if (v.phase === 'armed') return 'armed';
  if (v.phase === 'record') return 'rec';
  // An overdub waiting for its bar still plays: green until it records.
  if (v.phase === 'overdub') return v.pending === 'punch-in' ? 'play' : 'dub';
  if (v.phase === 'play') return muted ? 'muted' : 'play';
  return 'idle';
}

/** What the track button says, in a word or two. */
export function buttonLabel(v: TrackView, beat: number, muted = false): string {
  if (v.phase === 'empty') return 'Rec';
  if (v.phase === 'armed') {
    // Counting in (beats to go), then waiting for the first note.
    if (v.startBeat > beat + 1e-6) return `In ${Math.max(1, Math.ceil(v.startBeat - beat))}`;
    return v.waiting ? 'Ready' : 'Rec';
  }
  if (v.phase === 'record') {
    if (v.setsTempo) return 'Set';
    const bar = Math.max(1, Math.floor(Math.max(0, beat - v.startBeat) / BEATS_PER_BAR) + 1);
    if (v.endBeat !== null) return `Bar ${Math.min(bar, Math.max(1, Math.round((v.endBeat - v.startBeat) / BEATS_PER_BAR)))}/${Math.max(1, Math.round((v.endBeat - v.startBeat) / BEATS_PER_BAR))}`;
    return `Bar ${bar}`;
  }
  if (v.pending === 'stop') return 'Stop…';
  if (v.pending === 'punch-out') return 'End dub…';
  if (v.pending === 'punch-in') return 'Dub…';
  if (v.pending === 'play') return 'Start…';
  if (v.phase === 'overdub') return 'Dub';
  if (v.phase === 'play') return muted ? 'Muted' : 'Play';
  return 'Stopped';
}

/** A line saying what the track is doing, for the rows and columns. */
export function stateLine(v: TrackView, beat: number): string | null {
  if (v.phase === 'armed' && v.waiting) return v.startBeat > beat + 1e-6 ? 'Count-in, then your first note starts it' : 'Waiting for your first note';
  if (v.pending === 'stop') return 'Stopping on the next bar';
  if (v.pending === 'punch-out') return 'Ending the overdub on the next bar';
  if (v.pending === 'punch-in') return 'Overdub from the next bar';
  if (v.pending === 'play') return 'Starting on the next bar';
  return null;
}

/** Where a track is in its loop, 0–1 (waiting for a first note: where the loops playing are). */
export function trackProgress(v: TrackView, beat: number): number {
  if (v.phase === 'armed' && v.waiting && v.waitBeats > 0) return (((beat - v.waitOrigin) % v.waitBeats) + v.waitBeats) % v.waitBeats / v.waitBeats;
  if (v.phase === 'record' && v.endBeat !== null && v.endBeat > v.startBeat) return Math.max(0, Math.min(1, (beat - v.startBeat) / (v.endBeat - v.startBeat)));
  if (!(v.beats > 0) || (v.phase !== 'play' && v.phase !== 'overdub') || beat < v.origin) return 0;
  return (((beat - v.origin) % v.beats) + v.beats) % v.beats / v.beats;
}
