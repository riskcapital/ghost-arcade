/**
 * Rehearsing a show in the Stage Sim window: the messages between the editor
 * and the stage window, and the pure maths both sides share.
 *
 * The editor owns the show transport and its audio. The stage window only
 * mirrors the transport (a `show-state` about 20 times a second, plus one on
 * every play / pause / seek) and asks the editor to act (`show-command`).
 * It never plays show audio of its own, so there is only ever one audio
 * clock and one soundtrack.
 *
 * Times that cross windows are wall-clock epoch milliseconds
 * (`performance.timeOrigin + performance.now()`), which two renderer
 * processes on one machine agree on.
 */
import type { TakeoverSummary } from '../takeover/liveTakeover';
import type { ShowCameraClip, ShowTempoMap } from '../../types';
import type { DemoShot, ReelCameraState } from '../../stage3d/demoReel';
import { evaluateShotCamera } from '../../stage3d/demoReel';
import type { ShowMuxTrack } from '../showAudioExport';

export const REHEARSAL_CHANNEL = 'ghostarcade-show-rehearsal';
/** How often the editor publishes the transport while the stage window is there. */
export const REHEARSAL_STATE_HZ = 20;
/** The stage window says it is there this often… */
export const REHEARSAL_HELLO_MS = 1000;
/** …and counts as gone after this long without a word. */
export const REHEARSAL_ALIVE_MS = 3500;
/** Upper bound of the manual audio-sync delay. */
export const REHEARSAL_MAX_AUDIO_DELAY = 0.5;

export function epochNow(): number {
  if (typeof performance !== 'undefined' && Number.isFinite(performance.timeOrigin)) {
    return performance.timeOrigin + performance.now();
  }
  return Date.now();
}

export interface RehearsalMarker {
  time: number;
  label: string;
}

export interface RehearsalPresetBlock {
  start: number;
  duration: number;
  label: string;
}

export interface RehearsalAudioDelay {
  enabled: boolean;
  seconds: number;
}

export interface RehearsalShowState {
  /** A show with something on it (presets, tracks, audio, camera shots). */
  hasShow: boolean;
  currentTime: number;
  /** Epoch ms at which `currentTime` was read. */
  at: number;
  isPlaying: boolean;
  duration: number;
  loop: boolean;
  seekGeneration: number;
  /** Timecode / an external clock owns the playhead: commands are refused. */
  chasing: boolean;
  tempo: ShowTempoMap | null;
  hasAudio: boolean;
  presets: RehearsalPresetBlock[];
  markers: RehearsalMarker[];
  cameraLane: ShowCameraClip[];
  audioDelay: RehearsalAudioDelay;
  /** Live takeover in the editor (LIVE pill, Return); null when nothing is taken over. */
  takeover: TakeoverSummary | null;
}

export type RehearsalCommand =
  | { op: 'play' }
  | { op: 'pause' }
  | { op: 'toggle' }
  | { op: 'stop' }
  | { op: 'seek'; seconds: number }
  | { op: 'playFrom'; seconds: number }
  | { op: 'marker'; dir: 1 | -1 }
  | { op: 'home' }
  | { op: 'loop'; on: boolean }
  | { op: 'audioDelay'; enabled: boolean; seconds: number }
  /** Hand every taken-over track back to the timeline; allowed while chasing. */
  | { op: 'takeoverReturn'; instant: boolean };

export type RecAudioMode = 'exact' | 'sidecar' | 'none';
export interface RecAudioResult {
  ok: boolean;
  mode: RecAudioMode;
  error?: string;
}

export type RehearsalMessage =
  | { type: 'show-state'; state: RehearsalShowState }
  | { type: 'show-command'; command: RehearsalCommand }
  | { type: 'stage-hello'; at: number }
  | { type: 'stage-bye' }
  | { type: 'rec-audio-start'; id: string; at: number }
  | { type: 'rec-audio-finish'; id: string; videoPath: string; startedAt: number; durationSeconds: number; latencySeconds: number }
  | { type: 'rec-audio-cancel'; id: string }
  | { type: 'rec-audio-result'; id: string; result: RecAudioResult };

// ─── Transport mirror ───────────────────────────────────────────────────

/** Show time the editor is at `epochMs`, from its last published state. */
export function showTimeAt(state: Pick<RehearsalShowState, 'currentTime' | 'at' | 'isPlaying' | 'duration' | 'loop'>, epochMs: number): number {
  if (!state.isPlaying) return state.currentTime;
  // Never extrapolate far: a stalled editor must not run the stage ahead.
  const elapsed = Math.max(0, Math.min(0.5, (epochMs - state.at) / 1000));
  let t = state.currentTime + elapsed;
  const dur = state.duration;
  if (dur > 0) {
    if (state.loop) t = ((t % dur) + dur) % dur;
    else t = Math.min(t, dur);
  }
  return t;
}

/** Markers within this of the playhead count as "here" when stepping back. */
const MARKER_BACK_GRACE = 0.25;

/**
 * Where ← / → go: the previous marker (one passed within the last quarter
 * second is skipped, so a press right after a marker goes to the one before),
 * the start when there is none; the next marker, or null at the last one.
 */
export function markerJumpTarget(markers: readonly number[], t: number, dir: 1 | -1): number | null {
  const sorted = [...markers].filter(Number.isFinite).sort((a, b) => a - b);
  if (dir > 0) {
    for (const m of sorted) if (m > t + 1e-3) return m;
    return null;
  }
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i] < t - MARKER_BACK_GRACE) return sorted[i];
  return 0;
}

/** What the editor's show store offers the bridge. */
export interface RehearsalTransport {
  isChasing(): boolean;
  state(): { currentTime: number; isPlaying: boolean; duration: number; loop: boolean };
  markers(): number[];
  play(): void;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
  setLoop(on: boolean): void;
  setAudioDelay(delay: RehearsalAudioDelay): void;
  /** Hand every taken-over track back to the timeline. */
  returnTakeover?(instant: boolean): void;
}

export interface CommandOutcome {
  ok: boolean;
  reason?: 'chasing' | 'empty';
}

/** Carry out a stage-window command on the editor's transport. */
export function executeRehearsalCommand(cmd: RehearsalCommand, transport: RehearsalTransport): CommandOutcome {
  if (cmd.op === 'audioDelay') {
    transport.setAudioDelay(normalizeAudioDelay(cmd));
    return { ok: true };
  }
  if (cmd.op === 'takeoverReturn') {
    // A takeover is not the transport: Return works while a clock owns the show.
    transport.returnTakeover?.(cmd.instant);
    return { ok: true };
  }
  if (transport.isChasing()) return { ok: false, reason: 'chasing' };
  const s = transport.state();
  if (s.duration <= 0) return { ok: false, reason: 'empty' };
  const clamp = (t: number) => Math.max(0, Math.min(s.duration, Number.isFinite(t) ? t : 0));
  switch (cmd.op) {
    case 'play':
      transport.play();
      break;
    case 'pause':
      transport.pause();
      break;
    case 'toggle':
      if (s.isPlaying) transport.pause();
      else transport.play();
      break;
    case 'stop':
      transport.stop();
      break;
    case 'seek':
      transport.seek(clamp(cmd.seconds));
      break;
    case 'playFrom':
      if (s.isPlaying) transport.pause();
      transport.seek(clamp(cmd.seconds));
      transport.play();
      break;
    case 'home':
      transport.seek(0);
      break;
    case 'marker': {
      const target = markerJumpTarget(transport.markers(), s.currentTime, cmd.dir);
      if (target === null) return { ok: false };
      transport.seek(clamp(target));
      break;
    }
    case 'loop':
      transport.setLoop(!!cmd.on);
      break;
  }
  return { ok: true };
}

export function normalizeAudioDelay(raw: Partial<RehearsalAudioDelay> | null | undefined): RehearsalAudioDelay {
  const seconds = Number(raw?.seconds);
  return {
    enabled: raw?.enabled === true,
    seconds: Number.isFinite(seconds) ? Math.max(0, Math.min(REHEARSAL_MAX_AUDIO_DELAY, seconds)) : 0,
  };
}

// ─── Stage camera lane ──────────────────────────────────────────────────

export interface CameraLaneSample {
  clip: ShowCameraClip;
  shot: DemoShot;
  progress: number;
  camera: ReelCameraState;
}

/** The camera clip at show time `t` (half-open), sorted lane assumed or not. */
export function cameraClipAt(lane: readonly ShowCameraClip[], t: number): ShowCameraClip | null {
  let found: ShowCameraClip | null = null;
  for (const clip of lane) {
    if (t >= clip.startTime && t < clip.startTime + clip.duration) {
      // Overlaps cannot be made in the UI; the later start wins if loaded ones do.
      if (!found || clip.startTime >= found.startTime) found = clip;
    }
  }
  return found;
}

/** Camera the stage-camera lane asks for at show time `t`, or null between shots. */
export function evaluateCameraLane(
  lane: readonly ShowCameraClip[],
  shots: readonly DemoShot[],
  t: number,
): CameraLaneSample | null {
  const clip = cameraClipAt(lane, t);
  if (!clip) return null;
  const shot = shots.find((s) => s.id === clip.shotId);
  if (!shot) return null;
  const progress = clip.duration > 0 ? Math.max(0, Math.min(1, (t - clip.startTime) / clip.duration)) : 0;
  return { clip, shot, progress, camera: evaluateShotCamera(shot, progress) };
}

// ─── Recording audio ────────────────────────────────────────────────────

/** The editor's transport at one instant, logged while a recording runs. */
export interface TransportSample {
  /** Epoch ms. */
  at: number;
  showTime: number;
  playing: boolean;
  seekGeneration: number;
}

export type RecAudioPlan =
  | { kind: 'exact'; showFrom: number; videoAt: number; length: number }
  | { kind: 'silent' }
  | { kind: 'discontinuous'; reason: string };

/** Show time running ahead of the wall clock by more than this inside one play is a jump. */
const CONTINUITY_TOLERANCE = 0.12;
/** A show time read this far behind the clock is a jump back, not a late read. */
const STALE_TOLERANCE = 0.5;

/**
 * Can the recording get the show's soundtrack straight from its files?
 *
 * Yes when the show played once, continuously, during the recording (a
 * paused lead-in or tail is silence): then video time `v` heard show time
 * `showFrom + (v - videoAt)`. A seek, a loop wrap or a second play is a
 * discontinuity and the caller falls back to the live audio capture.
 *
 * `startedAt` is the epoch of the video's frame 0; the picture runs
 * `latency` seconds behind the editor's transport (the stage view's mirror
 * of the render core), so the soundtrack moves that much later too.
 */
export function rehearsalAudioPlan(
  samples: readonly TransportSample[],
  startedAt: number,
  durationSeconds: number,
  latency = 0,
): RecAudioPlan {
  const endAt = startedAt + durationSeconds * 1000;
  const ordered = [...samples].sort((a, b) => a.at - b.at);
  // Play spans: runs of playing samples on one seek generation.
  const spans: TransportSample[][] = [];
  let current: TransportSample[] | null = null;
  for (const s of ordered) {
    if (!s.playing) {
      current = null;
      continue;
    }
    if (!current || current[current.length - 1].seekGeneration !== s.seekGeneration) {
      current = [s];
      spans.push(current);
    } else {
      current.push(s);
    }
  }
  // Each span lasts until the next sample that is paused or on another generation.
  const spanEnd = (span: TransportSample[]): number => {
    const last = span[span.length - 1];
    const next = ordered.find((s) => s.at > last.at && (!s.playing || s.seekGeneration !== last.seekGeneration));
    return next ? next.at : Number.POSITIVE_INFINITY;
  };
  // Only spans that overlap the recording matter.
  const overlapping = spans.filter((span) => span[0].at < endAt && spanEnd(span) > startedAt);
  if (overlapping.length === 0) return { kind: 'silent' };
  if (overlapping.length > 1) return { kind: 'discontinuous', reason: 'the show was paused and played again, or jumped' };
  const span = overlapping[0];
  // Show time minus wall time is constant while the show plays. A sample
  // taken between transport ticks reads a slightly stale show time (lower),
  // so the reference is taken from the freshest samples.
  const offsets = span.map((s) => s.showTime - s.at / 1000).sort((a, b) => a - b);
  const offset = offsets[Math.min(offsets.length - 1, Math.floor(offsets.length * 0.9))];
  if (offsets[offsets.length - 1] - offset > CONTINUITY_TOLERANCE || offset - offsets[0] > STALE_TOLERANCE) {
    return { kind: 'discontinuous', reason: 'the show jumped while it played' };
  }
  const playFrom = span[0].showTime;
  const playStartAt = (playFrom - offset) * 1000;
  const playEndAt = spanEnd(span);

  let videoAt = (playStartAt - startedAt) / 1000 + latency;
  let showFrom = playFrom;
  if (videoAt < 0) {
    showFrom -= videoAt;
    videoAt = 0;
  }
  const videoEnd = Math.min(durationSeconds, (playEndAt - startedAt) / 1000 + latency);
  const length = videoEnd - videoAt;
  if (!(length > 0)) return { kind: 'silent' };
  return { kind: 'exact', showFrom, videoAt, length };
}

/**
 * The show's tracks placed on the recording's own timeline for an exact
 * plan: each track cut to the part the recording heard and moved to where
 * the recording heard it.
 */
export function planMuxTracks(tracks: readonly ShowMuxTrack[], plan: Extract<RecAudioPlan, { kind: 'exact' }>): ShowMuxTrack[] {
  const from = plan.showFrom;
  const to = plan.showFrom + plan.length;
  const out: ShowMuxTrack[] = [];
  for (const track of tracks) {
    const a = Math.max(from, track.startTime);
    const b = Math.min(to, track.startTime + track.duration);
    if (!(b - a > 1e-4)) continue;
    out.push({
      path: track.path,
      startTime: plan.videoAt + (a - from),
      offset: track.offset + (a - track.startTime),
      duration: b - a,
      volume: track.volume,
    });
  }
  return out;
}

// ─── Display helpers ────────────────────────────────────────────────────

/** m:ss.t for the transport readout. */
export function formatShowClock(seconds: number): string {
  const t = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
