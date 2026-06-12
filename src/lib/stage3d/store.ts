// Svelte store wrapping the active Stage3DScene. Single-instance — the
// 3D panel, the output window, and the Director all read/write the same
// scene state through this store.
//
// Persistence: scenes save to localStorage under per-project keys when
// the user hits Save (similar to existing compositions). Marketplace
// import/export goes through the same JSON shape.

import { writable, get } from 'svelte/store';
import type { Stage3DScene, Stage3DNode, StageLedScreenNode, Stage3DBasePreset, Stage3DScreenOverride, Stage3DVenue, Stage3DLighting, StageSceneryOverride, UserStageElement, Vec3 } from './types';
import { createEmptyScene, DEFAULT_LIGHTING } from './types';

const STORAGE_KEY = 'ga-stage3d-active-scene';

function loadFromStorage(): Stage3DScene {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.schemaVersion === 1) {
        return parsed as Stage3DScene;
      }
    }
  } catch { /* corrupt save — fall through to fresh */ }
  return createEmptyScene();
}

/** Bumps every time the undo stack changes. UI subscribes to refresh
 *  the enabled state of undo/redo buttons. */
export const historyVersion = writable<number>(0);

function createStore() {
  const { subscribe, set, update } = writable<Stage3DScene>(loadFromStorage());

  // Undo / redo history. snapshot() captures the current scene onto
  // `past` before any mutation; clears `future` because once you
  // diverge, the redo timeline is invalid. Deep-cloned via JSON to
  // avoid sharing mutable references with the live store.
  const past: Stage3DScene[] = [];
  const future: Stage3DScene[] = [];
  const MAX_HISTORY = 100;
  /** Coalesce window — repeated mutations within this many ms collapse
   *  to a single undo entry. Keeps slider drags from flooding history. */
  const COALESCE_MS = 400;
  let suppressSnapshot = false;
  let lastSnapshotAt = 0;
  function snapshot() {
    if (suppressSnapshot) return;
    const now = performance.now();
    if (now - lastSnapshotAt < COALESCE_MS) {
      // Coalesce: extend the current undo step instead of creating a new one.
      lastSnapshotAt = now;
      future.length = 0;
      return;
    }
    past.push(JSON.parse(JSON.stringify(get({ subscribe }))));
    if (past.length > MAX_HISTORY) past.shift();
    future.length = 0;
    lastSnapshotAt = now;
    historyVersion.update(v => v + 1);
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(get({ subscribe }))); } catch { /* private mode */ }
  }

  return {
    subscribe,

    /** Replace the entire scene (e.g. when loading a preset). */
    loadScene(scene: Stage3DScene) {
      snapshot();
      set(scene);
      persist();
    },

    /** Push a brand-new empty scene. */
    newScene() {
      snapshot();
      set(createEmptyScene());
      persist();
    },

    /** Undo the last mutation. No-op when history is empty. */
    undo() {
      if (past.length === 0) return;
      const current = JSON.parse(JSON.stringify(get({ subscribe })));
      const prev = past.pop()!;
      future.push(current);
      suppressSnapshot = true;
      set(prev);
      suppressSnapshot = false;
      persist();
      historyVersion.update(v => v + 1);
    },

    /** Redo the most recently undone mutation. */
    redo() {
      if (future.length === 0) return;
      const current = JSON.parse(JSON.stringify(get({ subscribe })));
      const next = future.pop()!;
      past.push(current);
      suppressSnapshot = true;
      set(next);
      suppressSnapshot = false;
      persist();
      historyVersion.update(v => v + 1);
    },

    /** Snapshot counts — drives undo/redo button enabled state in UI. */
    getHistoryCounts(): { past: number; future: number } {
      return { past: past.length, future: future.length };
    },

    addNode(node: Stage3DNode) {
      update(s => ({ ...s, nodes: [...s.nodes, node] }));
      persist();
    },

    updateNode(id: string, patch: Partial<Stage3DNode>) {
      update(s => ({
        ...s,
        nodes: s.nodes.map(n => n.id === id ? ({ ...n, ...patch } as Stage3DNode) : n),
      }));
      persist();
    },

    /** Update a LED-screen node specifically (keeps the discriminated
     *  union narrow so callers don't have to cast). */
    updateLedScreen(id: string, patch: Partial<StageLedScreenNode>) {
      update(s => ({
        ...s,
        nodes: s.nodes.map(n => n.id === id && n.type === 'led-screen'
          ? ({ ...n, ...patch } as StageLedScreenNode)
          : n),
      }));
      persist();
    },

    removeNode(id: string) {
      update(s => ({ ...s, nodes: s.nodes.filter(n => n.id !== id) }));
      persist();
    },

    setCamera(camera: Stage3DScene['camera']) {
      update(s => ({ ...s, camera }));
      persist();
    },

    setEnvironment(env: Partial<Stage3DScene['environment']>) {
      update(s => ({ ...s, environment: { ...s.environment, ...env } }));
      persist();
    },

    setName(name: string) {
      update(s => ({ ...s, name }));
      persist();
    },

    /** Pick the venue scenery — Festival / Arena / Club / Conference / Empty.
     *  Affects only platform / truss / ceiling / floor; LED layout still
     *  comes from the project's screen layers. */
    setBasePreset(preset: Stage3DBasePreset) {
      update(s => ({ ...s, basePreset: preset }));
      persist();
    },

    /** Apply a per-screen 3D override (position/rotation/scale plus
     *  visual tweaks). Pass a partial to merge with the existing
     *  override; pass `null` to clear it and return the LED to its
     *  auto-derived default. */
    setScreenOverride(layerId: string, override: Partial<Stage3DScreenOverride> | null) {
      snapshot();
      update(s => {
        const overrides = { ...(s.screenOverrides ?? {}) };
        if (override === null) {
          delete overrides[layerId];
        } else {
          overrides[layerId] = { ...(overrides[layerId] ?? {}), ...override };
        }
        return { ...s, screenOverrides: overrides };
      });
      persist();
    },

    /** Clear ALL per-screen overrides — returns every LED to its auto-
     *  derived layout. Useful after big Stage Designer changes. */
    clearScreenOverrides() {
      snapshot();
      update(s => ({ ...s, screenOverrides: {} }));
      persist();
    },

    /** Pick the venue preset (festival/arena/club/nightclub). Replaces
     *  the existing scenery wholesale — keeps user-placed elements. */
    setVenue(venue: Stage3DVenue) {
      snapshot();
      update(s => ({ ...s, venue }));
      persist();
    },

    addUserElement(element: UserStageElement) {
      snapshot();
      update(s => ({ ...s, userElements: [...(s.userElements ?? []), element] }));
      persist();
    },

    updateUserElement(id: string, patch: Partial<UserStageElement>) {
      snapshot();
      update(s => ({
        ...s,
        userElements: (s.userElements ?? []).map(el =>
          el.id === id ? { ...el, ...patch, params: { ...el.params, ...(patch.params ?? {}) } } : el,
        ),
      }));
      persist();
    },

    /** Patch only the element's params (the per-type field bag). Keeps
     *  transforms intact. */
    updateUserElementParams(id: string, params: Record<string, number | string>) {
      snapshot();
      update(s => ({
        ...s,
        userElements: (s.userElements ?? []).map(el =>
          el.id === id ? { ...el, params: { ...el.params, ...params } } : el,
        ),
      }));
      persist();
    },

    setUserElementTransform(id: string, transform: { position?: Vec3; rotationY?: number; scale?: number }) {
      snapshot();
      update(s => ({
        ...s,
        userElements: (s.userElements ?? []).map(el =>
          el.id === id ? { ...el, ...transform } : el,
        ),
      }));
      persist();
    },

    removeUserElement(id: string) {
      snapshot();
      update(s => ({ ...s, userElements: (s.userElements ?? []).filter(el => el.id !== id) }));
      persist();
    },

    clearUserElements() {
      snapshot();
      update(s => ({ ...s, userElements: [] }));
      persist();
    },

    /** Patch the scene's lighting overrides. Pass a partial to merge;
     *  the renderer applies these on top of the venue's baseline. */
    setLighting(patch: Partial<Stage3DLighting>) {
      snapshot();
      update(s => ({
        ...s,
        lighting: { ...DEFAULT_LIGHTING, ...(s.lighting ?? {}), ...patch },
      }));
      persist();
    },

    /** Reset lighting overrides back to neutral. */
    resetLighting() {
      snapshot();
      update(s => ({ ...s, lighting: { ...DEFAULT_LIGHTING } }));
      persist();
    },

    /** Patch a scenery piece's transform / deletion override. Pass null
     *  to restore the venue baseline for that piece. */
    setSceneryOverride(sceneryId: string, patch: Partial<StageSceneryOverride> | null) {
      snapshot();
      update(s => {
        const overrides = { ...(s.sceneryOverrides ?? {}) };
        if (patch === null) {
          delete overrides[sceneryId];
        } else {
          overrides[sceneryId] = { ...(overrides[sceneryId] ?? {}), ...patch };
        }
        return { ...s, sceneryOverrides: overrides };
      });
      persist();
    },

    /** Restore every scenery piece to its venue baseline. */
    clearSceneryOverrides() {
      snapshot();
      update(s => ({ ...s, sceneryOverrides: {} }));
      persist();
    },

    /** Export the active scene as a `.stage.json` blob — used by the
     *  marketplace-export action + the Save As flow. */
    exportJSON(): string {
      return JSON.stringify(get({ subscribe }), null, 2);
    },

    /** Import a `.stage.json` blob. Returns true on schema-validated
     *  success, false if the file isn't a valid stage scene. */
    importJSON(text: string): boolean {
      try {
        const parsed = JSON.parse(text);
        if (parsed?.schemaVersion === 1 && Array.isArray(parsed.nodes)) {
          snapshot();
          set(parsed as Stage3DScene);
          persist();
          return true;
        }
      } catch { /* fall through */ }
      return false;
    },
  };
}

export const stage3dScene = createStore();

/** Cross-component selection state for the 3D scene. The raycaster in
 *  Stage3DRenderer writes to this when the user clicks a node; the
 *  Svelte properties panel reads from it to know which node to show.
 *  String form: `screen:<layerId>` for an auto-built LED, or
 *  `element:<elementId>` for a user-placed library element. */
export const selectedStage3DNodeId = writable<string | null>(null);

/** Multi-selection set. Shift-click in the 3D view adds/removes from
 *  this; plain click resets to a single selection. The renderer
 *  attaches the gizmo to whichever target `selectedStage3DNodeId`
 *  names and broadcasts the same delta to every other entry in this
 *  set — so multi-drag, multi-rotate, and multi-scale all work as
 *  one transform. */
export const selectedStage3DTargets = writable<Set<string>>(new Set());

/** Programmatic selection setter — kept in sync with both stores +
 *  triggers the renderer's pivot/gizmo machinery via the controls bus.
 *  Use this from Svelte components instead of touching the stores
 *  directly so multi-select state stays consistent. */
export function setStage3DSelection(target: string | null): void {
  selectedStage3DNodeId.set(target);
  selectedStage3DTargets.set(target ? new Set([target]) : new Set());
}

/** Toggle a target in the multi-select set without dropping anything
 *  else. Used by the sidebar scene-tree shift-click and the
 *  "Select all screens" button. */
export function toggleStage3DSelection(target: string): void {
  const current = new Set(getStore(selectedStage3DTargets));
  if (current.has(target)) {
    current.delete(target);
    // If we removed the primary, fall back to any remaining.
    if (getStore(selectedStage3DNodeId) === target) {
      const remaining = [...current];
      selectedStage3DNodeId.set(remaining[remaining.length - 1] ?? null);
    }
  } else {
    current.add(target);
    selectedStage3DNodeId.set(target);
  }
  selectedStage3DTargets.set(current);
}

/** Replace the entire selection set, leaving the most-recently-clicked
 *  target as primary. */
export function setStage3DMultiSelection(targets: string[]): void {
  selectedStage3DTargets.set(new Set(targets));
  selectedStage3DNodeId.set(targets[targets.length - 1] ?? null);
}

// Helper so the toggle function above doesn't have to import { get } from svelte
// twice — re-export for ergonomics.
function getStore<T>(store: { subscribe: (run: (v: T) => void) => () => void }): T {
  let value!: T;
  const unsub = store.subscribe(v => { value = v; });
  unsub();
  return value;
}

export function parseSelection(sel: string | null):
  | { kind: 'screen'; id: string }
  | { kind: 'element'; id: string }
  | { kind: 'scenery'; id: string }
  | null {
  if (!sel) return null;
  const idx = sel.indexOf(':');
  if (idx < 0) return { kind: 'screen', id: sel }; // legacy entries (raw layer id)
  const kind = sel.slice(0, idx);
  const id = sel.slice(idx + 1);
  if (kind === 'screen' || kind === 'element' || kind === 'scenery') return { kind, id };
  return null;
}

/** Current TransformControls mode driven by keyboard shortcuts in the
 *  3D viewport (G = translate, R = rotate, S = scale). Persisted in
 *  memory only — resets to translate on app reload. */
export const stage3DGizmoMode = writable<'translate' | 'rotate' | 'scale'>('translate');

/** Renderer-control bus: the Stage3DRenderer registers its own
 *  camera/snap methods here when constructed; the Stage3DDesigner UI
 *  reads them for the top-bar buttons. Decouples the Svelte panel from
 *  the renderer instance (which lives inside Canvas.svelte). */
export interface Stage3DRendererControls {
  frameCamera: () => void;
  topCamera: () => void;
  setSnap: (on: boolean) => void;
  reload: () => void;
  /** Current live camera (position / orbit target / fov) — captured by
   *  the Demo Reel's Save Shot. */
  getCameraState: () => { position: Vec3; target: Vec3; fov: number };
  /** Drive the camera explicitly (Demo Reel playback / offline reel
   *  render). While driven, OrbitControls input + damping are bypassed
   *  so shot interpolation is exact. Call releaseCamera() to hand the
   *  camera back to the user. */
  setCameraState: (s: { position: Vec3; target: Vec3; fov: number }) => void;
  releaseCamera: () => void;
  /** One-shot capture of the next rendered 3D frame (top-down RGBA).
   *  Reads the default framebuffer synchronously right after the scene
   *  render — the only reliable window with preserveDrawingBuffer off. */
  captureFrame: () => Promise<{ data: Uint8Array; width: number; height: number }>;
}
export const stage3DRendererControls = writable<Stage3DRendererControls | null>(null);

/** Venue scenery pieces discovered by the renderer when it builds a
 *  venue, published here so the Stage3DDesigner tree can list them and
 *  let the user select / move / hide individual defaults — exactly like
 *  user-placed elements. The renderer owns the THREE objects, so it's
 *  the source of truth for which pieces exist in the current venue. */
export interface Stage3DSceneryItem {
  id: string;
  label: string;
}
export const stage3DSceneryList = writable<Stage3DSceneryItem[]>([]);

/** Turn a raw scenery id ("mover-front-0", "tower-front-L", "pa-L")
 *  into a friendly, title-cased label ("Mover Front 1", "Tower Front L",
 *  "PA L"). Numeric trailing segments are 1-indexed for display. */
export function sceneryLabel(id: string): string {
  const ACRONYMS = new Set(['pa', 'par', 'dj', 'led']);
  return id.split(/[-_]/).map((part, _i, arr) => {
    // 1-index a purely-numeric trailing segment.
    if (/^\d+$/.test(part) && arr.length > 1) return String(parseInt(part, 10) + 1);
    if (part.length <= 2) return part.toUpperCase();            // L / R / 3D
    if (ACRONYMS.has(part.toLowerCase())) return part.toUpperCase();
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join(' ');
}

export function generateNodeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
