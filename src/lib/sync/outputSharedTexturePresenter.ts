/**
 * outputSharedTexturePresenter — editor-side WebGPU zero-copy sender.
 *
 * Replaces outputPixelBroadcast.ts (WebRTC) with the production
 * pipeline. Reads GPU-backed VideoFrames from the editor canvas via
 * MediaStreamTrackProcessor and ships them across to the output
 * window via a cross-process MessagePort (paired by main.js as a
 * MessageChannelMain). The output side calls
 * `device.importExternalTexture({source: videoFrame})` for true
 * zero-copy GPU sampling on a fullscreen quad.
 *
 *   Editor canvas
 *     → canvas.captureStream(60)
 *     → MediaStreamTrackProcessor.readable.getReader()
 *     → port.postMessage(videoFrame, [videoFrame])  ← transferable
 *     ⇒ Output window's WebGPU presenter
 *
 * Why this beats WebRTC for output:
 *   - No encode (WebRTC: VP9/H264 ~5-15ms + lossy compression)
 *   - No decode (WebRTC: matching cost on receive)
 *   - No format conversion (importExternalTexture binds GpuMemoryBuffer
 *     directly; WebRTC always lands in YUV420 + re-converts)
 *   - True 4K60 with no quality drop on degraded encoders
 *   - Each output window gets its own MessagePort → multi-output is
 *     "more presenter windows", no fan-out cost on the editor side
 *
 * Why MessagePort over BroadcastChannel for VideoFrames:
 *   - BroadcastChannel uses structured-clone, which DOES NOT support
 *     transferring objects. VideoFrames would be cloned (CPU readback)
 *     instead of transferred (GPU handle stays GPU-resident). MessagePort
 *     postMessage with the transfer list is the only same-origin
 *     primitive that preserves the GpuMemoryBufferHandle.
 *   - Cross-process MessagePort in Chromium uses Mojo IPC which
 *     forwards the GpuMemoryBuffer handle natively (this is the same
 *     pathway used internally for transferable MediaStreamTracks
 *     between iframes).
 *
 * Lifecycle:
 *   1. Module loads → starts listening for the MessagePort that
 *      preload.cjs forwards via window.postMessage. The port arrives
 *      AFTER an output window opens with `outputZeroCopy` mode (main.js
 *      creates the MessageChannelMain on `did-finish-load`). May
 *      already be present if the editor started after the output
 *      (rare, but possible during dev hot-reload).
 *   2. `startOutputSharedTexturePresenter(canvas)` is called from
 *      Canvas.svelte once the editor canvas exists. Idempotent on the
 *      same canvas.
 *   3. When BOTH a port and a canvas are present, the pump starts:
 *      MediaStreamTrackProcessor reads VideoFrames in a loop, posts
 *      each through the port with the transfer list, and closes any
 *      frame that fails to transfer.
 *   4. `stopOutputSharedTexturePresenter()` tears down the pump and
 *      closes the port. Called when the output window closes (port
 *      breaks, the read loop's catch detects it) or the experimental
 *      flag flips off.
 *
 * Health metrics:
 *   - Per-frame `format` is recorded on the first 5 frames + sampled
 *     once a second after that. `'NV12'`/`'I420'` are the GPU-backed
 *     formats Chromium uses on Win/Mac with discrete GPUs. `'BGRA'`
 *     means Chromium fell back to CPU readback — degraded path, surface
 *     a warning so the operator can tell why their output looks slow.
 *   - Steady-state fps + total frames sent → exposed via
 *     `getOutputSharedTexturePresenterStats()` for the dev panel.
 */

import { get } from 'svelte/store';
import { settings } from '$lib/stores/settings';

/** A frame as captured from the editor canvas. Module-internal alias
 *  so we can swap to a future GPUExternalTexture-backed source without
 *  changing the call sites. */
type EditorFrame = VideoFrame;

let port: MessagePort | null = null;
let portWaiting = true;        // true until window.postMessage delivers one
let sourceCanvas: HTMLCanvasElement | null = null;
let captureFrameRate = 60;

let mediaStream: MediaStream | null = null;
let processor: MediaStreamTrackProcessor<EditorFrame> | null = null;
let reader: ReadableStreamDefaultReader<EditorFrame> | null = null;
let pumpRunning = false;
let pumpAbort = new AbortController();

let settingsUnsub: (() => void) | null = null;
let lastTransformJson = '';

// ── Stats ──────────────────────────────────────────────────────────
// Sampled by the dev panel; lightweight aggregation in the hot loop.
let stats = {
  framesTransferred: 0,
  framesDroppedNoPort: 0,
  framesDroppedTransferError: 0,
  lastFormat: '' as string,
  formatHistogram: new Map<string, number>(),
  fps: 0,
  bytesTransferredEstimate: 0,
  startedAt: 0,
  lastFrameAt: 0,
  // GPU-backed assertion — true when the most recent frames have a
  // GPU-friendly format. False indicates Chromium fell back to CPU.
  gpuBacked: true,
  gpuBackedReason: '',
};

const GPU_FRIENDLY_FORMATS = new Set(['NV12', 'I420', 'I422', 'I444', 'NV12A']);
const FORMAT_LOG_FIRST_N = 5;

function isPresenterEligible(): boolean {
  // Sender lives only in the editor renderer. Output / OSR windows
  // never publish to themselves. The mode flags are exposed by main.ts
  // before any imports run, so reading from window is safe at module
  // load time.
  if (typeof window === 'undefined') return false;
  if ((window as any).__OUTPUT_WINDOW_MODE__) return false;
  if ((window as any).__SPOUT_OSR_MODE__) return false;
  return true;
}

// ── Port intake ────────────────────────────────────────────────────
// The preload script forwards the MessagePort from the main process
// via window.postMessage with a tagged payload. The first port we see
// is the one we use. Subsequent ports (e.g. output window reopened)
// replace the previous one — the old pump tears down, a new one
// starts on the fresh port. This keeps the "single output window"
// case honest while leaving the door open for multi-output later
// (would need a per-port list instead of a single slot).
function installPortIntake(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('message', (event: MessageEvent) => {
    if (!event?.data || typeof event.data !== 'object') return;
    if (event.data.type !== 'ghostarcade-output-transport-port') return;
    const incoming = event.ports?.[0];
    if (!incoming) {
      console.warn('[OutputSharedTexture] received port-intake event with no ports');
      return;
    }
    if (port && port !== incoming) {
      console.log('[OutputSharedTexture] new MessagePort received — replacing previous');
      try { port.close(); } catch { /* */ }
    }
    port = incoming;
    portWaiting = false;
    console.log('[OutputSharedTexture] MessagePort installed, ready to publish frames');
    // If the canvas is already known (Canvas.svelte called start
    // before the port arrived), kick off the pump immediately.
    maybeStartPump();
  });
}

// Install the listener exactly once, at module load. This is a
// renderer-process module — multiple Svelte components importing it
// share the same singleton port + pump. The listener is cheap; only
// fires on tagged messages from preload.
if (isPresenterEligible()) {
  installPortIntake();
}

/** Wire the editor canvas into the presenter. Idempotent — calling
 *  again with the same canvas is a no-op; calling with a different
 *  canvas tears down and restarts. The pump only actually starts
 *  once both a port AND a canvas are present. */
export function startOutputSharedTexturePresenter(canvas: HTMLCanvasElement, frameRate = 60): void {
  if (!isPresenterEligible()) return;
  if (sourceCanvas === canvas && pumpRunning) return;
  if (sourceCanvas !== canvas) stopOutputSharedTexturePresenter();
  sourceCanvas = canvas;
  captureFrameRate = frameRate;

  // Subscribe to settings changes and forward output transform deltas
  // (rotation/brightness/contrast/fit/gamma) over the same port using a
  // sentinel object. The receiver discriminates frames vs control
  // messages by `data instanceof VideoFrame` (frames) or
  // `data?.type === 'transform'` (controls). Keeps everything on one
  // channel so we don't need a second BroadcastChannel for state.
  if (!settingsUnsub) {
    const sendTransformIfChanged = (s: any) => {
      if (!port) return;
      const payload = {
        type: 'transform',
        rotation: s.output?.outputRotation ?? 0,
        brightness: s.output?.brightness ?? 1,
        contrast: s.output?.contrast ?? 1,
        gamma: s.output?.gamma ?? 1,
        fit: (s.output as any)?.outputFit ?? 'cover',
      };
      const json = JSON.stringify(payload);
      if (json === lastTransformJson) return;
      lastTransformJson = json;
      try {
        port.postMessage(payload);
      } catch (err) {
        // If the port is closed (output window died) postMessage
        // throws. The frame pump will detect this on its next iteration
        // and tear down; we just swallow here to avoid spamming logs.
      }
    };
    sendTransformIfChanged(get(settings));
    settingsUnsub = settings.subscribe(sendTransformIfChanged);
  }

  maybeStartPump();
}

export function stopOutputSharedTexturePresenter(): void {
  pumpRunning = false;
  pumpAbort.abort();
  pumpAbort = new AbortController();
  if (reader) {
    try { reader.cancel('presenter stopped'); } catch { /* */ }
    try { reader.releaseLock(); } catch { /* */ }
    reader = null;
  }
  if (processor) {
    processor = null;
  }
  if (mediaStream) {
    try { mediaStream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    mediaStream = null;
  }
  if (settingsUnsub) {
    try { settingsUnsub(); } catch { /* */ }
    settingsUnsub = null;
  }
  if (port) {
    try { port.close(); } catch { /* */ }
    port = null;
    portWaiting = true;
  }
  sourceCanvas = null;
  resetStats();
}

function resetStats(): void {
  stats = {
    framesTransferred: 0,
    framesDroppedNoPort: 0,
    framesDroppedTransferError: 0,
    lastFormat: '',
    formatHistogram: new Map<string, number>(),
    fps: 0,
    bytesTransferredEstimate: 0,
    startedAt: 0,
    lastFrameAt: 0,
    gpuBacked: true,
    gpuBackedReason: '',
  };
}

function maybeStartPump(): void {
  if (pumpRunning) return;
  if (!sourceCanvas) return;
  if (!port) return;
  if (typeof MediaStreamTrackProcessor === 'undefined') {
    console.warn('[OutputSharedTexture] MediaStreamTrackProcessor unavailable — Chromium feature flag may be off');
    stats.gpuBacked = false;
    stats.gpuBackedReason = 'MediaStreamTrackProcessor not available';
    return;
  }
  try {
    mediaStream = sourceCanvas.captureStream(captureFrameRate);
    const track = mediaStream.getVideoTracks()[0];
    if (!track) {
      console.error('[OutputSharedTexture] captureStream returned no video tracks');
      stopOutputSharedTexturePresenter();
      return;
    }
    processor = new MediaStreamTrackProcessor<EditorFrame>({ track });
    reader = processor.readable.getReader();
    pumpRunning = true;
    stats.startedAt = performance.now();
    console.log('[OutputSharedTexture] pump started — publishing frames at', captureFrameRate, 'fps target');
    pump().catch((err) => {
      // pump's normal exit path is via reader.cancel(), which surfaces
      // as 'AbortError' or the cancel reason. Anything else is an
      // unexpected failure worth logging loudly.
      const name = err?.name;
      if (name !== 'AbortError') {
        console.error('[OutputSharedTexture] pump terminated with error:', err);
      }
      pumpRunning = false;
    });
  } catch (err) {
    console.error('[OutputSharedTexture] failed to start pump:', err);
    stopOutputSharedTexturePresenter();
  }
}

async function pump(): Promise<void> {
  // Hot loop. Each iteration:
  //   1. await reader.read() — blocks until the next VideoFrame is
  //      ready from the canvas paint, or the stream closes.
  //   2. Update stats (format histogram + fps EMA).
  //   3. port.postMessage(frame, [frame]) — transfers ownership. The
  //      sender's `frame` is detached after this call; we MUST NOT
  //      touch it again. If postMessage throws (closed port), close
  //      the frame ourselves to release its GPU buffer.
  //
  // We don't yield with setTimeout/RAF between frames because the
  // ReadableStream backpressure is driven by the consumer (the
  // canvas paint rate). MediaStreamTrackProcessor produces at most
  // one frame per actual paint, never faster than the source.
  if (!reader || !port) return;
  // tslint:disable-next-line - we want the explicit `while (true)` for
  // clarity; the exit condition is `done` from the reader.
  while (pumpRunning) {
    let value: EditorFrame | undefined;
    let done = false;
    try {
      const result = await reader.read();
      done = result.done;
      value = result.value;
    } catch (err) {
      // Reader threw — usually means cancel() was called from
      // stopOutputSharedTexturePresenter. Exit cleanly.
      break;
    }
    if (done) break;
    if (!value) continue;
    if (!port) {
      stats.framesDroppedNoPort++;
      try { value.close(); } catch { /* */ }
      continue;
    }

    // Stats accounting. videoFrame.format is the layout of the GPU
    // memory backing the frame; NV12/I420 are the indicators that
    // Chromium kept it on the GPU. BGRA usually means it dropped to
    // CPU readback.
    const fmt = (value.format as string | null) ?? 'unknown';
    stats.lastFormat = fmt;
    stats.formatHistogram.set(fmt, (stats.formatHistogram.get(fmt) ?? 0) + 1);
    if (stats.framesTransferred < FORMAT_LOG_FIRST_N) {
      console.log(
        `[OutputSharedTexture] frame ${stats.framesTransferred + 1} format=${fmt} ` +
          `dim=${value.codedWidth}x${value.codedHeight} ts=${value.timestamp}`,
      );
    }
    if (GPU_FRIENDLY_FORMATS.has(fmt)) {
      if (!stats.gpuBacked) {
        stats.gpuBacked = true;
        stats.gpuBackedReason = '';
        console.log('[OutputSharedTexture] frame format recovered to GPU-friendly:', fmt);
      }
    } else {
      // Only consider it "fell back to CPU" once we've seen a few
      // consecutive non-GPU formats; transient odd frames during
      // ramp-up shouldn't trip the warning badge.
      const cpuCount = (stats.formatHistogram.get('BGRA') ?? 0) + (stats.formatHistogram.get('RGBA') ?? 0);
      if (stats.framesTransferred > 10 && cpuCount > stats.framesTransferred * 0.5) {
        if (stats.gpuBacked) {
          stats.gpuBacked = false;
          stats.gpuBackedReason = `format=${fmt} (Chromium fell back to CPU readback)`;
          console.warn('[OutputSharedTexture] CPU fallback detected:', stats.gpuBackedReason);
        }
      }
    }

    // Per-frame fps EMA. `lastFrameAt = 0` on first iteration so the
    // first delta computes correctly only from the second frame onward.
    const now = performance.now();
    if (stats.lastFrameAt > 0) {
      const dt = now - stats.lastFrameAt;
      const inst = 1000 / Math.max(1, dt);
      stats.fps = stats.fps === 0 ? inst : stats.fps * 0.9 + inst * 0.1;
    }
    stats.lastFrameAt = now;

    // Transfer the frame. We're explicitly transferring (not cloning)
    // — after this call `value` is detached and unusable. The
    // receiver's onmessage handler now owns it and must close() it
    // when done.
    try {
      port.postMessage(value, [value]);
      stats.framesTransferred++;
      // Estimate bytes for the dev panel — codedWidth * codedHeight * 1.5
      // is a passable approximation for NV12 (1 byte luma + 0.5 byte
      // chroma per pixel). Doesn't need to be exact.
      stats.bytesTransferredEstimate += value.codedWidth * value.codedHeight * 1.5;
    } catch (err) {
      stats.framesDroppedTransferError++;
      // Port closed (output window died). Best-effort close of the
      // frame to release GPU memory; transfer might have already
      // succeeded partially in the implementation.
      try { value.close(); } catch { /* */ }
      console.warn('[OutputSharedTexture] postMessage failed — port likely closed:', (err as any)?.message ?? err);
      // Tear down the pump; main.js will set up a fresh channel if
      // the output window reopens.
      stopOutputSharedTexturePresenter();
      return;
    }
  }
}

/** Diagnostic readout — used by the dev preferences panel. */
export function getOutputSharedTexturePresenterStats(): {
  active: boolean;
  pumpRunning: boolean;
  portConnected: boolean;
  framesTransferred: number;
  framesDroppedNoPort: number;
  framesDroppedTransferError: number;
  lastFormat: string;
  formatHistogram: Record<string, number>;
  fps: number;
  bytesTransferredEstimate: number;
  uptimeMs: number;
  gpuBacked: boolean;
  gpuBackedReason: string;
} {
  const histogram: Record<string, number> = {};
  stats.formatHistogram.forEach((v, k) => { histogram[k] = v; });
  return {
    active: !!sourceCanvas,
    pumpRunning,
    portConnected: !!port,
    framesTransferred: stats.framesTransferred,
    framesDroppedNoPort: stats.framesDroppedNoPort,
    framesDroppedTransferError: stats.framesDroppedTransferError,
    lastFormat: stats.lastFormat,
    formatHistogram: histogram,
    fps: stats.fps,
    bytesTransferredEstimate: stats.bytesTransferredEstimate,
    uptimeMs: stats.startedAt ? performance.now() - stats.startedAt : 0,
    gpuBacked: stats.gpuBacked,
    gpuBackedReason: stats.gpuBackedReason,
  };
}
