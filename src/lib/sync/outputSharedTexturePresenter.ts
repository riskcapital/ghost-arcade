/**
 * outputSharedTexturePresenter — editor-side WebGPU zero-copy sender.
 *
 * Architectural model: same-renderer-process Resolume pattern. The
 * editor renderer process owns BOTH the editor window AND the output
 * window(s); the output windows are opened via `window.open()` (which
 * Chromium routes to the same renderer process for same-origin URLs).
 * A local `new MessageChannel()` between the two windows preserves
 * transferable VideoFrame zero-copy because the V8 heap and GPU
 * command stream are shared.
 *
 *   Editor renderer process
 *     editor canvas ─→ captureStream(60) ─→ MediaStreamTrackProcessor
 *                                              ↓ readable.getReader()
 *                                          VideoFrame
 *                                              ↓ port.postMessage(vf, [vf])
 *                                          ──── same-process MessageChannel ────
 *                                              ↓
 *     output window  ─→ port.onmessage(vf)  → device.importExternalTexture
 *                                                ─→ fullscreen quad
 *
 * Why NOT cross-process MessageChannelMain (the original design):
 *   - Chromium 130's Mojo IPC for cross-renderer MessagePort silently
 *     drops the GpuMemoryBuffer handle when transferring a VideoFrame.
 *     The receiver gets nothing. Verified empirically: editor sends
 *     frames, GC warnings appear because nothing closes them on the
 *     receive side, and the output's port.onmessage never fires.
 *   - Only specific Mojo interfaces (RTCRtpSender, MediaStreamTrack)
 *     have GpuMemoryBuffer-preserving cross-process transfer. Generic
 *     MessagePort doesn't.
 *
 * Lifecycle:
 *   1. `attachOutputWindow(targetWindow)` is called from
 *      OutputWindow.svelte after `window.open(...)` returns. The
 *      target Window proxy is the renderer-side handle to the new
 *      same-process window.
 *   2. We register a `window.message` listener that waits for the
 *      output window to send `{ type: 'ghostarcade-output-ready' }`
 *      (output side does this on its onMount after WebGPU is ready
 *      to receive).
 *   3. On 'output-ready', we create a local MessageChannel, post
 *      port2 to the target via `targetWindow.postMessage(..., [port2])`,
 *      and use port1 for our pump.
 *   4. `startPump()` opens captureStream + MediaStreamTrackProcessor
 *      and runs the read-and-transfer loop.
 *   5. If the target window closes (we detect via target.closed
 *      polling or message error), we tear down the pump and wait
 *      for a fresh attach.
 *
 * Multi-output (future): each call to attachOutputWindow registers a
 * separate target. The pump then fan-outs each frame to N ports via
 * `videoFrame.clone()` (refcount bump, still zero-copy). For now
 * single-output is the only call site.
 */

import { get } from 'svelte/store';
import { settings } from '$lib/stores/settings';

type EditorFrame = VideoFrame;

let sourceCanvas: HTMLCanvasElement | null = null;
let captureFrameRate = 60;

// One target window + one paired port. Multi-output extension would
// turn these into Map<windowId, {target, port}>.
let targetWindow: Window | null = null;
let outboundPort: MessagePort | null = null;
let pendingChannel: MessageChannel | null = null;

let mediaStream: MediaStream | null = null;
let processor: MediaStreamTrackProcessor<EditorFrame> | null = null;
let reader: ReadableStreamDefaultReader<EditorFrame> | null = null;
let pumpRunning = false;

let settingsUnsub: (() => void) | null = null;
let lastTransformJson = '';

// Listener for the output window's 'ready' message + 'bye' message.
// Registered exactly once when the first attachOutputWindow call
// happens; survives subsequent attaches (they post their own ready,
// each ready is matched against the current targetWindow reference).
let messageListenerInstalled = false;

let stats = {
  framesTransferred: 0,
  framesDroppedNoPort: 0,
  framesDroppedTransferError: 0,
  lastFormat: '' as string,
  formatHistogram: new Map<string, number>(),
  fps: 0,
  startedAt: 0,
  lastFrameAt: 0,
};

function isPresenterEligible(): boolean {
  if (typeof window === 'undefined') return false;
  if ((window as any).__OUTPUT_WINDOW_MODE__) return false;
  if ((window as any).__SPOUT_OSR_MODE__) return false;
  return true;
}

function installMessageListener(): void {
  if (messageListenerInstalled) return;
  if (typeof window === 'undefined') return;
  window.addEventListener('message', (event: MessageEvent) => {
    // Only consider messages from windows we have attached as targets
    // (the output window sends from its own context). MessageEvent.source
    // is a WindowProxy when the message comes from another window.
    if (!event?.data || typeof event.data !== 'object') return;
    const data = event.data;
    if (data.type === 'ghostarcade-output-ready') {
      // The output window is ready to receive. Establish the channel.
      // Validate source matches the target we attached, in case we
      // somehow get a ready from an old window after a reattach.
      if (event.source && targetWindow && event.source === (targetWindow as any)) {
        establishChannel();
      } else if (targetWindow) {
        // No source check — accept anyway. Chromium doesn't always
        // populate event.source for cross-window posts depending on
        // the security context. The targetWindow check + the URL
        // mode gate on the receiver side is enough.
        establishChannel();
      }
    } else if (data.type === 'ghostarcade-output-bye') {
      // Output is shutting down or reloading. Tear down the pump so
      // we don't keep posting to a dead port.
      console.log('[OutputSharedTexture] output window said bye — tearing down pump');
      stopOutputSharedTexturePresenter();
    }
  });
  messageListenerInstalled = true;
}

function establishChannel(): void {
  if (!targetWindow) return;
  if (outboundPort) {
    // Already established — re-establishing means the output reloaded.
    // Tear down the old pump first.
    teardownPort();
  }
  try {
    pendingChannel = new MessageChannel();
    // Post port2 to the output window. The transfer list MUST include
    // port2 — otherwise the port gets cloned (which doesn't actually
    // create a working MessagePort).
    targetWindow.postMessage(
      { type: 'ghostarcade-output-transport-port' },
      '*',
      [pendingChannel.port2],
    );
    outboundPort = pendingChannel.port1;
    pendingChannel = null;
    console.log('[OutputSharedTexture] MessageChannel established with output window — port1 retained, port2 sent');
    // Push initial transform snapshot now that the port is live.
    sendTransformSnapshot(get(settings));
    maybeStartPump();
  } catch (err) {
    console.error('[OutputSharedTexture] failed to establish channel:', err);
  }
}

function sendTransformSnapshot(s: any): void {
  if (!outboundPort) return;
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
    outboundPort.postMessage(payload);
  } catch {
    // Port may have closed since we last checked; pump's catch will
    // detect it on the next frame.
  }
}

// Output cursor position (0..1 normalized canvas coords). The editor
// renderer pushes the latest mouse-over-canvas position via this
// setter; the output receiver renders a CSS crosshair overlay at
// that position when visible. De-duped on the JSON of the payload
// so we don't spam the channel with identical messages between
// frames where the cursor didn't actually move.
let lastCursorJson = '';
export function setOutputCursor(u: number, v: number, visible: boolean): void {
  if (!outboundPort) return;
  const payload = {
    type: 'cursor',
    x: Math.max(0, Math.min(1, u)),
    y: Math.max(0, Math.min(1, v)),
    visible,
  };
  const json = JSON.stringify(payload);
  if (json === lastCursorJson) return;
  lastCursorJson = json;
  try {
    outboundPort.postMessage(payload);
  } catch { /* */ }
}

// Cursor STYLE — separate from position because it changes rarely
// (user tweaks settings) vs position (every mousemove). Keeping
// them in different messages avoids re-sending the style every
// frame for nothing.
let lastCursorStyleJson = '';
export interface OutputCursorStyle {
  style: 'crosshair' | 'circle' | 'dot' | 'reticle' | 'fullscreen';
  sizePx: number;
  thicknessPx: number;
  color: string;
  opacity: number;
}
export function setOutputCursorStyle(s: OutputCursorStyle): void {
  if (!outboundPort) return;
  const payload = { type: 'cursorStyle', ...s };
  const json = JSON.stringify(payload);
  if (json === lastCursorStyleJson) return;
  lastCursorStyleJson = json;
  try {
    outboundPort.postMessage(payload);
  } catch { /* */ }
}

/** Register the editor's main canvas with the presenter. Called once
 *  from Canvas.svelte's onMount. The canvas is held module-locally so
 *  any future attachOutputWindow call can start the pump without
 *  needing OutputWindow.svelte (which lives in a different component
 *  tree) to re-derive it. Idempotent on the same canvas; calling with
 *  a different canvas tears down any active pump. */
export function registerEditorCanvas(canvas: HTMLCanvasElement, frameRate = 60): void {
  if (!isPresenterEligible()) return;
  if (sourceCanvas === canvas) {
    captureFrameRate = frameRate;
    return;
  }
  if (sourceCanvas) {
    // Different canvas — tear down any pump on the old one.
    pumpRunning = false;
    if (reader) {
      try { reader.cancel('canvas swap'); } catch { /* */ }
      try { reader.releaseLock(); } catch { /* */ }
      reader = null;
    }
    processor = null;
    if (mediaStream) {
      try { mediaStream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
      mediaStream = null;
    }
  }
  sourceCanvas = canvas;
  captureFrameRate = frameRate;
  // If a target window is already attached (output opened first,
  // Canvas mounted second — possible during dev hot-reload), the pump
  // can start now.
  maybeStartPump();
}

/** Called from OutputWindow.svelte right after `window.open(...)`.
 *  The target Window proxy is the renderer-side handle to the new
 *  same-process child window. We start listening for the output's
 *  'ready' message; once received we establish the MessageChannel
 *  and start pumping frames (assuming the editor canvas was already
 *  registered via registerEditorCanvas). */
export function attachOutputWindow(target: Window): void {
  if (!isPresenterEligible()) return;
  installMessageListener();
  if (targetWindow && targetWindow !== target) {
    // Re-attach: previous target was different (closed and reopened).
    // Tear down the old channel before binding the new one.
    teardownPort();
  }
  targetWindow = target;

  if (!settingsUnsub) {
    settingsUnsub = settings.subscribe(sendTransformSnapshot);
  }

  // The output window may have already been mounted by the time we
  // get here. Send a probe 'editor-attach' message; the output's
  // listener responds with 'output-ready' if it's set up. This
  // handles the race where output's onMount finishes before our
  // message listener is installed.
  try {
    target.postMessage({ type: 'ghostarcade-editor-attach' }, '*');
  } catch (err) {
    console.warn('[OutputSharedTexture] could not post editor-attach probe:', err);
  }

  console.log('[OutputSharedTexture] attached to output window — awaiting ready handshake');
}

export function stopOutputSharedTexturePresenter(): void {
  pumpRunning = false;
  if (reader) {
    try { reader.cancel('presenter stopped'); } catch { /* */ }
    try { reader.releaseLock(); } catch { /* */ }
    reader = null;
  }
  processor = null;
  if (mediaStream) {
    try { mediaStream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    mediaStream = null;
  }
  if (settingsUnsub) {
    try { settingsUnsub(); } catch { /* */ }
    settingsUnsub = null;
  }
  teardownPort();
  targetWindow = null;
  sourceCanvas = null;
  resetStats();
}

function teardownPort(): void {
  if (outboundPort) {
    try { outboundPort.close(); } catch { /* */ }
    outboundPort = null;
  }
  pendingChannel = null;
  lastTransformJson = '';
}

function resetStats(): void {
  stats = {
    framesTransferred: 0,
    framesDroppedNoPort: 0,
    framesDroppedTransferError: 0,
    lastFormat: '',
    formatHistogram: new Map<string, number>(),
    fps: 0,
    startedAt: 0,
    lastFrameAt: 0,
  };
}

function maybeStartPump(): void {
  if (pumpRunning) return;
  if (!sourceCanvas) return;
  if (!outboundPort) return;
  if (typeof MediaStreamTrackProcessor === 'undefined') {
    console.warn('[OutputSharedTexture] MediaStreamTrackProcessor unavailable — Chromium feature flag may be off');
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
  if (!reader) return;
  while (pumpRunning) {
    let value: EditorFrame | undefined;
    let done = false;
    try {
      const result = await reader.read();
      done = result.done;
      value = result.value;
    } catch {
      break;
    }
    if (done) break;
    if (!value) continue;
    if (!outboundPort) {
      stats.framesDroppedNoPort++;
      try { value.close(); } catch { /* */ }
      continue;
    }

    const fmt = (value.format as string | null) ?? 'unknown';
    stats.lastFormat = fmt;
    stats.formatHistogram.set(fmt, (stats.formatHistogram.get(fmt) ?? 0) + 1);
    if (stats.framesTransferred < 5) {
      console.log(
        `[OutputSharedTexture] frame ${stats.framesTransferred + 1} format=${fmt} ` +
          `dim=${value.codedWidth}x${value.codedHeight} ts=${value.timestamp}`,
      );
    }

    const now = performance.now();
    if (stats.lastFrameAt > 0) {
      const dt = now - stats.lastFrameAt;
      const inst = 1000 / Math.max(1, dt);
      stats.fps = stats.fps === 0 ? inst : stats.fps * 0.9 + inst * 0.1;
    }
    stats.lastFrameAt = now;

    try {
      outboundPort.postMessage(value, [value]);
      stats.framesTransferred++;
    } catch (err) {
      stats.framesDroppedTransferError++;
      try { value.close(); } catch { /* */ }
      console.warn('[OutputSharedTexture] postMessage failed — output likely closed:', (err as any)?.message ?? err);
      // Tear down only the port + pump; keep the targetWindow
      // reference because the user may reload the output. The next
      // 'output-ready' will re-establish.
      pumpRunning = false;
      teardownPort();
      return;
    }
  }
}

export function getOutputSharedTexturePresenterStats() {
  const histogram: Record<string, number> = {};
  stats.formatHistogram.forEach((v, k) => { histogram[k] = v; });
  return {
    active: !!sourceCanvas,
    pumpRunning,
    portConnected: !!outboundPort,
    targetAttached: !!targetWindow,
    framesTransferred: stats.framesTransferred,
    framesDroppedNoPort: stats.framesDroppedNoPort,
    framesDroppedTransferError: stats.framesDroppedTransferError,
    lastFormat: stats.lastFormat,
    formatHistogram: histogram,
    fps: stats.fps,
    uptimeMs: stats.startedAt ? performance.now() - stats.startedAt : 0,
  };
}
