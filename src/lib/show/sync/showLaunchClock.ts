/**
 * The show drives the app's launch clock while it plays with a tempo map, so
 * beat-reactive effects, quantised launches and bpm-synced LFOs lock to the
 * show's bars instead of a free-running local clock.
 *
 * The show store publishes its playhead once a frame; between publishes the
 * position runs on at real time (at most a quarter second, so a stalled show
 * never runs away).
 */
import { engineNowMs, renderClockActive } from '../../recording/renderClock';
import type { ShowTempoMap } from '../../types';
import { get } from 'svelte/store';
import { showSectionStatus, showTimeline } from '../../stores/showTimeline';
import { setShowBeatSource } from '../../stores/launchClock';
import { barBeatAt, beatAtSeconds, secondsAtBar } from '../tempoMap';
import { quartersPerBarAt, showTempoAt } from './beatChase';

interface Anchor {
  t: number;
  at: number;
  map: ShowTempoMap;
  /** A Hold section: the playhead waits, the beat runs on (free-run). */
  holding?: boolean;
}

/** Beat and tempo for a playing show at `nowMs`, from its last published
 *  position, with the show's bar length and a bar line of its metre so bar
 *  launches land on its bars in 3/4 or 6/8 too. */
export function showBeatAt(anchor: Anchor | null, nowMs: number): { beat: number; bpm: number; barQuarters: number; barOrigin: number } | null {
  if (!anchor) return null;
  const { map } = anchor;
  if (anchor.holding) {
    // Held at a section end: beat LFOs, phrases and bar takeovers keep
    // going at the hold's tempo and metre instead of stepping every 0.25 s.
    const bpm = showTempoAt(map, anchor.t);
    const base = beatAtSeconds(map, anchor.t);
    const bar = barBeatAt(map, anchor.t).bar;
    const segBar = map.segments.reduce((b, s) => (s.bar <= bar ? s.bar : b), map.segments[0]?.bar ?? 1);
    return {
      beat: base + (Math.max(0, nowMs - anchor.at) / 1000) * (bpm / 60),
      bpm,
      barQuarters: quartersPerBarAt(map, anchor.t),
      barOrigin: beatAtSeconds(map, secondsAtBar(map, Math.min(segBar, bar))),
    };
  }
  const run = Math.max(-0.25, Math.min(0.25, (nowMs - anchor.at) / 1000));
  const t = anchor.t + run;
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

export function installShowLaunchClock(now: () => number = () => engineNowMs()): () => void {
  let anchor: Anchor | null = null;
  // Re-anchored only when the playhead, play state or tempo map changes.
  // Other updates (selection, zoom) carry no new position: re-anchoring on
  // them moved `at` without moving `t`, so the beat stepped back by up to a
  // frame each time.
  const unsubscribe = showTimeline.subscribe((s) => {
    // Render to video seeks a paused show frame by frame: its bars still
    // drive the clock, on the render's time.
    if (!(s.tempo && (s.isPlaying || renderClockActive()))) {
      anchor = null;
      return;
    }
    const holding = s.isPlaying && !!get(showSectionStatus).holdId;
    if (anchor && anchor.t === s.currentTime && anchor.map === s.tempo && !!anchor.holding === holding) return;
    anchor = { t: s.currentTime, at: now(), map: s.tempo, holding };
  });
  // A hold starts or ends without the playhead moving: re-anchor then too.
  const unsubHold = showSectionStatus.subscribe((st) => {
    if (!anchor || !!anchor.holding === !!st.holdId) return;
    anchor = { ...anchor, at: now(), holding: !!st.holdId && get(showTimeline).isPlaying };
  });
  setShowBeatSource((nowMs) => showBeatAt(anchor, nowMs));
  return () => {
    unsubscribe();
    unsubHold();
    setShowBeatSource(null);
  };
}
