// MediaPipe camera + worker manager. Singleton (one camera per app),
// mirrors how multiStemAnalyzer manages a single audio source.
//
// Lifecycle:
//   start(opts) — request camera, create worker, send init message,
//                 begin RAF loop. Resolves when the worker reports ready.
//   stop()      — tear down RAF, worker, camera.
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
};

// Public CDN URLs for the model files. Phase 1 fetches them at runtime
// — Phase 2 can optionally bundle a local copy for offline use.
const HAND_MODEL_URL    = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const GESTURE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

export type GestureListener = (signal: SignalFrame) => void;

class MediaPipeSource {
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

  /** Start the pipeline. Idempotent — calling while running with the
   *  same opts is a no-op; with different opts, stops and restarts. */
  async start(opts: MediaPipeStartOptions = {}): Promise<void> {
    const next: Required<MediaPipeStartOptions> = { ...DEFAULT_OPTS, ...opts };
    if (this.running && optsEqual(this.opts, next)) return;
    if (this.pendingStart) await this.pendingStart;
    this.pendingStart = this._startInternal(next).finally(() => { this.pendingStart = null; });
    return this.pendingStart;
  }

  /** Stop everything. Safe to call when not running. */
  async stop(): Promise<void> {
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
  }

  subscribe(cb: GestureListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  isRunning(): boolean { return this.running; }
  getError(): string | null { return this.error; }
  getLastFrame(): SignalFrame { return this.lastFrame; }
  getVideoElement(): HTMLVideoElement | null { return this.video; }
  getOpts(): Required<MediaPipeStartOptions> { return this.opts; }

  // ── Internal ─────────────────────────────────────────────────────────

  private async _startInternal(opts: Required<MediaPipeStartOptions>): Promise<void> {
    if (this.running) await this.stop();
    this.error = null;
    this.opts = opts;

    try {
      // 1. Camera
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: opts.deviceId
          ? { deviceId: { exact: opts.deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
          : { width: { ideal: 640 }, height: { ideal: 480 } },
      };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);

      this.video = document.createElement('video');
      this.video.autoplay = true;
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = this.stream;
      this.video.style.cssText = 'position:absolute;top:-99999px;left:-99999px;pointer-events:none;';
      document.body.appendChild(this.video);
      await new Promise<void>((resolve, reject) => {
        const onReady = () => { this.video!.removeEventListener('loadedmetadata', onReady); resolve(); };
        const onErr = (e: any) => { this.video!.removeEventListener('error', onErr); reject(e); };
        this.video!.addEventListener('loadedmetadata', onReady);
        this.video!.addEventListener('error', onErr);
      });
      await this.video.play();

      // 2. Offscreen canvas for grabbing ImageBitmaps to send to worker
      this.offscreen = new OffscreenCanvas(this.video.videoWidth, this.video.videoHeight);
      this.offCtx = this.offscreen.getContext('2d', { willReadFrequently: false });
      if (!this.offCtx) throw new Error('Failed to create 2D context for camera capture');

      // 3. Worker — Vite resolves this at build time. The `type: 'module'`
      // is required because MediaPipe's bundle uses ESM imports.
      this.worker = new Worker(new URL('./mediaPipeWorker.ts', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (e) => this._onWorkerMessage(e));

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
            this.worker!.removeEventListener('message', onMsg);
            resolve();
          } else if (e.data?.type === 'error') {
            this.worker!.removeEventListener('message', onMsg);
            reject(new Error(e.data.message));
          }
        };
        this.worker!.addEventListener('message', onMsg);
      });
      this.worker.postMessage({
        type: 'init',
        wasmUrl,
        handModelUrl: HAND_MODEL_URL,
        gestureModelUrl: GESTURE_MODEL_URL,
        useGesture: opts.useGesture,
        numHands: opts.numHands,
      });
      await initDone;
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
    } catch (err: any) {
      this.error = String(err?.message || err);
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
      const frame = deriveSignals(msg.timestamp, hands);

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
    }
  }
}

function optsEqual(a: Required<MediaPipeStartOptions>, b: Required<MediaPipeStartOptions>): boolean {
  return a.deviceId === b.deviceId && a.useGesture === b.useGesture && a.mirror === b.mirror
    && a.targetFps === b.targetFps && a.numHands === b.numHands;
}

export const mediaPipeSource = new MediaPipeSource();

/** Re-export so UI code can show a labeled gesture picker. */
export { GESTURE_LIST };
