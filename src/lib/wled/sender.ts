/**
 * WLED LED-controller sender.
 *
 * For each enabled WLED controller in the project store, this module
 * maintains a mapped RGB buffer and ships it to the main process via
 * IPC. All controllers sample one shared low-resolution snapshot of
 * the final composite, so custom maps do not multiply canvas readbacks.
 *
 * The main process owns the UDP socket (renderer can't open UDP in
 * Electron). See electron/main.js → wled_send_frame for the wire
 * format (DRGB / WLED protocol 2).
 *
 * Architecture choices:
 *
 * 1. **Shared tap canvas instead of gl.readPixels.** The 2D drawImage()
 *    handles Y-flip and downsamples once per frame. Every controller
 *    then samples arbitrary normalized points from that shared frame.
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
 * 4. **Physical mapping.** Auto grids, linear strips, serpentine
 *    matrices, source regions, and custom LED points all resolve to
 *    deterministic sample coordinates in physical LED order.
 *
 * 5. **Brightness + gamma applied in JS, not GLSL.** Keeps the
 *    WebGL render path untouched. The cost is one pass over 32-490
 *    bytes per frame — trivial.
 */

import { writable } from 'svelte/store';
import { project } from '../stores/layers';
import { audioStore } from '../stores/audio';
import type { Project, WLEDController, WLEDNormalizedPoint } from '../types';
import { invoke } from '../bridge';
import {
  calibrateWLEDPixels,
  fillWLEDTestPattern,
  resolveWLEDMapping,
  sampleWLEDSourcePixels,
  sanitizeWLEDCount,
} from './mapping';
import { applyWLEDEffects } from './effects';

/** Per-controller runtime state. */
interface SenderState {
  controller: WLEDController;
  rgbBuffer: Uint8Array;         // (ledCount * 3) packed bytes
  sourceBuffer: Uint8Array;
  effectBuffer: Uint8Array;
  previousBuffer: Uint8Array;
  samplePoints: WLEDNormalizedPoint[];
  mappingSignature: string;
  lastSendMs: number;
  inFlight: boolean;
  lastErrorAt: number;           // For throttling repeated error logs
  lastTelemetryAt: number;
}

export interface WLEDTelemetry {
  sourceColor: string;
  outputColor: string;
  updatedAt: number;
}

export const wledTelemetry = writable<Record<string, WLEDTelemetry>>({});

export type WLEDSourceRole = 'editor' | 'output' | 'osr';

interface RegisteredSource {
  canvas: HTMLCanvasElement;
  role: WLEDSourceRole;
}

const registeredSources = new Map<HTMLCanvasElement, RegisteredSource>();
let senders: Map<string, SenderState> = new Map();
let unsubProject: (() => void) | null = null;
let unsubAudio: (() => void) | null = null;
let frameTapCanvas: HTMLCanvasElement | null = null;
let frameTapCtx: CanvasRenderingContext2D | null = null;
let currentProject: Project | null = null;
let currentBpm = 120;

// Minimum interval between sends per controller (ms). 16ms = ~60Hz —
// matches RAF cadence; sending faster is wasted bandwidth + CPU.
const MIN_SEND_INTERVAL_MS = 16;

const SOURCE_ROLE_PRIORITY: Record<WLEDSourceRole, number> = {
  editor: 3,
  output: 2,
  osr: 1,
};

/** Choose the authoritative render source. The editor wins while it is
 *  mounted; output/OSR canvases are failover sources only. */
function activeSource(): RegisteredSource | null {
  let best: RegisteredSource | null = null;
  for (const source of registeredSources.values()) {
    if (!source.canvas.isConnected) continue;
    if (!best || SOURCE_ROLE_PRIORITY[source.role] > SOURCE_ROLE_PRIORITY[best.role]) {
      best = source;
    }
  }
  return best;
}

/** Build (or reuse) runtime state for a controller. */
function ensureSender(c: WLEDController): SenderState {
  const existing = senders.get(c.id);
  if (existing && existing.controller.ledCount === c.ledCount) {
    existing.controller = c;  // Update other params (ipAddr, brightness, etc.)
    return existing;
  }
  if (existing) {
    senders.delete(c.id);
  }
  const count = sanitizeWLEDCount(c.ledCount);
  const state: SenderState = {
    controller: c,
    rgbBuffer: new Uint8Array(count * 3),
    sourceBuffer: new Uint8Array(count * 3),
    effectBuffer: new Uint8Array(count * 3),
    previousBuffer: new Uint8Array(count * 3),
    samplePoints: [],
    mappingSignature: '',
    lastSendMs: 0,
    inFlight: false,
    lastErrorAt: 0,
    lastTelemetryAt: 0,
  };
  senders.set(c.id, state);
  return state;
}

function ensureSamplePoints(state: SenderState, sourceCanvas: HTMLCanvasElement) {
  const sourceAspect = sourceCanvas.width > 0 && sourceCanvas.height > 0
    ? sourceCanvas.width / sourceCanvas.height
    : 16 / 9;
  const signature = JSON.stringify([
    sanitizeWLEDCount(state.controller.ledCount),
    sourceAspect.toFixed(4),
    state.controller.mapping ?? null,
  ]);
  if (signature === state.mappingSignature) return;
  state.mappingSignature = signature;
  state.samplePoints = resolveWLEDMapping(
    state.controller.ledCount,
    state.controller.mapping,
    sourceAspect
  ).points;
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

function ensureFrameTap(sourceCanvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  if (!frameTapCanvas) {
    frameTapCanvas = document.createElement('canvas');
    frameTapCtx = frameTapCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!frameTapCanvas || !frameTapCtx) return null;
  const aspect = sourceCanvas.width > 0 && sourceCanvas.height > 0
    ? sourceCanvas.width / sourceCanvas.height
    : 16 / 9;
  const maxDimension = 192;
  const width = aspect >= 1
    ? maxDimension
    : Math.max(1, Math.round(maxDimension * aspect));
  const height = aspect >= 1
    ? Math.max(1, Math.round(maxDimension / aspect))
    : maxDimension;
  if (frameTapCanvas.width !== width || frameTapCanvas.height !== height) {
    frameTapCanvas.width = width;
    frameTapCanvas.height = height;
  }
  return frameTapCtx;
}

function captureComposite(sourceCanvas: HTMLCanvasElement): ImageData | null {
  const context = ensureFrameTap(sourceCanvas);
  if (!context || !frameTapCanvas) return null;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, frameTapCanvas.width, frameTapCanvas.height);
  context.save();
  context.setTransform(1, 0, 0, -1, 0, frameTapCanvas.height);
  context.drawImage(sourceCanvas, 0, 0, frameTapCanvas.width, frameTapCanvas.height);
  context.restore();
  return context.getImageData(0, 0, frameTapCanvas.width, frameTapCanvas.height);
}

function packRGB(state: SenderState, imageData: ImageData | null, nowMs: number) {
  const mapping = resolveWLEDMapping(
    state.controller.ledCount,
    state.controller.mapping,
    imageData && imageData.height > 0 ? imageData.width / imageData.height : 16 / 9
  );
  const options = {
    brightness: state.controller.brightness,
    gamma: state.controller.gamma,
    calibration: state.controller.calibration,
  };
  const testPattern = state.controller.testPattern ?? 'off';
  if (testPattern !== 'off') {
    fillWLEDTestPattern(
      testPattern,
      state.controller.testColor,
      nowMs,
      state.rgbBuffer,
      options,
      state.previousBuffer
    );
  } else if (imageData) {
    sampleWLEDSourcePixels(
      imageData.data,
      imageData.width,
      imageData.height,
      state.samplePoints,
      mapping.sampleRadius,
      state.sourceBuffer,
      state.controller.samplingMode ?? 'dominant'
    );
    applyWLEDEffects(
      state.sourceBuffer,
      state.effectBuffer,
      state.controller,
      currentProject?.wledGroups ?? [],
      currentProject?.wledEffects ?? [],
      currentProject?.wledEffectAutomation,
      nowMs,
      currentBpm
    );
    calibrateWLEDPixels(
      state.effectBuffer,
      state.rgbBuffer,
      options,
      state.previousBuffer
    );
  }
  state.previousBuffer.set(state.rgbBuffer);
  if (nowMs - state.lastTelemetryAt >= 100) {
    state.lastTelemetryAt = nowMs;
    wledTelemetry.update(telemetry => ({
      ...telemetry,
      [state.controller.id]: {
        sourceColor: averageColorHex(testPattern === 'off' ? state.sourceBuffer : state.rgbBuffer),
        outputColor: averageColorHex(state.rgbBuffer),
        updatedAt: Date.now(),
      },
    }));
  }
}

function averageColorHex(buffer: Uint8Array): string {
  const count = Math.max(1, Math.floor(buffer.length / 3));
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    red += buffer[offset] ?? 0;
    green += buffer[offset + 1] ?? 0;
    blue += buffer[offset + 2] ?? 0;
  }
  const hex = (value: number) => Math.round(value / count).toString(16).padStart(2, '0');
  return `#${hex(red)}${hex(green)}${hex(blue)}`;
}

/** Called every frame from Canvas.svelte's animate loop. Walks the
 *  current sender set, taps + sends for any due for an update. */
export function tickWLEDSenders(canvas: HTMLCanvasElement) {
  if (senders.size === 0 || activeSource()?.canvas !== canvas) return;
  const now = performance.now();
  let imageData: ImageData | null | undefined;
  for (const state of senders.values()) {
    if (!state.controller.enabled) continue;
    if (state.inFlight) continue;
    if (now - state.lastSendMs < MIN_SEND_INTERVAL_MS) continue;

    ensureSamplePoints(state, canvas);

    try {
      if (imageData === undefined && (state.controller.testPattern ?? 'off') === 'off') {
        imageData = captureComposite(canvas);
      }
      packRGB(state, imageData ?? null, now);
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
export function startWLEDSenders(canvas: HTMLCanvasElement, role: WLEDSourceRole = 'editor') {
  registeredSources.set(canvas, { canvas, role });
  if (unsubProject) return;
  unsubProject = project.subscribe(p => {
    currentProject = p;
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
  unsubAudio = audioStore.subscribe(state => {
    currentBpm = state.bpm > 0 ? state.bpm : state.manualBPM ?? 120;
  });
}

/** Unregister one canvas. Shared sender state remains alive until the
 *  final render source is gone, so preset/output teardown cannot stop it. */
export function stopWLEDSenders(canvas: HTMLCanvasElement) {
  registeredSources.delete(canvas);
  if (registeredSources.size > 0) return;
  if (unsubProject) {
    unsubProject();
    unsubProject = null;
  }
  if (unsubAudio) {
    unsubAudio();
    unsubAudio = null;
  }
  for (const id of Array.from(senders.keys())) {
    teardownSender(id);
  }
  currentProject = null;
  wledTelemetry.set({});
  frameTapCanvas = null;
  frameTapCtx = null;
}
