import { writable } from 'svelte/store';
import type { Project } from '../types';

// Maximum number of undo states to keep
const MAX_HISTORY_SIZE = 50;

// ============================================================================
// SAFE CLONING — strips non-serializable runtime refs (textures, DOM elements)
// then re-hydrates them from the live project after restore.
// ============================================================================

// Fields by name that always hold non-serializable runtime references
// (GPU textures, DOM elements, canvases). Stripped before JSON.stringify.
const RUNTIME_KEYS = new Set([
  'texture', 'videoElement', 'iframeElement', 'threejsCanvas',
  'synthVisionCanvas',
]);

// Does this value look like something we must NOT hand to JSON.stringify?
// JSON.stringify invokes obj.toJSON() BEFORE calling any replacer — so a
// replacer cannot suppress THREE.Texture.toJSON()'s internal
// "Unable to serialize Texture." console.error. We have to strip these
// BEFORE stringify ever sees them.
function isRuntimeRef(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as { isTexture?: boolean; isRenderTarget?: boolean; isWebGLRenderTarget?: boolean };
  if (v.isTexture === true) return true;
  if (v.isRenderTarget === true || v.isWebGLRenderTarget === true) return true;
  if (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) return true;
  if (typeof HTMLVideoElement !== 'undefined' && value instanceof HTMLVideoElement) return true;
  if (typeof HTMLIFrameElement !== 'undefined' && value instanceof HTMLIFrameElement) return true;
  if (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas) return true;
  if (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) return true;
  return false;
}

// Build a sanitized deep copy of `value`, omitting RUNTIME_KEYS by name and
// any runtime refs detected by shape/type. Cycle protection uses a recursion-
// stack set (push on enter, pop on exit) so it ONLY rejects true back-edges,
// never sibling re-uses of the same reference.
//
// Why the recursion-stack matters: project state has lots of shared refs
// across siblings — every light-painting stroke spread-copies the same
// `currentBrush` object, so all strokes' `brush.color` points at the SAME
// [r,g,b] array. The previous implementation used a global WeakSet and
// returned `undefined` the second time it saw any reference, so only the
// first stroke survived an undo round-trip — strokes 2..N came back with
// `brush.color = null` / missing fields, and the renderer threw
// `Cannot read properties of null (reading 'x')` once Canvas re-rendered.
// ============================================================================
// LARGE STRINGS — an embedded 3D model or image (a data URL of many MB) is
// kept once and referenced from each step. Steps are JSON strings, so it was
// otherwise copied into all fifty of them: each edit re-serialised it and the
// history held gigabytes.
// ============================================================================

const LARGE_STRING = 64 * 1024;
const LARGE_REF = '\u0000ga-large:';
const largeById = new Map<number, string>();
const idByLarge = new Map<string, number>();
let nextLargeId = 1;
/** Ids interned by the serialisation in progress. */
let largeInUse: Set<number> | null = null;

function internLarge(value: string): string {
  let id = idByLarge.get(value);
  if (id === undefined) {
    id = nextLargeId++;
    idByLarge.set(value, id);
    largeById.set(id, value);
  }
  largeInUse?.add(id);
  return LARGE_REF + id;
}

/** Put the large strings back into a parsed step, in place. */
function restoreLarge(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.startsWith(LARGE_REF) ? (largeById.get(Number(value.slice(LARGE_REF.length))) ?? value) : value;
  }
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = restoreLarge(value[i]);
  } else {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) record[key] = restoreLarge(record[key]);
  }
  return value;
}

/** Forget large strings no step refers to any more. */
function pruneLarge(entries: Iterable<HistoryEntry | null>): void {
  if (largeById.size === 0) return;
  const keep = new Set<number>();
  for (const entry of entries) for (const id of entry?.large ?? []) keep.add(id);
  for (const [id, value] of largeById) {
    if (keep.has(id)) continue;
    largeById.delete(id);
    idByLarge.delete(value);
  }
}

function sanitize(value: unknown, ancestors: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string') return (value as string).length >= LARGE_STRING ? internLarge(value as string) : value;
  if (t === 'number' || t === 'boolean') return value;
  if (t === 'function' || t === 'symbol' || t === 'bigint') return undefined;
  if (t !== 'object') return undefined;

  if (isRuntimeRef(value)) return undefined;

  const obj = value as object;
  // Recursion-stack cycle guard: if this object is one of our ancestors in
  // the current branch, we're cycling — drop it. Sibling re-uses are fine.
  if (ancestors.has(obj)) return undefined;
  ancestors.add(obj);

  let out: unknown;
  if (Array.isArray(value)) {
    const arr: unknown[] = [];
    for (const item of value) {
      const s = sanitize(item, ancestors);
      arr.push(s === undefined ? null : s);
    }
    out = arr;
  } else {
    const src = value as Record<string, unknown>;
    const obj2: Record<string, unknown> = {};
    for (const key of Object.keys(src)) {
      if (RUNTIME_KEYS.has(key)) continue;
      const s = sanitize(src[key], ancestors);
      if (s !== undefined) obj2[key] = s;
    }
    out = obj2;
  }

  ancestors.delete(obj); // pop on exit so siblings can re-traverse
  return out;
}

/**
 * The output-stage geometry a step carries: the Screens (crop, warp, masks)
 * and the Master Warp, keyed as in settings.output. See
 * settings.captureOutputHistory for what is in and what stays out.
 */
export type OutputHistoryState = Record<string, unknown>;

/**
 * A single undo step.
 *
 * Keyframe timelines live in their own store (stores/keyframeTimeline.ts), not
 * inside `Project` — the project only gains a `keyframeTimelines` field at
 * save time. So snapshotting the project alone left every keyframe edit
 * outside undo entirely. Each step carries both, and undo/redo restore them
 * together so a keyframe and the layer edit beside it unwind as one action.
 *
 * Screens and the Master Warp are the same story: they live in settings
 * (the per-frame output path reads them there) but belong to the project,
 * so a screen crop drag, a mask edit and a Master Warp drag were outside
 * undo. Each step now carries them too, on the one shared timeline, so a
 * mask edit and the layer edit after it unwind in the order they happened.
 */
export interface HistorySnapshot {
  project: Project;
  /** Output of keyframeTimeline.exportAll(); null when nothing is keyframed. */
  keyframes: unknown;
  /** Screens + Master Warp at this step; null if the step was recorded
   *  without them. */
  output: OutputHistoryState | null;
  /** The output state of the step being left. The caller restores only the
   *  keys that differ between the two, so a step that never touched the
   *  screens leaves them exactly as they are live. */
  leavingOutput: OutputHistoryState | null;
}

/**
 * Serialize a snapshot for history. sanitize() strips all runtime refs
 * (textures, DOM elements) BEFORE JSON.stringify sees them, so no toJSON()
 * hooks run — avoiding the "Unable to serialize Texture." flood that
 * otherwise starves the renderer when VJ clips hold live textures.
 */
function serializeSnapshot(project: Project, keyframes: unknown, output: OutputHistoryState | null): { json: string; large: number[] } {
  largeInUse = new Set();
  try {
    const json = JSON.stringify({ project: sanitize(withoutViewState(project)), keyframes: sanitize(keyframes), output: sanitize(output) });
    return { json, large: [...largeInUse] };
  } finally {
    largeInUse = null;
  }
}

/**
 * Which layer is selected and which groups are folded open are how the
 * editor is being looked at, not edits. They stay out of every step: a step
 * that differed only in them would be an undo that does nothing visible, and
 * restoring them made undo jump the selection back to whatever was selected
 * when the step was recorded. Undo keeps the live selection instead (see
 * mergeProjectStep).
 */
function withoutViewState(project: Project): Project {
  if (!project || typeof project !== 'object') return project;
  const out: Record<string, unknown> = { ...(project as unknown as Record<string, unknown>) };
  delete out.selectedLayerId;
  if (Array.isArray(project.layers)) {
    out.layers = project.layers.map((layer) => {
      if (!layer || typeof layer !== 'object') return layer;
      const hasTransport = !!layer.source && SOURCE_TRANSPORT_KEYS.some((key) => key in layer.source!);
      if (!('groupCollapsed' in layer) && !hasTransport) return layer;
      const { groupCollapsed: _collapsed, ...rest } = layer;
      if (hasTransport) {
        const source: Record<string, unknown> = { ...(layer.source as unknown as Record<string, unknown>) };
        for (const key of SOURCE_TRANSPORT_KEYS) delete source[key];
        (rest as Record<string, unknown>).source = source;
      }
      return rest;
    });
  }
  return out as unknown as Project;
}

/**
 * Playback state on a layer's media: whether it is playing and where the
 * native decoder's clock is anchored. Pressing play or scrubbing is not an
 * edit, so it is not part of a step, and an undo keeps the live transport
 * (re-attached by source id, like the runtime references).
 */
const SOURCE_TRANSPORT_KEYS = [
  'isPlaying',
  '_nativePlaybackDirection',
  '_nativePlaybackTimeSeconds',
  '_nativePlaybackUpdatedAtMs',
  '_nativePlaybackSeekSeq',
  '_nativeLaunchPreparation',
  '_lastFrameTime',
  '_timelapseFrame',
  '_timelapseTotalFrames',
] as const;

/** A step's state. `withLarge: false` leaves large strings as references
 *  (enough to compare two steps, and much cheaper). */
function parseSnapshot(json: string, withLarge = true): { project: Project; keyframes: unknown; output: OutputHistoryState | null } {
  const parsed = JSON.parse(json) as { project: Project; keyframes: unknown; output?: OutputHistoryState | null };
  if (withLarge && json.includes('\\u0000ga-large:')) restoreLarge(parsed);
  return { project: parsed.project, keyframes: parsed.keyframes ?? null, output: parsed.output ?? null };
}

/** Re-attach the runtime references (textures, video elements) of the live
 *  layer whose source has the same id. */
function hydrateLayer(layer: Project['layers'][number], liveSources: Map<string, Record<string, unknown>>) {
  if (layer?.source) {
    const refs = liveSources.get(layer.source.id);
    if (refs) Object.assign(layer.source, refs);
  }
  return layer;
}

function liveSourceRefs(live: Project): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const layer of live?.layers ?? []) {
    if (!layer?.source) continue;
    const refs: Record<string, unknown> = {};
    for (const key of [...RUNTIME_KEYS, ...SOURCE_TRANSPORT_KEYS]) {
      const val = (layer.source as any)[key];
      if (val !== undefined) refs[key] = val;
    }
    if (Object.keys(refs).length > 0) map.set(layer.source.id, refs);
  }
  return map;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The project an undo or redo should leave live: the step's state for what
 * the step changed, the live state for everything else.
 *
 * `to` is the step being moved to and `from` the step being left. A layer
 * (or a project field) that is the same in both was not touched by this step,
 * so the live one is kept as it is. Replacing the whole project instead made
 * an undo also revert whatever had changed without being recorded since: a
 * MIDI fader, a show-control fade, a value an automation was sweeping. The
 * live selection is kept when the selected layer still exists; otherwise the
 * selection the step was recorded with is used.
 */
export function mergeProjectStep(
  live: Project,
  to: Project,
  from: Project | null,
  stepSelection: string | null = null,
): Project {
  const liveSources = liveSourceRefs(live);
  const liveRecord = (live ?? {}) as unknown as Record<string, unknown>;
  const toRecord = to as unknown as Record<string, unknown>;
  const fromRecord = (from ?? null) as unknown as Record<string, unknown> | null;
  const out: Record<string, unknown> = {};

  const keys = new Set([...Object.keys(liveRecord), ...Object.keys(toRecord), ...Object.keys(fromRecord ?? {})]);
  keys.delete('layers');
  keys.delete('selectedLayerId');
  for (const key of keys) {
    const inStep = key in toRecord || (fromRecord !== null && key in fromRecord);
    if (!inStep) {
      out[key] = liveRecord[key];
    } else if (fromRecord && sameJson(toRecord[key], fromRecord[key]) && key in liveRecord) {
      out[key] = liveRecord[key];
    } else if (key in toRecord) {
      out[key] = toRecord[key];
    }
  }

  const liveLayers = new Map((live?.layers ?? []).map((layer) => [layer.id, layer]));
  const fromLayers = new Map((from?.layers ?? []).map((layer) => [layer.id, layer]));
  const layers = (to.layers ?? []).map((layer) => {
    const liveLayer = liveLayers.get(layer.id);
    const fromLayer = fromLayers.get(layer.id);
    if (liveLayer && fromLayer && sameJson(layer, fromLayer)) return liveLayer;
    const restored = hydrateLayer(layer, liveSources);
    if (liveLayer && 'groupCollapsed' in liveLayer) {
      return { ...restored, groupCollapsed: liveLayer.groupCollapsed };
    }
    return restored;
  });
  out.layers = layers;

  const ids = new Set(layers.map((layer) => layer.id));
  const liveSelection = live?.selectedLayerId ?? null;
  out.selectedLayerId = liveSelection && ids.has(liveSelection)
    ? liveSelection
    : stepSelection && ids.has(stepSelection) ? stepSelection : null;
  return out as unknown as Project;
}

// ============================================================================

/** One recorded step. `json` is what steps are compared and restored by;
 *  `selectedLayerId` (the selection when it was recorded) is only a fallback
 *  for when an undo removes the layer that is selected live. `id` is unique
 *  per step, so "is this still the step that was saved" survives undo. */
interface HistoryEntry {
  id: number;
  json: string;
  selectedLayerId: string | null;
  /** Large strings this step refers to (see internLarge). */
  large: number[];
}

interface HistoryState {
  past: HistoryEntry[];       // previous steps, oldest first
  future: HistoryEntry[];     // undone steps, next first
  current: HistoryEntry | null;
}

function entriesOf(state: HistoryState): Array<HistoryEntry | null> {
  return [...state.past, state.current, ...state.future];
}

let nextEntryId = 1;
function makeEntry(snapshot: { json: string; large: number[] }, project: Project | null | undefined): HistoryEntry {
  return { id: nextEntryId++, json: snapshot.json, large: snapshot.large, selectedLayerId: project?.selectedLayerId ?? null };
}

function createHistoryStore() {
  const { subscribe, set, update } = writable<HistoryState>({
    past: [],
    future: [],
    current: null,
  });

  // Counter-based guard to suppress recording during undo/redo
  let suppressCount = 0;

  /** Move one step back (`direction` -1) or forward (+1). */
  function step(direction: -1 | 1, liveProject: Project): HistorySnapshot | null {
    let result: HistorySnapshot | null = null;
    update((state) => {
      const source = direction < 0 ? state.past : state.future;
      if (source.length === 0) return state;
      const target = direction < 0 ? source[source.length - 1] : source[0];
      const leaving = state.current;
      // Compared with large strings still as references (equal strings
      // share one), then put back in what is restored.
      const parsed = parseSnapshot(target.json, false);
      const left = leaving ? parseSnapshot(leaving.json, false) : null;
      const project = mergeProjectStep(liveProject, parsed.project, left?.project ?? null, target.selectedLayerId);
      result = {
        project: restoreLarge(project) as Project,
        keyframes: restoreLarge(parsed.keyframes),
        output: restoreLarge(parsed.output) as OutputHistoryState | null,
        leavingOutput: restoreLarge(left?.output ?? null) as OutputHistoryState | null,
      };
      if (direction < 0) {
        return {
          past: state.past.slice(0, -1),
          future: leaving ? [leaving, ...state.future] : state.future,
          current: target,
        };
      }
      return {
        past: leaving ? [...state.past, leaving] : state.past,
        future: state.future.slice(1),
        current: target,
      };
    });
    return result;
  }

  return {
    subscribe,

    // Initialize with a project state
    init(project: Project, keyframes: unknown = null, output: OutputHistoryState | null = null) {
      const current = makeEntry(serializeSnapshot(project, keyframes, output), project);
      set({ past: [], future: [], current });
      pruneLarge([current]);
    },

    // Record a new state (called after discrete user actions)
    record(project: Project, keyframes: unknown = null, output: OutputHistoryState | null = null) {
      if (suppressCount > 0) return;

      const serialized = serializeSnapshot(project, keyframes, output);

      let kept: HistoryState | null = null;
      update((state) => {
        // Skip if identical to current state
        if (state.current?.json === serialized.json) return state;

        const newPast = state.current
          ? [...state.past, state.current].slice(-MAX_HISTORY_SIZE)
          : state.past;

        kept = {
          past: newPast,
          future: [],
          current: makeEntry(serialized, project),
        };
        return kept;
      });
      if (kept) pruneLarge(entriesOf(kept));
    },

    /** Replace the latest step with this state, without adding a step
     *  (see amendLastHistoryStep). */
    amend(project: Project, keyframes: unknown = null, output: OutputHistoryState | null = null) {
      if (suppressCount > 0) return;
      const serialized = serializeSnapshot(project, keyframes, output);
      let kept: HistoryState | null = null;
      update((state) => {
        if (!state.current || state.current.json === serialized.json) return state;
        kept = { ...state, current: { ...state.current, json: serialized.json, large: serialized.large } };
        return kept;
      });
      if (kept) pruneLarge(entriesOf(kept));
    },

    /**
     * Name the project in every step. Its name follows its file (Save As
     * names it), so undo must not take it back to the old name.
     */
    renameSteps(name: string) {
      const rename = (entry: HistoryEntry | null): HistoryEntry | null => {
        if (!entry) return entry;
        const parsed = JSON.parse(entry.json) as { project?: { name?: string } };
        if (!parsed.project || parsed.project.name === name) return entry;
        parsed.project.name = name;
        return { ...entry, json: JSON.stringify(parsed) };
      };
      update((state) => ({
        past: state.past.map((e) => rename(e)!),
        future: state.future.map((e) => rename(e)!),
        current: rename(state.current),
      }));
    },

    // Suppress/unsuppress recording during undo/redo
    suppress() { suppressCount++; },
    unsuppress() { setTimeout(() => { suppressCount = Math.max(0, suppressCount - 1); }, 50); },

    /** Undo — returns the state to restore: the previous step merged onto the
     *  live project (see mergeProjectStep). */
    undo(liveProject: Project): HistorySnapshot | null {
      return step(-1, liveProject);
    },

    /** Redo — the next step, merged the same way. */
    redo(liveProject: Project): HistorySnapshot | null {
      return step(1, liveProject);
    },

    /** Id of the step the project is at now; changes with every recorded
     *  edit, undo and redo. null before init. */
    currentStepId(): number | null {
      let id: number | null = null;
      subscribe((state) => { id = state.current?.id ?? null; })();
      return id;
    },

    // Clear history
    clear() {
      set({ past: [], future: [], current: null });
      suppressCount = 0;
      pruneLarge([]);
    },
  };
}

export const history = createHistoryStore();

/**
 * What an undo or redo should write back to the output stage: the keys of
 * `to` whose value differs from `from`, or null when the step did not
 * touch the output. Comparing the two recorded steps (not the live state)
 * is what keeps undo from reverting anything that changed without being
 * recorded, such as a live control or another window's edit.
 */
export function outputHistoryPatch(
  to: OutputHistoryState | null,
  from: OutputHistoryState | null,
): OutputHistoryState | null {
  if (!to) return null;
  const patch: OutputHistoryState = {};
  for (const key of Object.keys(to)) {
    if (JSON.stringify(to[key]) !== JSON.stringify(from?.[key])) patch[key] = to[key];
  }
  return Object.keys(patch).length ? patch : null;
}

// Derived stores for UI
export const canUndo = {
  subscribe(fn: (value: boolean) => void) {
    return history.subscribe((state) => fn(state.past.length > 0));
  },
};

export const canRedo = {
  subscribe(fn: (value: boolean) => void) {
    return history.subscribe((state) => fn(state.future.length > 0));
  },
};
