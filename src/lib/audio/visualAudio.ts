// Shared visual-audio follower.
//
// Raw analyser values are great for meters and FFT textures, but they make
// shader params feel like a speaker cone: up on the transient, snap back on
// the next frame. This module turns the app's audioStore into Milkdrop-style
// control signals that are safe to feed into visual params everywhere.

import { get, writable } from 'svelte/store';
import { audioStore, type AudioState } from '../stores/audio';
import type { AudioBands, BandKickSnare } from './analyzer';
import { MilkdropFollower } from './milkdropFollower';

export interface VisualAudioState {
  isActive: boolean;
  bands: AudioBands;
  level: number;
  energy: number;
  peak: number;
  bass: number;
  bassFast: number;
  mid: number;
  treble: number;
  high: number;
  sub: number;
  lowMid: number;
  highMid: number;
  air: number;
  presence: number;
  kick: number;
  snare: number;
  beat: number;
  beatPhase: number;
  lfoBeat: number;
  lfoHalf: number;
  lfoBar: number;
  centroid: number;
  bpm: number;
}

const EMPTY_BANDS: AudioBands = {
  sub: 0,
  bass: 0,
  lowMid: 0,
  mid: 0,
  highMid: 0,
  treble: 0,
  air: 0,
  presence: 0,
  high: 0,
};

const EMPTY_KICK_SNARE: BandKickSnare = {
  isKick: false,
  kickIntensity: 0,
  timeSinceLastKick: 0,
  isSnare: false,
  snareIntensity: 0,
  timeSinceLastSnare: 0,
};

const DEFAULT_VISUAL_AUDIO: VisualAudioState = {
  isActive: false,
  bands: { ...EMPTY_BANDS },
  level: 0,
  energy: 0,
  peak: 0,
  bass: 0,
  bassFast: 0,
  mid: 0,
  treble: 0,
  high: 0,
  sub: 0,
  lowMid: 0,
  highMid: 0,
  air: 0,
  presence: 0,
  kick: 0,
  snare: 0,
  beat: 0,
  beatPhase: 0,
  lfoBeat: 0.5,
  lfoHalf: 0.5,
  lfoBar: 0.5,
  centroid: 0,
  bpm: 0,
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function nowSec(): number {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return now / 1000;
}

function smoothTowards(current: number, target: number, halfLifeMs: number, dt: number): number {
  if (halfLifeMs <= 0) return target;
  const alpha = 1 - Math.pow(0.5, (dt * 1000) / halfLifeMs);
  return current + (target - current) * alpha;
}

function ratioToUnit(ratio: number, floor = 0.72, span = 0.9): number {
  return clamp01((ratio - floor) / span);
}

function decayVisualAudio(prev: VisualAudioState, dt: number): VisualAudioState {
  const phase = (prev.beatPhase + dt * Math.max(prev.bpm / 60, 0.5)) % 1;
  const lfoBeat = Math.sin(phase * Math.PI * 2) * 0.5 + 0.5;
  return {
    ...prev,
    isActive: false,
    bands: { ...EMPTY_BANDS },
    level: smoothTowards(prev.level, 0, 500, dt),
    energy: smoothTowards(prev.energy, 0, 1600, dt),
    peak: smoothTowards(prev.peak, 0, 900, dt),
    bass: smoothTowards(prev.bass, 0, 650, dt),
    bassFast: smoothTowards(prev.bassFast, 0, 220, dt),
    mid: smoothTowards(prev.mid, 0, 650, dt),
    treble: smoothTowards(prev.treble, 0, 500, dt),
    high: smoothTowards(prev.high, 0, 500, dt),
    sub: smoothTowards(prev.sub, 0, 650, dt),
    lowMid: smoothTowards(prev.lowMid, 0, 650, dt),
    highMid: smoothTowards(prev.highMid, 0, 500, dt),
    air: smoothTowards(prev.air, 0, 500, dt),
    presence: smoothTowards(prev.presence, 0, 650, dt),
    kick: smoothTowards(prev.kick, 0, 180, dt),
    snare: smoothTowards(prev.snare, 0, 220, dt),
    beat: smoothTowards(prev.beat, 0, 260, dt),
    beatPhase: phase,
    lfoBeat,
    lfoHalf: lfoBeat,
    lfoBar: lfoBeat,
    centroid: smoothTowards(prev.centroid, 0, 900, dt),
  };
}

/** dt clamp shared by the live and manual-clock paths. A debugger pause
 *  (or a slow export frame) must never hand the integrators a huge step. */
function clampDt(dt: number): number {
  return Math.max(0.001, Math.min(0.1, Number.isFinite(dt) ? dt : 1 / 60));
}

function createVisualAudioStore() {
  const follower = new MilkdropFollower();
  const { subscribe, set } = writable<VisualAudioState>(DEFAULT_VISUAL_AUDIO);
  let latest = DEFAULT_VISUAL_AUDIO;
  let lastAt = 0;
  let lastInputType: AudioState['inputType'] = 'none';
  let energy = 0;
  let peak = 0;

  // ─── Manual-clock (offline render) state ──────────────────────────
  // Mirrors setISFManualTime / setStageEffectsManualTime: while a virtual
  // time is set, every integrator in here advances on the DELTA BETWEEN
  // SUCCESSIVE MANUAL TIMES instead of the wall clock. An export that
  // takes 15 s of wall time to write 10 s of video must fold exactly 10 s
  // of envelope / LFO / beat-phase motion into the file.
  let manualTime: number | null = null;
  let lastManualTime: number | null = null;
  /** Published state as of the moment the export took over, restored on
   *  release so the live show doesn't inherit the export's envelopes. */
  let liveSnapshot: VisualAudioState | null = null;
  /** Newest analyser emission. In manual mode the store is pumped once per
   *  exported frame rather than once per analyser callback (an export may
   *  capture several frames between two callbacks, or none), so the pump
   *  needs the latest input parked somewhere it can read it. */
  let latestAudio: AudioState | null = null;

  function advance(audio: AudioState, dt: number) {
    if (audio.inputType !== lastInputType) {
      follower.reset();
      energy = 0;
      peak = 0;
      lastInputType = audio.inputType;
    }

    if (!audio.isActive) {
      latest = decayVisualAudio(latest, dt);
      set(latest);
      return;
    }

    const bands = audio.bands ?? EMPTY_BANDS;
    const kickSnare = audio.kickSnare ?? EMPTY_KICK_SNARE;
    follower.update({
      bands,
      amplitude: audio.amplitude ?? 0,
      kickSnare,
      beatPhase: audio.beatPhase ?? 0,
      bpm: audio.bpm || 0,
      spectralCentroid: audio.spectralCentroid ?? 0,
      isBeat: audio.beat?.isBeat,
    }, dt);

    const bass = ratioToUnit(follower.bass_att);
    const bassFast = Math.max(ratioToUnit(follower.bass, 0.82, 0.85), follower.kickEnv * 0.8);
    const mid = ratioToUnit(follower.mid_att);
    const treble = ratioToUnit(follower.treb_att);
    const level = ratioToUnit(follower.vol_att, 0.7, 0.95);
    const sub = ratioToUnit(follower.sub_att);
    const lowMid = ratioToUnit(follower.lowMid_att);
    const highMid = ratioToUnit(follower.highMid_att);
    const air = ratioToUnit(follower.air_att);
    const presence = ratioToUnit((audio.bands.presence / Math.max(audio.bands.high || 0.05, 0.05)) || 0, 0.5, 1.2);
    const high = clamp01((treble + air + presence) / 3);
    const rawPeak = Math.max(audio.peak ?? 0, audio.amplitude ?? 0);

    energy = smoothTowards(energy, Math.max(level, (audio.rms ?? 0) * 2.2), 1400, dt);
    peak = rawPeak > peak ? rawPeak : smoothTowards(peak, rawPeak, 600, dt);

    latest = {
      isActive: true,
      bands: { sub, bass, lowMid, mid, highMid, treble, air, presence, high },
      level,
      energy: clamp01(energy),
      peak: clamp01(peak),
      bass,
      bassFast: clamp01(bassFast),
      mid,
      treble,
      high,
      sub,
      lowMid,
      highMid,
      air,
      presence,
      kick: clamp01(follower.kickEnv),
      snare: clamp01(follower.snareEnv),
      beat: clamp01(follower.beatEnv),
      beatPhase: ((follower.beats % 1) + 1) % 1,
      lfoBeat: follower.lfo01(1, 'sin'),
      lfoHalf: follower.lfo01(0.5, 'sin'),
      lfoBar: follower.lfo01(0.25, 'sin'),
      centroid: clamp01(follower.centroid_att),
      bpm: audio.bpm || 0,
    };
    set(latest);
  }

  audioStore.subscribe((audio) => {
    latestAudio = audio;
    // Under an offline render's manual clock the analyser keeps firing at
    // wall speed; letting it advance the follower is exactly the bug this
    // mode exists to kill. Park the input and let pump() spend it.
    if (manualTime !== null) return;
    const t = nowSec();
    const dt = lastAt > 0 ? clampDt(t - lastAt) : 1 / 60;
    lastAt = t;
    advance(audio, dt);
  });

  /** Take over (number) or release (null) the follower's clock. Entering
   *  manual mode snapshots the live published state and resets the
   *  follower so the export starts from a clean baseline; releasing
   *  resets it again and restores that snapshot, so a render never leaves
   *  the live visuals mid-envelope. */
  function setManualTime(seconds: number | null): void {
    if (seconds === null || !Number.isFinite(seconds)) {
      if (manualTime === null) return;
      manualTime = null;
      lastManualTime = null;
      follower.reset();
      energy = 0;
      peak = 0;
      // Force the next live emission onto the 1/60 bootstrap step instead
      // of a dt the size of the whole export.
      lastAt = 0;
      if (liveSnapshot) {
        latest = liveSnapshot;
        liveSnapshot = null;
        set(latest);
      }
      return;
    }
    if (manualTime === null) {
      liveSnapshot = latest;
      follower.reset();
      energy = 0;
      peak = 0;
      lastManualTime = null;
    }
    manualTime = seconds;
  }

  /** Advance the follower to `seconds` on the virtual timeline. Called
   *  once per exported frame. Engages manual mode on first call. */
  function pump(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    const previous = lastManualTime;
    setManualTime(seconds);
    const dt = previous === null ? 1 / 60 : clampDt(seconds - previous);
    lastManualTime = seconds;
    advance(latestAudio ?? audioStoreSnapshot(), dt);
  }

  return {
    subscribe,
    getSnapshot: () => latest,
    setManualTime,
    pump,
    isManual: () => manualTime !== null,
  };
}

/** Last audioStore value, for the (impossible in practice) case where the
 *  pump runs before any store emission has landed. */
function audioStoreSnapshot(): AudioState {
  return get(audioStore);
}

export const visualAudio = createVisualAudioStore();

export function getVisualAudioSnapshot(): VisualAudioState {
  return visualAudio.getSnapshot();
}

/**
 * Pin the visual-audio follower to an explicit virtual time, or release
 * it back to the wall clock with `null`.
 *
 * Same contract as `setISFManualTime` / `setStageEffectsManualTime`: the
 * offline render owns the clock for the duration of the export and hands
 * it back in a `finally`. Live playback never calls this.
 */
export function setVisualAudioManualTime(seconds: number | null): void {
  visualAudio.setManualTime(seconds);
}

/**
 * Advance the follower by exactly one exported frame.
 *
 * The store is normally driven by analyser callbacks, which arrive on the
 * wall clock — during an export several frames may be captured between two
 * callbacks (or none at all), so the offline loop pumps it explicitly at
 * `virtualTime` instead.
 */
export function pumpVisualAudio(virtualTime: number): void {
  visualAudio.pump(virtualTime);
}

/** True while an offline render owns the follower's clock. */
export function isVisualAudioManualClock(): boolean {
  return visualAudio.isManual();
}
