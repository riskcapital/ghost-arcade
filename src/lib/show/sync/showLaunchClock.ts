/**
 * The show drives the app's launch clock while it plays with a tempo map, so
 * beat-reactive effects, quantised launches and bpm-synced LFOs lock to the
 * show's bars instead of a free-running local clock.
 *
 * The show store publishes its playhead once a frame; between publishes the
 * position runs on at real time (at most a quarter second, so a stalled show
 * never runs away).
 */
import type { ShowTempoMap } from '../../types';
import { showTimeline } from '../../stores/showTimeline';
import { setShowBeatSource } from '../../stores/launchClock';
import { beatAtSeconds } from '../tempoMap';
import { showTempoAt } from './beatChase';

interface Anchor {
  t: number;
  at: number;
  map: ShowTempoMap;
}

/** Beat and tempo for a playing show at `nowMs`, from its last published position. */
export function showBeatAt(anchor: Anchor | null, nowMs: number): { beat: number; bpm: number } | null {
  if (!anchor) return null;
  const run = Math.max(-0.25, Math.min(0.25, (nowMs - anchor.at) / 1000));
  const t = anchor.t + run;
  return { beat: beatAtSeconds(anchor.map, t), bpm: showTempoAt(anchor.map, t) };
}

export function installShowLaunchClock(now: () => number = () => performance.now()): () => void {
  let anchor: Anchor | null = null;
  // Re-anchored only when the playhead, play state or tempo map changes.
  // Other updates (selection, zoom) carry no new position: re-anchoring on
  // them moved `at` without moving `t`, so the beat stepped back by up to a
  // frame each time.
  const unsubscribe = showTimeline.subscribe((s) => {
    if (!(s.isPlaying && s.tempo)) {
      anchor = null;
      return;
    }
    if (anchor && anchor.t === s.currentTime && anchor.map === s.tempo) return;
    anchor = { t: s.currentTime, at: now(), map: s.tempo };
  });
  setShowBeatSource((nowMs) => showBeatAt(anchor, nowMs));
  return () => {
    unsubscribe();
    setShowBeatSource(null);
  };
}
