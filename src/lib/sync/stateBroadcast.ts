/**
 * State Sync via BroadcastChannel — Main Window ↔ OSR Window
 *
 * The OSR (offscreen rendering) window needs the same Svelte store state
 * as the main window to render the same Three.js scene. BroadcastChannel
 * provides sub-millisecond IPC between same-origin renderer processes.
 *
 * Sender (main window): subscribes to project store, broadcasts changes
 * Receiver (OSR window): listens for changes, updates local stores
 */

import { get } from 'svelte/store';
import { project } from '$lib/stores/layers';
import { settings } from '$lib/stores/settings';
import { vjClipLauncher } from '$lib/stores/vjClipLauncher';
import { vjLayerSequencer } from '$lib/stores/vjLayerSequencer';
import { stage3dScene } from '$lib/stage3d/store';
import { DEFAULT_ATMOSPHERE, DEFAULT_LIGHTING } from '$lib/stage3d/types';
import { invoke, isDesktopApp } from '$lib/bridge';

const CHANNEL_NAME = 'ghostarcade-state-sync';

let channel: BroadcastChannel | null = null;
let mode: 'sender' | 'receiver' | null = null;
let unsubscribers: (() => void)[] = [];
let stage3dRelayFullPublishTimer: ReturnType<typeof setTimeout> | null = null;
let stage3dRelayLivePublishTimer: ReturnType<typeof setTimeout> | null = null;
let stage3dRelayScenePublishTimer: ReturnType<typeof setTimeout> | null = null;
let stage3dRelaySettingsPublishTimer: ReturnType<typeof setTimeout> | null = null;
let stage3dRelayPatchPublishTimer: ReturnType<typeof setTimeout> | null = null;
let stage3dRelayPollTimer: ReturnType<typeof setInterval> | null = null;
let stage3dRelayPollInFlight = false;
let lastStage3DRelayFullTick = -1;
let lastStage3DRelayLiveTick = -1;
let lastStage3DRelaySceneTick = -1;
let lastStage3DRelaySettingsTick = -1;
let lastStage3DRelayPatchTick = -1;
let stage3dRelayWarned = false;
// Whether the Stage 3D pop-out window is actually open. Sender-side
// gate for ALL relay publishes: serializing the project (full exports
// every 100ms in the worst case) is pure waste when no window is
// polling for it. Polled via stage3d_is_open; on the closed→open
// transition every stream is pushed fresh so a late-joining window
// never waits for the next change.
let stage3dRelayActive = false;
let stage3dRelayActivePollTimer: ReturnType<typeof setInterval> | null = null;

// Debounce timer for project updates (avoid flooding during rapid changes)
let projectDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 50; // Reduced frequency for full state (heavy serialization)

// ── Fast-path layer patch (corners, opacity, etc.) ──
// Tracks previous layer state so corner/opacity/mesh tweaks can go out as
// lightweight patches instead of re-serializing the entire project.
let lastLayerCorners: Record<string, any> = {};
let lastLayerOpacities: Record<string, number> = {};
let lastLayerMeshGrids: Record<string, any> = {};
let lastLayerSignatures: Record<string, string> = {};
let lastLayerIds = '';
let pendingLayerPatches = new Map<string, { id: string; corners?: any; opacity?: number; meshGrid?: any }>();
let patchThrottle: ReturnType<typeof setTimeout> | null = null;

function cloneSerializable<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function stripLayerSourceForSignature(source: any): any {
  if (!source) return source;
  const {
    texture: _texture,
    videoElement: _videoElement,
    isPlaying: _isPlaying,
    synthVisionCanvas: _synthVisionCanvas,
    threejsCanvas: _threejsCanvas,
    iframeElement: _iframeElement,
    ...rest
  } = source;
  return rest;
}

function layerPatchSignature(layer: any): string {
  const {
    corners: _corners,
    opacity: _opacity,
    meshGrid: _meshGrid,
    source,
    _seqOrigOpacity,
    ...rest
  } = layer;
  return JSON.stringify({ ...rest, source: stripLayerSourceForSignature(source) });
}

function resetLayerPatchSnapshot(projectState = get(project)) {
  const nextCorners: Record<string, any> = {};
  const nextOpacities: Record<string, number> = {};
  const nextMeshGrids: Record<string, any> = {};
  const nextSignatures: Record<string, string> = {};
  const ids: string[] = [];

  for (const layer of projectState.layers) {
    ids.push(layer.id);
    nextCorners[layer.id] = cloneSerializable(layer.corners);
    nextOpacities[layer.id] = layer.opacity;
    nextMeshGrids[layer.id] = cloneSerializable(layer.meshGrid);
    nextSignatures[layer.id] = layerPatchSignature(layer);
  }

  lastLayerIds = ids.join('|');
  lastLayerCorners = nextCorners;
  lastLayerOpacities = nextOpacities;
  lastLayerMeshGrids = nextMeshGrids;
  lastLayerSignatures = nextSignatures;
}

function flushLayerPatches() {
  if (!channel || mode !== 'sender' || pendingLayerPatches.size === 0) return;
  const patches = Array.from(pendingLayerPatches.values());
  pendingLayerPatches.clear();
  try {
    channel.postMessage({
      type: 'layer-patch',
      data: patches,
      timestamp: Date.now(),
    } satisfies StateMessage);
  } catch {}
}

type LayerPatch = { id: string; corners?: any; opacity?: number; meshGrid?: any };

/** Diff the current project against the last-sent snapshot and decide
 *  the cheapest sync that fully describes the change:
 *    'full'  — layer set or non-volatile fields changed → full export
 *    'patch' — only corners/opacity/meshGrid moved → tiny patches
 *    'none'  — nothing observable changed → publish nothing at all
 *  Patch detection also advances the snapshot for the patched fields. */
function diffProjectForSync():
  | { kind: 'none' | 'full' }
  | { kind: 'patch'; patches: LayerPatch[] } {
  const currentLayers = get(project).layers;
  const currentIds = currentLayers.map(layer => layer.id).join('|');
  if (!lastLayerIds || currentIds !== lastLayerIds) return { kind: 'full' };

  for (const layer of currentLayers) {
    if (lastLayerSignatures[layer.id] !== layerPatchSignature(layer)) return { kind: 'full' };
  }

  const patches: LayerPatch[] = [];
  for (const layer of currentLayers) {
    const prevCorners = lastLayerCorners[layer.id];
    const prevOpacity = lastLayerOpacities[layer.id];
    const prevMeshGrid = lastLayerMeshGrids[layer.id];
    const cornersChanged = !prevCorners || JSON.stringify(layer.corners) !== JSON.stringify(prevCorners);
    const opacityChanged = prevOpacity !== layer.opacity;
    const meshGridChanged = JSON.stringify(layer.meshGrid) !== JSON.stringify(prevMeshGrid);

    if (cornersChanged || opacityChanged || meshGridChanged) {
      const patch: LayerPatch = { id: layer.id };
      if (cornersChanged) patch.corners = layer.corners;
      if (meshGridChanged) patch.meshGrid = layer.meshGrid;
      if (opacityChanged) patch.opacity = layer.opacity;
      patches.push(patch);
      lastLayerCorners[layer.id] = cloneSerializable(layer.corners);
      lastLayerOpacities[layer.id] = layer.opacity;
      lastLayerMeshGrids[layer.id] = cloneSerializable(layer.meshGrid);
    }
  }
  return patches.length ? { kind: 'patch', patches } : { kind: 'none' };
}

/** Queue per-layer patches onto the BroadcastChannel (output windows). */
function queueBroadcastLayerPatches(patches: LayerPatch[]): void {
  if (!channel || mode !== 'sender' || !hasActiveReceiver) return;
  for (const patch of patches) {
    pendingLayerPatches.set(patch.id, { ...pendingLayerPatches.get(patch.id), ...patch });
  }
  if (!patchThrottle) {
    patchThrottle = setTimeout(() => {
      patchThrottle = null;
      flushLayerPatches();
    }, 16);
  }
}

/** Queue per-layer patches onto the Stage 3D IPC relay. Coalesced to
 *  ~30Hz; the main process merges batches per layer id so a window
 *  that polls slowly still converges on the latest values. */
let pendingRelayPatches = new Map<string, LayerPatch>();
function queueStage3DRelayPatches(patches: LayerPatch[]): void {
  if (!isDesktopApp || mode !== 'sender' || !stage3dRelayActive) return;
  for (const patch of patches) {
    pendingRelayPatches.set(patch.id, { ...pendingRelayPatches.get(patch.id), ...patch });
  }
  if (stage3dRelayPatchPublishTimer) return;
  stage3dRelayPatchPublishTimer = setTimeout(() => {
    stage3dRelayPatchPublishTimer = null;
    if (pendingRelayPatches.size === 0) return;
    const batch = Array.from(pendingRelayPatches.values());
    pendingRelayPatches.clear();
    publishStage3DRelay('patch', JSON.parse(JSON.stringify(batch)));
  }, 33);
}

function isStage3DWindow(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('mode') === 'stage-3d';
  } catch {
    return false;
  }
}

function isProjectionSimWindow(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('mode') === 'projection-sim';
  } catch {
    return false;
  }
}

function isExternalPreviewWindow(): boolean {
  return isStage3DWindow() || isProjectionSimWindow();
}

// ============================================================
// Message Types
// ============================================================

interface StateMessage {
  type: 'project-state' | 'vj-state' | 'stage3d-state' | 'settings-update' | 'osr-request-state' | 'layer-patch' | 'cursor-visibility' | 'cursor-position' | 'output-frozen';
  data?: any;
  timestamp: number;
}

// ============================================================
// Sender (Main Window)
// ============================================================

function sendFullState() {
  if (!channel || mode !== 'sender') return;

  try {
    const fullStatePayload = buildSyncedStatePayload();
    channel.postMessage({
      type: 'project-state',
      data: fullStatePayload,
      timestamp: Date.now(),
    } satisfies StateMessage);

    resetLayerPatchSnapshot();
    // Force the next vj-state broadcast to carry full grids — a receiver
    // that just connected mid-session may have missed earlier grid sends.
    lastSentVJStructure = null;
    publishStage3DRelayFullState();
    console.log('[StateSync] Full state sent to OSR');
  } catch (err) {
    console.error('[StateSync] Failed to send full state:', err);
  }
}

let hasActiveReceiver = false;

function buildSyncedStatePayload(): any {
  const projectData = project.exportProject() as any;
  const vjState = get(vjClipLauncher) as any;
  const settingsState = get(settings);
  const liveVJState = buildLiveVJStatePayload(vjState, true);

  const payload = {
    ...projectData,
    vjClipLauncher: liveVJState,
    vjLayerSequencer: buildVJLayerSequencerPayload(),
    stage3dScene: get(stage3dScene),
    settings: { output: settingsState?.output },
  };

  return JSON.parse(JSON.stringify(payload));
}

function buildVJLayerSequencerPayload(): any {
  const state = get(vjLayerSequencer) as any;
  return JSON.parse(JSON.stringify({
    isOpen: state.isOpen,
    minimized: state.minimized,
    isPlaying: state.isPlaying,
    currentStep: state.currentStep,
    stepCount: state.stepCount,
    bpm: state.bpm,
    syncToMaster: state.syncToMaster,
    masterBPM: state.masterBPM,
    subdivision: state.subdivision,
    crossfade: state.crossfade,
    crossfadeDuration: state.crossfadeDuration,
    randomDensity: state.randomDensity,
    presetMode: state.presetMode,
    bankBPresetMode: state.bankBPresetMode,
    cells: state.cells,
    bankBCells: state.bankBCells,
    opacityOverrides: state.opacityOverrides,
    bankBOpacityOverrides: state.bankBOpacityOverrides,
    transportTimeSec: (vjLayerSequencer as any).getTransportTimeSec?.() ?? 0,
  }));
}

function buildVJLayerSequencerSyncSignature(): string {
  const state = get(vjLayerSequencer) as any;
  return JSON.stringify({
    isOpen: state.isOpen,
    minimized: state.minimized,
    isPlaying: state.isPlaying,
    stepCount: state.stepCount,
    bpm: state.bpm,
    syncToMaster: state.syncToMaster,
    masterBPM: state.masterBPM,
    subdivision: state.subdivision,
    crossfade: state.crossfade,
    crossfadeDuration: state.crossfadeDuration,
    randomDensity: state.randomDensity,
    presetMode: state.presetMode,
    bankBPresetMode: state.bankBPresetMode,
    cells: state.cells,
    bankBCells: state.bankBCells,
  });
}

function buildLiveVJStatePayload(vjState = get(vjClipLauncher) as any, includeGrids = false): any {
  const safeBlocks = includeGrids
    ? (vjState.blocks || []).map((block: any) => ({
        id: block.id,
        name: block.name,
        clipGrid: stripClipGrid(block.clipGrid),
        bankBClipGrid: block.bankBClipGrid ? stripClipGrid(block.bankBClipGrid) : undefined,
      }))
    : undefined;
  const safeClipGrid = includeGrids ? stripClipGrid(vjState.clipGrid) : undefined;
  const safeBankBClipGrid = includeGrids && vjState.bankBClipGrid ? stripClipGrid(vjState.bankBClipGrid) : undefined;

  const payload = {
    numLayers: vjState.numLayers,
    numColumns: vjState.numColumns,
    ...(includeGrids ? { blocks: safeBlocks } : {}),
    activeBlockId: vjState.activeBlockId,
    ...(includeGrids ? { clipGrid: safeClipGrid } : {}),
    ...(includeGrids ? { bankBClipGrid: safeBankBClipGrid } : {}),
    layerStates: stripLayerStates(vjState.layerStates),
    bankBLayerStates: stripLayerStates(vjState.bankBLayerStates),
    selectedDeck: vjState.selectedDeck,
    selectedLayerIndex: vjState.selectedLayerIndex,
    compositionEffects: vjState.compositionEffects,
    masterOpacity: vjState.masterOpacity,
    isOpen: vjState.isOpen,
    isLive: vjState.isLive,
    stageMode: vjState.stageMode,
    mapMode: vjState.mapMode,
    stagePresetId: vjState.stagePresetId,
    stoppedAll: vjState.stoppedAll,
    crossfaderEnabled: vjState.crossfaderEnabled,
    crossfaderValue: vjState.crossfaderValue,
    crossfaderTransition: vjState.crossfaderTransition,
    crossfaderCurve: vjState.crossfaderCurve,
    crossfaderBlendMode: vjState.crossfaderBlendMode,
    crossfaderFadeDuration: vjState.crossfaderFadeDuration ?? 0,
    quantization: vjState.quantization,
    pendingTriggers: [],
    vjLayerSequencer: buildVJLayerSequencerPayload(),
  };

  return JSON.parse(JSON.stringify(payload));
}

function publishStage3DRelay(kind: 'full' | 'live' | 'scene' | 'settings' | 'patch', state: any) {
  if (!isDesktopApp || mode !== 'sender' || !stage3dRelayActive) return;
  try {
    void invoke('stage3d_publish_state', { kind, state }).catch((err) => {
      if (!stage3dRelayWarned) {
        stage3dRelayWarned = true;
        console.warn('[StateSync] Stage 3D IPC relay publish failed:', err);
      }
    });
  } catch (err) {
    if (!stage3dRelayWarned) {
      stage3dRelayWarned = true;
      console.warn('[StateSync] Stage 3D IPC relay publish failed:', err);
    }
  }
}

function publishStage3DRelayFullState() {
  if (!isDesktopApp || mode !== 'sender' || !stage3dRelayActive) return;
  publishStage3DRelay('full', buildSyncedStatePayload());
  // A full publish carries the latest corners/opacity, so the patch
  // diff baseline must advance with it or the next diff re-detects
  // already-sent changes.
  resetLayerPatchSnapshot();
  pendingRelayPatches.clear();
}

function publishStage3DRelayLiveState() {
  publishStage3DRelay('live', buildLiveVJStatePayload(undefined, false));
}

function publishStage3DRelaySceneState() {
  publishStage3DRelay('scene', JSON.parse(JSON.stringify(get(stage3dScene))));
}

function publishStage3DRelaySettingsState() {
  const settingsState = get(settings);
  publishStage3DRelay('settings', JSON.parse(JSON.stringify({ output: settingsState?.output })));
}

function scheduleStage3DRelayFullPublish(delay = 100) {
  if (!isDesktopApp || mode !== 'sender' || !stage3dRelayActive) return;
  if (stage3dRelayFullPublishTimer) return;
  stage3dRelayFullPublishTimer = setTimeout(() => {
    stage3dRelayFullPublishTimer = null;
    publishStage3DRelayFullState();
  }, delay);
}

function scheduleStage3DRelayLivePublish(delay = 33) {
  if (!isDesktopApp || mode !== 'sender' || !stage3dRelayActive) return;
  if (stage3dRelayLivePublishTimer) return;
  stage3dRelayLivePublishTimer = setTimeout(() => {
    stage3dRelayLivePublishTimer = null;
    publishStage3DRelayLiveState();
  }, delay);
}

function scheduleStage3DRelayScenePublish(delay = 50) {
  if (!isDesktopApp || mode !== 'sender' || !stage3dRelayActive) return;
  if (stage3dRelayScenePublishTimer) return;
  stage3dRelayScenePublishTimer = setTimeout(() => {
    stage3dRelayScenePublishTimer = null;
    publishStage3DRelaySceneState();
  }, delay);
}

function scheduleStage3DRelaySettingsPublish(delay = 100) {
  if (!isDesktopApp || mode !== 'sender' || !stage3dRelayActive) return;
  if (stage3dRelaySettingsPublishTimer) return;
  stage3dRelaySettingsPublishTimer = setTimeout(() => {
    stage3dRelaySettingsPublishTimer = null;
    publishStage3DRelaySettingsState();
  }, delay);
}

function broadcastProjectUpdate() {
  if (!channel || mode !== 'sender' || !hasActiveReceiver) return;

  // Debounce to avoid flooding during rapid store changes
  if (projectDebounceTimer) clearTimeout(projectDebounceTimer);
  projectDebounceTimer = setTimeout(() => {
    try {
      const projectData = buildSyncedStatePayload();
      channel!.postMessage({
        type: 'project-state',
        data: projectData,
        timestamp: Date.now(),
      } satisfies StateMessage);
      resetLayerPatchSnapshot();
      publishStage3DRelayFullState();
    } catch (err) {
      console.error('[StateSync] Failed to broadcast project:', err);
    }
  }, DEBOUNCE_MS);
}

let stage3dDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const STAGE3D_DEBOUNCE_MS = 33;

function broadcastStage3DState() {
  if (!channel || mode !== 'sender' || !hasActiveReceiver) return;
  if (stage3dDebounceTimer !== null) return;

  stage3dDebounceTimer = setTimeout(() => {
    stage3dDebounceTimer = null;
    if (!channel || mode !== 'sender' || !hasActiveReceiver) return;
    try {
      channel.postMessage({
        type: 'stage3d-state',
        data: JSON.parse(JSON.stringify(get(stage3dScene))),
        timestamp: Date.now(),
      } satisfies StateMessage);
      scheduleStage3DRelayScenePublish(0);
    } catch (err) {
      console.error('[StateSync] Failed to broadcast Stage 3D state:', err);
    }
  }, STAGE3D_DEBOUNCE_MS);
}

// Debounce VJ-state broadcasts. Modulation engines write to the clip launcher
// at audio-frame rate (up to 60 Hz) for any modulated shader param, and each
// write would otherwise trigger a full clip-grid deep-map + structured-clone
// postMessage to the OSR window. Debouncing to ~33ms coalesces modulation
// bursts into a single broadcast while still giving the output window a
// perceptually-live feel (30 fps state sync).
let vjDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const VJ_DEBOUNCE_MS = 33;

// Remove the non-cloneable runtime fields that VJ clips carry (OffscreenCanvas
// for SynthVision, HTMLVideoElement for video clips, HTMLIFrameElement for
// threejs clips). BroadcastChannel.postMessage uses structured clone which
// throws DataCloneError on any of these — if that throw happens inside the
// Svelte store subscription path, the subscribe callback rethrows on every
// store update and the console fills with "[StateSync] Failed to broadcast
// VJ state: [object DOMException]", which is what the fps meltdown showed.
function stripClip(clip: any): any {
  if (!clip) return clip;
  const {
    synthVisionCanvas: _s,
    videoElement: _v,
    iframeElement: _i,
    threejsCanvas: _t,
    ...rest
  } = clip;
  return rest;
}

function stripClipGrid(grid: any[][]): any[][] {
  if (!Array.isArray(grid)) return [];
  return grid.map(row => Array.isArray(row) ? row.map(stripClip) : []);
}

// layerStates[i].activeClip points to the same VJClip object that lives in
// the grid, so it has the same uncloneable runtime fields. Strip activeClip
// the same way stripClip does for grid cells. Without this, every broadcast
// that carries layerStates rethrows DataCloneError ("HTMLVideoElement object
// could not be cloned") — fills the console and signals to anyone watching
// that the sync pipeline is broken even though video texture creation in
// the editor itself is fine.
function stripLayerStates(layerStates: any[] | undefined): any[] | undefined {
  if (!layerStates) return layerStates;
  return layerStates.map(ls => ({
    ...ls,
    activeClip: stripClip(ls?.activeClip),
  }));
}

// Identity snapshot of the last grids/blocks sent. Grid arrays only get
// a new identity on structural ops (trigger/set/remove clip, bank or
// block changes) — per-tick value churn (faders, modulated shader
// params) reuses the same arrays — so an O(1) identity compare decides
// whether this broadcast needs to carry the full grids or just the slim
// live state. Serializing all grids on every tick (the old behavior)
// cost a full stripClipGrid + JSON round-trip of every clip at 30Hz
// whenever an output window was open.
let lastSentVJStructure: {
  blocks: any;
  clipGrid: any;
  bankBClipGrid: any;
  activeBlockId: any;
  numLayers: number;
  numColumns: number;
} | null = null;

function doBroadcastVJState() {
  if (!channel || mode !== 'sender' || !hasActiveReceiver) return;

  try {
    const vjState = get(vjClipLauncher) as any;

    const structuralChanged = !lastSentVJStructure
      || lastSentVJStructure.blocks !== vjState.blocks
      || lastSentVJStructure.clipGrid !== vjState.clipGrid
      || lastSentVJStructure.bankBClipGrid !== vjState.bankBClipGrid
      || lastSentVJStructure.activeBlockId !== vjState.activeBlockId
      || lastSentVJStructure.numLayers !== vjState.numLayers
      || lastSentVJStructure.numColumns !== vjState.numColumns;

    // buildLiveVJStatePayload strips uncloneable runtime refs (video/
    // iframe/canvas elements) and JSON-cleans; with includeGrids=true it
    // also carries blocks + clip grids. Receivers merge shallowly, so a
    // slim payload leaves their existing grids untouched.
    const vjPayload = buildLiveVJStatePayload(vjState, structuralChanged);
    channel.postMessage({
      type: 'vj-state',
      data: vjPayload,
      timestamp: Date.now(),
    } satisfies StateMessage);
    if (structuralChanged) {
      lastSentVJStructure = {
        blocks: vjState.blocks,
        clipGrid: vjState.clipGrid,
        bankBClipGrid: vjState.bankBClipGrid,
        activeBlockId: vjState.activeBlockId,
        numLayers: vjState.numLayers,
        numColumns: vjState.numColumns,
      };
    }
    scheduleStage3DRelayLivePublish(0);
  } catch (err) {
    console.error('[StateSync] Failed to broadcast VJ state:', err);
  }
}

function broadcastVJState() {
  if (!channel || mode !== 'sender' || !hasActiveReceiver) return;
  if (vjDebounceTimer !== null) return; // already scheduled
  vjDebounceTimer = setTimeout(() => {
    vjDebounceTimer = null;
    doBroadcastVJState();
  }, VJ_DEBOUNCE_MS);
}

function initSender() {
  if (!channel) return;

  // Listen for state requests from OSR window
  channel.onmessage = (event: MessageEvent<StateMessage>) => {
    if (event.data?.type === 'osr-request-state') {
      console.log('[StateSync] OSR requested full state — activating broadcast');
      hasActiveReceiver = true;
      sendFullState();
    }
  };

  // Subscribe to project store changes. Diff-routed: a structural
  // change (layer add/remove/reorder, source/effect edits) triggers the
  // debounced full export; corner/opacity/meshGrid moves go out as tiny
  // patches; a no-op store tick publishes NOTHING. Skip the diff
  // entirely when nobody is listening — that's the common case during
  // a live set with no output/Stage-3D window, and layerPatchSignature
  // JSON-stringifies every layer.
  const unsubProject = project.subscribe(() => {
    if (!hasActiveReceiver && !stage3dRelayActive) return;
    const diff = diffProjectForSync();
    if (diff.kind === 'full') {
      scheduleStage3DRelayFullPublish();
      broadcastProjectUpdate();
    } else if (diff.kind === 'patch') {
      queueStage3DRelayPatches(diff.patches);
      queueBroadcastLayerPatches(diff.patches);
    }
  });
  unsubscribers.push(unsubProject);

  // Subscribe to VJ clip launcher changes
  const unsubVJ = vjClipLauncher.subscribe(() => {
    scheduleStage3DRelayLivePublish();
    broadcastVJState();
  });
  unsubscribers.push(unsubVJ);

  let lastVJSequencerSignature = '';
  const unsubVJSequencer = vjLayerSequencer.subscribe(() => {
    const nextSignature = buildVJLayerSequencerSyncSignature();
    if (nextSignature === lastVJSequencerSignature) return;
    lastVJSequencerSignature = nextSignature;
    scheduleStage3DRelayLivePublish();
    broadcastVJState();
  });
  unsubscribers.push(unsubVJSequencer);

  const unsubStage3D = stage3dScene.subscribe(() => {
    scheduleStage3DRelayScenePublish();
    broadcastStage3DState();
  });
  unsubscribers.push(unsubStage3D);

  // Subscribe to settings.output changes so final-pass output transforms
  // (rotation, crop, brightness, contrast, gamma, cursor visibility) stay
  // in sync between editor + output window without requiring the user to
  // reopen the output window after every tweak. Diffed against the last
  // sent snapshot so non-output settings (e.g. UI prefs) don't trigger a
  // broadcast.
  let lastOutputJson = '';
  const unsubSettings = settings.subscribe(s => {
    scheduleStage3DRelaySettingsPublish();
    if (!hasActiveReceiver) return;
    const outJson = JSON.stringify(s.output);
    if (outJson === lastOutputJson) return;
    lastOutputJson = outJson;
    if (settingsBroadcastTimer) clearTimeout(settingsBroadcastTimer);
    settingsBroadcastTimer = setTimeout(() => {
      if (!channel || mode !== 'sender') return;
      try {
        channel.postMessage({
          type: 'settings-update',
          // Post a JSON-cleaned snapshot, not the live object: output can
          // carry non-structuredClone-able values (functions / proxies on
          // nested slice + effect data) that throw DataCloneError on
          // postMessage. `outJson` is already computed above, so free.
          data: { output: JSON.parse(outJson) },
          timestamp: Date.now(),
        } satisfies StateMessage);
      } catch (err) {
        console.error('[StateSync] Failed to broadcast settings:', err);
      }
    }, 16); // 1-frame coalesce — slider drags collapse to ~60 messages/sec
  });
  unsubscribers.push(unsubSettings);

  startStage3DRelayActivePolling();
  console.log('[StateSync] Sender initialized');
}

/** Sender-side: track whether the Stage 3D window is open so relay
 *  publishes (and their serialization cost) only happen while it is.
 *  On closed→open, push every stream fresh so the window paints
 *  immediately instead of waiting for the next state change. */
function startStage3DRelayActivePolling() {
  if (!isDesktopApp || mode !== 'sender' || stage3dRelayActivePollTimer) return;
  const check = async () => {
    let open = false;
    try {
      open = !!(await invoke<boolean>('stage3d_is_open'));
    } catch {
      open = false;
    }
    if (!open) {
      try {
        open = !!(await invoke<boolean>('projection_sim_is_open'));
      } catch {
        open = false;
      }
    }

    if (open && !stage3dRelayActive) {
      stage3dRelayActive = true;
      publishStage3DRelayFullState();
      publishStage3DRelayLiveState();
      publishStage3DRelaySceneState();
      publishStage3DRelaySettingsState();
    } else if (!open) {
      stage3dRelayActive = false;
    }
  };
  void check();
  stage3dRelayActivePollTimer = setInterval(() => { void check(); }, 1000);
}

let settingsBroadcastTimer: ReturnType<typeof setTimeout> | null = null;

// ============================================================
// Receiver (OSR Window)
// ============================================================

let receivedFirstState = false;

function applyProjectStatePayload(data: any, sourceLabel: string) {
  if (!data) return;
  try {
    // The relay payload is always shaped as exportProject() output:
    // { project: {...}, mediaLibrary: [...], vjClipLauncher: ..., ... }.
    // Some upstream paths (notably an older Stage 3D relay shape, and
    // certain partial-state publishes) instead send the inner project
    // object directly at the top level. Detect that case and re-wrap so
    // importProject sees its expected shape — without this, the import
    // logs "Invalid project data: missing project object" and the
    // receiver's layers/screens dropdown stays empty.
    let importPayload = data;
    if (!data.project && (Array.isArray(data.layers) || typeof data.name === 'string' || typeof data.width === 'number')) {
      importPayload = {
        version: data.version ?? '1.9.3',
        project: data,
        mediaLibrary: data.mediaLibrary ?? [],
        vjClipLauncher: data.vjClipLauncher,
        modulation: data.modulation,
      };
    }
    const importedOk = project.importProject(importPayload);
    if (!importedOk) {
      // Last-resort visibility: log what we actually received so a future
      // debug session doesn't have to add console.logs to find it. Keys
      // only — full payload is large enough to spam the console.
      console.warn(`[StateSync] importProject rejected (${sourceLabel}); payload keys:`, data ? Object.keys(data) : 'null');
    }
    // importProject is intentionally conservative for file loads: it
    // forces VJ live/stage/map mode off. State-sync receivers are not
    // file loads, though; output and Stage 3D windows must mirror the
    // sender's live deck state. Merge the live payload back after the
    // structural import so active clips keep driving synced renderers.
    if (data.vjClipLauncher) {
      const { vjLayerSequencer: sequencerPayload, ...clipPayload } = data.vjClipLauncher;
      vjClipLauncher.update((state: any) => ({ ...state, ...clipPayload }));
      if (sequencerPayload) vjLayerSequencer.hydrate(sequencerPayload);
    }
    if (data.vjLayerSequencer) {
      vjLayerSequencer.hydrate(data.vjLayerSequencer);
    }
    if (data.stage3dScene?.schemaVersion === 1 && Array.isArray(data.stage3dScene.nodes)) {
      // Merge in a way that preserves the LOCAL window's stage3D editing
      // surface — lighting overrides, scenery transforms, screen
      // overrides, and user-placed elements all belong to whoever is
      // looking at the 3D viewport (usually the popout that's on the
      // external monitor for the show). Without this, every clip
      // change in the editor triggers a full state publish, which used
      // to clobber the popout's lighting back to defaults.
      mergeStage3DScenePreservingLocal(data.stage3dScene);
    }
    // Pull settings.output through too. Output transforms (rotation,
    // crop, color correction, cursor visibility) live in settings.output
    // and are applied by the output renderer, so receivers need the
    // latest values to actually show changes the user makes mid-session.
    if (data.settings?.output) {
      settings.update(s => ({ ...s, output: { ...s.output, ...data.settings.output } }));
    }
    if (!receivedFirstState) {
      receivedFirstState = true;
      console.log(`[StateSync] First project state received (${sourceLabel})`);
    }
  } catch (err) {
    console.error(`[StateSync] Failed to import project state (${sourceLabel}):`, err);
  }
}

function applyLiveVJStatePayload(data: any, sourceLabel: string) {
  if (!data) return;
  try {
    const { vjLayerSequencer: sequencerPayload, ...clipPayload } = data;
    vjClipLauncher.update((state: any) => ({ ...state, ...clipPayload }));
    if (sequencerPayload) vjLayerSequencer.hydrate(sequencerPayload);
  } catch (err) {
    console.error(`[StateSync] Failed to import live VJ state (${sourceLabel}):`, err);
  }
}

function applyStage3DScenePayload(data: any, sourceLabel: string) {
  if (!data?.schemaVersion || data.schemaVersion !== 1 || !Array.isArray(data.nodes)) return;
  try {
    mergeStage3DScenePreservingLocal(data);
  } catch (err) {
    console.error(`[StateSync] Failed to import Stage 3D state (${sourceLabel}):`, err);
  }
}

/** Merge an incoming stage3D scene payload while keeping the local
 *  viewport's editing surface intact. A fresh Stage 3D popout starts
 *  with the built-in fallback scene and should accept the sender's scene.
 *  Once the local viewport has real venue/shapes/lighting edits, those
 *  local scene fields survive clip-change broadcasts from the editor. */
function isEmptyRecord(value: any): boolean {
  return !value || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}

function sameSerializable(a: any, b: any): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function withDefaults<T extends Record<string, any>>(defaults: T, value: any): T {
  return { ...defaults, ...(value ?? {}) } as T;
}

function isPristineFallbackStage3DScene(scene: any): boolean {
  if (!scene?.schemaVersion || scene.schemaVersion !== 1 || !Array.isArray(scene.nodes)) return false;
  const venue = scene.venue ?? 'festival';
  const basePreset = scene.basePreset ?? 'festival';
  return venue === 'festival'
    && basePreset === 'festival'
    && scene.nodes.length === 0
    && (!Array.isArray(scene.userElements) || scene.userElements.length === 0)
    && isEmptyRecord(scene.screenOverrides)
    && isEmptyRecord(scene.sceneryOverrides)
    && !scene.platform
    && sameSerializable(scene.camera, { position: [12, 6, 14], target: [0, 2, 0], fov: 50 })
    && sameSerializable(scene.environment, {
      background: '#06060a',
      ambient: 0.4,
      showGround: true,
      groundColor: '#15151b',
    })
    && sameSerializable(withDefaults(DEFAULT_LIGHTING, scene.lighting), DEFAULT_LIGHTING)
    && sameSerializable(withDefaults(DEFAULT_ATMOSPHERE, scene.atmosphere), DEFAULT_ATMOSPHERE);
}

function mergeStage3DScenePreservingLocal(incoming: any): void {
  const current: any = get(stage3dScene);
  if (isPristineFallbackStage3DScene(current)) {
    stage3dScene.loadScene(incoming);
    return;
  }
  const merged: any = {
    ...incoming,
    // Local-owned: keep ours over incoming. `??` so an undefined local
    // (e.g. legacy project shape) still inherits whatever the sender had.
    id:                current.id                ?? incoming.id,
    name:              current.name              ?? incoming.name,
    environment:       current.environment       ?? incoming.environment,
    platform:          current.platform          ?? incoming.platform,
    camera:            current.camera            ?? incoming.camera,
    nodes:             current.nodes             ?? incoming.nodes,
    lightingCueId:     current.lightingCueId     ?? incoming.lightingCueId,
    basePreset:        current.basePreset        ?? incoming.basePreset,
    venue:             current.venue             ?? incoming.venue,
    lighting:          current.lighting          ?? incoming.lighting,
    atmosphere:        current.atmosphere        ?? incoming.atmosphere,
    sceneryOverrides:  current.sceneryOverrides  ?? incoming.sceneryOverrides,
    screenOverrides:   current.screenOverrides   ?? incoming.screenOverrides,
    userElements:      current.userElements      ?? incoming.userElements,
    meta:              current.meta              ?? incoming.meta,
  };
  stage3dScene.loadScene(merged);
}

/** Apply lightweight corner/opacity/meshGrid patches in place — no
 *  full import, no texture teardown. Shared by the BroadcastChannel
 *  'layer-patch' message and the IPC relay 'patch' stream. */
function applyLayerPatchesPayload(patches: any[]): void {
  if (!Array.isArray(patches) || patches.length === 0) return;
  try {
    project.update((p: any) => {
      const layers = [...p.layers];
      for (const patch of patches) {
        const idx = layers.findIndex((l: any) => l.id === patch.id);
        if (idx < 0) continue;
        const l = { ...layers[idx] };
        if (patch.corners) l.corners = patch.corners;
        if (patch.meshGrid) l.meshGrid = patch.meshGrid;
        if (patch.opacity !== undefined) l.opacity = patch.opacity;
        layers[idx] = l;
      }
      return { ...p, layers };
    });
  } catch {}
}

function applySettingsPayload(data: any, sourceLabel: string) {
  if (!data?.output) return;
  try {
    settings.update(s => ({ ...s, output: { ...s.output, ...data.output } }));
  } catch (err) {
    console.error(`[StateSync] Failed to import settings (${sourceLabel}):`, err);
  }
}

function handleReceivedMessage(event: MessageEvent<StateMessage>) {
  const msg = event.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'project-state': {
      applyProjectStatePayload(msg.data, 'BroadcastChannel');
      break;
    }

    case 'stage3d-state': {
      applyStage3DScenePayload(msg.data, 'BroadcastChannel');
      break;
    }

    case 'output-frozen': {
      if (msg.data) {
        // Import and update the outputFrozen store on the output window
        import('$lib/stores/settings').then(({ outputFrozen }) => {
          outputFrozen.set(!!msg.data.frozen);
        }).catch(() => {});
      }
      break;
    }

    case 'cursor-visibility': {
      if (msg.data) {
        outputCursorVisible = msg.data.show;
        document.body.style.cursor = msg.data.show ? 'default' : 'none';
        // Update or create cursor overlay
        updateCursorOverlay();
      }
      break;
    }

    case 'cursor-position': {
      if (msg.data) {
        outputCursorX = msg.data.x;
        outputCursorY = msg.data.y;
      } else {
        outputCursorX = null;
        outputCursorY = null;
      }
      updateCursorOverlay();
      break;
    }

    case 'layer-patch': {
      // Lightweight corner/opacity patch — apply directly without full import
      applyLayerPatchesPayload(msg.data);
      break;
    }

    case 'vj-state': {
      if (msg.data) {
        try {
          // Merge incoming VJ state payload into current state shape.
          const { vjLayerSequencer: sequencerPayload, ...clipPayload } = msg.data;
          vjClipLauncher.update((state: any) => ({ ...state, ...clipPayload }));
          if (sequencerPayload) vjLayerSequencer.hydrate(sequencerPayload);
        } catch (err) {
          console.error('[StateSync] Failed to import VJ state:', err);
        }
      }
      break;
    }

    case 'settings-update': {
      if (msg.data) {
        try {
          if (typeof msg.data?.output?.spoutEnabled === 'boolean') {
            settings.setSpoutEnabled(!!msg.data.output.spoutEnabled);
          }
          if (typeof msg.data?.output?.spoutName === 'string') {
            settings.setSpoutName(msg.data.output.spoutName);
          }
          if (
            msg.data?.output?.spoutResolution === 'match'
            || msg.data?.output?.spoutResolution === '1080p'
            || msg.data?.output?.spoutResolution === '4K'
          ) {
            settings.setSpoutResolution(msg.data.output.spoutResolution);
          }
          if (typeof msg.data?.output?.outputWindowOpen === 'boolean') {
            settings.setOutputWindowOpen(!!msg.data.output.outputWindowOpen);
          }
          // Bulk-merge the rest of output (rotation/crop/color/cursor) so
          // CSS-applied transforms on the output canvas update live as the
          // performer adjusts them in the editor.
          if (msg.data?.output) {
            settings.update(s => ({ ...s, output: { ...s.output, ...msg.data.output } }));
          }
        } catch (err) {
          console.error('[StateSync] Failed to import settings:', err);
        }
      }
      break;
    }
  }
}

function initReceiver() {
  if (!channel) return;

  channel.onmessage = handleReceivedMessage;

  // Drive the cursor crosshair overlay visibility from settings rather than
  // a separate cursor-visibility broadcast. The toggle in Settings →
  // Display now writes settings.output.outputShowCursor; broadcast picks
  // it up via the project-state / settings-update messages and we mirror
  // it into the local outputCursorVisible flag the overlay code reads.
  const unsubCursorVis = settings.subscribe(s => {
    const next = !!s.output.outputShowCursor;
    if (next !== outputCursorVisible) {
      outputCursorVisible = next;
      // Hide the OS cursor when our overlay is the cursor of record.
      document.body.style.cursor = next ? 'none' : 'none';
      updateCursorOverlay();
    }
  });
  unsubscribers.push(unsubCursorVis);

  // Request initial state from main window
  channel.postMessage({
    type: 'osr-request-state',
    timestamp: Date.now(),
  } satisfies StateMessage);

  if (isExternalPreviewWindow()) {
    startStage3DRelayPolling();
  }

  console.log('[StateSync] Receiver initialized, requesting state');
}

async function pollStage3DRelayState() {
  if (!isDesktopApp || mode !== 'receiver' || !isExternalPreviewWindow() || stage3dRelayPollInFlight) return;
  stage3dRelayPollInFlight = true;
  try {
    const result = await invoke<{
      full?: any;
      fullTick?: number;
      live?: any;
      liveTick?: number;
      scene?: any;
      sceneTick?: number;
      settings?: any;
      settingsTick?: number;
      patch?: any[];
      patchTick?: number;
      state?: any;
      tick?: number;
    }>('stage3d_get_state', {
      fullTick: lastStage3DRelayFullTick,
      liveTick: lastStage3DRelayLiveTick,
      sceneTick: lastStage3DRelaySceneTick,
      settingsTick: lastStage3DRelaySettingsTick,
      patchTick: lastStage3DRelayPatchTick,
    });

    // Backward compatibility for an older main-process relay shape.
    const legacyTick = typeof result?.tick === 'number' ? result.tick : -1;
    if (result?.state && legacyTick !== lastStage3DRelayFullTick) {
      lastStage3DRelayFullTick = legacyTick;
      applyProjectStatePayload(result.state, 'Stage 3D IPC relay');
      return;
    }

    const fullTick = typeof result?.fullTick === 'number' ? result.fullTick : lastStage3DRelayFullTick;
    if (result?.full && fullTick !== lastStage3DRelayFullTick) {
      lastStage3DRelayFullTick = fullTick;
      applyProjectStatePayload(result.full, 'Stage 3D IPC relay');
    }

    const liveTick = typeof result?.liveTick === 'number' ? result.liveTick : lastStage3DRelayLiveTick;
    if (result?.live && liveTick !== lastStage3DRelayLiveTick) {
      lastStage3DRelayLiveTick = liveTick;
      applyLiveVJStatePayload(result.live, 'Stage 3D IPC relay');
    }

    const sceneTick = typeof result?.sceneTick === 'number' ? result.sceneTick : lastStage3DRelaySceneTick;
    if (result?.scene && sceneTick !== lastStage3DRelaySceneTick) {
      lastStage3DRelaySceneTick = sceneTick;
      applyStage3DScenePayload(result.scene, 'Stage 3D IPC relay');
    }

    const settingsTick = typeof result?.settingsTick === 'number' ? result.settingsTick : lastStage3DRelaySettingsTick;
    if (result?.settings && settingsTick !== lastStage3DRelaySettingsTick) {
      lastStage3DRelaySettingsTick = settingsTick;
      applySettingsPayload(result.settings, 'Stage 3D IPC relay');
    }

    // Apply patches AFTER full: the main process clears its patch
    // accumulator when a new full lands, so a poll that picks up both
    // applies the full first and the newer patches on top.
    const patchTick = typeof result?.patchTick === 'number' ? result.patchTick : lastStage3DRelayPatchTick;
    if (Array.isArray(result?.patch) && patchTick !== lastStage3DRelayPatchTick) {
      lastStage3DRelayPatchTick = patchTick;
      applyLayerPatchesPayload(result.patch);
    }
  } catch (err) {
    if (!stage3dRelayWarned) {
      stage3dRelayWarned = true;
      console.warn('[StateSync] Stage 3D IPC relay poll failed:', err);
    }
  } finally {
    stage3dRelayPollInFlight = false;
  }
}

function startStage3DRelayPolling() {
  if (!isDesktopApp || stage3dRelayPollTimer) return;
  void pollStage3DRelayState();
  stage3dRelayPollTimer = setInterval(() => {
    void pollStage3DRelayState();
  }, 50);
  console.log('[StateSync] Stage 3D IPC relay polling started');
}

// ============================================================
// Public API
// ============================================================

/**
 * Initialize BroadcastChannel state sync.
 *
 * @param syncMode 'sender' for main window, 'receiver' for OSR window
 */
/** Broadcast freeze/pause state to the output window */
export function broadcastFrozenState(frozen: boolean) {
  if (!channel || mode !== 'sender') return;
  try {
    channel.postMessage({ type: 'output-frozen', data: { frozen }, timestamp: Date.now() } satisfies StateMessage);
  } catch {}
}

/** Broadcast cursor visibility to the output window */
export function broadcastCursorVisibility(show: boolean) {
  if (!channel || mode !== 'sender') return;
  try {
    channel.postMessage({ type: 'cursor-visibility', data: { show }, timestamp: Date.now() } satisfies StateMessage);
  } catch {}
}

/** Broadcast cursor position (normalized 0-1) so the output can draw a crosshair */
export function broadcastCursorPosition(x: number, y: number) {
  if (!channel || mode !== 'sender') return;
  try {
    channel.postMessage({ type: 'cursor-position', data: { x, y }, timestamp: Date.now() } satisfies StateMessage);
  } catch {}
}

/** Clear cursor on the output window */
export function broadcastCursorClear() {
  if (!channel || mode !== 'sender') return;
  try {
    channel.postMessage({ type: 'cursor-position', data: null, timestamp: Date.now() } satisfies StateMessage);
  } catch {}
}

// Module-level cursor overlay state (set by receiver, read by SpoutOutputApp)
export let outputCursorX: number | null = null;
export let outputCursorY: number | null = null;
export let outputCursorVisible = false;

export function initStateBroadcast(syncMode: 'sender' | 'receiver') {
  if (channel) {
    console.warn('[StateSync] Already initialized as', mode);
    return;
  }

  // BroadcastChannel requires same origin — both windows load from localhost:1420
  channel = new BroadcastChannel(CHANNEL_NAME);
  mode = syncMode;

  if (syncMode === 'sender') {
    initSender();
  } else {
    initReceiver();
  }
}

/**
 * Check if the receiver has received its first state update.
 */
export function hasReceivedState(): boolean {
  return receivedFirstState;
}

/**
 * Clean up BroadcastChannel and subscriptions.
 */
/** Render a crosshair cursor overlay on the output window */
/**
 * Render a full-overlay crosshair cursor on the output window. Vertical and
 * horizontal lines span the entire window at the pointer position so the
 * performer can see exactly where they're aiming on the projector. White
 * core + dark drop-shadow so it reads on any background. Hidden when
 * outputCursorVisible is false OR no cursor position is set.
 */
function updateCursorOverlay() {
  let el = document.getElementById('cursor-overlay');
  const shouldShow =
    outputCursorVisible && outputCursorX !== null && outputCursorY !== null;

  if (!shouldShow) {
    if (el) el.style.display = 'none';
    return;
  }

  if (!el) {
    el = document.createElement('div');
    el.id = 'cursor-overlay';
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;';
    el.innerHTML = `
      <div id="ch-vbg" style="position:absolute;top:0;bottom:0;width:3px;background:rgba(0,0,0,0.6);transform:translateX(-50%);"></div>
      <div id="ch-hbg" style="position:absolute;left:0;right:0;height:3px;background:rgba(0,0,0,0.6);transform:translateY(-50%);"></div>
      <div id="ch-vline" style="position:absolute;top:0;bottom:0;width:1px;background:rgba(255,255,255,0.9);transform:translateX(-50%);"></div>
      <div id="ch-hline" style="position:absolute;left:0;right:0;height:1px;background:rgba(255,255,255,0.9);transform:translateY(-50%);"></div>
      <div id="ch-ring" style="position:absolute;width:18px;height:18px;border-radius:50%;border:2px solid rgba(0,0,0,0.7);box-sizing:border-box;transform:translate(-50%,-50%);"></div>
      <div id="ch-ring2" style="position:absolute;width:18px;height:18px;border-radius:50%;border:1px solid rgba(255,255,255,0.95);box-sizing:border-box;transform:translate(-50%,-50%);"></div>
    `;
    document.body.appendChild(el);
  }

  el.style.display = 'block';
  const xPct = (outputCursorX as number) * 100;
  const yPct = (1 - (outputCursorY as number)) * 100;
  const vbg = document.getElementById('ch-vbg');
  const hbg = document.getElementById('ch-hbg');
  const vline = document.getElementById('ch-vline');
  const hline = document.getElementById('ch-hline');
  const ring = document.getElementById('ch-ring');
  const ring2 = document.getElementById('ch-ring2');
  if (vbg) vbg.style.left = xPct + '%';
  if (vline) vline.style.left = xPct + '%';
  if (hbg) hbg.style.top = yPct + '%';
  if (hline) hline.style.top = yPct + '%';
  if (ring) { ring.style.left = xPct + '%'; ring.style.top = yPct + '%'; }
  if (ring2) { ring2.style.left = xPct + '%'; ring2.style.top = yPct + '%'; }
}

export function destroyStateBroadcast() {
  for (const unsub of unsubscribers) {
    try { unsub(); } catch {}
  }
  unsubscribers = [];

  if (projectDebounceTimer) {
    clearTimeout(projectDebounceTimer);
    projectDebounceTimer = null;
  }
  if (stage3dRelayFullPublishTimer) {
    clearTimeout(stage3dRelayFullPublishTimer);
    stage3dRelayFullPublishTimer = null;
  }
  if (stage3dRelayLivePublishTimer) {
    clearTimeout(stage3dRelayLivePublishTimer);
    stage3dRelayLivePublishTimer = null;
  }
  if (stage3dRelayScenePublishTimer) {
    clearTimeout(stage3dRelayScenePublishTimer);
    stage3dRelayScenePublishTimer = null;
  }
  if (stage3dRelaySettingsPublishTimer) {
    clearTimeout(stage3dRelaySettingsPublishTimer);
    stage3dRelaySettingsPublishTimer = null;
  }
  if (stage3dRelayPatchPublishTimer) {
    clearTimeout(stage3dRelayPatchPublishTimer);
    stage3dRelayPatchPublishTimer = null;
  }
  if (stage3dRelayPollTimer) {
    clearInterval(stage3dRelayPollTimer);
    stage3dRelayPollTimer = null;
  }
  if (stage3dRelayActivePollTimer) {
    clearInterval(stage3dRelayActivePollTimer);
    stage3dRelayActivePollTimer = null;
  }
  if (stage3dDebounceTimer) {
    clearTimeout(stage3dDebounceTimer);
    stage3dDebounceTimer = null;
  }

  if (channel) {
    channel.close();
    channel = null;
  }

  mode = null;
  receivedFirstState = false;
  lastStage3DRelayFullTick = -1;
  lastStage3DRelayLiveTick = -1;
  lastStage3DRelaySceneTick = -1;
  lastStage3DRelaySettingsTick = -1;
  lastStage3DRelayPatchTick = -1;
  stage3dRelayActive = false;
  pendingRelayPatches.clear();
  lastSentVJStructure = null;
  stage3dRelayPollInFlight = false;
  console.log('[StateSync] Destroyed');
}
