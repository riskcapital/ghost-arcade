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

const CHANNEL_NAME = 'ghostarcade-state-sync';

let channel: BroadcastChannel | null = null;
let mode: 'sender' | 'receiver' | null = null;
let unsubscribers: (() => void)[] = [];

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

/** Send a lightweight per-layer patch instead of a full export. */
function broadcastLayerPatches(currentLayers = get(project).layers): boolean {
  if (!channel || mode !== 'sender') return false;

  const patches: Array<{ id: string; corners?: any; opacity?: number; meshGrid?: any }> = [];

  for (const layer of currentLayers) {
    const prevCorners = lastLayerCorners[layer.id];
    const prevOpacity = lastLayerOpacities[layer.id];
    const prevMeshGrid = lastLayerMeshGrids[layer.id];
    const cornersChanged = !prevCorners || JSON.stringify(layer.corners) !== JSON.stringify(prevCorners);
    const opacityChanged = prevOpacity !== layer.opacity;
    const meshGridChanged = JSON.stringify(layer.meshGrid) !== JSON.stringify(prevMeshGrid);

    if (cornersChanged || opacityChanged || meshGridChanged) {
      const patch: any = { id: layer.id };
      if (cornersChanged) patch.corners = layer.corners;
      if (meshGridChanged) patch.meshGrid = layer.meshGrid;
      if (opacityChanged) patch.opacity = layer.opacity;
      patches.push(patch);
      lastLayerCorners[layer.id] = cloneSerializable(layer.corners);
      lastLayerOpacities[layer.id] = layer.opacity;
      lastLayerMeshGrids[layer.id] = cloneSerializable(layer.meshGrid);
    }
  }

  if (patches.length > 0) {
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
  return true;
}

function tryBroadcastLayerPatchUpdate(): boolean {
  if (!channel || mode !== 'sender' || !hasActiveReceiver) return true;
  const projectState = get(project);
  const currentLayers = projectState.layers;
  const currentIds = currentLayers.map(layer => layer.id).join('|');

  if (!lastLayerIds || currentIds !== lastLayerIds) return false;

  for (const layer of currentLayers) {
    const signature = layerPatchSignature(layer);
    if (lastLayerSignatures[layer.id] !== signature) return false;
  }

  return broadcastLayerPatches(currentLayers);
}

// ============================================================
// Message Types
// ============================================================

interface StateMessage {
  type: 'project-state' | 'vj-state' | 'settings-update' | 'osr-request-state' | 'layer-patch' | 'cursor-visibility' | 'cursor-position' | 'output-frozen';
  data?: any;
  timestamp: number;
}

// ============================================================
// Sender (Main Window)
// ============================================================

function sendFullState() {
  if (!channel || mode !== 'sender') return;

  try {
    // Use existing exportProject() which strips textures/video elements
    const projectData = project.exportProject();
    const vjState = get(vjClipLauncher);
    const settingsState = get(settings);

    // Strip non-serializable properties from clip grids (HTMLCanvasElement,
    // HTMLVideoElement, HTMLIFrameElement). Must strip:
    //   - the top-level Bank A clipGrid
    //   - the Bank B clipGrid (when crossfader has it)
    //   - the clipGrid AND bankBClipGrid inside every block
    //   - layerStates[i].activeClip + bankBLayerStates[i].activeClip
    //     (same VJClip object reference as in the grid, so same runtime fields)
    // Pre-fix the activeClip path leaked HTMLVideoElement into structured
    // clone and threw DataCloneError on every triggerClip / setClip /
    // openVJMode — visible as a console flood and reported by the user.
    const safeBlocks = vjState.blocks.map(block => ({
      ...block,
      clipGrid: stripClipGrid(block.clipGrid),
      bankBClipGrid: block.bankBClipGrid ? stripClipGrid(block.bankBClipGrid) : undefined,
    }));
    const safeClipGrid = stripClipGrid(vjState.clipGrid);
    const safeBankBClipGrid = (vjState as any).bankBClipGrid ? stripClipGrid((vjState as any).bankBClipGrid) : undefined;

    channel.postMessage({
      type: 'project-state',
      data: {
        ...projectData,
        vjClipLauncher: {
          blocks: safeBlocks,
          activeBlockId: vjState.activeBlockId,
          clipGrid: safeClipGrid,
          bankBClipGrid: safeBankBClipGrid,
          layerStates: stripLayerStates(vjState.layerStates),
          bankBLayerStates: stripLayerStates((vjState as any).bankBLayerStates),
          compositionEffects: vjState.compositionEffects,
          masterOpacity: vjState.masterOpacity,
          isOpen: vjState.isOpen,
          isLive: vjState.isLive,
        },
        settings: {
          // JSON-clean: output can carry non-cloneable nested values that
          // otherwise throw DataCloneError on postMessage.
          output: settingsState?.output ? JSON.parse(JSON.stringify(settingsState.output)) : undefined,
        },
      },
      timestamp: Date.now(),
    } satisfies StateMessage);

    resetLayerPatchSnapshot();
    console.log('[StateSync] Full state sent to OSR');
  } catch (err) {
    console.error('[StateSync] Failed to send full state:', err);
  }
}

let hasActiveReceiver = false;

function broadcastProjectUpdate() {
  if (!channel || mode !== 'sender' || !hasActiveReceiver) return;

  // Debounce to avoid flooding during rapid store changes
  if (projectDebounceTimer) clearTimeout(projectDebounceTimer);
  projectDebounceTimer = setTimeout(() => {
    try {
      const projectData = project.exportProject();
      channel!.postMessage({
        type: 'project-state',
        data: projectData,
        timestamp: Date.now(),
      } satisfies StateMessage);
      resetLayerPatchSnapshot();
    } catch (err) {
      console.error('[StateSync] Failed to broadcast project:', err);
    }
  }, DEBOUNCE_MS);
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
  return grid.map(row => row.map(stripClip));
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

function doBroadcastVJState() {
  if (!channel || mode !== 'sender' || !hasActiveReceiver) return;

  try {
    const vjState = get(vjClipLauncher);

    // Strip the top-level clipGrid AND the clipGrid inside each block —
    // also strip layerStates[i].activeClip (carries the same uncloneable
    // VJClip reference) and bank B equivalents. Pre-fix only the top-level
    // grid was stripped, so every triggerClip/setClip/openVJMode broadcast
    // re-exposed an HTMLVideoElement to structured clone and threw
    // DataCloneError.
    const safeBlocks = vjState.blocks.map(block => ({
      ...block,
      clipGrid: stripClipGrid(block.clipGrid),
      bankBClipGrid: block.bankBClipGrid ? stripClipGrid(block.bankBClipGrid) : undefined,
    }));
    const safeClipGrid = stripClipGrid(vjState.clipGrid);
    const safeBankBClipGrid = (vjState as any).bankBClipGrid ? stripClipGrid((vjState as any).bankBClipGrid) : undefined;

    channel.postMessage({
      type: 'vj-state',
      data: {
        blocks: safeBlocks,
        activeBlockId: vjState.activeBlockId,
        clipGrid: safeClipGrid,
        bankBClipGrid: safeBankBClipGrid,
        layerStates: stripLayerStates(vjState.layerStates),
        bankBLayerStates: stripLayerStates((vjState as any).bankBLayerStates),
        compositionEffects: vjState.compositionEffects,
        masterOpacity: vjState.masterOpacity,
        isOpen: vjState.isOpen,
        isLive: vjState.isLive,
      },
      timestamp: Date.now(),
    } satisfies StateMessage);
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

  // Subscribe to project store changes. Full export is debounced.
  // Layer patches (corners, opacity) are sent only when the output window
  // is actually open — otherwise they just waste CPU on JSON.stringify.
  const unsubProject = project.subscribe(() => {
    if (!tryBroadcastLayerPatchUpdate()) {
      broadcastProjectUpdate();
    }
  });
  unsubscribers.push(unsubProject);

  // Subscribe to VJ clip launcher changes
  const unsubVJ = vjClipLauncher.subscribe(() => {
    broadcastVJState();
  });
  unsubscribers.push(unsubVJ);

  // Subscribe to settings.output changes so final-pass output transforms
  // (rotation, crop, brightness, contrast, gamma, cursor visibility) stay
  // in sync between editor + output window without requiring the user to
  // reopen the output window after every tweak. Diffed against the last
  // sent snapshot so non-output settings (e.g. UI prefs) don't trigger a
  // broadcast.
  let lastOutputJson = '';
  const unsubSettings = settings.subscribe(s => {
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

  console.log('[StateSync] Sender initialized');
}

let settingsBroadcastTimer: ReturnType<typeof setTimeout> | null = null;

// ============================================================
// Receiver (OSR Window)
// ============================================================

let receivedFirstState = false;

function handleReceivedMessage(event: MessageEvent<StateMessage>) {
  const msg = event.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'project-state': {
      if (msg.data) {
        try {
          // Use existing importProject() which handles all store updates
          project.importProject(msg.data);
          // Pull settings.output through too. Output transforms (rotation,
          // crop, color correction, cursor visibility) live in
          // settings.output and are applied by the output renderer, so
          // the output window needs the latest values to actually show
          // changes the user makes mid-session.
          if (msg.data.settings?.output) {
            settings.update(s => ({ ...s, output: { ...s.output, ...msg.data.settings.output } }));
          }
          if (!receivedFirstState) {
            receivedFirstState = true;
            console.log('[StateSync] First project state received');
          }
        } catch (err) {
          console.error('[StateSync] Failed to import project state:', err);
        }
      }
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
      if (msg.data && Array.isArray(msg.data)) {
        try {
          project.update((p: any) => {
            const layers = [...p.layers];
            for (const patch of msg.data) {
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
      break;
    }

    case 'vj-state': {
      if (msg.data) {
        try {
          // Merge incoming VJ state payload into current state shape.
          vjClipLauncher.update((state: any) => ({ ...state, ...msg.data }));
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

  console.log('[StateSync] Receiver initialized, requesting state');
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

  if (channel) {
    channel.close();
    channel = null;
  }

  mode = null;
  receivedFirstState = false;
  console.log('[StateSync] Destroyed');
}
