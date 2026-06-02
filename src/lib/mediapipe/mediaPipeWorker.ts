// MediaPipe inference worker. Owns the Hand Landmarker + Gesture
// Recognizer instances so inference (which can block ~10ms per frame
// on landmarks alone) happens off the main thread — this is what the
// MediaPipe docs explicitly recommend for live video pipelines.
//
// Protocol (all messages JSON; ImageBitmaps transferred):
//
// Main → Worker:
//   { type: 'init', wasmUrl, handModelUrl, gestureModelUrl, useGesture, numHands }
//   { type: 'frame', bitmap: ImageBitmap, timestamp: number }
//   { type: 'dispose' }
//
// Worker → Main:
//   { type: 'ready' }
//   { type: 'error', message }
//   { type: 'result', timestamp, hands: WorkerHandResult[] }
//
// We intentionally keep the worker dumb — it only runs the inference
// and ships raw results. Signal derivation (pinch distance, palm
// normalization, etc.) lives in mediaPipeSource on the main thread so
// it's easy to add new signals without round-tripping changes through
// worker rebuilds.

import {
  FilesetResolver,
  HandLandmarker,
  GestureRecognizer,
  type HandLandmarkerResult,
  type GestureRecognizerResult,
} from '@mediapipe/tasks-vision';

interface WorkerHandLandmark { x: number; y: number; z: number; }

export interface WorkerHandResult {
  /** 'Left' | 'Right' as MediaPipe reports it (from the model's POV;
   *  may need flipping if the camera image is mirrored). */
  handedness: string;
  /** 0..1 — model confidence in handedness. */
  handednessScore: number;
  /** 21 landmarks normalized 0..1 in image space (origin top-left). */
  landmarks: WorkerHandLandmark[];
  /** 21 landmarks in metric world coords (origin = hand center). */
  worldLandmarks: WorkerHandLandmark[];
  /** Canned-gesture category (empty when gesture model disabled). */
  gestureName: string;
  gestureScore: number;
}

let handLandmarker: HandLandmarker | null = null;
let gestureRecognizer: GestureRecognizer | null = null;
let useGestureModel = true;
let lastTimestamp = -1;

self.addEventListener('message', async (e: MessageEvent) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      await initModels(msg.wasmUrl, msg.handModelUrl, msg.gestureModelUrl, msg.useGesture ?? true, msg.numHands ?? 2);
      (self as any).postMessage({ type: 'ready' });
    } else if (msg.type === 'frame') {
      processFrame(msg.bitmap as ImageBitmap, msg.timestamp as number);
    } else if (msg.type === 'dispose') {
      try { handLandmarker?.close(); } catch {}
      try { gestureRecognizer?.close(); } catch {}
      handLandmarker = null;
      gestureRecognizer = null;
    }
  } catch (err: any) {
    (self as any).postMessage({ type: 'error', message: String(err?.message || err) });
  }
});

async function initModels(
  wasmUrl: string, handModelUrl: string, gestureModelUrl: string,
  useGesture: boolean, numHands: number,
): Promise<void> {
  useGestureModel = useGesture;
  // useModule: true picks vision_wasm_module_internal.js (the ES-module
  // variant) instead of vision_wasm_internal.js. The classic file uses
  // a top-level `var ModuleFactory = …` pattern that only pollutes
  // `self` when loaded via importScripts() in a classic worker. We run
  // a `{ type: 'module' }` worker, so importScripts is unavailable and
  // FilesetResolver falls back to dynamic `import()` — which scopes the
  // `var` to the module and leaves self.ModuleFactory undefined,
  // throwing "ModuleFactory not set." The _module_ variant is real ESM
  // and assigns self.ModuleFactory explicitly.
  const fileset = await FilesetResolver.forVisionTasks(wasmUrl, true);

  // Pre-import the WASM loader and stash its default export so we can
  // load multiple models back-to-back. The loader's last line is
  // `globalThis.ModuleFactory = ModuleFactory; export default
  // ModuleFactory;` — that side-effect assignment only fires on first
  // import (dynamic import() is cached per URL). MediaPipe's internal
  // `aa()` helper then does `self.ModuleFactory = void 0` after
  // consuming the factory, so the second createFromOptions call
  // (GestureRecognizer right after HandLandmarker) would throw
  // "ModuleFactory not set." Re-installing the saved factory before
  // each model creation works around the consume-once behaviour.
  const loaderMod: any = await import(/* @vite-ignore */ fileset.wasmLoaderPath);
  const moduleFactory = loaderMod?.default ?? (self as any).ModuleFactory;
  const installFactory = () => { (self as any).ModuleFactory = moduleFactory; };

  // HandLandmarker always created; it's the one we trust for positions
  // even when the gesture model is also active (gesture model has its
  // own landmarks but we use the dedicated landmarker for stability).
  installFactory();
  handLandmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: handModelUrl, delegate: 'GPU' },
    numHands,
    runningMode: 'VIDEO',
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  if (useGesture) {
    installFactory();
    gestureRecognizer = await GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: gestureModelUrl, delegate: 'GPU' },
      numHands,
      runningMode: 'VIDEO',
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }
}

function processFrame(bitmap: ImageBitmap, timestamp: number): void {
  if (!handLandmarker) {
    bitmap.close?.();
    return;
  }
  // MediaPipe requires monotonically increasing timestamps. Camera
  // frames can land out of order if the worker queue stacks; clamp to
  // prevent the "timestamp not greater than previous" runtime error.
  if (timestamp <= lastTimestamp) timestamp = lastTimestamp + 1;
  lastTimestamp = timestamp;

  let handResult: HandLandmarkerResult;
  let gestureResult: GestureRecognizerResult | null = null;
  try {
    handResult = handLandmarker.detectForVideo(bitmap, timestamp);
    if (gestureRecognizer && useGestureModel) {
      gestureResult = gestureRecognizer.recognizeForVideo(bitmap, timestamp);
    }
  } finally {
    bitmap.close?.();
  }

  // MediaPipe reports landmarks and gestures as parallel arrays —
  // index N in handednesses / landmarks / gestures refers to the same
  // detected hand. Stitch into a single WorkerHandResult per hand.
  const count = handResult.landmarks.length;
  const out: WorkerHandResult[] = [];
  for (let i = 0; i < count; i++) {
    const hd = handResult.handedness[i]?.[0];
    // Gesture result indexes can be out of sync if numHands differs; be defensive.
    const gd = gestureResult?.gestures?.[i]?.[0];
    out.push({
      handedness: hd?.categoryName ?? 'Unknown',
      handednessScore: hd?.score ?? 0,
      landmarks: handResult.landmarks[i] as any,
      worldLandmarks: handResult.worldLandmarks[i] as any,
      gestureName: gd?.categoryName ?? '',
      gestureScore: gd?.score ?? 0,
    });
  }
  (self as any).postMessage({ type: 'result', timestamp, hands: out });
}
