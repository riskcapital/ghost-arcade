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

// Multi-target: each attached output window (Fullscreen + N slice
// displays) has its own MessagePort. The single editor pump reads
// VideoFrames and fan-outs to all attached ports via VideoFrame.clone()
// (refcount bump — still zero-copy on the underlying GpuMemoryBuffer).
// Backwards-compat: callers that don't pass an id share the legacy
// 'main' slot (the Fullscreen output's traditional slot).
type TargetState = {
  window: Window;
  port: MessagePort | null;
  pendingChannel: MessageChannel | null;
  lastTransformJson: string;
};
const targets = new Map<string, TargetState>();

let mediaStream: MediaStream | null = null;
let processor: MediaStreamTrackProcessor<EditorFrame> | null = null;
let reader: ReadableStreamDefaultReader<EditorFrame> | null = null;
let pumpRunning = false;

let settingsUnsub: (() => void) | null = null;

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
    if (!event?.data || typeof event.data !== 'object') return;
    const data = event.data;
    if (data.type === 'ghostarcade-output-ready') {
      // Find which attached target sent this ready. event.source is a
      // WindowProxy when the message came from another window. Compare
      // against each attached target.window to route correctly.
      let matchedId: string | null = null;
      if (event.source) {
        for (const [id, t] of targets) {
          if (event.source === (t.window as any)) { matchedId = id; break; }
        }
      }
      if (!matchedId) {
        // Chromium can drop event.source on cross-window posts in some
        // security contexts. Fallback: if exactly one target is awaiting
        // ready (no port yet), establish that one. With multiple racing
        // attaches this isn't perfect but it's the historical behavior.
        const awaiting = Array.from(targets.entries()).filter(([, t]) => !t.port);
        if (awaiting.length === 1) matchedId = awaiting[0][0];
      }
      if (matchedId) establishChannel(matchedId);
    } else if (data.type === 'ghostarcade-output-bye') {
      // Route to the right target. If no source match (cross-process
      // event.source loss), tear down all — the user has presumably
      // closed everything.
      let matchedId: string | null = null;
      if (event.source) {
        for (const [id, t] of targets) {
          if (event.source === (t.window as any)) { matchedId = id; break; }
        }
      }
      if (matchedId) {
        console.log(`[OutputSharedTexture] target ${matchedId} said bye — detaching`);
        detachOutputWindow(matchedId);
      } else if (targets.size === 1) {
        const [id] = targets.keys();
        detachOutputWindow(id);
      }
    }
  });
  messageListenerInstalled = true;
}

function establishChannel(id: string): void {
  const t = targets.get(id);
  if (!t) return;
  if (t.port) {
    // Already established — re-establishing means the output reloaded.
    try { t.port.close(); } catch { /* */ }
    t.port = null;
  }
  try {
    t.pendingChannel = new MessageChannel();
    // Post port2 to the target window. transfer list MUST include port2.
    t.window.postMessage(
      { type: 'ghostarcade-output-transport-port' },
      '*',
      [t.pendingChannel.port2],
    );
    t.port = t.pendingChannel.port1;
    t.pendingChannel = null;
    t.lastTransformJson = '';
    console.log(`[OutputSharedTexture] MessageChannel established with target ${id}`);
    // Push initial transform snapshot now that this port is live.
    sendTransformSnapshotToTarget(t, get(settings));
    maybeStartPump();
  } catch (err) {
    console.error(`[OutputSharedTexture] failed to establish channel for ${id}:`, err);
  }
}

function sendTransformSnapshotToTarget(t: TargetState, s: any): void {
  if (!t.port) return;
  const payload = {
    type: 'transform',
    rotation: s.output?.outputRotation ?? 0,
    brightness: s.output?.brightness ?? 1,
    contrast: s.output?.contrast ?? 1,
    gamma: s.output?.gamma ?? 1,
    fit: (s.output as any)?.outputFit ?? 'cover',
  };
  const json = JSON.stringify(payload);
  if (json === t.lastTransformJson) return;
  t.lastTransformJson = json;
  try {
    t.port.postMessage(payload);
  } catch {
    // Port may have closed; pump will detect on next frame.
  }
}

function sendTransformSnapshot(s: any): void {
  for (const t of targets.values()) sendTransformSnapshotToTarget(t, s);
}

// Output cursor position (0..1 normalized canvas coords).
let lastCursorJson = '';
export function setOutputCursor(u: number, v: number, visible: boolean): void {
  if (targets.size === 0) return;
  const payload = {
    type: 'cursor',
    x: Math.max(0, Math.min(1, u)),
    y: Math.max(0, Math.min(1, v)),
    visible,
  };
  const json = JSON.stringify(payload);
  if (json === lastCursorJson) return;
  lastCursorJson = json;
  for (const t of targets.values()) {
    if (!t.port) continue;
    try { t.port.postMessage(payload); } catch { /* */ }
  }
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
  if (targets.size === 0) return;
  const payload = { type: 'cursorStyle', ...s };
  const json = JSON.stringify(payload);
  if (json === lastCursorStyleJson) return;
  lastCursorStyleJson = json;
  for (const t of targets.values()) {
    if (!t.port) continue;
    try { t.port.postMessage(payload); } catch { /* */ }
  }
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

/** Attach a new output window. `id` distinguishes simultaneously-
 *  attached targets: Fullscreen uses 'main' (default), each slice
 *  uses `slice:<sliceId>`. Multiple windows can attach concurrently;
 *  the editor pump fan-outs each frame to all attached ports. */
export function attachOutputWindow(target: Window, id: string = 'main'): void {
  if (!isPresenterEligible()) return;
  installMessageListener();
  const existing = targets.get(id);
  if (existing) {
    if (existing.window === target && existing.port) {
      return; // Idempotent — same window already attached.
    }
    // Same id, different window (close+reopen). Tear down the old port.
    if (existing.port) { try { existing.port.close(); } catch { /* */ } }
    targets.delete(id);
  }
  targets.set(id, {
    window: target,
    port: null,
    pendingChannel: null,
    lastTransformJson: '',
  });

  if (!settingsUnsub) {
    settingsUnsub = settings.subscribe(sendTransformSnapshot);
  }

  // Probe the target — if it mounted before this listener was installed,
  // it'll respond with 'output-ready' which we route via event.source.
  try {
    target.postMessage({ type: 'ghostarcade-editor-attach' }, '*');
  } catch (err) {
    console.warn(`[OutputSharedTexture] could not post editor-attach probe to ${id}:`, err);
  }
  console.log(`[OutputSharedTexture] attached output window ${id} — awaiting ready handshake`);
}

/** Detach a single target (closing its port). The pump keeps running
 *  for the other attached targets. */
export function detachOutputWindow(id: string = 'main'): void {
  const t = targets.get(id);
  if (!t) return;
  if (t.port) { try { t.port.close(); } catch { /* */ } }
  if (t.pendingChannel) {
    try { t.pendingChannel.port1.close(); } catch { /* */ }
    try { t.pendingChannel.port2.close(); } catch { /* */ }
  }
  targets.delete(id);
  // Last target gone — stop the pump so we're not pinning a stream.
  if (targets.size === 0) {
    pumpRunning = false;
    if (reader) {
      try { reader.cancel('all targets detached'); } catch { /* */ }
      try { reader.releaseLock(); } catch { /* */ }
      reader = null;
    }
    processor = null;
    if (mediaStream) {
      try { mediaStream.getTracks().forEach((tr) => tr.stop()); } catch { /* */ }
      mediaStream = null;
    }
    if (settingsUnsub) {
      try { settingsUnsub(); } catch { /* */ }
      settingsUnsub = null;
    }
  }
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
  for (const t of targets.values()) {
    if (t.port) { try { t.port.close(); } catch { /* */ } }
  }
  targets.clear();
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
    startedAt: 0,
    lastFrameAt: 0,
  };
}

function anyPortLive(): boolean {
  for (const t of targets.values()) if (t.port) return true;
  return false;
}

function collectLivePorts(): { id: string; port: MessagePort }[] {
  const livePorts: { id: string; port: MessagePort }[] = [];
  for (const [id, t] of Array.from(targets.entries())) {
    try {
      if (t.window.closed) {
        detachOutputWindow(id);
        continue;
      }
    } catch {
      // Some WindowProxy states throw on `.closed`; the next postMessage
      // failure will detach it.
    }
    if (t.port) livePorts.push({ id, port: t.port });
  }
  return livePorts;
}

function cloneFrameForFanout(frame: VideoFrame): VideoFrame | null {
  try {
    const clone = (frame as any).clone?.();
    if (clone) return clone as VideoFrame;
  } catch { /* */ }

  // Conservative fallback for Chromium builds where VideoFrame.clone()
  // is missing or driver-buggy. This keeps secondary outputs alive at
  // the cost of one extra VideoFrame wrapper creation from the already
  // presented canvas.
  if (!sourceCanvas) return null;
  try {
    return new VideoFrame(sourceCanvas as any, {
      timestamp: (frame as any).timestamp,
    } as any);
  } catch {
    return null;
  }
}

function maybeStartPump(): void {
  if (pumpRunning) return;
  if (!sourceCanvas) return;
  if (!anyPortLive()) return;
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
    // Snapshot the live ports — pump can race with attach/detach.
    const livePorts = collectLivePorts();
    if (livePorts.length === 0) {
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
          `dim=${value.codedWidth}x${value.codedHeight} ts=${value.timestamp} fanout=${livePorts.length}`,
      );
    }

    const now = performance.now();
    if (stats.lastFrameAt > 0) {
      const dt = now - stats.lastFrameAt;
      const inst = 1000 / Math.max(1, dt);
      stats.fps = stats.fps === 0 ? inst : stats.fps * 0.9 + inst * 0.1;
    }
    stats.lastFrameAt = now;

    if (livePorts.length === 1) {
      try {
        livePorts[0].port.postMessage(value, [value]);
        stats.framesTransferred++;
      } catch (err) {
        stats.framesDroppedTransferError++;
        try { value.close(); } catch { /* */ }
        console.warn(`[OutputSharedTexture] postMessage to ${livePorts[0].id} failed:`, (err as any)?.message ?? err);
        detachOutputWindow(livePorts[0].id);
      }
      continue;
    }

    // Fan out: one transferable VideoFrame per port. clone() bumps the
    // refcount on the underlying GPU buffer — still zero-copy.
    // Transfer the original to the FIRST port, clone for the rest.
    try {
      const frames: VideoFrame[] = [value];
      for (let i = 1; i < livePorts.length; i++) {
        frames.push(cloneFrameForFanout(value) as any);
      }
      let sentAny = false;
      for (let i = 0; i < livePorts.length; i++) {
        const f = frames[i];
        if (!f) continue;
        try {
          livePorts[i].port.postMessage(f, [f]);
          sentAny = true;
        } catch (err) {
          try { f.close(); } catch { /* */ }
          console.warn(`[OutputSharedTexture] postMessage to ${livePorts[i].id} failed:`, (err as any)?.message ?? err);
          detachOutputWindow(livePorts[i].id);
        }
      }
      if (sentAny) stats.framesTransferred++;
      else stats.framesDroppedTransferError++;
    } catch (err) {
      stats.framesDroppedTransferError++;
      try { value.close(); } catch { /* */ }
      console.warn('[OutputSharedTexture] fan-out failed:', (err as any)?.message ?? err);
      // Pump stays alive — individual port failures are handled per-port
      // inside the fan-out loop. This catch is the outer safety net.
    }
  }
}

export function getOutputSharedTexturePresenterStats() {
  const histogram: Record<string, number> = {};
  stats.formatHistogram.forEach((v, k) => { histogram[k] = v; });
  let liveTargets = 0;
  let liveTargetsWithPort = 0;
  for (const t of targets.values()) {
    liveTargets++;
    if (t.port) liveTargetsWithPort++;
  }
  return {
    active: !!sourceCanvas,
    pumpRunning,
    portConnected: liveTargetsWithPort > 0,
    targetAttached: liveTargets > 0,
    targetCount: liveTargets,
    targetsWithPort: liveTargetsWithPort,
    framesTransferred: stats.framesTransferred,
    framesDroppedNoPort: stats.framesDroppedNoPort,
    framesDroppedTransferError: stats.framesDroppedTransferError,
    lastFormat: stats.lastFormat,
    formatHistogram: histogram,
    fps: stats.fps,
    uptimeMs: stats.startedAt ? performance.now() - stats.startedAt : 0,
  };
}
