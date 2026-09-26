/**
 * Art-Net / sACN pixel-mapping runtime.
 *
 * A timer at the project's configured rate (default 40fps, max 60) samples
 * every enabled fixture from the latest native composite snapshot, packs
 * the pixels into DMX universes (fixtures.ts) and ships one frame per tick
 * to the main process (electron/pixelmap-output.cjs), which owns the UDP
 * socket, sequence numbers, rate cap and drop counters.
 *
 * Like WLED, sampling reads the shared native composite mirror, whose
 * snapshot rows are already top-down, so no vertical flip is applied.
 *
 * - One frame in flight at a time. A tick that finds the previous IPC call
 *   unresolved is skipped and counted, so an unreachable node or a busy main
 *   process can never build a queue.
 * - Output stops cleanly: disabling, blackout (the lighting blackout or the
 *   global output blackout) and teardown call pixelmap_stop, which sends one
 *   black frame to every universe and terminates sACN streams.
 * - Test patterns (solid, chase, LED order) run without a composite frame.
 */
import { writable } from 'svelte/store';
import { project } from '../stores/layers';
import { settings } from '../stores/settings';
import { invoke } from '../bridge';
import type { PixelMapConfig, PixelMapFixture, WLEDNormalizedPoint } from '../types';
import { acquireNativeCompositeMirror, type CompositeMirrorHandle } from '../sync/nativeCompositeMirror';
import { calibrateWLEDPixels, fillWLEDTestPattern, sampleWLEDSourcePixels } from '../wled/mapping';
import {
  buildPixelMapFrame,
  fixtureIssues,
  normalizePixelMapConfig,
  resolveFixtureMapping,
} from './fixtures';

export interface PixelMapStats {
  framesSent: number;
  packetsSent: number;
  framesDropped: number;
  droppedBusy: number;
  droppedRate: number;
  sendErrors: number;
  lastError: string | null;
  fps: number;
  universes: number;
  sending: boolean;
  /** Ticks skipped in the renderer because the previous frame was still in flight. */
  skippedInFlight: number;
}

export const pixelMapStats = writable<PixelMapStats | null>(null);
/** Lighting blackout. Session-only on purpose: a saved blackout would
 *  reopen a show dark with nothing on screen saying why. */
export const pixelMapBlackout = writable(false);

interface FixtureState {
  signature: string;
  points: WLEDNormalizedPoint[];
  sampleRadius: number;
  source: Uint8Array;
  rgb: Uint8Array;
  previous: Uint8Array;
}

const MIRROR_MAX_DIM = 384;
const STATS_INTERVAL_MS = 250;

let running = false;
let rawConfig: PixelMapConfig | undefined;
let config: PixelMapConfig | null = null;
let lightingBlackout = false;
let outputBlackout = false;
let timer: ReturnType<typeof setInterval> | null = null;
let timerFps = 0;
let mirror: CompositeMirrorHandle | null = null;
let mirrorFps = 0;
let mirrorFresh = false;
let tapCanvas: HTMLCanvasElement | null = null;
let tapContext: CanvasRenderingContext2D | null = null;
let latestFrame: ImageData | null = null;
let inFlight = false;
let sending = false;
let skippedInFlight = 0;
let lastStatsAt = 0;
let lastErrorLogAt = 0;
let unsubscribers: Array<() => void> = [];
const fixtureStates = new Map<string, FixtureState>();

function readyFixtures(): PixelMapFixture[] {
  return (config?.fixtures ?? []).filter(fixture => fixture.enabled && fixtureIssues(fixture).length === 0);
}

function outputWanted(): boolean {
  return running && !!config?.enabled && !lightingBlackout && !outputBlackout && readyFixtures().length > 0;
}

function contentWanted(): boolean {
  return outputWanted() && readyFixtures().some(fixture => (fixture.testPattern ?? 'off') === 'off');
}

function publishStats(result: Partial<PixelMapStats> | undefined, force = false) {
  const now = performance.now();
  if (!force && now - lastStatsAt < STATS_INTERVAL_MS) return;
  lastStatsAt = now;
  pixelMapStats.set({
    framesSent: result?.framesSent ?? 0,
    packetsSent: result?.packetsSent ?? 0,
    framesDropped: result?.framesDropped ?? 0,
    droppedBusy: result?.droppedBusy ?? 0,
    droppedRate: result?.droppedRate ?? 0,
    sendErrors: result?.sendErrors ?? 0,
    lastError: result?.lastError ?? null,
    fps: result?.fps ?? 0,
    universes: result?.universes ?? 0,
    sending: result?.sending ?? false,
    skippedInFlight,
  });
}

function stopSending() {
  if (!sending) return;
  sending = false;
  invoke('pixelmap_stop', {})
    .then((result: { stats?: Partial<PixelMapStats> } | undefined) => publishStats(result?.stats, true))
    .catch(() => { /* main process gone; nothing left to stop */ });
}

function releaseMirror() {
  mirror?.release();
  mirror = null;
  mirrorFps = 0;
  mirrorFresh = false;
  latestFrame = null;
}

/** Start, re-time or stop the timer and the snapshot mirror to match the config. */
function reconcile() {
  const wanted = outputWanted();
  const fps = config?.fps ?? 40;
  if (wanted && (!timer || timerFps !== fps)) {
    if (timer) clearInterval(timer);
    timerFps = fps;
    timer = setInterval(tick, Math.round(1000 / fps));
  } else if (!wanted && timer) {
    clearInterval(timer);
    timer = null;
    timerFps = 0;
  }
  if (!wanted) stopSending();

  if (contentWanted()) {
    if (!mirror || mirrorFps !== fps) {
      releaseMirror();
      mirrorFps = fps;
      mirror = acquireNativeCompositeMirror({
        maxDim: MIRROR_MAX_DIM,
        fps,
        onFrame: () => { mirrorFresh = true; },
      });
    }
  } else if (mirror) {
    releaseMirror();
  }

  const live = new Set((config?.fixtures ?? []).map(fixture => fixture.id));
  for (const id of fixtureStates.keys()) if (!live.has(id)) fixtureStates.delete(id);
}

function captureMirror(): ImageData | null {
  if (!mirror) return null;
  if (!mirrorFresh) return latestFrame;
  const source = mirror.canvas;
  if (!tapCanvas) {
    tapCanvas = document.createElement('canvas');
    tapContext = tapCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!tapCanvas || !tapContext || source.width < 1 || source.height < 1) return latestFrame;
  if (tapCanvas.width !== source.width) tapCanvas.width = source.width;
  if (tapCanvas.height !== source.height) tapCanvas.height = source.height;
  tapContext.drawImage(source, 0, 0);
  latestFrame = tapContext.getImageData(0, 0, tapCanvas.width, tapCanvas.height);
  mirrorFresh = false;
  return latestFrame;
}

function ensureFixtureState(fixture: PixelMapFixture, aspect: number): FixtureState {
  const signature = JSON.stringify([fixture.type, fixture.pixelCount, fixture.mapping, aspect.toFixed(4)]);
  let state = fixtureStates.get(fixture.id);
  if (state && state.signature === signature) return state;
  const mapping = resolveFixtureMapping(fixture, aspect);
  const length = mapping.points.length * 3;
  const sameLength = state?.rgb.length === length;
  state = {
    signature,
    points: mapping.points,
    sampleRadius: mapping.sampleRadius,
    source: sameLength ? state!.source : new Uint8Array(length),
    rgb: sameLength ? state!.rgb : new Uint8Array(length),
    previous: sameLength ? state!.previous : new Uint8Array(length),
  };
  fixtureStates.set(fixture.id, state);
  return state;
}

/** Latest pixels sent for a fixture (RGB, physical order), for previews. */
export function getPixelMapFixturePixels(fixtureId: string): Uint8Array | undefined {
  return sending ? fixtureStates.get(fixtureId)?.rgb : undefined;
}

function tick() {
  if (!outputWanted() || !config) return;
  if (inFlight) {
    skippedInFlight += 1;
    return;
  }
  const now = performance.now();
  const frame = contentWanted() ? captureMirror() : null;
  const aspect = frame && frame.height > 0 ? frame.width / frame.height : 16 / 9;
  const pixels = new Map<string, Uint8Array>();
  for (const fixture of readyFixtures()) {
    const state = ensureFixtureState(fixture, aspect);
    const options = { brightness: fixture.brightness, gamma: fixture.gamma, calibration: fixture.calibration };
    const pattern = fixture.testPattern ?? 'off';
    if (pattern !== 'off') {
      fillWLEDTestPattern(pattern, fixture.testColor, now, state.rgb, options, state.previous);
    } else if (frame) {
      sampleWLEDSourcePixels(frame.data, frame.width, frame.height, state.points, state.sampleRadius, state.source, fixture.samplingMode ?? 'average');
      calibrateWLEDPixels(state.source, state.rgb, options, state.previous);
    } else {
      state.rgb.fill(0);
    }
    state.previous.set(state.rgb);
    pixels.set(fixture.id, state.rgb);
  }

  const packed = buildPixelMapFrame(config, pixels);
  inFlight = true;
  sending = true;
  invoke('pixelmap_send_frame', packed)
    .then((result: { ok?: boolean; error?: string; stats?: Partial<PixelMapStats> } | undefined) => {
      inFlight = false;
      publishStats(result?.stats);
      if (result && result.ok === false && now - lastErrorLogAt > 5000) {
        lastErrorLogAt = now;
        console.warn('[PixelMap] send failed:', result.error);
      }
    })
    .catch(() => { inFlight = false; });
}

let holders = 0;

/** Run pixel-mapping output from the native composite. Returns teardown.
 *  Ref-counted: output keeps running until every caller has torn down. */
export function startPixelMapOutput(): () => void {
  holders += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0) shutdown();
  };
  if (running) return release;
  running = true;
  unsubscribers = [
    project.subscribe(current => {
      if (current.pixelMap === rawConfig) return;
      rawConfig = current.pixelMap;
      config = rawConfig ? normalizePixelMapConfig(rawConfig) : null;
      reconcile();
    }),
    settings.subscribe(current => {
      const next = current.output?.blackout === true;
      if (next === outputBlackout) return;
      outputBlackout = next;
      reconcile();
    }),
    pixelMapBlackout.subscribe(value => {
      if (value === lightingBlackout) return;
      lightingBlackout = value;
      reconcile();
    }),
  ];
  return release;
}

function shutdown() {
  if (!running) return;
  running = false;
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
  reconcile();
  releaseMirror();
  fixtureStates.clear();
  rawConfig = undefined;
  config = null;
  inFlight = false;
  tapCanvas = null;
  tapContext = null;
}
