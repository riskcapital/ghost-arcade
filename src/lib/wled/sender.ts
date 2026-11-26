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
 * 3. **Bounded update rate.** A 16ms minimum interval caps legacy
 *    render-loop sends. Native output follows fresh frames from the
 *    shared composite mirror (requested at 20fps). A frame identical to
 *    the last one sent is skipped, except for a once-a-second keepalive.
 *
 * 4. **Physical mapping.** Auto grids, linear strips, serpentine
 *    matrices, source regions, and custom LED points all resolve to
 *    deterministic sample coordinates in physical LED order.
 *
 * 5. **Brightness + gamma applied in JS, not GLSL.** Keeps the
 *    WebGL render path untouched. The cost is one pass over up to 490 RGB
 *    pixels per frame — trivial.
 *
 * 6. **The render core sends when it can.** Under the native driver
 *    (startWLEDNativeOutput) every controller the core can drive alone
 *    goes to it as a plan (corePlan.ts): the core samples its own program
 *    picture and sends on its own clock with the same keep-alive rule and
 *    link tracking, and the composite mirror here stops once no controller
 *    is left on this path. Controllers that an LED FX reaches, that the
 *    Timeline's LED rows drive, or that a Timeline line dims stay here,
 *    because those are computed in the editor every frame; so do host
 *    names, GA_CORE_WLED=0, an old core and any failure. The main process
 *    (electron/wled-route.cjs) moves each controller between the two
 *    without a gap the strip could show.
 */

import { writable } from 'svelte/store';
import { project } from '../stores/layers';
import { audioStore } from '../stores/audio';
import type { Project, WLEDController, WLEDEffect, WLEDNormalizedPoint } from '../types';
import { invoke } from '../bridge';
import {
  calibrateWLEDPixels,
  fillWLEDTestPattern,
  resolveWLEDMapping,
  sampleWLEDSourcePixels,
  sanitizeWLEDCount,
} from './mapping';
import { applyWLEDEffects, ledEffectBpm } from './effects';
import { lineLedOverrides } from '../timeline/lines/lineRuntime';
import { applyLedControllerOverrides, applyLedEffectOverrides } from '../timeline/lines/stageLedParams';
import { currentLedTimeline } from '../timeline/leds/ledRuntime';
import { controllerNeedsPicture, renderTimelineLeds } from '../timeline/leds/ledRender';
import { acquireNativeCompositeMirror, compositeMirrorCanvas, compositeMirrorPixels, type CompositeMirrorHandle } from '../sync/nativeCompositeMirror';
import { onLedTimelineChange } from '../timeline/leds/ledRuntime';
import { controlLineFrame } from '../timeline/lines/lineRuntime';
import { buildCoreWLEDPlan, coreWLEDBlocker, CORE_WLED_MAX_DIM, CORE_WLED_FPS } from './corePlan';

/** Per-controller runtime state. */
interface SenderState {
  controller: WLEDController;
  rgbBuffer: Uint8Array;         // (ledCount * 3) packed bytes
  sourceBuffer: Uint8Array;
  effectBuffer: Uint8Array;
  previousBuffer: Uint8Array;
  samplePoints: WLEDNormalizedPoint[];
  sampleRadius: number;
  // What samplePoints were built from. Project edits replace the mapping
  // object rather than change it, so a reference check is enough.
  mappingRef: WLEDController['mapping'];
  mappingCount: number;
  mappingAspectKey: number;
  lastSendMs: number;
  /** Last frame actually put on the wire, and when. */
  sentBuffer: Uint8Array;
  lastWireMs: number;
  inFlight: boolean;
  lastErrorAt: number;           // For throttling repeated error logs
  lastTelemetryAt: number;
}

export interface WLEDTelemetry {
  sourceColor: string;
  outputColor: string;
  updatedAt: number;
  /** The Timeline's LED rows drive the controller. */
  timeline?: boolean;
  /** The last frame sent, per LED (for the map preview). */
  pixels?: Uint8Array;
}

export const wledTelemetry = writable<Record<string, WLEDTelemetry>>({});

export type WLEDSourceRole = 'editor' | 'output' | 'osr' | 'native';

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
// An unchanged frame is sent again only this often. WLED leaves realtime
// mode when no packet arrives for the 2 s timeout set in each packet.
export const WLED_KEEPALIVE_MS = 1000;

/**
 * Install mode's off periods: every controller sends black and keeps
 * sending it (the once-a-second keepalive), so the strips stay dark instead
 * of falling back to the controller's own effect after its two-second
 * realtime timeout.
 */
let forceBlack = false;
export function setWLEDForceBlack(on: boolean): void {
  if (forceBlack === on) return;
  forceBlack = on;
  // Send the change at once rather than at the next keepalive.
  for (const state of senders.values()) state.lastWireMs = -Infinity;
  // The core's controllers get it with their plan.
  reconcileNative();
}
export function wledForceBlack(): boolean {
  return forceBlack;
}

const SOURCE_ROLE_PRIORITY: Record<WLEDSourceRole, number> = {
  native: 4,
  editor: 3,
  output: 2,
  osr: 1,
};

/** Choose the authoritative render source. The native mirror wins when
 *  registered; browser editor/output/OSR canvases are fallback sources. */
function activeSource(): RegisteredSource | null {
  let best: RegisteredSource | null = null;
  for (const source of registeredSources.values()) {
    if (source.role !== 'native' && !source.canvas.isConnected) continue;
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
    if (existing.controller !== c) existing.lastWireMs = -Infinity; // address or settings changed: send the next frame
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
    sampleRadius: 0,
    mappingRef: undefined,
    mappingCount: 0,
    mappingAspectKey: Number.NaN,
    lastSendMs: 0,
    sentBuffer: new Uint8Array(count * 3),
    lastWireMs: -Infinity,
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
  const count = sanitizeWLEDCount(state.controller.ledCount);
  const aspectKey = Math.round(sourceAspect * 10000);
  if (
    state.mappingRef === state.controller.mapping
    && state.mappingCount === count
    && state.mappingAspectKey === aspectKey
  ) return;
  state.mappingRef = state.controller.mapping;
  state.mappingCount = count;
  state.mappingAspectKey = aspectKey;
  const mapping = resolveWLEDMapping(state.controller.ledCount, state.controller.mapping, sourceAspect);
  state.samplePoints = mapping.points;
  state.sampleRadius = mapping.sampleRadius;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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

function captureComposite(sourceCanvas: HTMLCanvasElement, flipY: boolean): ImageData | null {
  const context = ensureFrameTap(sourceCanvas);
  if (!context || !frameTapCanvas) return null;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, frameTapCanvas.width, frameTapCanvas.height);
  context.save();
  if (flipY) context.setTransform(1, 0, 0, -1, 0, frameTapCanvas.height);
  context.drawImage(sourceCanvas, 0, 0, frameTapCanvas.width, frameTapCanvas.height);
  context.restore();
  return context.getImageData(0, 0, frameTapCanvas.width, frameTapCanvas.height);
}

function packRGB(state: SenderState, imageData: { data: Uint8ClampedArray; width: number; height: number } | null, nowMs: number) {
  // Timeline control lines on the LEDs (brightness, gamma, effect values),
  // never written to the project.
  const ledLines = lineLedOverrides();
  const controller = applyLedControllerOverrides(state.controller, ledLines);
  const options = {
    brightness: controller.brightness,
    gamma: controller.gamma,
    calibration: state.controller.calibration,
  };
  const testPattern = state.controller.testPattern ?? 'off';
  let timelineDriven = false;
  if (testPattern !== 'off') {
    fillWLEDTestPattern(
      testPattern,
      state.controller.testColor,
      nowMs,
      state.rgbBuffer,
      options,
      state.previousBuffer
    );
  } else if (imageData || currentLedTimeline()) {
    // The Timeline's colour blocks need no picture; following the stage does.
    if (imageData) {
      sampleWLEDSourcePixels(
        imageData.data,
        imageData.width,
        imageData.height,
        state.samplePoints,
        state.sampleRadius,
        state.sourceBuffer,
        state.controller.samplingMode ?? 'dominant'
      );
    } else {
      state.sourceBuffer.fill(0);
    }
    // The Timeline's LED rows, when they reach this controller; else the
    // project's own LED FX over the sampled picture.
    const timeline = currentLedTimeline();
    timelineDriven = !!timeline && renderTimelineLeds(state.controller, timeline.clips, { ...timeline, lines: (id) => timeline.lines.get(id), source: state.sourceBuffer }, state.effectBuffer);
    if (!timelineDriven) {
      applyWLEDEffects(
        state.sourceBuffer,
        state.effectBuffer,
        state.controller,
        currentProject?.wledGroups ?? [],
        applyLedEffectOverrides(currentProject?.wledEffects ?? [], ledLines) as WLEDEffect[],
        currentProject?.wledEffectAutomation,
        nowMs,
        currentBpm
      );
    }
    calibrateWLEDPixels(
      state.effectBuffer,
      state.rgbBuffer,
      options,
      state.previousBuffer
    );
  }
  if (forceBlack) state.rgbBuffer.fill(0);
  state.previousBuffer.set(state.rgbBuffer);
  if (nowMs - state.lastTelemetryAt >= 100) {
    state.lastTelemetryAt = nowMs;
    wledTelemetry.update(telemetry => ({
      ...telemetry,
      [state.controller.id]: {
        sourceColor: averageColorHex(testPattern === 'off' ? state.sourceBuffer : state.rgbBuffer),
        outputColor: averageColorHex(state.rgbBuffer),
        updatedAt: Date.now(),
        timeline: timelineDriven,
        pixels: state.rgbBuffer.slice(),
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

/** The Timeline drives this controller with colours only: no picture needed. */
function needsPicture(controller: WLEDController): boolean {
  const timeline = currentLedTimeline();
  return !timeline || controllerNeedsPicture(controller, timeline.clips, timeline);
}

/**
 * The picture to sample. Under the native driver the canvas is the composite
 * mirror, whose last frame is already in memory as pixels: sampling those
 * avoids reading the canvas back from the GPU (a synchronous round trip that
 * stalls the page while the GPU is busy). Otherwise, or when the mirror's
 * last frame came as JPEG, the canvas is tapped.
 */
function framePixels(canvas: HTMLCanvasElement): ImageData | { data: Uint8ClampedArray; width: number; height: number } | null {
  if (activeSource()?.role === 'native' && canvas === compositeMirrorCanvas()) {
    const pixels = compositeMirrorPixels();
    if (pixels && pixels.width === canvas.width && pixels.height === canvas.height) return pixels;
  }
  return captureComposite(canvas, activeSource()?.role !== 'native');
}

/** Called every frame from Canvas.svelte's animate loop. Walks the
 *  current sender set, taps + sends for any due for an update. */
export function tickWLEDSenders(canvas: HTMLCanvasElement) {
  if (senders.size === 0 || activeSource()?.canvas !== canvas) return;
  const now = performance.now();
  let imageData: ReturnType<typeof framePixels> | undefined;
  for (const state of senders.values()) {
    if (!state.controller.enabled) continue;
    // The render core sends this one, or is about to.
    if (coreIds.has(state.controller.id) || corePendingIds.has(state.controller.id)) continue;
    if (state.inFlight) continue;
    if (now - state.lastSendMs < MIN_SEND_INTERVAL_MS) continue;

    ensureSamplePoints(state, canvas);

    try {
      if (imageData === undefined && !forceBlack && (state.controller.testPattern ?? 'off') === 'off' && needsPicture(state.controller)) {
        try {
          imageData = framePixels(canvas);
        } catch (err) {
          // No picture this frame: the Timeline's own colours still go out.
          if (!currentLedTimeline()) throw err;
          imageData = null;
        }
      }
      packRGB(state, imageData ?? null, now);
    } catch (err) {
      // GL canvas might be in a transitional state (e.g. resize). Skip
      // this frame and retry next.
      continue;
    }

    state.lastSendMs = now;
    // Skip a frame identical to the last one sent, apart from a keepalive.
    if (now - state.lastWireMs < WLED_KEEPALIVE_MS && sameBytes(state.rgbBuffer, state.sentBuffer)) continue;
    state.sentBuffer.set(state.rgbBuffer);
    state.lastWireMs = now;
    state.inFlight = true;
    invoke('wled_send_frame', {
      controllerId: state.controller.id,
      ip: state.controller.ipAddr,
      port: state.controller.port,
      name: state.controller.name,
      pixels: state.rgbBuffer,
    }).then((res: any) => {
      state.inFlight = false;
      if (res && !res.ok) state.lastWireMs = -Infinity; // not delivered: send the next frame
      if (res && !res.ok && now - state.lastErrorAt > 5000) {
        // Throttle error logs to once per 5s so we don't flood
        // when a controller goes offline.
        state.lastErrorAt = now;
        console.warn('[WLED] send failed for', state.controller.name, res.error);
      }
    }).catch(() => {
      state.inFlight = false;
      state.lastWireMs = -Infinity;
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
    currentBpm = ledEffectBpm(state);
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

// ─── Render core output (native driver) ───────────────────────────────

let nativeRunning = false;
let nativeProject: Project | null = null;
let nativeMirror: CompositeMirrorHandle | null = null;
let nativeCanvas: HTMLCanvasElement | null = null;
let nativeUnsubscribers: Array<() => void> = [];
/** Controllers the core sends; offered to it and not yet answered. */
const coreIds = new Set<string>();
let corePendingIds = new Set<string>();
let corePlanJson: string | null = null;
let coreRefusedJson: string | null = null;
let coreDisabled = false;
let coreInFlight = false;
let coreDirty = false;
let corePoll: ReturnType<typeof setInterval> | null = null;
let corePollInFlight = false;
/** What the last plan was built from: rebuilt only when this changes. */
let corePlanKey = '';
let coreControllersRef: unknown = null;
// The picture's aspect (auto-grid maps follow it): from the mirror while
// it runs, else from the core's own picture.
let coreAspect = 16 / 9;
const CORE_POLL_MS = 250;

function aspectKey(aspect: number): number {
  return Math.round(aspect * 10000);
}

/** Send the next frame from here at once (a controller coming back from the core). */
function resendFromHere(ids?: Iterable<string>) {
  for (const id of ids ?? senders.keys()) {
    const state = senders.get(id);
    if (state) state.lastWireMs = -Infinity;
  }
}

function startCorePoll() {
  if (corePoll) return;
  corePoll = setInterval(pollCore, CORE_POLL_MS);
}

function stopCorePoll() {
  if (corePoll) clearInterval(corePoll);
  corePoll = null;
  corePollInFlight = false;
}

function fromHex(text: unknown): Uint8Array | null {
  if (typeof text !== 'string' || text.length % 2 !== 0) return null;
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

interface CoreStats {
  core?: boolean;
  controllers?: Array<{ controllerId?: string; source?: string; rgb?: string; live?: boolean }>;
  pictureWidth?: number;
  pictureHeight?: number;
}

function pollCore() {
  if (corePollInFlight || coreIds.size === 0) return;
  corePollInFlight = true;
  invoke('wled_get_stats', {})
    .then((result: CoreStats | undefined) => {
      corePollInFlight = false;
      if (coreIds.size === 0 || !nativeRunning) return;
      if (result?.core !== true) {
        // The core stopped (or restarted without the plan): send from here.
        console.warn('[WLED] render core output lost; sending from the app');
        coreRefusedJson = corePlanJson;
        corePlanJson = null;
        resendFromHere(coreIds);
        coreIds.clear();
        stopCorePoll();
        reconcileNative();
        return;
      }
      const now = Date.now();
      const updates: Record<string, WLEDTelemetry> = {};
      for (const entry of result.controllers ?? []) {
        const id = entry.controllerId;
        if (!id || !coreIds.has(id) || !entry.live) continue;
        const source = fromHex(entry.source);
        const rgb = fromHex(entry.rgb);
        if (!source || !rgb) continue;
        updates[id] = { sourceColor: averageColorHex(source), outputColor: averageColorHex(rgb), updatedAt: now, timeline: false, pixels: rgb };
      }
      if (Object.keys(updates).length) wledTelemetry.update(telemetry => ({ ...telemetry, ...updates }));
      // Auto-grid maps follow the picture's aspect: rebuild when the core's differs.
      const width = result.pictureWidth ?? 0;
      const height = result.pictureHeight ?? 0;
      if (!nativeMirror && width > 0 && height > 0 && aspectKey(width / height) !== aspectKey(coreAspect)) {
        coreAspect = width / height;
        reconcileNative();
      }
    })
    .catch(() => { corePollInFlight = false; });
}

function ensureNativeMirror() {
  if (nativeMirror) return;
  nativeMirror = acquireNativeCompositeMirror({
    maxDim: CORE_WLED_MAX_DIM,
    fps: CORE_WLED_FPS,
    onFrame: () => { if (nativeMirror) tickWLEDSenders(nativeMirror.canvas); },
  });
  if (nativeCanvas !== nativeMirror.canvas) {
    nativeCanvas = nativeMirror.canvas;
    startWLEDSenders(nativeCanvas, 'native');
  }
}

function releaseNativeMirror() {
  if (!nativeMirror) return;
  const canvas = nativeMirror.canvas;
  if (canvas.width > 0 && canvas.height > 0) coreAspect = canvas.width / canvas.height;
  nativeMirror.release();
  nativeMirror = null;
}

function stopCore() {
  stopCorePoll();
  const had = coreIds.size > 0 || corePlanJson !== null || coreInFlight;
  coreIds.clear();
  corePendingIds = new Set();
  corePlanJson = null;
  corePlanKey = '';
  if (had) invoke('wled_core_stop', {}).catch(() => { /* main process gone */ });
}

function stopNativeAll() {
  stopCore();
  releaseNativeMirror();
  if (nativeCanvas) {
    stopWLEDSenders(nativeCanvas);
    nativeCanvas = null;
  }
}

/** Offer the core the controllers it can drive, or take them back. */
function requestCore(eligible: WLEDController[]) {
  if (coreInFlight) {
    coreDirty = true;
    return;
  }
  if (coreDisabled) eligible = [];
  const key = `${eligible.map(c => c.id).join('|')}#${forceBlack ? 1 : 0}#${aspectKey(coreAspect)}`;
  const controllers = nativeProject?.wledControllers;
  if (key === corePlanKey && controllers === coreControllersRef) return;
  corePlanKey = key;
  coreControllersRef = controllers;
  if (eligible.length === 0) {
    if (coreIds.size > 0 || corePlanJson) {
      resendFromHere(coreIds);
      stopCore();
    }
    return;
  }
  const plan = buildCoreWLEDPlan(eligible, coreAspect, forceBlack);
  const json = JSON.stringify(plan);
  if (json === corePlanJson || json === coreRefusedJson) return;
  const offered = new Set(eligible.map(c => c.id));
  // Leaving the core: sent from here again from the next frame on (the
  // main process takes each back from the core at its first frame).
  for (const id of Array.from(coreIds)) {
    if (!offered.has(id)) {
      coreIds.delete(id);
      resendFromHere([id]);
    }
  }
  // Newly offered: held here until the core answers, so the two never
  // send different frames to one strip.
  corePendingIds = new Set(Array.from(offered).filter(id => !coreIds.has(id)));
  coreInFlight = true;
  coreDirty = false;
  invoke('wled_core_configure', plan)
    .then((result: { ok?: boolean; reason?: string } | undefined) => {
      coreInFlight = false;
      corePendingIds = new Set();
      if (!nativeRunning) return;
      if (result?.ok === true) {
        coreIds.clear();
        for (const id of offered) coreIds.add(id);
        corePlanJson = json;
        coreRefusedJson = null;
        startCorePoll();
      } else {
        if (coreIds.size) console.warn('[WLED] render core output stopped:', result?.reason);
        if (typeof result?.reason === 'string' && result.reason.startsWith('disabled')) coreDisabled = true;
        resendFromHere(offered);
        coreIds.clear();
        corePlanJson = null;
        coreRefusedJson = json;
        stopCorePoll();
      }
      corePlanKey = '';
      reconcileNative();
    })
    .catch(() => {
      coreInFlight = false;
      corePendingIds = new Set();
      resendFromHere(offered);
      coreIds.clear();
      corePlanJson = null;
      coreRefusedJson = json;
      corePlanKey = '';
      reconcileNative();
    });
}

/** Match the core plan and the mirror to the project, the Timeline and install mode. */
function reconcileNative() {
  if (!nativeRunning) return;
  const p = nativeProject;
  const enabled = (p?.wledControllers ?? []).filter(c => c.enabled);
  if (!p || enabled.length === 0) {
    stopNativeAll();
    return;
  }
  if (nativeMirror) {
    const canvas = nativeMirror.canvas;
    if (canvas.width > 0 && canvas.height > 0) coreAspect = canvas.width / canvas.height;
  }
  const ctx = {
    timeline: currentLedTimeline(),
    lines: lineLedOverrides(),
    groups: p.wledGroups ?? [],
    effects: p.wledEffects ?? [],
    automation: p.wledEffectAutomation,
  };
  requestCore(enabled.filter(c => coreWLEDBlocker(c, ctx) === null));
  // The mirror runs while any controller is sent from here.
  if (enabled.some(c => !coreIds.has(c.id) && !corePendingIds.has(c.id))) ensureNativeMirror();
  else releaseNativeMirror();
  if (coreDirty && !coreInFlight) {
    coreDirty = false;
    reconcileNative();
  }
}

/**
 * WLED output under the native driver: the render core sends what it can,
 * the composite mirror feeds the rest from here. Returns the teardown.
 */
export function startWLEDNativeOutput(): () => void {
  if (nativeRunning) return () => {};
  nativeRunning = true;
  coreDisabled = false;
  coreRefusedJson = null;
  nativeUnsubscribers = [
    project.subscribe(p => {
      nativeProject = p;
      reconcileNative();
    }),
    // The Timeline's lines and LED rows decide which controllers the core may take.
    controlLineFrame.subscribe(() => reconcileNative()),
    onLedTimelineChange(() => reconcileNative()),
  ];
  return () => {
    if (!nativeRunning) return;
    for (const unsubscribe of nativeUnsubscribers) unsubscribe();
    nativeUnsubscribers = [];
    stopNativeAll();
    nativeRunning = false;
    nativeProject = null;
  };
}
