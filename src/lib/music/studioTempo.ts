/**
 * The Studio's tempo controls for syncing with a live band: Tap, Downbeat
 * (this is beat 1), Nudge, half and double, and follow the band's audio.
 * Everything goes to the one shared clock (audioStore and launchClock), so
 * VJ, loops, echoes, the build and tempo-synced effects all follow.
 */

import { get, writable } from 'svelte/store';
import { audioBpm, audioManualBpm, audioStore } from '../stores/audio';
import { launchClockPosition, resyncLaunchClock, setTempoNudgeInput } from '../stores/launchClock';
import { addTap, emptyTaps, msToNextBeat, scaleTempo, tapBpm, type TapState } from './tapTempo';

let taps: TapState = emptyTaps();
let pending: ReturnType<typeof setTimeout> | null = null;

/** Each tap, for the readout to flash on; `bpm` once the taps make a tempo. */
export const studioTapPulse = writable<{ at: number; count: number; bpm: number | null }>({ at: 0, count: 0, bpm: null });

/** Set the shared tempo on the next beat, so nothing jumps mid-bar. */
function setTempoOnBeat(bpm: number): void {
  if (pending) clearTimeout(pending);
  const { beat, beatMs } = launchClockPosition();
  pending = setTimeout(() => {
    pending = null;
    audioStore.setManualBPM(bpm);
  }, msToNextBeat(beat, beatMs));
}

export function tapStudioTempo(nowMs = performance.now()): void {
  taps = addTap(taps, nowMs);
  const bpm = tapBpm(taps);
  studioTapPulse.set({ at: nowMs, count: taps.taps.length, bpm });
  if (bpm !== null) setTempoOnBeat(bpm);
}

/** "This is beat 1": the bar starts now, the tempo stays. */
export function studioDownbeat(): boolean {
  return resyncLaunchClock();
}

/** Hold to drift faster or slower into phase with the band, like a DJ. */
export function studioNudge(direction: -1 | 0 | 1): void {
  setTempoNudgeInput('studio-nudge', direction);
}

/** A typed tempo: it lands on the next beat, and stops following the band's audio. */
export function setStudioTempo(bpm: number): boolean {
  if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300) return false;
  setTempoOnBeat(Math.round(bpm * 100) / 100);
  return true;
}

export function studioScaleTempo(factor: 0.5 | 2): void {
  const bpm = get(audioBpm);
  if (bpm > 0) setTempoOnBeat(scaleTempo(bpm, factor));
}

/** Follow the band's detected tempo, or lock the tempo where it is now. */
export function setFollowBand(on: boolean): void {
  if (on) audioStore.clearManualBPM();
  else {
    const bpm = get(audioBpm);
    if (bpm > 0) audioStore.setManualBPM(bpm);
  }
}

export function followingBand(): boolean {
  return get(audioManualBpm) === null;
}
