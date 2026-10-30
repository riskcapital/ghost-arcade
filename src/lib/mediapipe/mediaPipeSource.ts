// MediaPipe camera + worker manager. Singleton (one camera per app),
// mirrors how multiStemAnalyzer manages a single audio source.
//
// Lifecycle:
//   start(opts) — request camera, create worker, send init message,
//                 begin RAF loop. Resolves when the worker reports ready.
//   stop()      — tear down RAF, worker, camera.
//
// Consumers (the MediaPipe panel, each HandFX layer) hold the camera with
// acquire() and let go with release(). The camera stops a moment after the
// last one lets go. A hold given a time limit lapses unless renewed, for
// callers that ask on every frame and have no teardown of their own.
//
// Frame loop: each animation frame we draw the video into an
// OffscreenCanvas, grab an ImageBitmap, transfer it to the worker.
// Throttled to a target FPS so the worker isn't perpetually behind on
// inference (60Hz video × 12ms inference would fall further behind
// every frame).
//
// Outputs:
//   - the latest `SignalFrame` via subscribe(cb)
//   - the live <video> element so a debug UI can show landmark overlays
//   - `isRunning()` / `getError()` for UI state

import { deriveSignals, type SignalFrame, EMPTY_SIGNAL_FRAME, GESTURE_LIST, type GestureName } from './signals';
import type { WorkerHandResult } from './mediaPipeWorker';
import { invoke, isElectron } from '$lib/bridge';

const CAMERA_FIRST_FRAME_TIMEOUT_MS = 8000;
/** How long the camera stays on after the last consumer lets go. */
export const MEDIAPIPE_STOP_GRACE_MS = 2500;
/** How long automatic starts wait after a failed start with the same options. */
export const MEDIAPIPE_RETRY_AFTER_FAILURE_MS = 10_000;

export interface MediaPipeRunState {
  running: boolean;
  starting: boolean;
  error: string | null;
  /** Who is holding the camera, e.g. 'panel' or 'handfx-layers'. */
  consumers: string[];
  /** Turned off from the panel while other consumers still want it. */
  heldOff: boolean;
}

export interface MediaPipeStartOptions {
  /** Specific camera device id, or empty for default. */
  deviceId?: string;
  /** Run gesture model alongside landmarker. ~2× cost. Default true. */
  useGesture?: boolean;
  /** Mirror the video horizontally (selfie-style). Default true. */
  mirror?: boolean;
  /** Target inference FPS (we throttle frames to the worker). Default 60
   *  — modern hardware handles HandLandmarker GPU delegate at full
   *  display rate, and lower latency reads as snappier hand-tracking. */
  targetFps?: number;
  /** Max simultaneous hands. Default 2. */
  numHands?: number;
  /** Track one body's skeleton (33 landmarks). One more model per frame. Default false. */
  trackBody?: boolean;
  /** Track one face: landmarks and expressions. One more model per frame. Default false. */
  trackFace?: boolean;
}

const DEFAULT_OPTS: Required<MediaPipeStartOptions> = {
  deviceId: '',
  // Gesture model defaults OFF: it doubles per-frame inference cost
  // (a second model.recognizeForVideo() call) and the live HandFX
  // modes derive everything they need (pinch distance, fingertip
  // velocity, palm position) from raw landmarks. MediaPipePanel still
  // explicitly opts in via its "Canned gestures" checkbox if the user
  // wants binding-bus gestures, but the default path skips it for
  // a noticeable latency drop.
  useGesture: false,
  mirror: true,
  // targetFps caps the upper send rate; actual pacing comes from the
  // anti-backlog guard (only one frame in flight at a time), so this
  // just needs to be high enough not to be the bottleneck.
  targetFps: 120,
  numHands: 2,
  trackBody: false,
  trackFace: false,
};

// Public CDN URLs for the model files. Phase 1 fetches them at runtime
// — Phase 2 can optionally bundle a local copy for offline use.
// Models are BUNDLED (public/mediapipe/models/) and served from our origin —
// runtime CDN fetches were the "MediaPipe not loading" failure (offline/CSP/
// firewall kills storage.googleapis.com and HandFX silently never starts).
// The CDN URLs remain as a fallback if the local copies are missing.
const HAND_MODEL_CDN_URL    = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const GESTURE_MODEL_CDN_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
const POSE_MODEL_CDN_URL    = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const FACE_MODEL_CDN_URL    = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';

function localModelUrl(name: string): string {
  // Same document-relative resolution as the WASM path below (see comment):
  // works in dev (http://localhost:1420) and Electron prod (file://…/dist).
  return new URL(`./mediapipe/models/${name}`, document.baseURI).toString();
}

async function resolveModelUrl(name: string, cdnFallback: string): Promise<string> {
  const local = localModelUrl(name);
  try {
    const probe = await fetch(local, { method: 'HEAD' });
    if (probe.ok) return local;
  } catch {
    /* local copy missing — fall through to CDN */
  }
  console.warn(`[MediaPipe] bundled model ${name} unavailable, falling back to CDN`);
  return cdnFallback;
}

export type GestureListener = (signal: SignalFrame) => void;

export class MediaPipeSource {
  private worker: Worker | null = null;
  private workerReady = false;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private offscreen: OffscreenCanvas | null = null;
  private offCtx: OffscreenCanvasRenderingContext2D | null = null;
  private rafId: number | null = null;
  private lastFrameSentAt = 0;
  // Number of frames the worker hasn't acknowledged yet. We only ever
  // allow one in flight: pump → inference → result → pump again. This
  // self-paces the pipeline so a slow inference frame can't snowball
  // into a queue of stale frames, which would show up as ever-growing
  // lag between the user's actual hand and the on-screen tracking.
  private framesInFlight = 0;
  private opts: Required<MediaPipeStartOptions> = { ...DEFAULT_OPTS };
  private listeners = new Set<GestureListener>();
  private lastFrame: SignalFrame = EMPTY_SIGNAL_FRAME;
  private lastGestureByHand: Record<string, GestureName> = { 'gesture.right': '', 'gesture.left': '' };
  private error: string | null = null;
  private running = false;
  private pendingStart: Promise<void> | null = null;
  private frameCounter = 0;
  private startToken = 0;
  // Consumer id -> time its hold lapses (Infinity until release()).
  private holders = new Map<string, number>();
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private lapseTimer: ReturnType<typeof setTimeout> | null = null;
  private heldOff = false;
  private lastFailure: { at: number; key: string } | null = null;
  private watchingDevices = false;
  private stateListeners = new Set<(state: MediaPipeRunState) => void>();
  private lastStateKey = '';

  /** The preview and inference must use the same selfie convention. */
  isMirrored(): boolean { return this.opts.mirror; }
  setMirror(mirror: boolean): void { this.opts.mirror = mirror; }

  /** Start the pipeline. Idempotent — calling while running with the
   *  same opts is a no-op; with different opts, stops and restarts. */
  async start(opts: MediaPipeStartOptions = {}): Promise<void> {
    const next: Required<MediaPipeStartOptions> = { ...DEFAULT_OPTS, ...opts };
    this.heldOff = false;
    // Render sync can request startup every frame while camera/model loading
    // is pending. Join that attempt instead of launching another camera/worker.
    if (this.pendingStart) return this.pendingStart;
    if (this.running && optsEqual(this.opts, next)) return;
    if (this.running) await this.stop();
    const token = ++this.startToken;
    const pending: Promise<void> = this._startInternal(next, token).finally(() => {
      if (this.pendingStart === pending) this.pendingStart = null;
      this.emitState();
    });
    this.pendingStart = pending;
    this.emitState();
    return pending;
  }

  /** Stop everything. Safe to call when not running. */
  async stop(): Promise<void> {
    this.startToken++;
    this.pendingStart = null;
    if (this.stopTimer !== null) { clearTimeout(this.stopTimer); this.stopTimer = null; }
    this.running = false;
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    if (this.worker) {
      try { this.worker.postMessage({ type: 'dispose' }); } catch {}
      try { this.worker.terminate(); } catch {}
      this.worker = null;
      this.workerReady = false;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.video) {
      try { this.video.pause(); } catch {}
      this.video.srcObject = null;
      this.video.remove();
      this.video = null;
    }
    this.offscreen = null;
    this.offCtx = null;
    this.framesInFlight = 0;
    this.lastFrame = EMPTY_SIGNAL_FRAME;
    this.lastGestureByHand = { 'gesture.right': '', 'gesture.left': '' };
    this.emitState();
  }

  subscribe(cb: GestureListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  isRunning(): boolean { return this.running; }
  isStarting(): boolean { return this.pendingStart !== null; }
  getError(): string | null { return this.error; }
  getLastFrame(): SignalFrame { return this.lastFrame; }
  getVideoElement(): HTMLVideoElement | null { return this.video; }
  getOpts(): Required<MediaPipeStartOptions> { return this.opts; }

  // ── Consumers ────────────────────────────────────────────────────────

  /** Count `consumer` as using the camera. Does not start it. With `ttlMs`
   *  the hold lapses unless acquire() is called again within that time. */
  acquire(consumer: string, ttlMs?: number): void {
    const isNew = !this.holders.has(consumer);
    const timed = typeof ttlMs === 'number' && ttlMs > 0;
    this.holders.set(consumer, timed ? performance.now() + ttlMs : Infinity);
    if (this.stopTimer !== null) { clearTimeout(this.stopTimer); this.stopTimer = null; }
    if (timed && this.lapseTimer === null) this.scheduleLapse();
    if (isNew) this.emitState();
  }

  /** Stop counting `consumer`. The camera stops a moment after the last one goes. */
  release(consumer: string): void {
    if (!this.holders.delete(consumer)) return;
    this.afterRelease();
  }

  getConsumers(): string[] { return [...this.holders.keys()]; }

  /** Turn the camera off now, for every consumer. Consumers that still hold
   *  it do not start it again until start() is called directly. */
  async turnOff(consumer?: string): Promise<void> {
    if (consumer) this.holders.delete(consumer);
    this.heldOff = this.holders.size > 0;
    await this.stop();
  }

  /** Whether an automatic start (HandFX) may try now: not while turned off
   *  from the panel, and not within 10 s of a failed start with the same
   *  options. A camera plugged in or removed clears the wait. */
  canAutoStart(opts: MediaPipeStartOptions = {}): boolean {
    if (this.heldOff) return false;
    const failure = this.lastFailure;
    if (!failure || failure.key !== optsKey({ ...DEFAULT_OPTS, ...opts })) return true;
    return performance.now() - failure.at >= MEDIAPIPE_RETRY_AFTER_FAILURE_MS;
  }

  /** Running state for UI; called now and on every change. */
  subscribeState(cb: (state: MediaPipeRunState) => void): () => void {
    this.stateListeners.add(cb);
    cb(this.runState());
    return () => { this.stateListeners.delete(cb); };
  }

  private runState(): MediaPipeRunState {
    return {
      running: this.running,
      starting: this.pendingStart !== null,
      error: this.error,
      consumers: [...this.holders.keys()],
      heldOff: this.heldOff,
    };
  }

  private emitState(): void {
    const state = this.runState();
    const key = JSON.stringify(state);
    if (key === this.lastStateKey) return;
    this.lastStateKey = key;
    for (const cb of this.stateListeners) {
      try { cb(state); } catch (err) { console.warn('[MediaPipe] state listener threw', err); }
    }
  }

  private afterRelease(): void {
    if (this.holders.size === 0) {
      this.heldOff = false;
      if (this.stopTimer !== null) clearTimeout(this.stopTimer);
      this.stopTimer = setTimeout(() => {
        this.stopTimer = null;
        if (this.holders.size === 0 && (this.running || this.pendingStart)) void this.stop();
      }, MEDIAPIPE_STOP_GRACE_MS);
    }
    this.emitState();
  }

  private scheduleLapse(): void {
    let next = Infinity;
    for (const at of this.holders.values()) next = Math.min(next, at);
    if (!Number.isFinite(next)) return;
    this.lapseTimer = setTimeout(() => {
      this.lapseTimer = null;
      const now = performance.now();
      let lapsed = false;
      for (const [id, at] of this.holders) {
        if (at <= now) { this.holders.delete(id); lapsed = true; }
      }
      if (lapsed) this.afterRelease();
      this.scheduleLapse();
    }, Math.max(0, next - performance.now()));
  }

  private noteFailure(opts: Required<MediaPipeStartOptions>): void {
    this.lastFailure = { at: performance.now(), key: optsKey(opts) };
    if (this.watchingDevices) return;
    const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!devices?.addEventListener) return;
    this.watchingDevices = true;
    devices.addEventListener('devicechange', () => { this.lastFailure = null; });
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private async _startInternal(opts: Required<MediaPipeStartOptions>, token: number): Promise<void> {
    this.error = null;
    this.opts = opts;
    let localStream: MediaStream | null = null;
    let localVideo: HTMLVideoElement | null = null;
    let localWorker: Worker | null = null;
    let localOffscreen: OffscreenCanvas | null = null;
    let localOffCtx: OffscreenCanvasRenderingContext2D | null = null;
    let adopted = false;

    const isStale = () => token !== this.startToken;
    const disposeLocals = () => {
      if (adopted) return;
      if (localWorker) {
        try { localWorker.postMessage({ type: 'dispose' }); } catch {}
        try { localWorker.terminate(); } catch {}
      }
      if (localStream) {
        try { localStream.getTracks().forEach(t => t.stop()); } catch {}
      }
      if (localVideo) {
        try { localVideo.pause(); } catch {}
        try { localVideo.srcObject = null; } catch {}
        try { localVideo.remove(); } catch {}
      }
    };

    try {
      // 1. Camera
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: opts.deviceId
          ? { deviceId: { exact: opts.deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
          : { width: { ideal: 640 }, height: { ideal: 480 } },
      };
      // macOS gives the page a camera that never sends a frame unless the app has
      // asked the system for access first, so ask before opening it.
      if (isElectron) {
        const access = await invoke<{ ok?: boolean }>('camera_access_ensure').catch(() => null);
        if (access && access.ok === false) throw new Error('Camera access is off for Ghost Arcade. Turn it on in System Settings, Privacy & Security, Camera, then start again.');
      }
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      if (isStale()) { disposeLocals(); return; }

      localVideo = document.createElement('video');
      localVideo.autoplay = true;
      localVideo.muted = true;
      localVideo.playsInline = true;
      localVideo.srcObject = localStream;
      localVideo.style.cssText = 'position:absolute;top:-99999px;left:-99999px;pointer-events:none;';
      document.body.appendChild(localVideo);
      await new Promise<void>((resolve, reject) => {
        // A camera that opens but never sends a picture must not leave the tracker waiting for ever.
        const giveUp = setTimeout(() => reject(new Error('The camera opened but sent no picture. Check that Ghost Arcade has camera access in your system settings and that no other app is holding the camera, then start again.')), CAMERA_FIRST_FRAME_TIMEOUT_MS);
        const onReady = () => { clearTimeout(giveUp); localVideo!.removeEventListener('loadedmetadata', onReady); resolve(); };
        const onErr = (e: any) => { clearTimeout(giveUp); localVideo!.removeEventListener('error', onErr); reject(e); };
        localVideo!.addEventListener('loadedmetadata', onReady);
        localVideo!.addEventListener('error', onErr);
        if (localVideo!.readyState >= 1) onReady();
      });
      if (isStale()) { disposeLocals(); return; }
      await localVideo.play();
      if (isStale()) { disposeLocals(); return; }

      // 2. Offscreen canvas for grabbing ImageBitmaps to send to worker
      localOffscreen = new OffscreenCanvas(localVideo.videoWidth, localVideo.videoHeight);
      localOffCtx = localOffscreen.getContext('2d', { willReadFrequently: false });
      if (!localOffCtx) throw new Error('Failed to create 2D context for camera capture');

      // 3. Worker — Vite resolves this at build time. The `type: 'module'`
      // is required because MediaPipe's bundle uses ESM imports.
      localWorker = new Worker(new URL('./mediaPipeWorker.ts', import.meta.url), { type: 'module' });
      localWorker.addEventListener('message', (e) => this._onWorkerMessage(e));

      // Resolve WASM URL — copied to /public/mediapipe/wasm at install
      // time so it's served from our origin (avoids CDN dependency for
      // the WASM runtime even though models still load from CDN).
      // IMPORTANT: trailing slash required — FilesetResolver concatenates
      // file names directly onto this base URL. Without the slash you get
      // requests like /mediapipe/wasmvision_wasm_internal.js → 404 → the
      // internal Module bootstrap fails with "ModuleFactory not set".
      //
      // Resolve against document.baseURI (NOT window.location.origin):
      //   Dev (http://localhost:1420/) → http://localhost:1420/mediapipe/wasm/
      //   Electron prod (file:///.../dist/index.html) → file:///.../dist/mediapipe/wasm/
      // Using `.origin` was wrong because Electron loads the bundle via
      // file:// where `window.location.origin === 'null'`, which made
      // `new URL('/mediapipe/wasm/', 'null')` resolve to
      // `file:///mediapipe/wasm/` (literal filesystem root) — the
      // exact error reported as `file:///mediapipe/wasm//vision_wasm_module_internal.js
      // failed to fetch` in v1.7.1/v1.7.2 desktop builds. A document-
      // relative URL inherits vite.config.ts's `base: './'` electron path.
      const wasmUrl = new URL('./mediapipe/wasm/', document.baseURI).toString();

      const initDone = new Promise<void>((resolve, reject) => {
        const onMsg = (e: MessageEvent) => {
          if (e.data?.type === 'ready') {
            localWorker!.removeEventListener('message', onMsg);
            resolve();
          } else if (e.data?.type === 'error') {
            localWorker!.removeEventListener('message', onMsg);
            reject(new Error(e.data.message));
          }
        };
        localWorker!.addEventListener('message', onMsg);
      });
      const [handModelUrl, gestureModelUrl, poseModelUrl, faceModelUrl] = await Promise.all([
        resolveModelUrl('hand_landmarker.task', HAND_MODEL_CDN_URL),
        resolveModelUrl('gesture_recognizer.task', GESTURE_MODEL_CDN_URL),
        opts.trackBody ? resolveModelUrl('pose_landmarker_lite.task', POSE_MODEL_CDN_URL) : Promise.resolve(''),
        opts.trackFace ? resolveModelUrl('face_landmarker.task', FACE_MODEL_CDN_URL) : Promise.resolve(''),
      ]);
      localWorker.postMessage({
        type: 'init',
        wasmUrl,
        handModelUrl,
        gestureModelUrl,
        useGesture: opts.useGesture,
        numHands: opts.numHands,
        trackBody: opts.trackBody,
        trackFace: opts.trackFace,
        poseModelUrl,
        faceModelUrl,
      });
      await initDone;
      if (isStale()) { disposeLocals(); return; }

      this.stream = localStream;
      this.video = localVideo;
      this.worker = localWorker;
      this.offscreen = localOffscreen;
      this.offCtx = localOffCtx;
      adopted = true;
      this.workerReady = true;
      this.running = true;

      // 4. Start frame loop
      this.lastFrameSentAt = 0;
      this.framesInFlight = 0;
      const tick = () => {
        this.rafId = requestAnimationFrame(tick);
        this._pumpFrame();
      };
      this.rafId = requestAnimationFrame(tick);
      this.lastFailure = null;
      this.emitState();
    } catch (err: any) {
      disposeLocals();
      // A start that was cancelled meanwhile must not stop the newer one.
      if (isStale()) return;
      this.error = String(err?.message || err);
      this.noteFailure(opts);
      await this.stop();
      throw err;
    }
  }

  private _pumpFrame(): void {
    if (!this.workerReady || !this.video || !this.offCtx || !this.offscreen) return;
    // Strict request-response pacing: don't send a new frame until the
    // worker has acknowledged the previous one. This is the real rate
    // limiter — targetFps is just an upper bound.
    if (this.framesInFlight >= 1) return;
    const now = performance.now();
    const interval = 1000 / this.opts.targetFps;
    if (now - this.lastFrameSentAt < interval) return;
    this.lastFrameSentAt = now;

    // Mirror by negating the X axis when drawing — keeps the source
    // image consistent so landmark coords are correct for the user's
    // mental model regardless of which camera path you take.
    const w = this.offscreen.width;
    const h = this.offscreen.height;
    this.offCtx.save();
    if (this.opts.mirror) {
      this.offCtx.scale(-1, 1);
      this.offCtx.drawImage(this.video, -w, 0, w, h);
    } else {
      this.offCtx.drawImage(this.video, 0, 0, w, h);
    }
    this.offCtx.restore();

    const bitmap = this.offscreen.transferToImageBitmap();
    try {
      this.worker!.postMessage({ type: 'frame', bitmap, timestamp: ++this.frameCounter }, [bitmap]);
      this.framesInFlight++;
    } catch {
      bitmap.close?.();
    }
  }

  private _onWorkerMessage(e: MessageEvent): void {
    const msg = e.data;
    if (msg?.type === 'result') {
      // Acknowledge the in-flight frame so the next pump can fire.
      this.framesInFlight = Math.max(0, this.framesInFlight - 1);
      let hands = msg.hands as WorkerHandResult[];
      // When the source is mirrored (selfie-style), MediaPipe sees a
      // flipped image — your physical right hand looks shape-wise like
      // a left hand, and the model reports `handedness: 'Left'`. Swap
      // labels post-process so `palm.right.x` continues to track the
      // user's actual right hand regardless of mirror state. Without
      // this, selfie mode (mirror=true, the default) inverts which
      // hand each signal follows.
      if (this.opts.mirror && hands.length > 0) {
        hands = hands.map(h => ({
          ...h,
          handedness: h.handedness === 'Left' ? 'Right'
            : h.handedness === 'Right' ? 'Left'
            : h.handedness,
        }));
      }
      const frame = deriveSignals(msg.timestamp, hands, { pose: msg.pose, face: msg.face, mirrored: this.opts.mirror });

      // Suppress gesture "stuck" signals — only fire the gesture every
      // time it *changes*, so a consumer using gestures as triggers
      // gets one edge per actual change instead of every frame.
      const filteredGestures: SignalFrame['gestures'] = { 'gesture.right': '', 'gesture.left': '' };
      for (const key of ['gesture.right', 'gesture.left'] as const) {
        const cur = frame.gestures[key];
        const prev = this.lastGestureByHand[key];
        filteredGestures[key] = cur !== prev ? cur : '';
        this.lastGestureByHand[key] = cur;
      }
      const stableFrame: SignalFrame = { ...frame, gestures: filteredGestures };

      this.lastFrame = stableFrame;
      for (const cb of this.listeners) {
        try { cb(stableFrame); } catch (err) { console.warn('[MediaPipe] listener threw', err); }
      }
    } else if (msg?.type === 'error') {
      // Treat as ack so the pump can resume — otherwise an error would
      // leave framesInFlight stuck at 1 forever.
      this.framesInFlight = Math.max(0, this.framesInFlight - 1);
      this.error = msg.message;
      console.warn('[MediaPipe] worker error', msg.message);
      this.emitState();
    }
  }
}

function optsEqual(a: Required<MediaPipeStartOptions>, b: Required<MediaPipeStartOptions>): boolean {
  return a.deviceId === b.deviceId && a.useGesture === b.useGesture && a.mirror === b.mirror
    && a.targetFps === b.targetFps && a.numHands === b.numHands
    && a.trackBody === b.trackBody && a.trackFace === b.trackFace;
}

function optsKey(o: Required<MediaPipeStartOptions>): string {
  return [o.deviceId, o.useGesture, o.mirror, o.targetFps, o.numHands, o.trackBody, o.trackFace].join('|');
}

export const mediaPipeSource = new MediaPipeSource();

/** Re-export so UI code can show a labeled gesture picker. */
export { GESTURE_LIST };
