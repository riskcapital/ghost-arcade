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
import { barBeatAt, beatAtSeconds, secondsAtBar } from '../tempoMap';
import { quartersPerBarAt, showTempoAt } from './beatChase';

interface Anchor {
  t: number;
  at: number;
  map: ShowTempoMap;
}

/** Beat and tempo for a playing show at `nowMs`, from its last published
 *  position, with the show's bar length and a bar line of its metre so bar
 *  launches land on its bars in 3/4 or 6/8 too. */
export function showBeatAt(anchor: Anchor | null, nowMs: number): { beat: number; bpm: number; barQuarters: number; barOrigin: number } | null {
  if (!anchor) return null;
  const run = Math.max(-0.25, Math.min(0.25, (nowMs - anchor.at) / 1000));
  const t = anchor.t + run;
  const { map } = anchor;
  // Bars count from the first bar of the segment in force (its metre).
  const bar = barBeatAt(map, t).bar;
  const segBar = map.segments.reduce((b, s) => (s.bar <= bar ? s.bar : b), map.segments[0]?.bar ?? 1);
  return {
    beat: beatAtSeconds(map, t),
    bpm: showTempoAt(map, t),
    barQuarters: quartersPerBarAt(map, t),
    barOrigin: beatAtSeconds(map, secondsAtBar(map, Math.min(segBar, bar))),
  };
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
