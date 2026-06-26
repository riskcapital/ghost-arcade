<script lang="ts">
  // Ghost Arcade Mobile — standalone (local-only) VJ surface.
  //
  // Architecture (2026-06-08 rewrite):
  //   - 4 stacked layers, each = (source, opacity, blendMode, effects[])
  //   - One <canvas> + StandaloneRenderer per layer, CSS-composited via
  //     mix-blend-mode + opacity
  //   - Sources can be curated shaders, local media, or live camera.
  //   - Effects run as WebGL post-process passes per layer.
  //   - Tabs: SOURCES | FX | MAP | MIX
  //   - Mic audio (Milkdrop-smoothed) feeds every layer's renderer
  //   - MIDI Learn re-targeted to layer controls (opacity per layer,
  //     master record toggle, mic toggle, clean output)
  //   - MediaRecorder captures the live composite
  //
  // What was removed (was here pre-rewrite, no longer relevant):
  //   - Clip-launcher / banks / Resolume-style dual deck crossfader
  //   - Autopilot, per-clip params, projection mapping, onboarding tour,
  //     diagnostic HUD — none of those map to the layer model.

  import { onMount, onDestroy } from 'svelte';
  import { StandaloneAudio, SILENT_AUDIO } from '../mobile/standaloneAudio';
  import { StandaloneRenderer } from '../mobile/standaloneRenderer';
  import { MOBILE_SHADERS, findShader, type MobileShader } from '../mobile/standaloneShaderList';
  import StandaloneShaderPicker from './StandaloneShaderPicker.svelte';
  import MobileSnapshotBank from './mobile/MobileSnapshotBank.svelte';
  import VJMixerStrip from './mobile/VJMixerStrip.svelte';
  import {
    StandaloneMidi,
    DEFAULT_MIDI_MAPPINGS,
    DEFAULT_MIDI_PRESET_ID,
    MIDI_LAYOUT_PRESETS,
    defaultControllerTargets,
    findMidiLayoutPreset,
    isWebMidiAvailable,
    type ControllerTargetDef,
    type MidiBinding,
    type MidiEvent,
    type MidiMappings,
    type MidiStatus,
    type MidiTarget,
  } from '../mobile/standaloneMidi';
  import {
    DEFAULT_OSC_PRESET_ID,
    OSC_LAYOUT_PRESETS,
    cloneOscBindings,
    defaultOscState,
    findOscLayoutPreset,
    normalizeOscBindings,
    normalizeOscPresetId,
    routeStandaloneOscMessage,
    standaloneOscLayoutText,
    type StandaloneOscBinding,
  } from '../mobile/standaloneOsc';
  import {
    StandaloneNativeOsc,
    isNativeOscBridgeAvailable,
    type NativeOscMessage,
    type NativeOscStatus,
    type NativeOscStatusEvent,
  } from '../mobile/nativeOsc';
  import {
    StandaloneRecorder,
    isRecordingSupported,
    deliverRecording,
    type LayerSnapshot,
  } from '../mobile/standaloneRecorder';
  import {
    MOBILE_EFFECTS,
    findMobileEffect,
    type MobileEffectInstance,
  } from '../mobile/standaloneEffects';
  import { EFFECT_PARAM_DEFS, type EffectParamDef } from '../effects/effectParamDefs';
  import { cornersToMatrix3d, type Pt } from '../mobile/standaloneHomography';

  export let onSwitchMode: () => void;

  // ── Layer model ──
  // Default 4 layers. Each layer has its own shader, opacity, blend
  // mode, and a list of CSS-filter effects. Layers are persisted to
  // localStorage as a flat array.
  const N_LAYERS = 4;
  const LAYER_COLORS = ['#FF6E6E', '#FFC857', '#69F0AE', '#BB86FC'];
  const SNAPSHOT_COUNT = 16;
  const SNAPSHOT_COLORS = [
    '#FF6E6E', '#FFC857', '#69F0AE', '#4FC3F7',
    '#BB86FC', '#FF8AD8', '#F59E0B', '#22D3EE',
    '#A3E635', '#F472B6', '#60A5FA', '#F87171',
    '#34D399', '#C084FC', '#FACC15', '#E5E7EB',
  ];
  const BLEND_MODES = [
    'normal', 'multiply', 'screen', 'add', 'difference',
    'overlay', 'darken', 'lighten', 'exclusion',
    'hardlight', 'softlight', 'color-dodge', 'color-burn',
  ];
  const QUICK_BLEND_MODES = ['normal', 'screen', 'multiply', 'add'];

  type ControllerSurfaceId = 'ghost' | 'apc' | 'launchpad' | 'nanokontrol';
  type ControllerSurface = {
    id: ControllerSurfaceId;
    name: string;
    short: string;
    description: string;
  };

  const CONTROLLER_SURFACES: ControllerSurface[] = [
    {
      id: 'ghost',
      name: 'Ghost Performance',
      short: 'Ghost',
      description: 'Layer faders, mapping toggles, edge fade, blend, and global show controls.',
    },
    {
      id: 'apc',
      name: 'APC Mini',
      short: 'APC',
      description: 'Fader row with a compact clip-launcher style pad matrix for layer actions.',
    },
    {
      id: 'launchpad',
      name: 'Launchpad',
      short: 'Launch',
      description: 'Large performance pads for toggles, mapping, blends, and show commands.',
    },
    {
      id: 'nanokontrol',
      name: 'nanoKONTROL',
      short: 'nano',
      description: 'Mixer-channel workflow with faders, edge knobs, and channel buttons.',
    },
  ];

  type StandaloneEffect = {
    id: string;
    type: string;                          // matches an entry in standaloneEffects.MOBILE_EFFECTS
    enabled: boolean;
    params: Record<string, number>;        // EFFECT_PARAM_DEFS-style param values
  };

  type LayerSourceType = 'shader' | 'media';
  type MediaKind = 'image' | 'video' | 'camera';
  type CameraFacing = 'environment' | 'user';

  type StandaloneLayer = {
    id: string;
    sourceType: LayerSourceType;
    shaderId: string | null;
    mediaName: string | null;
    mediaKind: MediaKind | null;
    cameraFacing: CameraFacing | null;
    enabled: boolean;
    opacity: number;
    blendMode: string;
    effects: StandaloneEffect[];
    mapped: boolean;
    corners: Pt[];
    edgeFeather: number;
    playbackSpeed: number;
    audioIntensity: number;
  };

  type StandaloneSnapshot = {
    id: string;
    slot: number;
    name: string;
    color: string;
    populated: boolean;
    capturedAt: number;
    layers: StandaloneLayer[] | null;
  };

  type SavedState = {
    projectId: string;
    projectName: string;
    updatedAt: number;
    layers: StandaloneLayer[];
    snapshots: StandaloneSnapshot[];
    activeSnapshotId: string | null;
    midi?: { enabled: boolean; mappings: MidiMappings; presetId?: string };
    osc?: { enabled: boolean; port: number; presetId: string; bindings: StandaloneOscBinding[] };
  };

  type StandaloneShowEntry = {
    id: string;
    name: string;
    updatedAt: number;
    state: SavedState;
  };

  const SAVE_KEY = 'ga-mobile-vj-state-v3';
  const SHOWS_KEY = 'ga-mobile-vj-shows-v1';
  const CUSTOM_MIDI_PRESET_ID = 'custom';

  const FULL_FRAME_CORNERS: Pt[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  const MAP_PRESETS = [
    {
      id: 'full',
      label: 'Full frame',
      corners: FULL_FRAME_CORNERS,
    },
    {
      id: 'center',
      label: 'Center panel',
      corners: [
        { x: 0.18, y: 0.16 },
        { x: 0.82, y: 0.13 },
        { x: 0.78, y: 0.82 },
        { x: 0.22, y: 0.86 },
      ],
    },
    {
      id: 'left-wall',
      label: 'Left wall',
      corners: [
        { x: 0.03, y: 0.18 },
        { x: 0.52, y: 0.08 },
        { x: 0.5, y: 0.9 },
        { x: 0.06, y: 0.78 },
      ],
    },
    {
      id: 'right-wall',
      label: 'Right wall',
      corners: [
        { x: 0.48, y: 0.08 },
        { x: 0.97, y: 0.18 },
        { x: 0.94, y: 0.78 },
        { x: 0.5, y: 0.9 },
      ],
    },
    {
      id: 'floor',
      label: 'Floor tilt',
      corners: [
        { x: 0.22, y: 0.48 },
        { x: 0.78, y: 0.48 },
        { x: 0.98, y: 0.98 },
        { x: 0.02, y: 0.98 },
      ],
    },
  ];

  const CORNER_LABELS = ['TL', 'TR', 'BR', 'BL'];

  function clamp01(v: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
  }

  function clampPlaybackSpeed(v: number): number {
    return Math.max(0, Math.min(3, Number.isFinite(v) ? v : 1));
  }

  function clampAudioIntensity(v: number): number {
    return Math.max(0, Math.min(2, Number.isFinite(v) ? v : 1));
  }

  function makeProjectId(): string {
    return `show-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeProjectName(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : 'Untitled Show';
  }

  function cloneCorners(corners: Pt[] = FULL_FRAME_CORNERS): Pt[] {
    return corners.map(p => ({ x: clamp01(p.x), y: clamp01(p.y) }));
  }

  function sanitizedCorners(value: unknown): Pt[] {
    if (!Array.isArray(value) || value.length !== 4) return cloneCorners(FULL_FRAME_CORNERS);
    return value.map((p: any, idx: number) => ({
      x: clamp01(typeof p?.x === 'number' ? p.x : FULL_FRAME_CORNERS[idx].x),
      y: clamp01(typeof p?.y === 'number' ? p.y : FULL_FRAME_CORNERS[idx].y),
    }));
  }

  function normalizedLayer(raw: any, i: number): StandaloneLayer {
    const rawSource = raw?.sourceType === 'media' ? 'media' : 'shader';
    const shaderId = raw && typeof raw.shaderId === 'string' && findShader(raw.shaderId) ? raw.shaderId : null;
    const hasRestorableSource = rawSource === 'shader' && !!shaderId;
    return {
      id: `layer-${i}`,
      sourceType: rawSource,
      shaderId,
      mediaName: typeof raw?.mediaName === 'string' ? raw.mediaName : null,
      mediaKind: raw?.mediaKind === 'video' || raw?.mediaKind === 'image' || raw?.mediaKind === 'camera' ? raw.mediaKind : null,
      cameraFacing: raw?.cameraFacing === 'user' || raw?.cameraFacing === 'environment' ? raw.cameraFacing : null,
      enabled: !!(raw?.enabled) && hasRestorableSource,
      opacity: typeof raw?.opacity === 'number' ? Math.max(0, Math.min(1, raw.opacity)) : 1,
      blendMode: typeof raw?.blendMode === 'string' ? raw.blendMode : 'normal',
      effects: Array.isArray(raw?.effects)
        ? raw.effects
            .filter((e: any) => e && typeof e.type === 'string' && findMobileEffect(e.type))
            .map((e: any) => ({
              id: typeof e.id === 'string' ? e.id : `${e.type}-${Math.random().toString(36).slice(2, 8)}`,
              type: e.type,
              enabled: e.enabled !== false,
              params: (e.params && typeof e.params === 'object') ? { ...e.params } : {},
            }))
        : [],
      mapped: !!raw?.mapped,
      corners: sanitizedCorners(raw?.corners),
      edgeFeather: typeof raw?.edgeFeather === 'number' ? Math.max(0, Math.min(0.45, raw.edgeFeather)) : 0,
      playbackSpeed: clampPlaybackSpeed(typeof raw?.playbackSpeed === 'number' ? raw.playbackSpeed : 1),
      audioIntensity: clampAudioIntensity(typeof raw?.audioIntensity === 'number' ? raw.audioIntensity : 1),
    };
  }

  function cloneLayerState(layer: StandaloneLayer, i: number): StandaloneLayer {
    return {
      ...layer,
      id: `layer-${i}`,
      effects: layer.effects.map(e => ({
        id: e.id,
        type: e.type,
        enabled: e.enabled,
        params: { ...e.params },
      })),
      corners: cloneCorners(layer.corners),
    };
  }

  function defaultSnapshot(slot: number): StandaloneSnapshot {
    return {
      id: `standalone-snap-${slot}`,
      slot,
      name: `Snap ${slot + 1}`,
      color: SNAPSHOT_COLORS[slot % SNAPSHOT_COLORS.length],
      populated: false,
      capturedAt: 0,
      layers: null,
    };
  }

  function defaultSnapshots(): StandaloneSnapshot[] {
    return Array.from({ length: SNAPSHOT_COUNT }, (_, slot) => defaultSnapshot(slot));
  }

  function normalizedSnapshots(value: unknown): StandaloneSnapshot[] {
    const snapshots = defaultSnapshots();
    if (!Array.isArray(value)) return snapshots;
    for (const raw of value) {
      const slot = Math.max(0, Math.min(SNAPSHOT_COUNT - 1, Math.floor(Number(raw?.slot))));
      if (!Number.isFinite(slot)) continue;
      const base = defaultSnapshot(slot);
      const layers = Array.isArray(raw?.layers)
        ? Array.from({ length: N_LAYERS }, (_, i) => normalizedLayer(raw.layers[i], i))
        : null;
      snapshots[slot] = {
        ...base,
        id: typeof raw?.id === 'string' ? raw.id : base.id,
        name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name : base.name,
        color: typeof raw?.color === 'string' ? raw.color : base.color,
        populated: !!raw?.populated && !!layers,
        capturedAt: typeof raw?.capturedAt === 'number' ? raw.capturedAt : 0,
        layers,
      };
    }
    return snapshots;
  }

  function defaultLayers(): StandaloneLayer[] {
    const out: StandaloneLayer[] = [];
    for (let i = 0; i < N_LAYERS; i++) {
      out.push({
        id: `layer-${i}`,
        // Pre-fill first 2 layers with shaders so a first-time user sees
        // something move the moment they open the app. Layers 3 + 4 are
        // empty placeholders.
        sourceType: 'shader',
        shaderId: i < 2 ? (MOBILE_SHADERS[i]?.id ?? null) : null,
        mediaName: null,
        mediaKind: null,
        cameraFacing: null,
        enabled: i < 2,
        opacity: i === 0 ? 1 : 0.7,
        blendMode: i === 0 ? 'normal' : 'screen',
        effects: [],
        mapped: false,
        corners: cloneCorners(FULL_FRAME_CORNERS),
        edgeFeather: 0,
        playbackSpeed: 1,
        audioIntensity: 1,
      });
    }
    return out;
  }

  function defaultSavedState(projectName = 'Untitled Show'): SavedState {
    return {
      projectId: makeProjectId(),
      projectName: normalizeProjectName(projectName),
      updatedAt: Date.now(),
      layers: defaultLayers(),
      snapshots: defaultSnapshots(),
      activeSnapshotId: null,
      midi: { enabled: false, mappings: { ...DEFAULT_MIDI_MAPPINGS }, presetId: DEFAULT_MIDI_PRESET_ID },
      osc: defaultOscState(),
    };
  }

  function loadSavedState(): SavedState {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.layers)) {
          // Normalize layer array length to N_LAYERS and validate shader ids.
          const layers: StandaloneLayer[] = [];
          for (let i = 0; i < N_LAYERS; i++) {
            const l = parsed.layers[i] ?? null;
            layers.push(normalizedLayer(l, i));
          }
          parsed.layers = layers;
        } else {
          parsed.layers = defaultLayers();
        }
        parsed.snapshots = normalizedSnapshots(parsed.snapshots);
        parsed.activeSnapshotId = typeof parsed.activeSnapshotId === 'string'
          && parsed.snapshots.some((snap: StandaloneSnapshot) => snap.id === parsed.activeSnapshotId && snap.populated)
          ? parsed.activeSnapshotId
          : null;
        parsed.projectId = typeof parsed.projectId === 'string' && parsed.projectId.trim()
          ? parsed.projectId
          : makeProjectId();
        parsed.projectName = normalizeProjectName(parsed.projectName);
        parsed.updatedAt = typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
          ? parsed.updatedAt
          : Date.now();
	        if (!parsed.midi || typeof parsed.midi !== 'object') {
	          parsed.midi = { enabled: false, mappings: { ...DEFAULT_MIDI_MAPPINGS }, presetId: DEFAULT_MIDI_PRESET_ID };
	        } else {
	          parsed.midi.enabled = !!parsed.midi.enabled;
          parsed.midi.presetId = parsed.midi.presetId === CUSTOM_MIDI_PRESET_ID
            ? CUSTOM_MIDI_PRESET_ID
            : (typeof parsed.midi.presetId === 'string'
              ? findMidiLayoutPreset(parsed.midi.presetId).id
              : DEFAULT_MIDI_PRESET_ID);
	          parsed.midi.mappings = parsed.midi.mappings && typeof parsed.midi.mappings === 'object'
	            ? { ...(parsed.midi.mappings || {}) }
	            : { ...findMidiLayoutPreset(parsed.midi.presetId).mappings };
	        }
	        if (!parsed.osc || typeof parsed.osc !== 'object') {
	          parsed.osc = defaultOscState();
	        } else {
	          const presetId = normalizeOscPresetId(parsed.osc.presetId);
	          const preset = findOscLayoutPreset(presetId);
	          const port = typeof parsed.osc.port === 'number' && parsed.osc.port >= 1 && parsed.osc.port <= 65535
	            ? Math.round(parsed.osc.port)
	            : preset.port;
	          parsed.osc = {
	            enabled: !!parsed.osc.enabled,
	            port,
	            presetId,
	            bindings: normalizeOscBindings(parsed.osc.bindings, presetId),
	          };
	        }
	        return parsed;
	      }
	    } catch { /* corrupt save — fall through */ }
	    return defaultSavedState();
	  }

  let state: SavedState = loadSavedState();
  function save() {
    state.updatedAt = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
  }

  function cloneSavedState(input: SavedState): SavedState {
    return JSON.parse(JSON.stringify(input)) as SavedState;
  }

  function loadSavedShows(): StandaloneShowEntry[] {
    try {
      const raw = localStorage.getItem(SHOWS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((entry: any) => entry && typeof entry.id === 'string' && entry.state)
        .map((entry: any) => ({
          id: entry.id,
          name: normalizeProjectName(entry.name ?? entry.state?.projectName),
          updatedAt: typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
            ? entry.updatedAt
            : Date.now(),
          state: entry.state as SavedState,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  function persistSavedShows(next: StandaloneShowEntry[]): void {
    savedShows = next
      .slice(0, 24)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    try { localStorage.setItem(SHOWS_KEY, JSON.stringify(savedShows)); } catch { /* private mode */ }
  }

  let savedShows: StandaloneShowEntry[] = loadSavedShows();

  function showControllerMessage(message: string): void {
    controllerMsg = message;
    setTimeout(() => {
      if (controllerMsg === message) controllerMsg = null;
    }, 2800);
  }

  function setProjectName(name: string): void {
    state.projectName = normalizeProjectName(name);
    state = state;
    save();
  }

  function saveCurrentShowToBank(): void {
    if (!state.projectId) state.projectId = makeProjectId();
    state.projectName = normalizeProjectName(state.projectName);
    save();
    const snapshot = cloneSavedState(state);
    const entry: StandaloneShowEntry = {
      id: snapshot.projectId,
      name: snapshot.projectName,
      updatedAt: snapshot.updatedAt,
      state: snapshot,
    };
    persistSavedShows([entry, ...savedShows.filter(show => show.id !== entry.id)]);
    state = state;
    showControllerMessage('Show saved');
  }

  function refreshRenderersFromState(): void {
    for (let i = 0; i < N_LAYERS; i++) {
      cleanupMediaLayer(i);
      renderers[i]?.clearSource();
    }
    for (let i = 0; i < N_LAYERS; i++) {
      const layer = state.layers[i];
      if (layer?.sourceType === 'shader' && layer.shaderId) void fetchAndLoad(renderers[i], layer.shaderId);
      pushLayerEffects(i);
    }
  }

  function newStandaloneShow(): void {
    state = defaultSavedState();
    refreshRenderersFromState();
    save();
    showSettings = false;
    tab = 'shaders';
    showControllerMessage('New show ready');
  }

  function loadStandaloneShow(id: string): void {
    const entry = savedShows.find(show => show.id === id);
    if (!entry) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(entry.state));
      state = loadSavedState();
      refreshRenderersFromState();
      showSettings = false;
      tab = 'shaders';
      showControllerMessage('Show loaded');
    } catch {
      recError = 'Could not load show';
    }
  }

  function deleteStandaloneShow(id: string): void {
    persistSavedShows(savedShows.filter(show => show.id !== id));
    showControllerMessage('Show deleted');
  }

  function formatShowDate(ts: number): string {
    if (!Number.isFinite(ts) || ts <= 0) return '';
    return new Date(ts).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  // ── Renderers + canvases ──
  let canvases: (HTMLCanvasElement | null)[] = new Array(N_LAYERS).fill(null);
  let renderers: (StandaloneRenderer | null)[] = new Array(N_LAYERS).fill(null);
  let mediaInput: HTMLInputElement | null = null;
  let pendingMediaLayer: number | null = null;
  let mediaElements: (HTMLImageElement | HTMLVideoElement | null)[] = new Array(N_LAYERS).fill(null);
  let mediaObjectUrls: (string | null)[] = new Array(N_LAYERS).fill(null);
  let audio: StandaloneAudio | null = null;
  let micEnabled = false;
  let micRequesting = false;
  let micError: string | null = null;
  let resizeObs: ResizeObserver | null = null;
  let pumpTimer: ReturnType<typeof setInterval> | null = null;

  // ── UI shell ──
  type TabId = 'shaders' | 'fx' | 'map' | 'mix' | 'ctrl';
  let tab: TabId = 'shaders';
  let pickerForLayer: number | null = null;
  let showSettings = false;
  let showMidi = false;
  let controllerSurfaceId: ControllerSurfaceId = 'ghost';
  $: activeControllerSurface = CONTROLLER_SURFACES.find(surface => surface.id === controllerSurfaceId) ?? CONTROLLER_SURFACES[0];
  let canvasStackEl: HTMLDivElement | null = null;
  let stackW = 1;
  let stackH = 1;
  let mapLayerIndex = 0;
  let dragMapCorner: { layerIndex: number; cornerIndex: number; pointerId: number } | null = null;

  // Clean Output — long-press to hide all UI for HDMI mirror.
  let cleanOutput = false;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  function onCanvasPointerDown() {
    if (cleanOutput) { cleanOutput = false; return; }
    longPressTimer = setTimeout(() => { cleanOutput = true; longPressTimer = null; }, 650);
  }
  function onCanvasPointerUp() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  }

  // ── Projection mapping controls ──
  function updateStackSize(): void {
    if (!canvasStackEl) return;
    const r = canvasStackEl.getBoundingClientRect();
    stackW = Math.max(1, r.width);
    stackH = Math.max(1, r.height);
  }
  function layerCornersPx(l: StandaloneLayer): Pt[] {
    const corners = l.corners?.length === 4 ? l.corners : FULL_FRAME_CORNERS;
    return corners.map(p => ({ x: p.x * stackW, y: p.y * stackH }));
  }
  function layerMapTransform(l: StandaloneLayer): string {
    if (!l.mapped) return 'none';
    return cornersToMatrix3d(stackW, stackH, layerCornersPx(l));
  }
  function selectedMapLayer(): StandaloneLayer {
    return state.layers[Math.max(0, Math.min(N_LAYERS - 1, mapLayerIndex))] ?? state.layers[0];
  }
  function setMapLayerIndex(i: number): void {
    mapLayerIndex = Math.max(0, Math.min(N_LAYERS - 1, i));
  }
  function setLayerMapped(i: number, mapped: boolean): void {
    state.layers[i].mapped = mapped;
    if (!state.layers[i].corners?.length) state.layers[i].corners = cloneCorners(FULL_FRAME_CORNERS);
    state = state;
    save();
  }
  function setLayerEdgeFeather(i: number, value: number): void {
    state.layers[i].edgeFeather = Math.max(0, Math.min(0.45, value));
    state = state;
    save();
    pushLayerEffects(i);
  }
  function applyMapPreset(i: number, presetId: string): void {
    const preset = MAP_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    state.layers[i].corners = cloneCorners(preset.corners);
    state.layers[i].mapped = true;
    state = state;
    save();
  }
  function resetLayerMapping(i: number): void {
    state.layers[i].corners = cloneCorners(FULL_FRAME_CORNERS);
    state.layers[i].mapped = false;
    state.layers[i].edgeFeather = 0;
    state = state;
    save();
    pushLayerEffects(i);
  }
  function updateLayerCorner(i: number, cornerIndex: number, x: number, y: number, persist = true): void {
    const layer = state.layers[i];
    if (!layer) return;
    const next = cloneCorners(layer.corners);
    next[cornerIndex] = { x: clamp01(x), y: clamp01(y) };
    layer.corners = next;
    layer.mapped = true;
    state = state;
    if (persist) save();
  }
  function eventToStackNorm(e: PointerEvent): Pt | null {
    if (!canvasStackEl) return null;
    const r = canvasStackEl.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return {
      x: clamp01((e.clientX - r.left) / r.width),
      y: clamp01((e.clientY - r.top) / r.height),
    };
  }
  function handleMapCornerDown(layerIndex: number, cornerIndex: number, e: PointerEvent): void {
    e.stopPropagation();
    e.preventDefault();
    setMapLayerIndex(layerIndex);
    dragMapCorner = { layerIndex, cornerIndex, pointerId: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function handleMapPointerMove(e: PointerEvent): void {
    if (!dragMapCorner || dragMapCorner.pointerId !== e.pointerId) return;
    const p = eventToStackNorm(e);
    if (!p) return;
    updateLayerCorner(dragMapCorner.layerIndex, dragMapCorner.cornerIndex, p.x, p.y, false);
  }
  function handleMapPointerUp(e: PointerEvent): void {
    if (!dragMapCorner || dragMapCorner.pointerId !== e.pointerId) return;
    save();
    dragMapCorner = null;
  }

  // ── Shader load ──
  async function fetchAndLoad(renderer: StandaloneRenderer | null, shaderId: string | null) {
    if (!renderer || !shaderId) return;
    const s = findShader(shaderId);
    if (!s) return;
    try {
      const url = encodeURI(`${import.meta.env.BASE_URL}${s.path}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      await renderer.loadShaderSource(await res.text(), s.audioNative, s.audioInject);
    } catch (e) {
      console.warn('[StandaloneApp] shader load failed', shaderId, e);
    }
  }

  // ── Layer ops ──
  function layerHasSource(l: StandaloneLayer): boolean {
    if (l.sourceType === 'shader') return !!l.shaderId;
    return !!l.mediaName && !!mediaElements[Number(l.id.replace('layer-', ''))];
  }
  function layerDisplayName(l: StandaloneLayer): string | null {
    if (l.sourceType === 'media') return l.mediaName;
    return l.shaderId ? findShader(l.shaderId)?.name ?? l.shaderId : null;
  }
  function layerDisplayKind(l: StandaloneLayer): string {
    if (l.sourceType === 'media') return l.mediaKind === 'camera' ? 'camera' : l.mediaKind === 'video' ? 'video' : 'image';
    return l.shaderId ? findShader(l.shaderId)?.category ?? 'shader' : 'empty';
  }
  function cleanupMediaLayer(i: number): void {
    const el = mediaElements[i];
    if (el instanceof HTMLVideoElement) {
      try { el.pause(); } catch { /* ignore */ }
      const stream = el.srcObject;
      if (stream instanceof MediaStream) {
        try { stream.getTracks().forEach(track => track.stop()); } catch { /* ignore */ }
      }
      try { el.srcObject = null; } catch { /* ignore */ }
      el.removeAttribute('src');
      el.load();
    }
    mediaElements[i] = null;
    if (mediaObjectUrls[i]) {
      URL.revokeObjectURL(mediaObjectUrls[i]!);
      mediaObjectUrls[i] = null;
    }
  }
  function requestMediaForLayer(i: number): void {
    pendingMediaLayer = i;
    mediaInput?.click();
  }
  async function handleMediaPicked(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    const layerIndex = pendingMediaLayer;
    pendingMediaLayer = null;
    input.value = '';
    if (!file || layerIndex === null) return;
    const kind: MediaKind = file.type.startsWith('video/') ? 'video' : 'image';
    const url = URL.createObjectURL(file);
    try {
      let el: HTMLImageElement | HTMLVideoElement;
      if (kind === 'video') {
        const video = document.createElement('video');
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.crossOrigin = 'anonymous';
        video.src = url;
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error('Could not load video'));
        });
        await video.play().catch(() => undefined);
        el = video;
      } else {
        const image: HTMLImageElement = new Image();
        image.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('Could not load image'));
          image.src = url;
        });
        el = image;
      }
      cleanupMediaLayer(layerIndex);
      mediaElements[layerIndex] = el;
      mediaObjectUrls[layerIndex] = url;
      state.layers[layerIndex] = {
        ...state.layers[layerIndex],
        sourceType: 'media',
        shaderId: null,
        mediaName: file.name,
        mediaKind: kind,
        cameraFacing: null,
        enabled: true,
      };
      state = state;
      renderers[layerIndex]?.loadMediaSource(el);
      pushLayerEffects(layerIndex);
      save();
    } catch (err: any) {
      URL.revokeObjectURL(url);
      recError = err?.message || 'Could not import media';
    }
  }
  async function requestCameraForLayer(i: number): Promise<void> {
    const current = state.layers[i];
    const facing: CameraFacing = current?.mediaKind === 'camera'
      ? (current.cameraFacing === 'environment' ? 'user' : 'environment')
      : 'environment';
    await startCameraForLayer(i, facing);
  }
  async function startCameraForLayer(i: number, facing: CameraFacing): Promise<void> {
    recError = null;
    if (!navigator.mediaDevices?.getUserMedia) {
      recError = 'Camera is not available in this browser.';
      return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 60 },
        },
      });
      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.loop = false;
      video.playsInline = true;
      video.setAttribute('playsinline', 'true');
      video.srcObject = stream;
      await new Promise<void>((resolve) => {
        if (video.readyState >= 1) { resolve(); return; }
        video.onloadedmetadata = () => resolve();
      });
      await video.play().catch(() => undefined);

      cleanupMediaLayer(i);
      mediaElements[i] = video;
      mediaObjectUrls[i] = null;
      state.layers[i] = {
        ...state.layers[i],
        sourceType: 'media',
        shaderId: null,
        mediaName: facing === 'user' ? 'Front Camera' : 'Rear Camera',
        mediaKind: 'camera',
        cameraFacing: facing,
        enabled: true,
      };
      state = state;
      renderers[i]?.loadMediaSource(video);
      pushLayerEffects(i);
      save();
    } catch (err: any) {
      try { stream?.getTracks().forEach(track => track.stop()); } catch { /* ignore */ }
      recError = err?.message || 'Could not start camera';
    }
  }
  function setLayerShader(i: number, shaderId: string | null): void {
    cleanupMediaLayer(i);
    state.layers[i].sourceType = 'shader';
    state.layers[i].shaderId = shaderId;
    state.layers[i].mediaName = null;
    state.layers[i].mediaKind = null;
    state.layers[i].cameraFacing = null;
    state.layers[i].enabled = !!shaderId;
    state = state;
    save();
    if (shaderId) void fetchAndLoad(renderers[i], shaderId);
    else renderers[i]?.clearSource();
  }
  function setLayerOpacity(i: number, opacity: number): void {
    state.layers[i].opacity = Math.max(0, Math.min(1, opacity));
    state = state;
    save();
  }
  function setLayerBlendMode(i: number, blendMode: string): void {
    state.layers[i].blendMode = blendMode;
    state = state;
    save();
  }
  function setLayerPlaybackSpeed(i: number, speed: number): void {
    state.layers[i].playbackSpeed = clampPlaybackSpeed(speed);
    state = state;
    renderers[i]?.setClipParams({
      speed: state.layers[i].playbackSpeed,
      intensity: state.layers[i].audioIntensity,
    });
    save();
  }
  function setLayerAudioIntensity(i: number, intensity: number): void {
    state.layers[i].audioIntensity = clampAudioIntensity(intensity);
    state = state;
    renderers[i]?.setClipParams({
      speed: state.layers[i].playbackSpeed,
      intensity: state.layers[i].audioIntensity,
    });
    save();
  }
  function setLayerEnabled(i: number, enabled: boolean): void {
    state.layers[i].enabled = enabled && layerHasSource(state.layers[i]);
    state = state;
    save();
  }
  function stopLayer(i: number): void {
    cleanupMediaLayer(i);
    renderers[i]?.clearSource();
    state.layers[i].sourceType = 'shader';
    state.layers[i].shaderId = null;
    state.layers[i].mediaName = null;
    state.layers[i].mediaKind = null;
    state.layers[i].cameraFacing = null;
    state.layers[i].enabled = false;
    state = state;
    save();
  }
  function stopAllLayers(): void {
    for (let i = 0; i < N_LAYERS; i++) {
      cleanupMediaLayer(i);
      renderers[i]?.clearSource();
      state.layers[i] = {
        ...state.layers[i],
        sourceType: 'shader',
        shaderId: null,
        mediaName: null,
        mediaKind: null,
        cameraFacing: null,
        enabled: false,
      };
    }
    state = state;
    save();
  }
  function saveStandaloneSnapshot(index: number): void {
    if (index < 0 || index >= SNAPSHOT_COUNT) return;
    const base = state.snapshots[index] ?? defaultSnapshot(index);
    const capturedAt = Date.now();
    const next: StandaloneSnapshot = {
      ...base,
      populated: true,
      capturedAt,
      name: `Look ${new Date(capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      layers: state.layers.map((layer, i) => cloneLayerState(layer, i)),
    };
    state.snapshots = state.snapshots.map((snap, i) => i === index ? next : snap);
    state.activeSnapshotId = next.id;
    state = state;
    save();
  }
  function recallStandaloneSnapshot(index: number): void {
    const snap = state.snapshots[index];
    if (!snap?.populated || !snap.layers) return;
    let needsMediaReimport = false;
    const shaderLoads: Array<{ index: number; shaderId: string }> = [];
    const cameraStarts: Array<{ index: number; facing: CameraFacing }> = [];
    const nextLayers = state.layers.map((current, i) => {
      const captured = snap.layers?.[i];
      if (!captured) return current;
      const next = cloneLayerState(captured, i);
      if (next.sourceType === 'shader') {
        cleanupMediaLayer(i);
        if (next.shaderId) shaderLoads.push({ index: i, shaderId: next.shaderId });
        else renderers[i]?.clearSource();
        return next;
      }

      if (next.mediaKind === 'camera' && next.cameraFacing) {
        cleanupMediaLayer(i);
        renderers[i]?.clearSource();
        cameraStarts.push({ index: i, facing: next.cameraFacing });
        return { ...next, enabled: false };
      }

      const canKeepRuntimeMedia = current.sourceType === 'media'
        && current.mediaName === next.mediaName
        && current.mediaKind === next.mediaKind
        && current.cameraFacing === next.cameraFacing
        && !!mediaElements[i];
      if (canKeepRuntimeMedia) {
        renderers[i]?.loadMediaSource(mediaElements[i]!);
        return next;
      }

      cleanupMediaLayer(i);
      renderers[i]?.clearSource();
      needsMediaReimport = true;
      return { ...next, enabled: false };
    });

    state.layers = nextLayers;
    state.activeSnapshotId = snap.id;
    state = state;
    for (let i = 0; i < N_LAYERS; i++) pushLayerEffects(i);
    for (const load of shaderLoads) void fetchAndLoad(renderers[load.index], load.shaderId);
    for (const camera of cameraStarts) void startCameraForLayer(camera.index, camera.facing);
    save();
    if (needsMediaReimport) {
      controllerMsg = 'Snapshot recalled · re-import media sources';
      setTimeout(() => {
        if (controllerMsg === 'Snapshot recalled · re-import media sources') controllerMsg = null;
      }, 3200);
    }
  }

  // ── Effects ──
  // Real fragment-shader post-process passes — see standaloneEffects.ts
  // for the registry + GLSL. Effect TYPE strings + PARAM names match
  // the desktop catalog so EFFECT_PARAM_DEFS slider defs are shared.
  function getEffectDefList() {
    return MOBILE_EFFECTS.filter(fx => !fx.internal);
  }
  function getEffectParamDefs(type: string) {
    return EFFECT_PARAM_DEFS[type] ?? [];
  }
  function defaultParamsFor(type: string): Record<string, number> {
    const def = findMobileEffect(type);
    if (!def) return {};
    // Start from each EFFECT_PARAM_DEFS entry's default if present; fall
    // back to the mobile def's default. This keeps mobile + desktop in
    // visual sync when both know the param.
    const paramDefs = getEffectParamDefs(type);
    const out: Record<string, number> = { ...def.defaults };
    for (const pd of paramDefs) {
      if (pd.default !== undefined && out[pd.param] === undefined) out[pd.param] = pd.default;
    }
    return out;
  }
  function addLayerEffect(i: number, type: string): void {
    if (!findMobileEffect(type)) return;
    state.layers[i].effects = [
      ...state.layers[i].effects,
      { id: `${type}-${Date.now().toString(36)}`, type, enabled: true, params: defaultParamsFor(type) },
    ];
    state = state;
    save();
    pushLayerEffects(i);
  }
  function removeLayerEffect(i: number, effectId: string): void {
    state.layers[i].effects = state.layers[i].effects.filter(e => e.id !== effectId);
    state = state;
    save();
    pushLayerEffects(i);
  }
  function toggleLayerEffect(i: number, effectId: string): void {
    state.layers[i].effects = state.layers[i].effects.map(e =>
      e.id === effectId ? { ...e, enabled: !e.enabled } : e,
    );
    state = state;
    save();
    pushLayerEffects(i);
  }
  function setLayerEffectParam(i: number, effectId: string, param: string, value: number): void {
    state.layers[i].effects = state.layers[i].effects.map(e =>
      e.id === effectId ? { ...e, params: { ...e.params, [param]: value } } : e,
    );
    state = state;
    save();
    pushLayerEffects(i);
  }
  /** Push the layer's effect chain to its renderer. The renderer
   *  caches compiled effect programs internally, so calling this on
   *  every edit is cheap — only NEW effect types trigger a compile. */
  function pushLayerEffects(i: number): void {
    const r = renderers[i];
    if (!r) return;
    r.setClipParams({
      speed: state.layers[i].playbackSpeed,
      intensity: state.layers[i].audioIntensity,
    });
    const chain: MobileEffectInstance[] = state.layers[i].effects.map(e => ({
      type: e.type,
      params: e.params,
      enabled: e.enabled,
    }));
    const edgeFeather = state.layers[i].edgeFeather ?? 0;
    if (edgeFeather > 0) {
      chain.push({
        type: 'edgeFade',
        params: { edgeFeather, edgeGamma: 1 },
        enabled: true,
      });
    }
    r.setEffectChain(chain);
  }

  function dynamicControllerTargets(current: SavedState): ControllerTargetDef[] {
    const targets = defaultControllerTargets(N_LAYERS);
    for (let i = 0; i < N_LAYERS; i++) {
      const layer = current.layers[i];
      if (!layer) continue;
      for (const effect of layer.effects) {
        const fx = findMobileEffect(effect.type);
        for (const pd of getEffectParamDefs(effect.type)) {
          targets.push({
            target: `layer:${i}:effect:${effect.type}:${pd.param}` as MidiTarget,
            label: `L${i + 1} ${fx?.label ?? effect.type} ${pd.name}`,
            group: `Layer ${i + 1} FX`,
            mode: pd.step >= 1 && pd.min === 0 && pd.max === 1 ? 'trigger' : 'continuous',
          });
        }
      }
    }
    return targets;
  }
  let controllerTargets: ControllerTargetDef[] = dynamicControllerTargets(state);
  $: controllerTargets = dynamicControllerTargets(state);

  // ── Audio pump ──
  function pumpAudio() {
    if (audio?.ready) audio.update();
    const u = audio?.ready ? audio.uniforms : SILENT_AUDIO;
    for (const r of renderers) r?.setAudio(u);
  }
  async function enableMic() {
    if (micEnabled || micRequesting) return;
    micRequesting = true;
    micError = null;
    try {
      audio = new StandaloneAudio();
      await audio.start();
      micEnabled = true;
    } catch (e: any) {
      micError = e?.message || 'Mic permission denied';
      audio = null;
    } finally {
      micRequesting = false;
    }
  }
  function disableMic(): void {
    audio?.stop();
    audio = null;
    micEnabled = false;
  }

  // ── MIDI ──
  let midi: StandaloneMidi | null = null;
  let midiStatus: MidiStatus = isWebMidiAvailable() ? 'idle' : 'unavailable';
  let midiDevices: string[] = [];
	  let learnTarget: MidiTarget | null = null;
	  let learnTimer: ReturnType<typeof setTimeout> | null = null;
	  let currentMidiPreset = activeMidiPreset();
	  $: currentMidiPreset = activeMidiPreset();
	  let currentOscPreset = activeOscPreset();
	  $: currentOscPreset = activeOscPreset();
	  let controllerMsg: string | null = null;
	  let nativeOsc: StandaloneNativeOsc | null = null;
	  let oscStatus: NativeOscStatus = isNativeOscBridgeAvailable() ? 'idle' : 'unavailable';
	  let oscError: string | null = null;
	  let oscLastMessage: string | null = null;

  function scaledParamValue(pd: EffectParamDef, value: number): number {
    const raw = pd.min + clamp01(value) * (pd.max - pd.min);
    const stepped = pd.step > 0 ? Math.round(raw / pd.step) * pd.step : raw;
    return Math.max(pd.min, Math.min(pd.max, stepped));
  }
  function triggerBoolean(current: boolean, ev: MidiEvent): boolean | null {
    if (ev.binding.kind === 'note') {
      if (!ev.isTrigger) return null;
      return !current;
    }
    return ev.value >= 0.5;
  }
  function applyLayerControllerTarget(target: MidiTarget, ev: MidiEvent): boolean {
    if (!target.startsWith('layer:')) return false;
    const parts = target.split(':');
    const layerIndex = Number(parts[1]);
    const layer = state.layers[layerIndex];
    if (!Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex >= N_LAYERS || !layer) return true;
    const action = parts[2];

    if (action === 'opacity') {
      if (ev.binding.kind === 'note' && !ev.isTrigger) return true;
      setLayerOpacity(layerIndex, ev.value);
      return true;
    }
    if (action === 'enabled') {
      const next = triggerBoolean(layer.enabled, ev);
      if (next === null) return true;
      setLayerEnabled(layerIndex, next);
      return true;
    }
    if (action === 'mapped') {
      const next = triggerBoolean(layer.mapped, ev);
      if (next === null) return true;
      setLayerMapped(layerIndex, next);
      return true;
    }
    if (action === 'edge') {
      if (ev.binding.kind === 'note' && !ev.isTrigger) return true;
      setLayerEdgeFeather(layerIndex, ev.value * 0.35);
      return true;
    }
    if (action === 'speed') {
      if (ev.binding.kind === 'note' && !ev.isTrigger) return true;
      setLayerPlaybackSpeed(layerIndex, ev.value * 3);
      return true;
    }
    if (action === 'intensity') {
      if (ev.binding.kind === 'note' && !ev.isTrigger) return true;
      setLayerAudioIntensity(layerIndex, ev.value * 2);
      return true;
    }
    if (action === 'blend') {
      if (ev.binding.kind === 'note' && !ev.isTrigger) return true;
      const current = Math.max(0, BLEND_MODES.indexOf(layer.blendMode));
      const nextIndex = ev.isTrigger
        ? (current + 1) % BLEND_MODES.length
        : Math.min(BLEND_MODES.length - 1, Math.floor(clamp01(ev.value) * BLEND_MODES.length));
      setLayerBlendMode(layerIndex, BLEND_MODES[nextIndex]);
      return true;
    }
    if (action === 'corner') {
      if (ev.binding.kind === 'note' && !ev.isTrigger) return true;
      const cornerIndex = Number(parts[3]);
      const axis = parts[4];
      if (!Number.isInteger(cornerIndex) || cornerIndex < 0 || cornerIndex > 3 || (axis !== 'x' && axis !== 'y')) return true;
      const corner = layer.corners[cornerIndex] ?? FULL_FRAME_CORNERS[cornerIndex];
      updateLayerCorner(
        layerIndex,
        cornerIndex,
        axis === 'x' ? ev.value : corner.x,
        axis === 'y' ? ev.value : corner.y,
      );
      return true;
    }
    if (action === 'effect') {
      if (ev.binding.kind === 'note' && !ev.isTrigger) return true;
      const effectType = parts[3];
      const param = parts.slice(4).join(':');
      if (!effectType || !param) return true;
      const effect = layer.effects.find(e => e.type === effectType);
      if (!effect) return true;
      const paramDef = getEffectParamDefs(effectType).find(pd => pd.param === param);
      setLayerEffectParam(layerIndex, effect.id, param, paramDef ? scaledParamValue(paramDef, ev.value) : ev.value);
      return true;
    }
    return true;
  }

  function handleMidiEvent(target: MidiTarget, ev: MidiEvent): void {
    if (learnTarget === target) return;
    if (target.startsWith('snapshot:')) {
      if (!ev.isTrigger) return;
      const index = Number(target.slice('snapshot:'.length));
      if (Number.isInteger(index)) recallStandaloneSnapshot(index);
      return;
    }
    if (applyLayerControllerTarget(target, ev)) return;
    // Re-purposed MIDI targets for layer model. Crossfader-style continuous
    // CC maps to "L1 opacity" by default; the bank/clip slots map to per-
    // layer opacity (4 layers) and per-layer enabled toggle. Everything
    // else carries forward.
    if (target === 'crossfader') {
      setLayerOpacity(0, ev.value);
      return;
    }
    if (target.startsWith('bank:')) {
      // bank:N → toggle layer N enabled
      if (!ev.isTrigger) return;
      const idx = Number(target.slice(5));
      if (idx >= 0 && idx < N_LAYERS) setLayerEnabled(idx, !state.layers[idx].enabled);
      return;
    }
    if (target.startsWith('clip:')) {
      // clip:N → continuous? No — MIDI Learn lets the user pick a knob
      // here too; values 0..1 map to layer-N opacity if N < N_LAYERS.
      const idx = Number(target.slice(5));
      if (idx >= 0 && idx < N_LAYERS) setLayerOpacity(idx, ev.value);
      return;
    }
    if (target === 'micToggle') {
      if (!ev.isTrigger) return;
      if (micEnabled) disableMic(); else void enableMic();
      return;
    }
    if (target === 'cleanOutput') {
      if (!ev.isTrigger) return;
      cleanOutput = !cleanOutput;
      return;
    }
    if (target === 'autopilotToggle') {
      // Re-purposed: toggle recording. (Autopilot is gone in the new shell.)
      if (!ev.isTrigger) return;
      toggleRecording();
      return;
    }
  }
  function layerTarget(i: number, key: 'opacity' | 'enabled' | 'mapped' | 'edge' | 'speed' | 'intensity' | 'blend'): MidiTarget {
    return `layer:${i}:${key}` as MidiTarget;
  }
  function controllerTargetValue(target: MidiTarget): number {
    if (target === 'micToggle') return micEnabled ? 1 : 0;
    if (target === 'cleanOutput') return cleanOutput ? 1 : 0;
    if (target === 'autopilotToggle') return isRecording ? 1 : 0;
    if (target.startsWith('snapshot:')) {
      const index = Number(target.slice('snapshot:'.length));
      const snap = state.snapshots[index];
      return snap?.populated && snap.id === state.activeSnapshotId ? 1 : 0;
    }
    if (!target.startsWith('layer:')) return 0;

    const parts = target.split(':');
    const layerIndex = Number(parts[1]);
    const layer = state.layers[layerIndex];
    if (!Number.isInteger(layerIndex) || !layer) return 0;
    const action = parts[2];
    if (action === 'opacity') return layer.opacity;
    if (action === 'enabled') return layer.enabled ? 1 : 0;
    if (action === 'mapped') return layer.mapped ? 1 : 0;
    if (action === 'edge') return Math.max(0, Math.min(1, (layer.edgeFeather ?? 0) / 0.35));
    if (action === 'speed') return Math.max(0, Math.min(1, (layer.playbackSpeed ?? 1) / 3));
    if (action === 'intensity') return Math.max(0, Math.min(1, (layer.audioIntensity ?? 1) / 2));
    if (action === 'blend') return Math.max(0, BLEND_MODES.indexOf(layer.blendMode)) / Math.max(1, BLEND_MODES.length - 1);
    if (action === 'corner') {
      const cornerIndex = Number(parts[3]);
      const axis = parts[4];
      const corner = layer.corners[cornerIndex] ?? FULL_FRAME_CORNERS[cornerIndex];
      return axis === 'y' ? corner.y : corner.x;
    }
    if (action === 'effect') {
      const effectType = parts[3];
      const param = parts.slice(4).join(':');
      const effect = layer.effects.find(e => e.type === effectType);
      const value = effect?.params[param];
      const pd = getEffectParamDefs(effectType).find(def => def.param === param);
      if (typeof value !== 'number') return 0;
      if (!pd || pd.max === pd.min) return clamp01(value);
      return clamp01((value - pd.min) / (pd.max - pd.min));
    }
    return 0;
  }
  function controllerTargetOn(target: MidiTarget): boolean {
    return controllerTargetValue(target) >= 0.5;
  }
  function setControllerTarget(target: MidiTarget, value: number): void {
    handleMidiEvent(target, {
      binding: { kind: 'cc', channel: 0, num: 0 },
      value: clamp01(value),
      isTrigger: false,
    });
  }
  function triggerControllerTarget(target: MidiTarget): void {
    handleMidiEvent(target, {
      binding: { kind: 'note', channel: 0, num: 0 },
      value: 1,
      isTrigger: true,
    });
  }
  function handleMidiRaw(msg: { kind: 'cc' | 'note'; channel: number; num: number; value: number }): void {
    if (!learnTarget) return;
    if (msg.value === 0 && msg.kind === 'note') return;
    const binding: MidiBinding = { kind: msg.kind, channel: msg.channel, num: msg.num };
    midi?.setBinding(learnTarget, binding);
    if (state.midi && midi) {
      state.midi = { ...state.midi, presetId: CUSTOM_MIDI_PRESET_ID, mappings: { ...midi.mappings } };
      save();
      state = state;
    }
    cancelLearn();
  }
  function startLearn(target: MidiTarget): void {
    if (!midi || midi.status !== 'connected') return;
    cancelLearn();
    learnTarget = target;
    learnTimer = setTimeout(cancelLearn, 8000);
  }
  function cancelLearn(): void {
    learnTarget = null;
    if (learnTimer) { clearTimeout(learnTimer); learnTimer = null; }
  }
  function clearBinding(target: MidiTarget): void {
    midi?.setBinding(target, null);
    if (state.midi && midi) {
      state.midi = { ...state.midi, presetId: CUSTOM_MIDI_PRESET_ID, mappings: { ...midi.mappings } };
      save();
      state = state;
    }
  }
  function activeMidiPreset() {
    if (state.midi?.presetId === CUSTOM_MIDI_PRESET_ID) return null;
    return findMidiLayoutPreset(state.midi?.presetId);
  }
  function applyMidiPreset(presetId: string): void {
    const preset = findMidiLayoutPreset(presetId);
    const mappings = { ...preset.mappings };
    midi?.updateMappings(mappings);
    state.midi = {
      enabled: state.midi?.enabled ?? false,
      presetId: preset.id,
      mappings,
    };
    save();
    state = state;
  }
  function selectMidiPreset(presetId: string): void {
    if (presetId === CUSTOM_MIDI_PRESET_ID) {
      state.midi = {
        enabled: state.midi?.enabled ?? false,
        presetId: CUSTOM_MIDI_PRESET_ID,
        mappings: state.midi?.mappings ?? {},
      };
      save();
      state = state;
      return;
    }
    applyMidiPreset(presetId);
  }
  function resetMidiMappings(): void {
    applyMidiPreset(DEFAULT_MIDI_PRESET_ID);
  }
  function activeOscPreset() {
    return findOscLayoutPreset(state.osc?.presetId ?? DEFAULT_OSC_PRESET_ID);
  }
  function ensureOscState(): NonNullable<SavedState['osc']> {
    if (!state.osc) state.osc = defaultOscState();
    return state.osc;
  }
  function selectOscPreset(presetId: string): void {
    const preset = findOscLayoutPreset(presetId);
    const current = ensureOscState();
    state.osc = {
      enabled: current.enabled,
      port: preset.port,
      presetId: preset.id,
      bindings: cloneOscBindings(preset.bindings),
    };
    save();
    state = state;
    const next = state.osc;
    if (next?.enabled && nativeOsc?.status === 'listening') void nativeOsc.start(next.port);
  }
  function controllerTargetLabel(target: MidiTarget): string {
    const targetDef = controllerTargets.find(t => t.target === target);
    if (targetDef) return targetDef.label;
    if (target === 'crossfader') return 'L1 opacity';
    if (target === 'micToggle') return 'Mic';
    if (target === 'cleanOutput') return 'Clean output';
    if (target === 'autopilotToggle') return 'Record';
    if (target.startsWith('bank:')) return `L${Number(target.slice(5)) + 1} toggle`;
    if (target.startsWith('clip:')) return `L${Number(target.slice(5)) + 1} opacity`;
    if (target.startsWith('snapshot:')) return `Snapshot ${Number(target.slice('snapshot:'.length)) + 1}`;
    if (target.startsWith('layer:')) {
      const parts = target.split(':');
      const layerNum = Number(parts[1]) + 1;
      if (parts[2] === 'corner') return `L${layerNum} ${CORNER_LABELS[Number(parts[3])] ?? 'Corner'} ${parts[4]?.toUpperCase() ?? ''}`.trim();
      if (parts[2] === 'effect') return `L${layerNum} ${parts[3]} ${parts.slice(4).join(':')}`;
      return `L${layerNum} ${parts[2] ?? 'control'}`;
    }
    return target;
  }
  async function copyOscLayout(): Promise<void> {
    const preset = currentOscPreset;
    const bindings = state.osc?.bindings?.length ? state.osc.bindings : cloneOscBindings(preset.bindings);
    const text = standaloneOscLayoutText(bindings, state.osc?.port ?? preset.port);
    try {
      await navigator.clipboard?.writeText(text);
      controllerMsg = 'OSC layout copied';
    } catch {
      controllerMsg = 'Could not copy OSC layout';
    }
    setTimeout(() => {
      if (controllerMsg === 'OSC layout copied' || controllerMsg === 'Could not copy OSC layout') controllerMsg = null;
    }, 3000);
  }
  function handleNativeOscMessage(message: NativeOscMessage): void {
    oscLastMessage = message.address;
    const bindings = state.osc?.bindings ?? currentOscPreset.bindings;
    routeStandaloneOscMessage(bindings, message.address, message.args ?? [], handleMidiEvent);
  }
  function handleNativeOscStatus(status: NativeOscStatus, event?: NativeOscStatusEvent): void {
    oscStatus = status;
    oscError = event?.error ?? null;
    if (event?.port && state.osc && event.port !== state.osc.port) {
      state.osc = { ...state.osc, port: event.port };
      state = state;
    }
  }
  function ensureNativeOsc(): StandaloneNativeOsc | null {
    if (!isNativeOscBridgeAvailable()) {
      oscStatus = 'unavailable';
      return null;
    }
    if (!nativeOsc) {
      nativeOsc = new StandaloneNativeOsc({
        bindings: () => state.osc?.bindings ?? [],
        onMessage: handleNativeOscMessage,
        onStatus: handleNativeOscStatus,
      });
    }
    return nativeOsc;
  }
  async function enableOsc(): Promise<void> {
    const osc = ensureOscState();
    const manager = ensureNativeOsc();
    if (!manager) return;
    await manager.start(osc.port);
    if (manager.status === 'listening') {
      state.osc = { ...osc, enabled: true };
      save();
      state = state;
    }
  }
  async function disableOsc(): Promise<void> {
    await nativeOsc?.stop();
    if (state.osc) {
      state.osc = { ...state.osc, enabled: false };
      save();
      state = state;
    }
  }
  function setOscPort(value: number): void {
    const current = ensureOscState();
    const port = Math.max(1, Math.min(65535, Math.round(Number.isFinite(value) ? value : currentOscPreset.port)));
    state.osc = { ...current, port };
    save();
    state = state;
    const next = state.osc;
    if (next?.enabled && nativeOsc?.status === 'listening') void nativeOsc.start(port);
  }
  function oscStatusLabel(): string {
    if (oscStatus === 'listening') return `Listening on ${state.osc?.port ?? currentOscPreset.port}`;
    if (oscStatus === 'starting') return 'Starting...';
    if (oscStatus === 'error') return oscError ?? 'Could not start OSC';
    if (oscStatus === 'unavailable') return 'Native OSC unavailable';
    return 'Not listening';
  }
  async function enableMidi(): Promise<void> {
    if (!isWebMidiAvailable()) { midiStatus = 'unavailable'; return; }
    if (midi) { await midi.start(); return; }
    midi = new StandaloneMidi({
      mappings: state.midi?.mappings ?? { ...DEFAULT_MIDI_MAPPINGS },
      onEvent: handleMidiEvent,
      onRawMessage: handleMidiRaw,
      onStatusChange: (s, d) => { midiStatus = s; midiDevices = d; },
    });
    await midi.start();
    state.midi = {
      presetId: state.midi?.presetId ?? DEFAULT_MIDI_PRESET_ID,
      mappings: state.midi?.mappings ?? { ...DEFAULT_MIDI_MAPPINGS },
      enabled: true,
    };
    save();
    state = state;
  }
  function disableMidi(): void {
    midi?.stop();
    midi = null;
    midiStatus = isWebMidiAvailable() ? 'idle' : 'unavailable';
    midiDevices = [];
    cancelLearn();
    if (state.midi) { state.midi = { ...state.midi, enabled: false }; save(); state = state; }
  }

  // ── Recording ──
  let recorder: StandaloneRecorder | null = null;
  let recElapsed = 0;
  let recElapsedTimer: ReturnType<typeof setInterval> | null = null;
  let recError: string | null = null;
  let recDeliveringMsg: string | null = null;
  $: recSupported = typeof window !== 'undefined' && isRecordingSupported();
  $: isRecording = !!recorder;

  function buildLayerStack(): LayerSnapshot[] {
    const out: LayerSnapshot[] = [];
    for (let i = 0; i < N_LAYERS; i++) {
      const l = state.layers[i];
      const c = canvases[i];
      if (!l || !c) continue;
      out.push({
        canvas: c,
        enabled: l.enabled && layerHasSource(l),
        opacity: l.opacity,
        blendMode: l.blendMode,
        // Effects now live in the WebGL pipeline — the canvas itself
        // already shows the post-processed result, so no CSS filter
        // chain to apply during recording compositing.
        filter: 'none',
        corners: l.mapped ? cloneCorners(l.corners) : null,
      });
    }
    return out;
  }
  function startRecording(): void {
    if (recorder) return;
    recError = null;
    if (!recSupported) { recError = 'Recording not supported here. Try Chrome on Android.'; return; }
    try {
      recorder = new StandaloneRecorder({ getStack: buildLayerStack });
      recorder.start();
      recElapsed = 0;
      recElapsedTimer = setInterval(() => {
        recElapsed = recorder ? recorder.elapsedSec() : 0;
      }, 250);
    } catch (e: any) {
      recError = e?.message || 'Could not start recorder';
      recorder = null;
    }
  }
  async function stopRecording(): Promise<void> {
    if (!recorder) return;
    const r = recorder;
    recorder = null;
    if (recElapsedTimer) { clearInterval(recElapsedTimer); recElapsedTimer = null; }
    const result = await r.stop();
    recElapsed = 0;
    if (!result) { recError = 'Recording produced no data'; return; }
    recDeliveringMsg = 'Saving…';
    const outcome = await deliverRecording(result);
    if (outcome === 'failed') { recError = 'Could not save the clip'; recDeliveringMsg = null; return; }
    recDeliveringMsg = outcome === 'shared' ? 'Shared' : 'Saved to downloads';
    setTimeout(() => { recDeliveringMsg = null; }, 3500);
  }
  function toggleRecording(): void {
    if (isRecording) void stopRecording();
    else startRecording();
  }

  // ── Lifecycle ──
  onMount(() => {
    // Spin up one renderer per layer. The layer's currently-assigned
    // shader (if any) loads immediately so first paint shows content.
    for (let i = 0; i < N_LAYERS; i++) {
      const c = canvases[i];
      if (!c) continue;
      const r = new StandaloneRenderer(c);
      renderers[i] = r;
      r.start();
      if (state.layers[i].shaderId) void fetchAndLoad(r, state.layers[i].shaderId);
      pushLayerEffects(i);
    }
    pumpTimer = setInterval(pumpAudio, 16);
    resizeObs = new ResizeObserver(() => {
      updateStackSize();
      for (const r of renderers) r?.resize();
    });
    if (canvasStackEl) resizeObs.observe(canvasStackEl);
    for (const c of canvases) if (c) resizeObs.observe(c);
	    updateStackSize();
	    if (state.midi?.enabled) void enableMidi();
	    if (state.osc?.enabled) void enableOsc();
	  });
	  onDestroy(() => {
    if (pumpTimer) clearInterval(pumpTimer);
    resizeObs?.disconnect();
    for (let i = 0; i < N_LAYERS; i++) cleanupMediaLayer(i);
    for (const r of renderers) r?.destroy();
    renderers = new Array(N_LAYERS).fill(null);
	    audio?.stop(); audio = null;
	    midi?.stop(); midi = null;
	    void nativeOsc?.dispose(); nativeOsc = null;
	    cancelLearn();
    if (recElapsedTimer) { clearInterval(recElapsedTimer); recElapsedTimer = null; }
    void recorder?.stop();
    recorder = null;
  });

  // ── Derived: VJMixerStrip's expected layerState shape ──
  // The strip reads {opacity, blendMode, activeClip:{name}}. Build that
  // from our local layer on the fly.
  function strip(l: StandaloneLayer) {
    return {
      opacity: l.opacity,
      blendMode: l.blendMode,
      activeClip: layerDisplayName(l) ? { name: layerDisplayName(l)! } : null,
    };
  }
</script>

<svelte:window
  onpointermove={handleMapPointerMove}
  onpointerup={handleMapPointerUp}
  onpointercancel={handleMapPointerUp}
  onresize={updateStackSize}
/>

<input
  bind:this={mediaInput}
  type="file"
  accept="image/*,video/*"
  class="hidden-file"
  onchange={(e) => void handleMediaPicked(e)}
/>

<div
  class="vj-root"
  class:clean={cleanOutput}
  onpointerdown={onCanvasPointerDown}
  onpointerup={onCanvasPointerUp}
  onpointercancel={onCanvasPointerUp}
  role="presentation"
>
  <!-- Canvas stack (bottom = layer 0, top = layer N-1). Each layer's
       canvas applies its own opacity, mix-blend-mode, and CSS filter
       chain — that's the entire compositor. -->
  <div class="canvas-stack" bind:this={canvasStackEl}>
    {#each state.layers as l, i (l.id)}
      <canvas
        bind:this={canvases[i]}
        class="layer-canvas"
        style="
          z-index: {i};
          opacity: {l.enabled ? l.opacity : 0};
          mix-blend-mode: {l.blendMode};
          transform: {layerMapTransform(l)};
        "
      ></canvas>
    {/each}
    {#if tab === 'map' && !cleanOutput}
      {@const activeLayer = selectedMapLayer()}
      <div class="map-overlay" onpointerdown={(e) => e.stopPropagation()} role="presentation">
        <svg class="map-lines" viewBox={`0 0 ${stackW} ${stackH}`} preserveAspectRatio="none" aria-hidden="true">
          {#each state.layers as l, i (l.id)}
            {#if l.mapped || i === mapLayerIndex}
              <polygon
                class={i === mapLayerIndex ? 'active-map-poly' : ''}
                points={layerCornersPx(l).map(p => `${p.x},${p.y}`).join(' ')}
                style="--lc: {LAYER_COLORS[i % LAYER_COLORS.length]}"
              />
            {/if}
          {/each}
        </svg>
        {#each activeLayer.corners as corner, ci}
          <button
            class="map-corner"
            style="
              --lc: {LAYER_COLORS[mapLayerIndex % LAYER_COLORS.length]};
              left: {corner.x * 100}%;
              top: {corner.y * 100}%;
            "
            onpointerdown={(e) => handleMapCornerDown(mapLayerIndex, ci, e)}
            aria-label={`Move ${CORNER_LABELS[ci]} corner`}
          >
            {CORNER_LABELS[ci]}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Top bar -->
  <div class="top-bar">
    <span class="brand">Ghost Arcade</span>
    <div class="top-actions">
      {#if recSupported}
        <button
          class="top-btn rec"
          class:on={isRecording}
          onclick={(e) => { e.stopPropagation(); toggleRecording(); }}
          aria-label={isRecording ? 'Stop recording' : 'Record'}
        >
          {#if isRecording}● {Math.floor(recElapsed / 60)}:{String(Math.floor(recElapsed % 60)).padStart(2, '0')}
          {:else}● REC{/if}
        </button>
      {/if}
      <button class="top-btn" onclick={(e) => { e.stopPropagation(); showSettings = true; }} aria-label="Settings">⋯</button>
    </div>
  </div>

  <!-- Tab bar -->
  <div class="tab-bar">
    <button class="tab" class:active={tab === 'shaders'} onclick={(e) => { e.stopPropagation(); tab = 'shaders'; }}>Sources</button>
    <button class="tab" class:active={tab === 'fx'}      onclick={(e) => { e.stopPropagation(); tab = 'fx'; }}>FX</button>
    <button class="tab" class:active={tab === 'map'}     onclick={(e) => { e.stopPropagation(); tab = 'map'; updateStackSize(); }}>Map</button>
    <button class="tab" class:active={tab === 'mix'}     onclick={(e) => { e.stopPropagation(); tab = 'mix'; }}>Mix</button>
    <button class="tab" class:active={tab === 'ctrl'}    onclick={(e) => { e.stopPropagation(); tab = 'ctrl'; }}>Ctrl</button>
  </div>

  <!-- Panel -->
  <div class="panel" class:ctrl-panel={tab === 'ctrl'} onpointerdown={(e) => e.stopPropagation()}>
    {#if tab === 'shaders'}
      <div class="shader-list">
        {#each state.layers as l, i (l.id)}
          {@const name = layerDisplayName(l)}
          {@const kind = layerDisplayKind(l)}
          {@const hasSource = layerHasSource(l)}
          <div class="shader-row" style="--lc: {LAYER_COLORS[i % LAYER_COLORS.length]}">
            <span class="row-label">L{i + 1}</span>
            <button class="shader-pick" onclick={() => pickerForLayer = i}>
              {#if name && hasSource}
                <span class="pick-name">{name}</span>
                <span class="pick-cat">{kind}</span>
              {:else if l.sourceType === 'media' && l.mediaName}
                <span class="pick-name muted">{l.mediaName}</span>
                <span class="pick-cat">{l.mediaKind === 'camera' ? 'restart camera' : 're-import media'}</span>
              {:else}
                <span class="pick-empty">+ pick a source</span>
              {/if}
            </button>
            <div class="source-actions">
              <button
                class="row-source-btn"
                onclick={() => requestMediaForLayer(i)}
                aria-label="Import photo or video"
              >File</button>
              <button
                class="row-source-btn camera"
                onclick={() => void requestCameraForLayer(i)}
                aria-label={l.mediaKind === 'camera' ? 'Switch camera' : 'Start camera'}
              >{l.mediaKind === 'camera' && hasSource ? 'Flip' : 'Cam'}</button>
            </div>
            <button
              class="row-enable"
              class:on={l.enabled}
              onclick={() => setLayerEnabled(i, !l.enabled)}
              aria-pressed={l.enabled}
              disabled={!hasSource}
              aria-label={l.enabled ? 'Mute layer' : 'Unmute layer'}
            >{l.enabled ? '●' : '○'}</button>
            {#if hasSource || l.mediaName}
              <button class="row-stop" onclick={() => stopLayer(i)} aria-label="Remove source">✕</button>
            {/if}
          </div>
        {/each}
      </div>
    {:else if tab === 'fx'}
      <div class="fx-tab">
        {#each state.layers as l, i (l.id)}
          <div class="fx-layer-block" style="--lc: {LAYER_COLORS[i % LAYER_COLORS.length]}">
            <div class="fx-layer-head">
              <span class="row-label">L{i + 1}</span>
              <span class="fx-layer-name">{layerDisplayName(l) ?? '— empty —'}</span>
              <details class="fx-add-wrap">
                <summary class="fx-add-btn">+ FX</summary>
                <div class="fx-add-menu">
                  {#each getEffectDefList() as fx}
                    {@const already = l.effects.some(e => e.type === fx.type)}
                    <button
                      class="fx-add-row"
                      disabled={already}
                      onclick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; addLayerEffect(i, fx.type); }}
                    >
                      <span class="fx-add-cat">{fx.category}</span>
                      <span class="fx-add-label">{fx.label}</span>
                      {#if already}<span class="fx-add-meta">added</span>{/if}
                    </button>
                  {/each}
                </div>
              </details>
            </div>
            {#if l.effects.length === 0}
              <div class="fx-empty">No effects. Tap + FX to add one.</div>
            {:else}
              {#each l.effects as e (e.id)}
                {@const fx = findMobileEffect(e.type)}
                {#if fx}
                  {@const paramDefs = getEffectParamDefs(e.type)}
                  <div class="fx-row" class:disabled={!e.enabled}>
                    <div class="fx-row-head">
                      <button class="fx-bypass" class:on={e.enabled} onclick={() => toggleLayerEffect(i, e.id)} aria-label="Bypass">{e.enabled ? '●' : '○'}</button>
                      <span class="fx-name">{fx.label}</span>
                      <button class="fx-remove" onclick={() => removeLayerEffect(i, e.id)} aria-label="Remove">✕</button>
                    </div>
                    {#if paramDefs.length === 0}
                      <!-- Parameterless effect (e.g. invert) — bypass button is the whole control. -->
                    {:else}
                      <div class="fx-params">
                        {#each paramDefs as pd}
                          {@const cur = e.params[pd.param] ?? pd.default}
                          <label class="fx-param-row">
                            <span class="fx-param-name">{pd.name}</span>
                            <input
                              type="range"
                              min={pd.min}
                              max={pd.max}
                              step={pd.step}
                              value={cur}
                              oninput={(ev) => setLayerEffectParam(i, e.id, pd.param, Number((ev.target as HTMLInputElement).value))}
                            />
                            <span class="fx-param-value">{Number.isInteger(pd.step) ? cur.toFixed(0) : cur.toFixed(2)}</span>
                          </label>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}
              {/each}
            {/if}
          </div>
        {/each}
      </div>
    {:else if tab === 'map'}
      {@const l = selectedMapLayer()}
      <div class="map-tab">
        <div class="map-layer-strip">
          {#each state.layers as layer, i (layer.id)}
            <button
              class="map-layer-pill"
              class:active={i === mapLayerIndex}
              style="--lc: {LAYER_COLORS[i % LAYER_COLORS.length]}"
              onclick={() => setMapLayerIndex(i)}
            >
              <span>L{i + 1}</span>
              <small>{layer.mapped ? 'mapped' : 'flat'}</small>
            </button>
          {/each}
        </div>

        <div class="map-control-card" style="--lc: {LAYER_COLORS[mapLayerIndex % LAYER_COLORS.length]}">
          <div class="map-control-head">
            <div>
              <div class="map-title">Layer {mapLayerIndex + 1} mapping</div>
              <div class="map-subtitle">{layerDisplayName(l) ?? 'No source assigned'}</div>
            </div>
            <label class="map-switch">
              <input
                type="checkbox"
                checked={l.mapped}
                onchange={(e) => setLayerMapped(mapLayerIndex, (e.target as HTMLInputElement).checked)}
              />
              <span>{l.mapped ? 'On' : 'Off'}</span>
            </label>
          </div>

          <div class="map-presets">
            {#each MAP_PRESETS as preset}
              <button class="map-preset-btn" onclick={() => applyMapPreset(mapLayerIndex, preset.id)}>
                {preset.label}
              </button>
            {/each}
          </div>

          <label class="map-range">
            <span>Edge fade</span>
            <input
              type="range"
              min="0"
              max="0.35"
              step="0.005"
              value={l.edgeFeather}
              oninput={(e) => setLayerEdgeFeather(mapLayerIndex, Number((e.target as HTMLInputElement).value))}
            />
            <strong>{Math.round(l.edgeFeather * 100)}%</strong>
          </label>

          <div class="map-corner-grid">
            {#each l.corners as corner, ci}
              <label class="map-corner-row">
                <span>{CORNER_LABELS[ci]}</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={Math.round(corner.x * 1000) / 10}
                  oninput={(e) => updateLayerCorner(mapLayerIndex, ci, Number((e.target as HTMLInputElement).value) / 100, corner.y)}
                />
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={Math.round(corner.y * 1000) / 10}
                  oninput={(e) => updateLayerCorner(mapLayerIndex, ci, corner.x, Number((e.target as HTMLInputElement).value) / 100)}
                />
              </label>
            {/each}
          </div>

          <button class="map-reset-btn" onclick={() => resetLayerMapping(mapLayerIndex)}>
            Reset layer mapping
          </button>
        </div>
      </div>
    {:else if tab === 'ctrl'}
      <div class="ctrl-tab">
        <MobileSnapshotBank
          snapshots={state.snapshots}
          activeId={state.activeSnapshotId}
          onRecall={recallStandaloneSnapshot}
          onSave={saveStandaloneSnapshot}
          compact={true}
        />

        <div class="ctrl-layout-picker" aria-label="Controller surface">
          {#each CONTROLLER_SURFACES as surface (surface.id)}
            <button
              class="ctrl-layout-btn"
              class:active={controllerSurfaceId === surface.id}
              onclick={() => controllerSurfaceId = surface.id}
              aria-pressed={controllerSurfaceId === surface.id}
            >
              <span>{surface.short}</span>
            </button>
          {/each}
        </div>

        <div class="ctrl-surface-head">
          <div>
            <div class="ctrl-title">{activeControllerSurface.name}</div>
            <div class="ctrl-subtitle">{activeControllerSurface.description}</div>
          </div>
          <button class="ctrl-map-btn" onclick={() => showMidi = true}>MIDI / OSC</button>
        </div>

        {#if controllerSurfaceId === 'ghost'}
          <div class="ctrl-ghost-grid">
            {#each state.layers as layer, i (layer.id)}
              {@const opacityTarget = layerTarget(i, 'opacity')}
              {@const enabledTarget = layerTarget(i, 'enabled')}
              {@const mappedTarget = layerTarget(i, 'mapped')}
              {@const edgeTarget = layerTarget(i, 'edge')}
              {@const speedTarget = layerTarget(i, 'speed')}
              {@const intensityTarget = layerTarget(i, 'intensity')}
              {@const blendTarget = layerTarget(i, 'blend')}
              <div class="ctrl-channel" style="--lc: {LAYER_COLORS[i % LAYER_COLORS.length]}">
                <div class="ctrl-channel-head">
                  <span>L{i + 1}</span>
                  <small>{layerDisplayName(layer) ?? 'empty'}</small>
                </div>
                <label class="ctrl-fader">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.001"
                    value={controllerTargetValue(opacityTarget)}
                    oninput={(e) => setControllerTarget(opacityTarget, Number((e.target as HTMLInputElement).value))}
                  />
                </label>
                <div class="ctrl-pad-row">
                  <button class="ctrl-pad" class:on={controllerTargetOn(enabledTarget)} onclick={() => triggerControllerTarget(enabledTarget)}>On</button>
                  <button class="ctrl-pad" class:on={controllerTargetOn(mappedTarget)} onclick={() => triggerControllerTarget(mappedTarget)}>Map</button>
                  <button class="ctrl-pad" onclick={() => triggerControllerTarget(blendTarget)}>Blend</button>
                </div>
                <label class="ctrl-mini-range">
                  <span>Edge</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.001"
                    value={controllerTargetValue(edgeTarget)}
                    oninput={(e) => setControllerTarget(edgeTarget, Number((e.target as HTMLInputElement).value))}
                  />
                </label>
                <label class="ctrl-mini-range">
                  <span>Speed</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.001"
                    value={controllerTargetValue(speedTarget)}
                    oninput={(e) => setControllerTarget(speedTarget, Number((e.target as HTMLInputElement).value))}
                  />
                </label>
                <label class="ctrl-mini-range">
                  <span>Audio</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.001"
                    value={controllerTargetValue(intensityTarget)}
                    oninput={(e) => setControllerTarget(intensityTarget, Number((e.target as HTMLInputElement).value))}
                  />
                </label>
              </div>
            {/each}
          </div>

          <div class="ctrl-global-row">
            <button class="ctrl-pad global" class:on={micEnabled} onclick={() => triggerControllerTarget('micToggle')}>Mic</button>
            <button class="ctrl-pad global" class:on={cleanOutput} onclick={() => triggerControllerTarget('cleanOutput')}>Clean</button>
            <button class="ctrl-pad global rec" class:on={isRecording} onclick={() => triggerControllerTarget('autopilotToggle')}>Rec</button>
          </div>
        {:else if controllerSurfaceId === 'apc'}
          <div class="ctrl-apc">
            <div class="apc-grid">
              {#each state.layers as layer, i (layer.id)}
                {@const enabledTarget = layerTarget(i, 'enabled')}
                <button class="apc-pad green" class:on={controllerTargetOn(enabledTarget)} onclick={() => triggerControllerTarget(enabledTarget)}>
                  L{i + 1}
                </button>
              {/each}
              {#each state.layers as layer, i (layer.id)}
                {@const mappedTarget = layerTarget(i, 'mapped')}
                <button class="apc-pad amber" class:on={controllerTargetOn(mappedTarget)} onclick={() => triggerControllerTarget(mappedTarget)}>
                  Map
                </button>
              {/each}
              {#each state.layers as layer, i (layer.id)}
                {@const blendTarget = layerTarget(i, 'blend')}
                <button class="apc-pad blue" onclick={() => triggerControllerTarget(blendTarget)}>
                  Blend
                </button>
              {/each}
              <button class="apc-pad red" onclick={() => triggerControllerTarget('autopilotToggle')}>Rec</button>
              <button class="apc-pad cyan" onclick={() => triggerControllerTarget('micToggle')}>Mic</button>
              <button class="apc-pad white" onclick={() => triggerControllerTarget('cleanOutput')}>Clean</button>
              <button class="apc-pad red" onclick={stopAllLayers}>Stop</button>
            </div>
            <div class="apc-faders">
              {#each state.layers as layer, i (layer.id)}
                {@const opacityTarget = layerTarget(i, 'opacity')}
                <label class="apc-fader" style="--lc: {LAYER_COLORS[i % LAYER_COLORS.length]}">
                  <span>L{i + 1}</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.001"
                    value={controllerTargetValue(opacityTarget)}
                    oninput={(e) => setControllerTarget(opacityTarget, Number((e.target as HTMLInputElement).value))}
                  />
                </label>
              {/each}
            </div>
          </div>
        {:else if controllerSurfaceId === 'launchpad'}
          <div class="launch-grid">
            {#each state.layers as layer, i (layer.id)}
              {@const enabledTarget = layerTarget(i, 'enabled')}
              <button class="launch-pad layer" class:on={controllerTargetOn(enabledTarget)} style="--lc: {LAYER_COLORS[i % LAYER_COLORS.length]}" onclick={() => triggerControllerTarget(enabledTarget)}>
                L{i + 1}
              </button>
            {/each}
            {#each state.layers as layer, i (layer.id)}
              {@const mappedTarget = layerTarget(i, 'mapped')}
              <button class="launch-pad map" class:on={controllerTargetOn(mappedTarget)} onclick={() => triggerControllerTarget(mappedTarget)}>
                Map {i + 1}
              </button>
            {/each}
            {#each QUICK_BLEND_MODES as mode}
              <button class="launch-pad blend" onclick={() => state.layers.forEach((_, i) => setLayerBlendMode(i, mode))}>
                {mode}
              </button>
            {/each}
            <button class="launch-pad global" class:on={micEnabled} onclick={() => triggerControllerTarget('micToggle')}>Mic</button>
            <button class="launch-pad global" class:on={cleanOutput} onclick={() => triggerControllerTarget('cleanOutput')}>Clean</button>
            <button class="launch-pad global rec" class:on={isRecording} onclick={() => triggerControllerTarget('autopilotToggle')}>Rec</button>
            <button class="launch-pad global stop" onclick={stopAllLayers}>Stop</button>
          </div>
        {:else}
          <div class="nano-strip">
            {#each state.layers as layer, i (layer.id)}
              {@const opacityTarget = layerTarget(i, 'opacity')}
              {@const enabledTarget = layerTarget(i, 'enabled')}
              {@const mappedTarget = layerTarget(i, 'mapped')}
              {@const edgeTarget = layerTarget(i, 'edge')}
              {@const speedTarget = layerTarget(i, 'speed')}
              {@const intensityTarget = layerTarget(i, 'intensity')}
              {@const blendTarget = layerTarget(i, 'blend')}
              <div class="nano-channel" style="--lc: {LAYER_COLORS[i % LAYER_COLORS.length]}">
                <div class="nano-label">L{i + 1}</div>
                <label class="nano-knob">
                  <span>Edge</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.001"
                    value={controllerTargetValue(edgeTarget)}
                    oninput={(e) => setControllerTarget(edgeTarget, Number((e.target as HTMLInputElement).value))}
                  />
                </label>
                <label class="nano-knob">
                  <span>Speed</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.001"
                    value={controllerTargetValue(speedTarget)}
                    oninput={(e) => setControllerTarget(speedTarget, Number((e.target as HTMLInputElement).value))}
                  />
                </label>
                <label class="nano-knob">
                  <span>Audio</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.001"
                    value={controllerTargetValue(intensityTarget)}
                    oninput={(e) => setControllerTarget(intensityTarget, Number((e.target as HTMLInputElement).value))}
                  />
                </label>
                <div class="nano-buttons">
                  <button class:on={controllerTargetOn(enabledTarget)} onclick={() => triggerControllerTarget(enabledTarget)}>S</button>
                  <button class:on={controllerTargetOn(mappedTarget)} onclick={() => triggerControllerTarget(mappedTarget)}>M</button>
                  <button onclick={() => triggerControllerTarget(blendTarget)}>B</button>
                </div>
                <label class="nano-fader">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.001"
                    value={controllerTargetValue(opacityTarget)}
                    oninput={(e) => setControllerTarget(opacityTarget, Number((e.target as HTMLInputElement).value))}
                  />
                </label>
              </div>
            {/each}
          </div>
          <div class="ctrl-global-row">
            <button class="ctrl-pad global" class:on={micEnabled} onclick={() => triggerControllerTarget('micToggle')}>Mic</button>
            <button class="ctrl-pad global" class:on={cleanOutput} onclick={() => triggerControllerTarget('cleanOutput')}>Clean</button>
            <button class="ctrl-pad global rec" class:on={isRecording} onclick={() => triggerControllerTarget('autopilotToggle')}>Rec</button>
          </div>
        {/if}
      </div>
    {:else}
      <div class="mix-tab">
        {#each state.layers as l, i (l.id)}
          <div class="mix-layer-card" style="--lc: {LAYER_COLORS[i % LAYER_COLORS.length]}">
            <VJMixerStrip
              layerIndex={i}
              layerState={strip(l)}
              isTablet={false}
              compact={true}
              onOpacityChange={(idx, v) => setLayerOpacity(idx, v)}
              onBlendModeChange={(idx, v) => setLayerBlendMode(idx, v)}
              onStopLayer={(idx) => stopLayer(idx)}
            />
            <div class="performance-rack">
              <label class="performance-control">
                <span>Speed</span>
                <input
                  type="range"
                  min="0"
                  max="3"
                  step="0.01"
                  value={l.playbackSpeed}
                  oninput={(e) => setLayerPlaybackSpeed(i, Number((e.target as HTMLInputElement).value))}
                />
                <strong>{l.playbackSpeed.toFixed(2)}x</strong>
              </label>
              <label class="performance-control">
                <span>Audio</span>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.01"
                  value={l.audioIntensity}
                  oninput={(e) => setLayerAudioIntensity(i, Number((e.target as HTMLInputElement).value))}
                />
                <strong>{Math.round(l.audioIntensity * 100)}%</strong>
              </label>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Mic prompt — bottom-floating until enabled -->
  {#if !micEnabled}
    <button class="mic-prompt" onclick={(e) => { e.stopPropagation(); void enableMic(); }} disabled={micRequesting}>
      {micRequesting ? 'Enabling mic…' : '🎤 Enable mic for audio-reactive shaders'}
    </button>
  {/if}

	  {#if micError}<div class="banner banner-error">{micError}</div>{/if}
	  {#if recError}<div class="banner banner-error">{recError}</div>{/if}
	  {#if controllerMsg}<div class="banner banner-ok">{controllerMsg}</div>{/if}
	  {#if recDeliveringMsg}<div class="banner banner-ok">{recDeliveringMsg}</div>{/if}

  <!-- Shader picker (per layer) -->
  {#if pickerForLayer !== null}
    <StandaloneShaderPicker
      shaders={MOBILE_SHADERS}
      onPick={(s) => { setLayerShader(pickerForLayer!, s.id); pickerForLayer = null; }}
      onClose={() => pickerForLayer = null}
    />
  {/if}

  <!-- Settings sheet -->
  {#if showSettings}
    <div class="modal-bg" onclick={() => showSettings = false} role="presentation">
      <div class="modal-card settings-card" onclick={(e) => e.stopPropagation()} role="presentation">
	        <h2>Settings</h2>

        <div class="project-card">
          <label class="project-name-row">
            <span>Current show</span>
            <input
              type="text"
              value={state.projectName}
              oninput={(e) => setProjectName((e.target as HTMLInputElement).value)}
            />
          </label>
          <div class="project-actions">
            <button class="project-action-btn primary" onclick={saveCurrentShowToBank}>Save show</button>
            <button class="project-action-btn" onclick={newStandaloneShow}>New show</button>
          </div>

          {#if savedShows.length > 0}
            <div class="saved-show-list">
              {#each savedShows as show (show.id)}
                <div class="saved-show-row" class:current={show.id === state.projectId}>
                  <button class="saved-show-main" onclick={() => loadStandaloneShow(show.id)}>
                    <strong>{show.name}</strong>
                    <span>{formatShowDate(show.updatedAt)}{show.id === state.projectId ? ' · current' : ''}</span>
                  </button>
                  <button class="saved-show-delete" onclick={() => deleteStandaloneShow(show.id)} aria-label={`Delete ${show.name}`}>
                    ✕
                  </button>
                </div>
              {/each}
            </div>
          {:else}
            <div class="saved-show-empty">No saved shows yet.</div>
          {/if}
        </div>

	        <button class="row-btn" onclick={() => { showSettings = false; showMidi = true; }}>
	          MIDI / OSC controller{midiStatus === 'connected' && midiDevices.length ? ` · ${midiDevices[0]}` : ''}
	        </button>
        <button class="row-btn" onclick={() => { micEnabled ? disableMic() : void enableMic(); showSettings = false; }}>
          {micEnabled ? 'Disable mic' : 'Enable mic'}
        </button>
        <button class="row-btn" onclick={onSwitchMode}>Switch mode (Standalone / Remote)</button>
        <button class="close-x" onclick={() => showSettings = false} aria-label="Close">✕</button>
      </div>
    </div>
  {/if}

  <!-- MIDI sheet -->
  {#if showMidi}
    <div class="modal-bg" onclick={() => { showMidi = false; cancelLearn(); }} role="presentation">
      <div class="modal-card midi-card" onclick={(e) => e.stopPropagation()} role="presentation">
        <h2>MIDI / OSC controller</h2>
        <div class="controller-section">
          <h3>MIDI</h3>
          {#if midiStatus === 'unavailable'}
            <p class="midi-hint">Web MIDI isn't available in this browser. Try Chrome on Android, or the iOS Capacitor build.</p>
          {:else}
          <div class="midi-status">
            <span class="midi-dot midi-dot-{midiStatus}"></span>
            <span>
              {#if midiStatus === 'connected'}Connected{midiDevices.length ? ` · ${midiDevices.join(', ')}` : ''}
              {:else if midiStatus === 'requesting'}Requesting permission…
              {:else if midiStatus === 'denied'}Permission denied
              {:else if midiStatus === 'error'}Could not connect
              {:else}Not connected{/if}
            </span>
          </div>
          {#if midiStatus !== 'connected'}
            <button class="row-btn" onclick={() => void enableMidi()}>Enable MIDI</button>
          {:else}
            <button class="row-btn" onclick={disableMidi}>Disable MIDI</button>
          {/if}
          <div class="midi-preset-card">
            <label class="midi-preset-row">
              <span>Controller layout</span>
              <select
                value={state.midi?.presetId ?? DEFAULT_MIDI_PRESET_ID}
                onchange={(e) => selectMidiPreset((e.target as HTMLSelectElement).value)}
              >
                {#each MIDI_LAYOUT_PRESETS as p (p.id)}
                  <option value={p.id}>{p.name}</option>
                {/each}
                <option value={CUSTOM_MIDI_PRESET_ID}>Custom</option>
              </select>
            </label>
            <div class="midi-preset-copy">
              {#if currentMidiPreset}
                <strong>{currentMidiPreset.controller}</strong>
                <span>{currentMidiPreset.description}</span>
              {:else}
                <strong>Custom layout</strong>
                <span>MIDI Learn edits are stored here until another preset is selected.</span>
              {/if}
            </div>
          </div>
          {#if midiStatus === 'connected'}
            {#if learnTarget}
              <div class="midi-learn-banner">
                Move a control on your controller to map <strong>{controllerTargetLabel(learnTarget)}</strong>…
                <button class="learn-cancel" onclick={cancelLearn}>Cancel</button>
              </div>
            {/if}
            <div class="midi-binding-list">
              {#each controllerTargets as item (item.target)}
                {@const b = state.midi?.mappings[item.target]}
                <div class="midi-row" class:learning={learnTarget === item.target}>
                  <span class="midi-target">
                    <small>{item.group}</small>
                    {item.label}
                  </span>
                  <span class="midi-binding">
                    {#if b}{b.kind === 'cc' ? 'CC' : 'Note'} {b.num} · ch{b.channel + 1}{:else}<em>unbound</em>{/if}
                  </span>
                  <button class="midi-btn" onclick={() => startLearn(item.target)}>Learn</button>
                  <button class="midi-btn midi-btn-clear" onclick={() => clearBinding(item.target)} disabled={!b}>Clear</button>
                </div>
              {/each}
            </div>
            <button class="row-btn" onclick={resetMidiMappings}>Reset to defaults</button>
          {/if}
          {/if}
        </div>
        <div class="controller-section">
          <h3>OSC layout</h3>
          <div class="midi-status">
            <span class="midi-dot {oscStatus === 'listening' ? 'midi-dot-connected' : oscStatus === 'starting' ? 'midi-dot-requesting' : (oscStatus === 'error' || oscStatus === 'unavailable') ? 'midi-dot-error' : ''}"></span>
            <span>{oscStatusLabel()}{oscLastMessage ? ` · ${oscLastMessage}` : ''}</span>
          </div>
          <label class="midi-preset-row osc-port-row">
            <span>UDP port</span>
            <input
              type="number"
              min="1"
              max="65535"
              step="1"
              value={state.osc?.port ?? currentOscPreset.port}
              onchange={(e) => setOscPort(Number((e.target as HTMLInputElement).value))}
            />
          </label>
          {#if oscStatus === 'listening'}
            <button class="row-btn" onclick={() => void disableOsc()}>Disable OSC</button>
          {:else}
            <button class="row-btn" onclick={() => void enableOsc()} disabled={oscStatus === 'unavailable' || oscStatus === 'starting'}>
              Enable OSC
            </button>
          {/if}
          <div class="midi-preset-card">
            <label class="midi-preset-row">
              <span>Address map</span>
              <select
                value={state.osc?.presetId ?? DEFAULT_OSC_PRESET_ID}
                onchange={(e) => selectOscPreset((e.target as HTMLSelectElement).value)}
              >
                {#each OSC_LAYOUT_PRESETS as p (p.id)}
                  <option value={p.id}>{p.name}</option>
                {/each}
              </select>
            </label>
            <div class="midi-preset-copy">
              <strong>{currentOscPreset.controller}</strong>
              <span>{currentOscPreset.description}</span>
            </div>
          </div>
          <div class="osc-binding-list">
            {#each state.osc?.bindings ?? [] as b (b.address)}
              <div class="osc-row">
                <span class="osc-address">{b.address}</span>
                <span class="osc-target">{controllerTargetLabel(b.target)}{b.trigger ? ' · trig' : ''}</span>
              </div>
            {/each}
          </div>
          <button class="row-btn" onclick={() => void copyOscLayout()}>Copy OSC layout</button>
        </div>
        <button class="close-x" onclick={() => { showMidi = false; cancelLearn(); }} aria-label="Close">✕</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .vj-root {
    position: fixed;
    inset: 0;
    background: #000;
    color: #fff;
    overflow: hidden;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    display: flex;
    flex-direction: column;
  }
  .vj-root.clean > :not(.canvas-stack) { display: none !important; }
  .hidden-file { display: none; }

  .canvas-stack {
    position: absolute;
    inset: 0;
    /* Display area for layers — top half-ish above the panel.
       The layer canvases are absolutely positioned within. */
  }
  .layer-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
    transform-origin: 0 0;
    backface-visibility: hidden;
    transition: opacity 80ms linear;
  }
  .map-overlay {
    position: absolute;
    inset: 0;
    z-index: 20;
    pointer-events: none;
  }
  .map-lines {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .map-lines polygon {
    fill: color-mix(in srgb, var(--lc) 14%, transparent);
    stroke: color-mix(in srgb, var(--lc) 70%, white 30%);
    stroke-width: 1.5;
    stroke-dasharray: 8 5;
    vector-effect: non-scaling-stroke;
    opacity: 0.55;
  }
  .map-lines polygon.active-map-poly {
    fill: color-mix(in srgb, var(--lc) 20%, transparent);
    stroke: var(--lc);
    stroke-width: 2.5;
    stroke-dasharray: none;
    opacity: 0.95;
  }
  .map-corner {
    position: absolute;
    width: 42px;
    height: 42px;
    transform: translate(-50%, -50%);
    border-radius: 999px;
    border: 2px solid #050508;
    background: var(--lc);
    color: #050508;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.4px;
    pointer-events: auto;
    touch-action: none;
    box-shadow: 0 0 0 2px rgba(255,255,255,0.8), 0 10px 24px rgba(0,0,0,0.45);
  }
  .map-corner:active {
    transform: translate(-50%, -50%) scale(1.08);
  }

  /* Top bar */
  .top-bar {
    position: relative;
    z-index: 5;
    padding: env(safe-area-inset-top, 0px) 12px 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .brand { font-weight: 700; letter-spacing: 0.5px; font-size: 14px; opacity: 0.9; }
  .top-actions { display: flex; gap: 6px; }
  .top-btn {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #fff;
    border-radius: 14px;
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 600;
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
  .top-btn.rec { color: #FF6E6E; }
  .top-btn.rec.on {
    background: #FF6E6E;
    color: #1a1a1f;
    border-color: #FF6E6E;
    font-variant-numeric: tabular-nums;
    animation: rec-blink 1.4s ease-in-out infinite;
  }
  @keyframes rec-blink {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255, 110, 110, 0.5); }
    50%      { box-shadow: 0 0 0 8px rgba(255, 110, 110, 0); }
  }

  /* The panel + tab bar sit at the bottom 45% of screen so the
     canvas stack reads as the visual focus above. */
  .tab-bar {
    position: relative;
    z-index: 4;
    margin-top: auto;
    display: flex;
    gap: 4px;
    padding: 6px 10px 0;
    background: linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0));
  }
  .tab {
    flex: 1;
    background: rgba(0, 0, 0, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.7);
    padding: 8px 0;
    border-radius: 10px 10px 0 0;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .tab.active {
    background: rgba(20, 20, 26, 0.95);
    color: #fff;
    border-color: rgba(187, 134, 252, 0.5);
  }

  .panel {
    position: relative;
    z-index: 4;
    background: rgba(20, 20, 26, 0.95);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    padding: 10px 10px calc(env(safe-area-inset-bottom, 0px) + 14px);
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    max-height: 50vh;
    overflow-y: auto;
  }

  /* SHADERS tab */
  .shader-list { display: grid; gap: 8px; }
  .shader-row {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto auto auto;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-left: 3px solid var(--lc);
    border-radius: 10px;
    padding: 8px 10px;
  }
  .row-label {
    font-size: 12px;
    font-weight: 700;
    color: var(--lc);
    letter-spacing: 0.5px;
  }
  .shader-pick {
    background: transparent;
    border: none;
    color: #fff;
    text-align: left;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .pick-name { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pick-name.muted { color: rgba(255,255,255,0.48); }
  .pick-cat { font-size: 11px; color: rgba(255, 255, 255, 0.5); text-transform: uppercase; letter-spacing: 0.5px; }
  .pick-empty { font-size: 14px; color: rgba(255, 255, 255, 0.5); }
  .source-actions {
    display: flex;
    gap: 5px;
  }
  .row-source-btn {
    height: 30px;
    border-radius: 15px;
    background: rgba(105, 240, 174, 0.12);
    border: 1px solid rgba(105, 240, 174, 0.26);
    color: rgba(255,255,255,0.86);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    padding: 0 9px;
  }
  .row-source-btn.camera {
    background: rgba(103, 232, 249, 0.12);
    border-color: rgba(103, 232, 249, 0.28);
  }
  .row-source-btn:active { background: rgba(105, 240, 174, 0.22); }
  .row-source-btn.camera:active { background: rgba(103, 232, 249, 0.22); }
  .row-enable {
    width: 30px; height: 30px;
    border-radius: 15px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.45);
    font-size: 15px;
  }
  .row-enable.on { background: var(--lc); color: #1a1a1f; border-color: var(--lc); }
  .row-enable:disabled { opacity: 0.3; }
  .row-stop {
    width: 28px; height: 28px;
    border-radius: 14px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.6);
    font-size: 13px;
  }

  /* FX tab */
  .fx-tab { display: grid; gap: 10px; }
  .fx-layer-block {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-left: 3px solid var(--lc);
    border-radius: 10px;
    padding: 8px 10px;
  }
  .fx-layer-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .fx-layer-name {
    flex: 1;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.85);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fx-add-wrap { position: relative; }
  .fx-add-btn {
    list-style: none;
    cursor: pointer;
    background: rgba(187, 134, 252, 0.2);
    border: 1px solid rgba(187, 134, 252, 0.4);
    color: #fff;
    padding: 4px 10px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 600;
  }
  .fx-add-btn::-webkit-details-marker { display: none; }
  .fx-add-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 6;
    background: #1c1c24;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 4px;
    display: grid;
    gap: 2px;
    min-width: 140px;
  }
  .fx-add-row {
    background: transparent;
    border: none;
    color: #fff;
    text-align: left;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 13px;
  }
  .fx-add-row:active { background: rgba(255, 255, 255, 0.06); }
  .fx-add-row:disabled { opacity: 0.4; }
  .fx-empty {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.4);
    padding: 4px 0;
  }
  .fx-row {
    background: rgba(255, 255, 255, 0.02);
    border-radius: 8px;
    padding: 6px 8px;
    margin-top: 4px;
  }
  .fx-row.disabled { opacity: 0.5; }
  .fx-row.disabled .fx-name { color: rgba(255, 255, 255, 0.35); }
  .fx-row-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .fx-bypass {
    width: 22px; height: 22px;
    border-radius: 11px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.5);
    font-size: 13px;
    flex: 0 0 auto;
  }
  .fx-bypass.on { background: #69F0AE; color: #1a1a1f; border-color: #69F0AE; }
  .fx-name { font-size: 13px; font-weight: 600; flex: 1; }
  .fx-remove {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    font-size: 12px;
    flex: 0 0 auto;
  }
  .fx-params { display: grid; gap: 4px; margin-top: 6px; }
  .fx-param-row {
    display: grid;
    grid-template-columns: 80px 1fr 38px;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .fx-param-name { color: rgba(255, 255, 255, 0.65); }
  .fx-param-row input[type="range"] { width: 100%; accent-color: #BB86FC; }
  .fx-param-value {
    text-align: right;
    color: rgba(255, 255, 255, 0.65);
    font-variant-numeric: tabular-nums;
  }
  .fx-add-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .fx-add-cat {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.4);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    width: 48px;
  }
  .fx-add-label { flex: 1; }
  .fx-add-meta { font-size: 11px; color: rgba(255, 255, 255, 0.4); }

  /* MIX tab — stack of horizontal VJMixerStrip components */
  .mix-tab { display: grid; gap: 6px; }
  .mix-layer-card {
    display: grid;
    gap: 7px;
    padding: 7px;
    border: 1px solid rgba(255,255,255,0.07);
    border-left: 3px solid var(--lc);
    border-radius: 10px;
    background: rgba(255,255,255,0.035);
  }
  .performance-rack {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
  }
  .performance-control {
    min-width: 0;
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 48px;
    align-items: center;
    gap: 7px;
    color: rgba(255,255,255,0.66);
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }
  .performance-control input {
    width: 100%;
    accent-color: var(--lc);
  }
  .performance-control strong {
    color: var(--lc);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    text-align: right;
    text-transform: none;
  }

  /* MAP tab */
  .map-tab { display: grid; gap: 10px; }
  .map-layer-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }
  .map-layer-pill {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-bottom: 3px solid var(--lc);
    border-radius: 10px;
    color: rgba(255, 255, 255, 0.72);
    padding: 8px 6px 7px;
    display: grid;
    gap: 2px;
    text-align: center;
  }
  .map-layer-pill.active {
    background: color-mix(in srgb, var(--lc) 22%, rgba(255,255,255,0.04));
    border-color: color-mix(in srgb, var(--lc) 75%, white 25%);
    color: #fff;
  }
  .map-layer-pill span {
    font-size: 12px;
    font-weight: 800;
  }
  .map-layer-pill small {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(255,255,255,0.52);
  }
  .map-control-card {
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-left: 3px solid var(--lc);
    border-radius: 10px;
    padding: 10px;
    display: grid;
    gap: 10px;
  }
  .map-control-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .map-title {
    font-size: 13px;
    font-weight: 800;
  }
  .map-subtitle {
    margin-top: 2px;
    font-size: 11px;
    color: rgba(255,255,255,0.5);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }
  .map-switch {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 700;
    color: rgba(255,255,255,0.78);
  }
  .map-switch input { accent-color: var(--lc); }
  .map-presets {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }
  .map-preset-btn,
  .map-reset-btn {
    background: rgba(255, 255, 255, 0.055);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 9px;
    color: rgba(255, 255, 255, 0.88);
    padding: 9px 8px;
    font-size: 12px;
    font-weight: 700;
  }
  .map-preset-btn:active,
  .map-reset-btn:active {
    background: rgba(255,255,255,0.12);
  }
  .map-range {
    display: grid;
    grid-template-columns: 68px 1fr 42px;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: rgba(255,255,255,0.68);
  }
  .map-range input { width: 100%; accent-color: var(--lc); }
  .map-range strong {
    text-align: right;
    color: rgba(255,255,255,0.75);
    font-variant-numeric: tabular-nums;
  }
  .map-corner-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }
  .map-corner-row {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) minmax(0, 1fr);
    gap: 5px;
    align-items: center;
    font-size: 11px;
    color: rgba(255,255,255,0.68);
  }
  .map-corner-row input {
    min-width: 0;
    width: 100%;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(0,0,0,0.34);
    color: #fff;
    padding: 7px 6px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  /* CTRL tab */
  .panel.ctrl-panel {
    max-height: 62vh;
  }
  .ctrl-tab {
    display: grid;
    gap: 10px;
  }
  .ctrl-layout-picker {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }
  .ctrl-layout-btn {
    min-width: 0;
    height: 34px;
    border-radius: 9px;
    border: 1px solid rgba(255,255,255,0.09);
    background: rgba(255,255,255,0.035);
    color: rgba(255,255,255,0.68);
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }
  .ctrl-layout-btn.active {
    border-color: rgba(105, 240, 174, 0.55);
    background: rgba(105, 240, 174, 0.14);
    color: #fff;
  }
  .ctrl-surface-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
  }
  .ctrl-title {
    font-size: 13px;
    font-weight: 900;
  }
  .ctrl-subtitle {
    margin-top: 2px;
    color: rgba(255,255,255,0.5);
    font-size: 11px;
    line-height: 1.3;
  }
  .ctrl-map-btn {
    height: 34px;
    border-radius: 9px;
    border: 1px solid rgba(187, 134, 252, 0.45);
    background: rgba(187, 134, 252, 0.14);
    color: #fff;
    padding: 0 11px;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }
  .ctrl-ghost-grid,
  .nano-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  .ctrl-channel,
  .nano-channel {
    min-width: 0;
    background: rgba(255,255,255,0.035);
    border: 1px solid rgba(255,255,255,0.08);
    border-top: 3px solid var(--lc);
    border-radius: 10px;
    padding: 8px;
    display: grid;
    gap: 8px;
  }
  .ctrl-channel-head {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .ctrl-channel-head span,
  .nano-label {
    color: var(--lc);
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
  }
  .ctrl-channel-head small {
    min-width: 0;
    color: rgba(255,255,255,0.48);
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ctrl-fader input,
  .ctrl-mini-range input,
  .apc-fader input,
  .nano-knob input,
  .nano-fader input {
    width: 100%;
    accent-color: var(--lc, #69F0AE);
  }
  .ctrl-fader input {
    height: 28px;
  }
  .ctrl-mini-range {
    display: grid;
    gap: 3px;
    color: rgba(255,255,255,0.52);
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
  }
  .ctrl-pad-row,
  .ctrl-global-row,
  .nano-buttons {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 5px;
  }
  .ctrl-global-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .ctrl-pad,
  .apc-pad,
  .launch-pad,
  .nano-buttons button {
    min-width: 0;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 9px;
    background: rgba(255,255,255,0.055);
    color: rgba(255,255,255,0.72);
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ctrl-pad {
    height: 34px;
  }
  .ctrl-pad.on,
  .apc-pad.on,
  .launch-pad.on,
  .nano-buttons button.on {
    background: color-mix(in srgb, var(--lc, #69F0AE) 72%, #111 28%);
    border-color: color-mix(in srgb, var(--lc, #69F0AE) 84%, white 16%);
    color: #050508;
  }
  .ctrl-pad.global {
    --lc: #69F0AE;
    background: rgba(105, 240, 174, 0.1);
    border-color: rgba(105, 240, 174, 0.22);
  }
  .ctrl-pad.global.rec {
    --lc: #FF6E6E;
    background: rgba(255, 110, 110, 0.1);
    border-color: rgba(255, 110, 110, 0.22);
  }
  .ctrl-pad.global.on {
    background: var(--lc);
    color: #050508;
  }
  .ctrl-apc {
    display: grid;
    gap: 10px;
  }
  .apc-grid,
  .launch-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 7px;
  }
  .apc-pad,
  .launch-pad {
    min-height: 46px;
    aspect-ratio: 1.25;
  }
  .apc-pad.green { --lc: #69F0AE; }
  .apc-pad.amber { --lc: #FFC857; }
  .apc-pad.blue  { --lc: #4FC3F7; }
  .apc-pad.cyan  { --lc: #67E8F9; }
  .apc-pad.red   { --lc: #FF6E6E; }
  .apc-pad.white { --lc: #F4F4F5; }
  .apc-pad.green,
  .apc-pad.amber,
  .apc-pad.blue,
  .apc-pad.cyan,
  .apc-pad.red,
  .apc-pad.white {
    border-color: color-mix(in srgb, var(--lc) 32%, transparent);
    background: color-mix(in srgb, var(--lc) 12%, rgba(255,255,255,0.04));
  }
  .apc-faders {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  .apc-fader {
    display: grid;
    gap: 5px;
    color: var(--lc);
    font-size: 11px;
    font-weight: 900;
    text-align: center;
  }
  .launch-pad {
    min-height: 58px;
  }
  .launch-pad.layer { border-color: var(--lc); background: color-mix(in srgb, var(--lc) 14%, rgba(255,255,255,0.035)); }
  .launch-pad.map { --lc: #FFC857; }
  .launch-pad.blend { --lc: #BB86FC; }
  .launch-pad.global { --lc: #69F0AE; }
  .launch-pad.rec,
  .launch-pad.stop { --lc: #FF6E6E; }
  .launch-pad.map,
  .launch-pad.blend,
  .launch-pad.global {
    border-color: color-mix(in srgb, var(--lc) 34%, transparent);
    background: color-mix(in srgb, var(--lc) 12%, rgba(255,255,255,0.035));
  }
  .nano-channel {
    border-top-color: var(--lc);
  }
  .nano-label {
    text-align: center;
  }
  .nano-knob {
    display: grid;
    gap: 4px;
    color: rgba(255,255,255,0.52);
    font-size: 10px;
    font-weight: 900;
    text-align: center;
    text-transform: uppercase;
  }
  .nano-buttons button {
    height: 30px;
  }
  .nano-fader {
    display: block;
  }
  @media (min-width: 768px) {
    .panel.ctrl-panel {
      max-height: 56vh;
    }
    .ctrl-tab {
      max-width: 920px;
      margin: 0 auto;
    }
    .ctrl-pad,
    .nano-buttons button {
      height: 40px;
    }
    .apc-pad,
    .launch-pad {
      min-height: 64px;
    }
  }

  /* Mic prompt */
  .mic-prompt {
    position: absolute;
    top: 64px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 6;
    background: rgba(187, 134, 252, 0.95);
    color: #1a1a1f;
    border: none;
    padding: 10px 16px;
    border-radius: 22px;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 4px 20px rgba(187, 134, 252, 0.4);
  }
  .mic-prompt:active { transform: translateX(-50%) scale(0.97); }
  .mic-prompt:disabled { opacity: 0.6; }

  /* Banner */
  .banner {
    position: absolute;
    top: 64px;
    left: 12px;
    right: 12px;
    background: rgba(180, 50, 50, 0.92);
    color: #fff;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
    z-index: 8;
  }
  .banner-error { background: rgba(255, 110, 110, 0.92); }
  .banner-ok    { background: rgba(105, 240, 174, 0.92); color: #1a1a1f; font-weight: 600; }

  /* Modals */
  .modal-bg {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 20;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .modal-card {
    width: 100%;
    max-width: 460px;
    background: #14141a;
    border-top-left-radius: 18px;
    border-top-right-radius: 18px;
    padding: 18px 20px calc(env(safe-area-inset-bottom, 0px) + 24px);
    position: relative;
  }
  .settings-card {
    max-height: 86vh;
    overflow-y: auto;
  }
  .modal-card h2 { margin: 0 0 14px 0; font-size: 17px; }
  .project-card {
    display: grid;
    gap: 10px;
    margin: 0 0 12px;
    padding: 12px;
    background: rgba(255,255,255,0.035);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
  }
  .project-name-row {
    display: grid;
    gap: 6px;
  }
  .project-name-row span {
    color: rgba(255,255,255,0.58);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .project-name-row input {
    width: 100%;
    min-width: 0;
    background: rgba(0,0,0,0.34);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 9px;
    color: #fff;
    padding: 10px 11px;
    font-size: 15px;
    font-weight: 700;
  }
  .project-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .project-action-btn {
    min-width: 0;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 9px;
    color: rgba(255,255,255,0.78);
    padding: 10px;
    font-size: 13px;
    font-weight: 900;
    text-transform: uppercase;
  }
  .project-action-btn.primary {
    background: rgba(105, 240, 174, 0.16);
    border-color: rgba(105, 240, 174, 0.32);
    color: #69F0AE;
  }
  .saved-show-list {
    display: grid;
    gap: 6px;
  }
  .saved-show-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 36px;
    gap: 6px;
    align-items: stretch;
  }
  .saved-show-main,
  .saved-show-delete {
    min-width: 0;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(0,0,0,0.22);
    color: #fff;
    border-radius: 8px;
  }
  .saved-show-main {
    display: grid;
    gap: 2px;
    padding: 9px 10px;
    text-align: left;
  }
  .saved-show-main strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }
  .saved-show-main span,
  .saved-show-empty {
    color: rgba(255,255,255,0.42);
    font-size: 11px;
  }
  .saved-show-row.current .saved-show-main {
    border-color: rgba(105, 240, 174, 0.34);
    background: rgba(105, 240, 174, 0.08);
  }
  .saved-show-delete {
    display: grid;
    place-items: center;
    color: rgba(255, 110, 110, 0.82);
    font-size: 12px;
    font-weight: 900;
  }
  .saved-show-empty {
    padding: 6px 0 2px;
  }
  .row-btn {
    width: 100%;
    background: #1c1c24;
    border: 1px solid #2a2a30;
    color: #fff;
    padding: 14px;
    border-radius: 10px;
    text-align: left;
    margin-bottom: 8px;
    font-size: 15px;
  }
	  .row-btn:active { background: #25252e; }
	  .row-btn:disabled { opacity: 0.45; }
  .close-x {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 30px; height: 30px;
    border-radius: 15px;
    border: none;
    background: #1c1c24;
    color: #fff;
    font-size: 15px;
  }

	  /* MIDI sub-sheet */
	  .midi-card { max-height: 80vh; overflow-y: auto; }
	  .controller-section {
	    display: grid;
	    gap: 10px;
	    padding: 12px 0;
	    border-top: 1px solid rgba(255,255,255,0.08);
	  }
	  .controller-section:first-of-type {
	    border-top: 0;
	    padding-top: 0;
	  }
	  .controller-section h3 {
	    margin: 0;
	    color: rgba(255,255,255,0.78);
	    font-size: 12px;
	    font-weight: 800;
	    letter-spacing: 0.08em;
	    text-transform: uppercase;
	  }
	  .midi-hint { color: rgba(255, 255, 255, 0.55); font-size: 13px; line-height: 1.5; }
	  .midi-status {
	    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: #1c1c24;
    border-radius: 10px;
    margin-bottom: 12px;
    font-size: 13px;
  }
  .midi-dot { width: 8px; height: 8px; border-radius: 4px; background: #888; }
  .midi-dot-connected  { background: #69F0AE; }
  .midi-dot-requesting { background: #FFC857; animation: midi-pulse 1.2s infinite; }
  .midi-dot-denied, .midi-dot-error { background: #FF6E6E; }
  @keyframes midi-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
  .midi-preset-card {
    background: rgba(255,255,255,0.035);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    padding: 10px;
    margin: 0 0 12px;
    display: grid;
    gap: 8px;
  }
  .midi-preset-row {
    display: grid;
    grid-template-columns: 1fr 180px;
    gap: 10px;
    align-items: center;
    color: rgba(255,255,255,0.76);
    font-size: 13px;
    font-weight: 700;
  }
	  .midi-preset-row select {
	    min-width: 0;
	    width: 100%;
    border-radius: 9px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.34);
    color: #fff;
    padding: 9px 10px;
	    font-size: 13px;
	  }
	  .osc-port-row {
	    background: rgba(255,255,255,0.035);
	    border: 1px solid rgba(255,255,255,0.08);
	    border-radius: 12px;
	    padding: 10px;
	  }
	  .osc-port-row input {
	    min-width: 0;
	    width: 100%;
	    border-radius: 9px;
	    border: 1px solid rgba(255,255,255,0.12);
	    background: rgba(0,0,0,0.34);
	    color: #fff;
	    padding: 9px 10px;
	    font-size: 13px;
	    font-variant-numeric: tabular-nums;
	  }
  .midi-preset-copy {
    display: grid;
    gap: 3px;
    color: rgba(255,255,255,0.52);
    font-size: 12px;
    line-height: 1.35;
  }
  .midi-preset-copy strong {
    color: rgba(255,255,255,0.82);
    font-size: 12px;
  }
  .midi-learn-banner {
    background: rgba(187, 134, 252, 0.18);
    border: 1px solid #BB86FC;
    color: #fff;
    padding: 10px 12px;
    border-radius: 10px;
    margin-bottom: 10px;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .learn-cancel {
    margin-left: auto;
    background: transparent;
    border: 1px solid #BB86FC;
    color: #BB86FC;
    border-radius: 8px;
    padding: 4px 10px;
    font-size: 12px;
  }
  .midi-binding-list {
    display: grid;
    gap: 4px;
    margin: 10px 0 14px;
    max-height: 40vh;
    overflow-y: auto;
    padding-right: 2px;
  }
  .midi-row {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    background: #1c1c24;
    border-radius: 8px;
    font-size: 12px;
  }
  .midi-row.learning { background: rgba(187, 134, 252, 0.18); }
  .midi-target {
    display: grid;
    gap: 1px;
    min-width: 0;
    font-weight: 600;
  }
  .midi-target small {
    color: rgba(255, 255, 255, 0.38);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .midi-binding { color: rgba(255, 255, 255, 0.55); text-align: right; min-width: 84px; }
  .midi-binding em { color: #555; font-style: normal; }
  .midi-btn {
    background: #2a2a30;
    border: none;
    color: #fff;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12px;
	  }
	  .midi-btn-clear { background: transparent; color: rgba(255, 255, 255, 0.55); }
	  .midi-btn:disabled { opacity: 0.4; }
	  .osc-binding-list {
	    display: grid;
	    gap: 4px;
	    max-height: 220px;
	    overflow-y: auto;
	    padding-right: 2px;
	  }
	  .osc-row {
	    display: grid;
	    grid-template-columns: minmax(0, 1.25fr) minmax(108px, 0.75fr);
	    align-items: center;
	    gap: 8px;
	    padding: 7px 9px;
	    background: rgba(18, 38, 48, 0.72);
	    border: 1px solid rgba(72, 213, 255, 0.12);
	    border-radius: 8px;
	    font-size: 12px;
	  }
	  .osc-address {
	    min-width: 0;
	    overflow: hidden;
	    text-overflow: ellipsis;
	    white-space: nowrap;
	    color: #66D9EF;
	    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	  }
	  .osc-target {
	    min-width: 0;
	    overflow: hidden;
	    text-overflow: ellipsis;
	    white-space: nowrap;
	    color: rgba(255,255,255,0.66);
	    text-align: right;
	  }
	</style>
