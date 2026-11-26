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
 * - When the render core can, it does all of this itself: the plan
 *   (corePlan.ts) goes to the main process on every change and the core
 *   samples its own program output, packs and sends on its own clock, so
 *   the timer and the mirror here stop. Fixtures an LED FX reaches, an old
 *   core, GA_CORE_PIXELMAP=0 or any failure keep or put output back on this
 *   path; the main process hands the sequence numbers over both ways.
 * - LED FX (project.wledEffects) run on fixtures exactly as on WLED
 *   controllers: a fixture is a valid effect target and LED group member,
 *   and beat-synced effects follow the manual or detected BPM. Effects run
 *   over black until the first composite frame arrives.
 */
import { writable } from 'svelte/store';
import { project } from '../stores/layers';
import { settings } from '../stores/settings';
import { audioStore } from '../stores/audio';
import { invoke } from '../bridge';
import type {
  PixelMapConfig,
  PixelMapFixture,
  WLEDEffect,
  WLEDEffectAutomation,
  WLEDGroup,
  WLEDNormalizedPoint,
} from '../types';
import { acquireNativeCompositeMirror, compositeMirrorPixels, type CompositeMirrorHandle } from '../sync/nativeCompositeMirror';
import { calibrateWLEDPixels, fillWLEDTestPattern, sampleWLEDSourcePixels } from '../wled/mapping';
import { applyWLEDEffects, fixtureLEDTarget, ledEffectBpm } from '../wled/effects';
import {
  buildPixelMapFrame,
  fixtureIssues,
  normalizePixelMapConfig,
  resolveFixtureMapping,
} from './fixtures';
import { buildCorePixelMapPlan, corePixelMapEligible } from './corePlan';

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
  /** The render core samples and sends (else this page and the main process). */
  core?: boolean;
}

export const pixelMapStats = writable<PixelMapStats | null>(null);
/** Lighting blackout. Session-only on purpose: a saved blackout would
 *  reopen a show dark with nothing on screen saying why. */
export const pixelMapBlackout = writable(false);

interface FixtureState {
  // What the points were built from. Project edits replace objects rather
  // than change them, so comparing references is enough and costs nothing
  // per tick (a custom map can hold thousands of points).
  type: PixelMapFixture['type'];
  pixelCount: number;
  mappingRef: unknown;
  aspectKey: number;
  points: WLEDNormalizedPoint[];
  sampleRadius: number;
  source: Uint8Array;
  effect: Uint8Array;
  rgb: Uint8Array;
  previous: Uint8Array;
}

const MIRROR_MAX_DIM = 384;
const STATS_INTERVAL_MS = 250;

let running = false;
let rawConfig: PixelMapConfig | undefined;
let config: PixelMapConfig | null = null;
let lightingBlackout = false;
let ledGroups: WLEDGroup[] = [];
let ledEffects: WLEDEffect[] = [];
let ledAutomation: WLEDEffectAutomation | undefined;
let ledBpm = 120;
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
// Render core output: the plan it is sending from (JSON), the plan it
// refused (not asked again until the plan changes), and the stats poll.
let coreActive = false;
let corePlanJson: string | null = null;
let coreRefusedJson: string | null = null;
let coreInFlight = false;
let coreDirty = false;
let coreEligible = false;
let corePoll: ReturnType<typeof setInterval> | null = null;
let corePollInFlight = false;
let previewFixtureId: string | null = null;
// The picture's aspect as last seen here (custom maps fall back to a grid
// that follows it); kept while the core sends and no mirror runs.
let knownAspect = 16 / 9;
let corePreview: { id: string; rgb: Uint8Array } | null = null;
const CORE_POLL_MS = 250;
// Each fixture's mapping object as stored in the project. Normalizing makes
// new objects on every edit; these stay the same for untouched fixtures.
let rawMappings = new Map<string, unknown>();

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
    core: coreActive,
  });
}

function stopSending() {
  stopCorePoll();
  coreActive = false;
  corePlanJson = null;
  corePreview = null;
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
  if (wanted) requestCore();
  const local = wanted && !coreActive;
  const fps = config?.fps ?? 40;
  if (local && (!timer || timerFps !== fps)) {
    if (timer) clearInterval(timer);
    timerFps = fps;
    timer = setInterval(tick, Math.round(1000 / fps));
  } else if (!local && timer) {
    clearInterval(timer);
    timer = null;
    timerFps = 0;
  }
  if (!wanted) stopSending();

  if (local && contentWanted()) {
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
  // The mirror's last frame as pixels, when it came raw: no GPU readback.
  const pixels = compositeMirrorPixels();
  if (pixels && pixels.width === source.width && pixels.height === source.height) {
    latestFrame = pixels;
    mirrorFresh = false;
    return latestFrame;
  }
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
  const mappingRef = rawMappings.get(fixture.id) ?? fixture.mapping;
  const aspectKey = Math.round(aspect * 10000);
  let state = fixtureStates.get(fixture.id);
  if (
    state
    && state.mappingRef === mappingRef
    && state.type === fixture.type
    && state.pixelCount === fixture.pixelCount
    && state.aspectKey === aspectKey
  ) return state;
  const mapping = resolveFixtureMapping(fixture, aspect);
  const length = mapping.points.length * 3;
  const sameLength = state?.rgb.length === length;
  state = {
    type: fixture.type,
    pixelCount: fixture.pixelCount,
    mappingRef,
    aspectKey,
    points: mapping.points,
    sampleRadius: mapping.sampleRadius,
    source: sameLength ? state!.source : new Uint8Array(length),
    effect: sameLength ? state!.effect : new Uint8Array(length),
    rgb: sameLength ? state!.rgb : new Uint8Array(length),
    previous: sameLength ? state!.previous : new Uint8Array(length),
  };
  fixtureStates.set(fixture.id, state);
  return state;
}

/** Latest pixels sent for a fixture (RGB, physical order), for previews. */
export function getPixelMapFixturePixels(fixtureId: string): Uint8Array | undefined {
  if (coreActive) {
    previewFixtureId = fixtureId;
    return corePreview?.id === fixtureId ? corePreview.rgb : undefined;
  }
  return sending ? fixtureStates.get(fixtureId)?.rgb : undefined;
}

function corePlanWanted(): string | null {
  if (!config || !outputWanted() || !coreEligible) return null;
  if (latestFrame && latestFrame.height > 0) knownAspect = latestFrame.width / latestFrame.height;
  // The tick's own cache of resolved maps: a big custom map is not resolved twice.
  return JSON.stringify(buildCorePixelMapPlan(config, knownAspect, ensureFixtureState));
}

/** Hand output to the render core, or give it the changed plan. */
function requestCore() {
  if (coreInFlight) {
    coreDirty = true;
    return;
  }
  const json = corePlanWanted();
  if (!json) {
    if (coreActive) {
      // Back to this path (an LED FX now reaches a fixture): the main
      // process takes the output back at the first frame sent from here.
      coreActive = false;
      corePlanJson = null;
      stopCorePoll();
    }
    return;
  }
  if (json === corePlanJson || json === coreRefusedJson) return;
  coreInFlight = true;
  coreDirty = false;
  invoke('pixelmap_core_configure', JSON.parse(json))
    .then((result: { ok?: boolean; reason?: string } | undefined) => {
      coreInFlight = false;
      if (!outputWanted()) return;
      if (result?.ok === true) {
        coreActive = true;
        corePlanJson = json;
        coreRefusedJson = null;
        sending = true;
        startCorePoll();
      } else {
        if (coreActive) console.warn('[PixelMap] render core output stopped:', result?.reason);
        coreActive = false;
        corePlanJson = null;
        coreRefusedJson = json;
        stopCorePoll();
      }
      reconcile();
      if (coreDirty) requestCore();
    })
    .catch(() => {
      coreInFlight = false;
      coreActive = false;
      corePlanJson = null;
      coreRefusedJson = json;
      reconcile();
    });
}

function startCorePoll() {
  if (corePoll) return;
  corePoll = setInterval(() => {
    if (corePollInFlight || !coreActive) return;
    corePollInFlight = true;
    invoke('pixelmap_get_stats', previewFixtureId ? { fixtureId: previewFixtureId } : {})
      .then((result: (Partial<PixelMapStats> & { coreLost?: boolean; fixtureId?: string; fixturePixels?: number[] }) | undefined) => {
        corePollInFlight = false;
        if (!coreActive) return;
        if (result?.core !== true) {
          // The core stopped (or restarted without the plan): send from here.
          console.warn('[PixelMap] render core output lost; sending from the app');
          coreActive = false;
          coreRefusedJson = corePlanJson;
          corePlanJson = null;
          stopCorePoll();
          reconcile();
          return;
        }
        if (result.fixtureId && Array.isArray(result.fixturePixels)) {
          corePreview = { id: result.fixtureId, rgb: Uint8Array.from(result.fixturePixels) };
        }
        publishStats(result, true);
      })
      .catch(() => { corePollInFlight = false; });
  }, CORE_POLL_MS);
}

function stopCorePoll() {
  if (corePoll) clearInterval(corePoll);
  corePoll = null;
  corePollInFlight = false;
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
    } else {
      if (frame) {
        sampleWLEDSourcePixels(frame.data, frame.width, frame.height, state.points, state.sampleRadius, state.source, fixture.samplingMode ?? 'average');
      } else {
        state.source.fill(0);
      }
      applyWLEDEffects(
        state.source,
        state.effect,
        fixtureLEDTarget(fixture, state.points.length),
        ledGroups,
        ledEffects,
        ledAutomation,
        now,
        ledBpm,
      );
      calibrateWLEDPixels(state.effect, state.rgb, options, state.previous);
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
      ledGroups = current.wledGroups ?? [];
      ledEffects = current.wledEffects ?? [];
      ledAutomation = current.wledEffectAutomation;
      if (current.pixelMap === rawConfig) {
        // LED FX changes decide whether the core may send.
        const eligible = !!config && corePixelMapEligible(config, ledGroups, ledEffects, ledAutomation);
        if (eligible !== coreEligible) {
          coreEligible = eligible;
          reconcile();
        }
        return;
      }
      rawConfig = current.pixelMap;
      config = rawConfig ? normalizePixelMapConfig(rawConfig) : null;
      rawMappings = new Map();
      for (const fixture of rawConfig?.fixtures ?? []) {
        if (fixture?.id && fixture.mapping) rawMappings.set(fixture.id, fixture.mapping);
      }
      coreEligible = !!config && corePixelMapEligible(config, ledGroups, ledEffects, ledAutomation);
      reconcile();
    }),
    settings.subscribe(current => {
      const next = current.output?.blackout === true;
      if (next === outputBlackout) return;
      outputBlackout = next;
      reconcile();
    }),
    audioStore.subscribe(state => { ledBpm = ledEffectBpm(state); }),
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
  rawMappings = new Map();
  rawConfig = undefined;
  config = null;
  ledGroups = [];
  ledEffects = [];
  ledAutomation = undefined;
  inFlight = false;
  tapCanvas = null;
  tapContext = null;
  coreRefusedJson = null;
  coreEligible = false;
  previewFixtureId = null;
}
