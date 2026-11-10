/**
 * Launch clock: the beat grid VJ launches land on.
 *
 * Quantized clip and column triggers, autopilot beat counts, tempo nudge and
 * phrase resync all read this one clock, so "where are we in the bar" has a
 * single answer. Phase sources, in priority order:
 *   1) An Ableton Link session with peers owns tempo and phase. It is what
 *      the other apps on the network already agree on, so nudge and resync
 *      step aside while it runs.
 *   2) The show timeline, while it plays with a tempo map: its bars are the
 *      grid, so beat-reactive effects land on the show's beats. Resync steps
 *      aside while it drives.
 *   3) Audio with detected beats anchors to the most recent detected beat.
 *   4) Otherwise a local clock runs at the manual / detected BPM, so a tapped
 *      tempo with audio off still gives usable quantization.
 * Resync and nudge move the phase of (3) and (4).
 */

import { writable, get } from 'svelte/store';
import { audioStore } from './audio';
import { abletonLink } from '../sync/abletonLink';

/** Tempo bend while a nudge is held. A few percent walks the grid onto the
 *  music within a beat or two without the visuals visibly lurching. */
export const TEMPO_NUDGE_AMOUNT = 0.04;

export type TempoNudge = -1 | 0 | 1;

export interface LaunchClockState {
  nudge: TempoNudge;
  /** performance.now() of the last resync, so the UI can confirm it. */
  resyncedAt: number | null;
}

export const launchClock = writable<LaunchClockState>({ nudge: 0, resyncedAt: null });

export interface ClockSegment {
  ms: number;
  beat: number;
  bpm: number;
}

/** Beat position on a constant-tempo stretch of clock. */
export function segmentBeatAt(segment: ClockSegment, nowMs: number): number {
  return segment.beat + ((nowMs - segment.ms) * segment.bpm) / 60000;
}

/**
 * Wall-clock time (performance.now() ms) of the next `gridBeats` boundary
 * after `beat`. The epsilon stops a trigger that lands exactly on a boundary
 * from being scheduled onto that same boundary, which would fire it at once
 * and defeat the quantization.
 */
export function nextGridWallTime(nowMs: number, beat: number, beatMs: number, gridBeats: number): number {
  if (!(gridBeats > 0) || !(beatMs > 0) || !Number.isFinite(beat)) return nowMs;
  const target = Math.ceil((beat + 0.001) / gridBeats) * gridBeats;
  return nowMs + (target - beat) * beatMs;
}

type AudioClockInput = {
  manualBPM?: number | null;
  bpm?: number;
  isActive?: boolean;
  beat?: { beatCount?: number; /** ms */ timeSinceLastBeat?: number };
};

function setTempo(audio: AudioClockInput | null | undefined): number {
  const bpm = Number(audio?.manualBPM) || Number(audio?.bpm) || 120;
  return bpm > 0 ? bpm : 120;
}

/** Beat position of the audio-anchored clock, or null while no beats are
 *  being detected. Integer beats fall on detected beats. */
function audioBeatPosition(audio: AudioClockInput | null | undefined): number | null {
  if (!audio?.isActive) return null;
  const count = Number(audio.beat?.beatCount);
  const since = Number(audio.beat?.timeSinceLastBeat);
  if (!(count > 0) || !(since >= 0)) return null;
  // The analyzer reports the time since the last beat in milliseconds.
  return count + (since * setTempo(audio)) / 60000;
}

function linkTempo(): number | null {
  const link = get(abletonLink);
  return link.enabled && link.peers > 0 && link.tempo > 0 ? link.tempo : null;
}

/** Beat position and tempo from the playing show, or null when it is not
 *  driving (paused, or no tempo map). Set by show/sync/showLaunchClock.ts. */
export type ShowBeatSource = (nowMs: number) => { beat: number; bpm: number } | null;
let showBeatSource: ShowBeatSource | null = null;

export function setShowBeatSource(source: ShowBeatSource | null): void {
  showBeatSource = source;
}

function showBeat(nowMs: number): { beat: number; bpm: number } | null {
  if (!showBeatSource) return null;
  try {
    const b = showBeatSource(nowMs);
    return b && Number.isFinite(b.beat) && b.bpm > 0 ? b : null;
  } catch {
    return null;
  }
}

/** True while the playing show (and not Link) gives the clock its beats. */
export function launchClockFollowsShow(nowMs = performance.now()): boolean {
  return linkTempo() === null && showBeat(nowMs) !== null;
}

const CLOCK_EPOCH = performance.now();

// The local clock. Re-anchored whenever its tempo changes so its phase is
// continuous: a tap, a typed BPM or a held nudge bends the tempo from that
// moment on. Deriving the phase from one fixed epoch instead would rescale
// everything since boot on each tempo change and throw the grid somewhere
// arbitrary, undoing any resync.
let local: ClockSegment = { ms: CLOCK_EPOCH, beat: 0, bpm: 0 };
// Phase that resync and released nudges have moved the audio-anchored clock by.
let audioPhaseOffset = 0;
let nudge: TempoNudge = 0;
let nudgeSince = 0;
let lastAudioTempo = setTempo(get(audioStore));
const nudgeInputs = new Map<string, -1 | 1>();

function nudgeFactor(): number {
  return 1 + nudge * TEMPO_NUDGE_AMOUNT;
}

function syncLocalTempo(nowMs: number, audio: AudioClockInput | null | undefined): void {
  const bpm = setTempo(audio) * nudgeFactor();
  if (!(local.bpm > 0)) {
    local = { ...local, bpm };
    return;
  }
  if (local.bpm === bpm) return;
  local = { ms: nowMs, beat: segmentBeatAt(local, nowMs), bpm };
}

/** Beats a held nudge has moved the audio-anchored clock so far. */
function heldNudgeBeats(nowMs: number, tempo: number): number {
  if (nudge === 0) return 0;
  return (nudge * TEMPO_NUDGE_AMOUNT * Math.max(0, nowMs - nudgeSince) * tempo) / 60000;
}

/** Fold the phase a held nudge has gained into the clocks, from now on. */
function settleNudge(nowMs: number): void {
  if (nudge === 0) return;
  audioPhaseOffset += heldNudgeBeats(nowMs, lastAudioTempo);
  nudgeSince = nowMs;
}

/** True while an Ableton Link session with peers owns tempo and phase. */
export function launchClockFollowsLink(): boolean {
  return linkTempo() !== null;
}

/** The tempo the clock runs at right now, nudge included. BPM-synced clips
 *  and autopilot beat counts follow this so they move with the grid. */
export function launchClockTempo(): number {
  const link = linkTempo();
  if (link !== null) return link;
  const show = showBeat(performance.now());
  if (show) return show.bpm;
  return setTempo(get(audioStore)) * nudgeFactor();
}

/** Where the clock is: a beat position (integer = beat, multiple of 4 =
 *  downbeat) and how long one beat lasts from here on. */
export function launchClockPosition(nowMs = performance.now()): { beat: number; beatMs: number } {
  const link = linkTempo();
  if (link !== null) {
    // Continuous session beats retain two/four-bar phrase boundaries.
    return { beat: abletonLink.beatNow(), beatMs: 60000 / link };
  }
  const show = showBeat(nowMs);
  if (show) {
    // The show owns tempo and phase: a nudge held from before it started
    // stops here, so it does not keep moving the local phase underneath.
    if (nudge !== 0) {
      nudgeInputs.clear();
      stopTempoNudge(undefined, nowMs);
    }
    return { beat: show.beat, beatMs: 60000 / show.bpm };
  }
  const audio = get(audioStore) as AudioClockInput;
  const tempo = setTempo(audio);
  const audioBeat = audioBeatPosition(audio);
  if (audioBeat !== null) {
    return {
      beat: audioBeat + audioPhaseOffset + heldNudgeBeats(nowMs, tempo),
      beatMs: 60000 / (tempo * nudgeFactor()),
    };
  }
  syncLocalTempo(nowMs, audio);
  return { beat: segmentBeatAt(local, nowMs), beatMs: 60000 / local.bpm };
}

/** Wall-clock time of the next boundary of a grid `gridBeats` long. */
export function nextLaunchBoundary(gridBeats: number, nowMs = performance.now()): number {
  if (!(gridBeats > 0)) return nowMs;
  const { beat, beatMs } = launchClockPosition(nowMs);
  return nextGridWallTime(nowMs, beat, beatMs, gridBeats);
}

/** True while Link or the playing show owns tempo and phase: nudge and
 *  resync do nothing then. */
export function launchClockFollowsExternal(nowMs = performance.now()): boolean {
  return linkTempo() !== null || showBeat(nowMs) !== null;
}

/** Hold-to-nudge: run the clock a few percent fast (1) or slow (-1) until
 *  released. Ignored while Link or the playing show owns the tempo (a nudge
 *  then only shifted the hidden local phase, which jumped when the show
 *  stopped). */
export function startTempoNudge(direction: -1 | 1, nowMs = performance.now()): void {
  if (launchClockFollowsExternal(nowMs) || nudge === direction) return;
  settleNudge(nowMs);
  nudge = direction;
  nudgeSince = nowMs;
  syncLocalTempo(nowMs, get(audioStore));
  launchClock.update((s) => ({ ...s, nudge: direction }));
}

/** Release a nudge. The phase it gained stays; the tempo goes back to the set
 *  BPM. Releasing the opposite direction is ignored. */
export function stopTempoNudge(direction?: -1 | 1, nowMs = performance.now()): void {
  if (nudge === 0 || (direction !== undefined && direction !== nudge)) return;
  settleNudge(nowMs);
  nudge = 0;
  syncLocalTempo(nowMs, get(audioStore));
  launchClock.update((s) => ({ ...s, nudge: 0 }));
}

type ResyncListener = (nowMs: number) => void;
const resyncListeners = new Set<ResyncListener>();

/** Run `listener` after every resync (BPM-synced clips restart, auto LFOs
 *  reset). Returns an unsubscribe. */
export function onLaunchClockResync(listener: ResyncListener): () => void {
  resyncListeners.add(listener);
  return () => { resyncListeners.delete(listener); };
}

/**
 * Phrase resync: make now the downbeat. The grid realigns so boundaries fall
 * on whole bars from this moment, then listeners restart what is synced to it.
 * Returns false (and does nothing) while Link or the playing show owns the phase.
 */
export function resyncLaunchClock(nowMs = performance.now()): boolean {
  if (linkTempo() !== null || showBeat(nowMs) !== null) return false;
  settleNudge(nowMs);
  const audio = get(audioStore) as AudioClockInput;
  const audioBeat = audioBeatPosition(audio);
  if (audioBeat !== null) audioPhaseOffset = -audioBeat;
  // Realign the local clock too, so a phase source switch after the resync
  // (beats stop being detected) still lands on the bar the performer set.
  local = { ms: nowMs, beat: 0, bpm: setTempo(audio) * nudgeFactor() };
  launchClock.update((s) => ({ ...s, resyncedAt: nowMs }));
  for (const listener of resyncListeners) {
    try {
      listener(nowMs);
    } catch (error) {
      console.warn('[launchClock] resync listener failed:', error);
    }
  }
  return true;
}

// Re-anchor the local clock the moment its tempo changes (tap, typed BPM,
// MIDI clock, detected BPM), not at the next query, so the stretch before the
// change is counted at the old tempo.
audioStore.subscribe((audio) => {
  const now = performance.now();
  settleNudge(now);
  lastAudioTempo = setTempo(audio as AudioClockInput);
  syncLocalTempo(now, audio as AudioClockInput);
});

/** Independent ownership prevents one released pad from canceling another. */
export function setTempoNudgeInput(id: string, direction: -1 | 0 | 1): void {
  if (direction === 0) nudgeInputs.delete(id);
  else if (!launchClockFollowsExternal()) { nudgeInputs.delete(id); nudgeInputs.set(id, direction); }
  const latest = [...nudgeInputs.values()].at(-1);
  if (latest) startTempoNudge(latest);
  else stopTempoNudge();
}
export function releaseTempoNudgeInputs(prefix: string): void {
  for (const id of [...nudgeInputs.keys()]) if (id.startsWith(prefix)) nudgeInputs.delete(id);
  const latest = [...nudgeInputs.values()].at(-1);
  if (latest) startTempoNudge(latest); else stopTempoNudge();
}
abletonLink.subscribe(link => {
  if (link.enabled && link.peers > 0) { nudgeInputs.clear(); stopTempoNudge(); }
});
