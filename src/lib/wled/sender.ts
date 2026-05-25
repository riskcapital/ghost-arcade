/**
 * WLED LED-controller sender.
 *
 * For each enabled WLED controller in the project store, this module
 * maintains:
 *   - a tiny 2D tap canvas sized (ledCount × 1)
 *   - a throttled per-frame readback that downscales the main WebGL
 *     output into the tap canvas, then ships the RGB bytes to the
 *     main process via IPC
 *
 * The main process owns the UDP socket (renderer can't open UDP in
 * Electron). See electron/main.js → wled_send_frame for the wire
 * format (DRGB / WLED protocol 2).
 *
 * Architecture choices:
 *
 * 1. **Tap canvas instead of gl.readPixels.** Mirrors the Spout slice
 *    pipeline (Canvas.svelte:1450+). The 2D canvas drawImage() is
 *    GPU-accelerated, handles Y-flip, and downsamples in one step —
 *    much cheaper than gl.readPixels of the full frame followed by
 *    a CPU resize. For 32 LEDs we read 32 RGBA bytes per frame
 *    instead of millions.
 *
 * 2. **In-flight gating per controller.** UDP is fire-and-forget but
 *    Node's dgram.send still returns a Promise; we don't fire the
 *    next frame's send until the previous one resolves. Prevents
 *    runaway IPC queueing if a controller is unreachable.
 *
 * 3. **Rate-limited to ~60Hz.** WLED handles up to a few hundred Hz
 *    but the controller's WS2812B driver typically refreshes at
 *    ~400Hz max. Sending faster than display refresh is wasted
 *    bandwidth. We use 16ms minimum interval (matches RAF cadence).
 *
 * 4. **Brightness + gamma applied in JS, not GLSL.** Keeps the
 *    WebGL render path untouched. The cost is one pass over 32-490
 *    bytes per frame — trivial.
 */

import { get } from 'svelte/store';
import { project } from '../stores/layers';
import type { WLEDController } from '../types';
import { invoke } from '../bridge';

/** Per-controller runtime state. */
interface SenderState {
  controller: WLEDController;
  tapCanvas: HTMLCanvasElement;
  tapCtx: CanvasRenderingContext2D;
  rgbBuffer: Uint8Array;         // (ledCount * 3) packed bytes
  lastSendMs: number;
  inFlight: boolean;
  lastErrorAt: number;           // For throttling repeated error logs
}

let glCanvas: HTMLCanvasElement | null = null;
let senders: Map<string, SenderState> = new Map();
let unsubProject: (() => void) | null = null;

// Minimum interval between sends per controller (ms). 16ms = ~60Hz —
// matches RAF cadence; sending faster is wasted bandwidth + CPU.
const MIN_SEND_INTERVAL_MS = 16;

/** Build (or reuse) a tap canvas for a controller. Canvas is sized
 *  to (ledCount × 1) so getImageData reads exactly N pixels. */
function ensureSender(c: WLEDController): SenderState {
  const existing = senders.get(c.id);
  // If the controller's ledCount changed, recreate the canvas.
  if (existing && existing.controller.ledCount === c.ledCount) {
    existing.controller = c;  // Update other params (ipAddr, brightness, etc.)
    return existing;
  }
  if (existing) {
    senders.delete(c.id);
  }
  const tap = document.createElement('canvas');
  tap.width = Math.max(1, Math.min(490, c.ledCount));
  tap.height = 1;
  const ctx = tap.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Failed to acquire 2D context for WLED tap canvas');
  }
  const state: SenderState = {
    controller: c,
    tapCanvas: tap,
    tapCtx: ctx,
    rgbBuffer: new Uint8Array(tap.width * 3),
    lastSendMs: 0,
    inFlight: false,
    lastErrorAt: 0,
  };
  senders.set(c.id, state);
  return state;
}

/** Tear down a sender + tell the main process to close its socket. */
function teardownSender(id: string) {
  const s = senders.get(id);
  if (!s) return;
  senders.delete(id);
  invoke('wled_close_socket', { controllerId: id }).catch(() => {
    // Socket may already be closed — main process logs on its end.
  });
}

/** Apply gamma correction. 1.0 = passthrough; ~2.2 is typical for
 *  perceptually-linear LED brightness. */
function gammaCorrect(v: number, gamma: number): number {
  if (gamma === 1 || gamma <= 0) return v;
  return Math.pow(v / 255, gamma) * 255;
}

/** Read the tap canvas's pixels into the rgb byte buffer with
 *  brightness + gamma applied. Drops alpha. */
function packRGB(state: SenderState) {
  const { tapCtx, rgbBuffer, controller, tapCanvas } = state;
  const imgData = tapCtx.getImageData(0, 0, tapCanvas.width, 1);
  const src = imgData.data;
  const brightness = controller.brightness ?? 1;
  const gamma = controller.gamma ?? 1;
  for (let i = 0, j = 0; i < src.length; i += 4, j += 3) {
    let r = src[i] * brightness;
    let g = src[i + 1] * brightness;
    let b = src[i + 2] * brightness;
    if (gamma !== 1) {
      r = gammaCorrect(r, gamma);
      g = gammaCorrect(g, gamma);
      b = gammaCorrect(b, gamma);
    }
    rgbBuffer[j] = Math.max(0, Math.min(255, r | 0));
    rgbBuffer[j + 1] = Math.max(0, Math.min(255, g | 0));
    rgbBuffer[j + 2] = Math.max(0, Math.min(255, b | 0));
  }
}

/** Called every frame from Canvas.svelte's animate loop. Walks the
 *  current sender set, taps + sends for any due for an update. */
export function tickWLEDSenders() {
  if (!glCanvas || senders.size === 0) return;
  const now = performance.now();
  for (const state of senders.values()) {
    if (!state.controller.enabled) continue;
    if (state.inFlight) continue;
    if (now - state.lastSendMs < MIN_SEND_INTERVAL_MS) continue;

    // Tap: draw GL canvas into tap canvas (downsamples to ledCount × 1).
    // scale(1, -1) flips Y to match WebGL's bottom-up frame buffer.
    try {
      state.tapCtx.save();
      state.tapCtx.scale(1, -1);
      state.tapCtx.drawImage(glCanvas, 0, -1, state.tapCanvas.width, 1);
      state.tapCtx.restore();
      packRGB(state);
    } catch (err) {
      // GL canvas might be in a transitional state (e.g. resize). Skip
      // this frame and retry next.
      continue;
    }

    state.lastSendMs = now;
    state.inFlight = true;
    invoke('wled_send_frame', {
      controllerId: state.controller.id,
      ip: state.controller.ipAddr,
      port: state.controller.port,
      pixels: state.rgbBuffer,
    }).then((res: any) => {
      state.inFlight = false;
      if (res && !res.ok && now - state.lastErrorAt > 5000) {
        // Throttle error logs to once per 5s so we don't flood
        // when a controller goes offline.
        state.lastErrorAt = now;
        console.warn('[WLED] send failed for', state.controller.name, res.error);
      }
    }).catch(() => {
      state.inFlight = false;
    });
  }
}

/** Start the senders. Subscribes to project.wledControllers and
 *  reconciles the running sender set on each change. */
export function startWLEDSenders(canvas: HTMLCanvasElement) {
  if (unsubProject) return;  // Idempotent
  glCanvas = canvas;
  unsubProject = project.subscribe(p => {
    const live = new Set<string>();
    for (const c of p.wledControllers ?? []) {
      live.add(c.id);
      ensureSender(c);
    }
    // Tear down any sender whose controller was removed.
    for (const id of Array.from(senders.keys())) {
      if (!live.has(id)) teardownSender(id);
    }
  });
}

/** Stop everything + close all sockets. */
export function stopWLEDSenders() {
  if (unsubProject) {
    unsubProject();
    unsubProject = null;
  }
  for (const id of Array.from(senders.keys())) {
    teardownSender(id);
  }
  glCanvas = null;
}
