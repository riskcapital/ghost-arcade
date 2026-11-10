/**
 * Stage Sim window side of rehearsing a show (see rehearsalBridge.ts).
 *
 * Mirrors the editor's transport, sends it commands, drives the stage
 * camera from the show's camera lane, asks for a faster picture feed while
 * the show plays, and measures how far the stage view runs behind the
 * editor so recordings and the audio delay can line up with it.
 */
import { derived, get, writable } from 'svelte/store';
import { compositeMirrorCanvas, compositeMirrorFrameInfo } from '../../sync/nativeCompositeMirror';
import { stage3DRendererControls } from '../../stage3d/store';
import { demoReel } from '../../stage3d/demoReel';
import {
  REHEARSAL_CHANNEL,
  REHEARSAL_HELLO_MS,
  REHEARSAL_ALIVE_MS,
  epochNow,
  evaluateCameraLane,
  showTimeAt,
  type RecAudioResult,
  type RehearsalCommand,
  type RehearsalMessage,
  type RehearsalShowState,
} from './rehearsalBridge';

/** The editor's transport as last heard, or null (no editor, or no show yet). */
export const stageShow = writable<RehearsalShowState | null>(null);

/** Camera follows the show's camera lane. Manual orbiting turns it off. */
export const stageCameraFollow = writable(true);

/** The picture size a running recording wants from the core mirror, or null. */
export const stageRecordingMaxDim = writable<number | null>(null);

/** Render rate and mirror request for the stage view (read by Canvas). */
export const stageRehearsalRender = derived(
  [stageShow, stageRecordingMaxDim],
  ([$show, $rec]) => {
    const playing = !!$show?.isPlaying;
    const boost = playing || $rec !== null;
    return {
      boost,
      fps: boost ? 60 : 30,
      // A playing show reads a smaller picture so the feed keeps up at 60;
      // a recording reads a larger one (it runs at the recording's rate).
      maxDim: $rec !== null ? Math.max(1280, $rec) : playing ? STAGE_PLAYING_MAX_DIM : 1280,
    };
  },
);

/** Mirror size while a show plays in the stage view (paused: 1280). */
export const STAGE_PLAYING_MAX_DIM = 960;

/** The render core shows the editor's show time this much later than the
 *  editor reaches it (scene sync, one core frame, video presentation). */
export const STAGE_CORE_LEAD_SECONDS = 0.035;

let channel: BroadcastChannel | null = null;
let installs = 0;
let helloTimer: ReturnType<typeof setInterval> | null = null;
let staleTimer: ReturnType<typeof setInterval> | null = null;
let latencyRaf = 0;
let cameraRaf = 0;
let lastStateAt = 0;
const pendingResults = new Map<string, (result: RecAudioResult) => void>();
/** Recent ages (s) of the mirror picture the stage view was drawing. */
const mirrorAges: number[] = [];
const MAX_AGES = 240;
let cameraDriven = false;

function post(msg: RehearsalMessage): boolean {
  if (!channel) return false;
  try {
    channel.postMessage(msg);
    return true;
  } catch {
    return false;
  }
}

export function sendRehearsalCommand(command: RehearsalCommand): boolean {
  return post({ type: 'show-command', command });
}

/** Show time right now, extrapolated from the last state; null without one. */
export function stageShowTimeNow(at = epochNow()): number | null {
  const s = get(stageShow);
  return s ? showTimeAt(s, at) : null;
}

/** How far behind the editor's show time the stage view is, in seconds. */
export function stageViewLatencySeconds(): number {
  if (mirrorAges.length === 0) return STAGE_CORE_LEAD_SECONDS + 0.05;
  const sorted = [...mirrorAges].sort((a, b) => a - b);
  return STAGE_CORE_LEAD_SECONDS + sorted[Math.floor(sorted.length / 2)];
}

/** Forget the latency samples (a new measurement starts). */
export function resetStageLatency(): void {
  mirrorAges.length = 0;
}

function sampleMirrorAge(): void {
  latencyRaf = 0;
  const info = compositeMirrorFrameInfo();
  if (info) {
    const age = (epochNow() - info.requestedAt) / 1000;
    if (age >= 0 && age < 1) {
      mirrorAges.push(age);
      if (mirrorAges.length > MAX_AGES) mirrorAges.shift();
    }
  }
  if (get(stageShow)?.isPlaying) latencyRaf = requestAnimationFrame(sampleMirrorAge);
}

// ── Camera lane ────────────────────────────────────────────────────────

function releaseDrivenCamera(): void {
  if (!cameraDriven) return;
  cameraDriven = false;
  get(stage3DRendererControls)?.releaseCamera();
}

/** Something else (the Demo Reel preview or render) is driving the camera. */
let cameraBorrowed = 0;
export function borrowStageCamera(): () => void {
  cameraBorrowed++;
  cameraDriven = false;
  let returned = false;
  return () => {
    if (returned) return;
    returned = true;
    cameraBorrowed = Math.max(0, cameraBorrowed - 1);
  };
}

function cameraTick(): void {
  cameraRaf = 0;
  const show = get(stageShow);
  const follow = get(stageCameraFollow);
  if (!show || show.cameraLane.length === 0 || !follow || cameraBorrowed > 0) {
    releaseDrivenCamera();
    return;
  }
  const controls = get(stage3DRendererControls);
  const t = showTimeAt(show, epochNow());
  const sample = evaluateCameraLane(show.cameraLane, get(demoReel).shots, t);
  if (controls && sample) {
    controls.setCameraState(sample.camera);
    cameraDriven = true;
  } else {
    // Between shots the camera holds where the last one left it.
    releaseDrivenCamera();
  }
  cameraRaf = requestAnimationFrame(cameraTick);
}

function ensureCameraLoop(): void {
  if (cameraRaf || typeof requestAnimationFrame !== 'function') return;
  cameraRaf = requestAnimationFrame(cameraTick);
}

/** The camera lane's camera at an instant, for the rehearsal render. */
export function stageLaneCameraAt(at = epochNow()) {
  const show = get(stageShow);
  if (!show || show.cameraLane.length === 0) return null;
  return evaluateCameraLane(show.cameraLane, get(demoReel).shots, showTimeAt(show, at))?.camera ?? null;
}

/** The user grabbed the camera: stop following until they turn it back on. */
export function pauseCameraFollow(): void {
  if (!get(stageCameraFollow)) return;
  const show = get(stageShow);
  if (!show || show.cameraLane.length === 0) return;
  stageCameraFollow.set(false);
  releaseDrivenCamera();
}

// ── Recording audio ────────────────────────────────────────────────────

export interface StageRecAudio {
  /** Frame 0 of the recording is at `startedAt` (epoch ms). */
  begin(startedAt: number): void;
  /** Put the show's sound into the finished file. */
  finish(videoPath: string, stoppedAt?: number): Promise<RecAudioResult>;
  cancel(): void;
}

/**
 * Ask the editor to collect the show's sound for a recording made here.
 * Null when no editor is listening.
 */
export function startStageRecAudio(): StageRecAudio | null {
  const show = get(stageShow);
  if (!channel || !show || epochNow() - lastStateAt > REHEARSAL_ALIVE_MS) return null;
  const id = `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  post({ type: 'rec-audio-start', id, at: epochNow() });
  let startedAt = epochNow();
  let done = false;
  return {
    begin(at) {
      startedAt = at;
    },
    finish(videoPath, stoppedAt = epochNow()) {
      if (done) return Promise.resolve({ ok: false, mode: 'none' as const, error: 'finished' });
      done = true;
      return new Promise<RecAudioResult>((resolve) => {
        const timer = setTimeout(() => {
          pendingResults.delete(id);
          resolve({ ok: false, mode: 'none', error: 'The editor did not answer.' });
        }, 60_000);
        pendingResults.set(id, (result) => {
          clearTimeout(timer);
          resolve(result);
        });
        post({
          type: 'rec-audio-finish',
          id,
          videoPath,
          startedAt,
          durationSeconds: Math.max(0.1, (stoppedAt - startedAt) / 1000),
          latencySeconds: stageViewLatencySeconds(),
        });
      });
    },
    cancel() {
      if (done) return;
      done = true;
      post({ type: 'rec-audio-cancel', id });
    },
  };
}

// ── Lifetime ───────────────────────────────────────────────────────────

/** Join the editor's show from the Stage Sim window. Returns the uninstall. */
export function installStageRehearsal(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  installs++;
  if (!channel) {
    channel = new BroadcastChannel(REHEARSAL_CHANNEL);
    channel.onmessage = (event: MessageEvent<RehearsalMessage>) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'show-state') {
        lastStateAt = epochNow();
        const prev = get(stageShow);
        stageShow.set(msg.state);
        if (msg.state.isPlaying && !prev?.isPlaying && !latencyRaf && typeof requestAnimationFrame === 'function') {
          latencyRaf = requestAnimationFrame(sampleMirrorAge);
        }
        if (msg.state.cameraLane.length > 0) ensureCameraLoop();
      } else if (msg.type === 'rec-audio-result') {
        const resolve = pendingResults.get(msg.id);
        pendingResults.delete(msg.id);
        resolve?.(msg.result);
      }
    };
    const hello = () => post({ type: 'stage-hello', at: epochNow() });
    hello();
    helloTimer = setInterval(hello, REHEARSAL_HELLO_MS);
    // The editor went away (closed, crashed): drop the mirror.
    staleTimer = setInterval(() => {
      if (get(stageShow) && epochNow() - lastStateAt > REHEARSAL_ALIVE_MS) stageShow.set(null);
    }, 1000);
  }
  // Read by the real-app checks (scripts drive the window over CDP).
  try {
    (window as unknown as Record<string, unknown>).__ghostStageRehearsal = {
      show: () => get(stageShow),
      follow: () => get(stageCameraFollow),
      latency: stageViewLatencySeconds,
      mirrorFrame: compositeMirrorFrameInfo,
      mirrorCanvas: compositeMirrorCanvas,
      controls: () => get(stage3DRendererControls),
      render: () => get(stageRehearsalRender),
    };
  } catch {
    /* sealed window */
  }
  // Following the lane again picks the camera straight back up.
  const unsubFollow = stageCameraFollow.subscribe((on) => {
    if (on) ensureCameraLoop();
  });
  return () => {
    unsubFollow();
    installs = Math.max(0, installs - 1);
    if (installs > 0 || !channel) return;
    post({ type: 'stage-bye' });
    if (helloTimer) clearInterval(helloTimer);
    if (staleTimer) clearInterval(staleTimer);
    helloTimer = staleTimer = null;
    if (latencyRaf) cancelAnimationFrame(latencyRaf);
    if (cameraRaf) cancelAnimationFrame(cameraRaf);
    latencyRaf = cameraRaf = 0;
    releaseDrivenCamera();
    channel.close();
    channel = null;
    stageShow.set(null);
  };
}
