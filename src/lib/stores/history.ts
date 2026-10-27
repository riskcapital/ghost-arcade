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
function sanitize(value: unknown, ancestors: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
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

/** Keyframe timelines as keyframeTimeline.exportAll() gives them. */
export type KeyframeHistoryState = Array<{ layerId: string; tracks: unknown[] }>;

/**
 * The output-stage geometry a step carries: the Screens (crop, warp, masks)
 * and the Master Warp, keyed as in settings.output. See
 * settings.captureOutputHistory for what is in and what stays out.
 */
export type OutputHistoryState = Record<string, unknown>;

/**
 * What an undo or redo makes live.
 *
 * Keyframe timelines live in their own store (stores/keyframeTimeline.ts),
 * not inside `Project`; the project only gains a `keyframeTimelines` field
 * at save time. Screens and the Master Warp live in settings, which the
 * per-frame output path reads. Both belong to the project, so every step
 * carries them beside it, on the one shared timeline: a keyframe, a Screen
 * crop drag, a mask edit and the layer edit after it unwind in the order
 * they happened.
 *
 * As with the project, only what the step changed comes back. `keyframes`
 * and `output` are null when the step did not touch them, so a step that
 * never touched the Screens leaves them exactly as they are live.
 */
export interface HistorySnapshot {
  project: Project;
  /** The timelines to make live (keyframeTimeline.importAll), or null. */
  keyframes: KeyframeHistoryState | null;
  /** The output keys to write back (settings.applyOutputStage), or null. */
  output: OutputHistoryState | null;
}

/**
 * Serialize a step for history. sanitize() strips all runtime refs
 * (textures, DOM elements) BEFORE JSON.stringify sees them, so no toJSON()
 * hooks run — avoiding the "Unable to serialize Texture." flood that
 * otherwise starves the renderer when VJ clips hold live textures.
 */
function serializeSnapshot(project: Project, keyframes: unknown, output: OutputHistoryState | null): string {
  return JSON.stringify({
    project: sanitize(withoutViewState(project)),
    keyframes: sanitize(keyframes ?? null),
    output: sanitize(output ?? null),
  });
}

interface ParsedStep {
  project: Project;
  /** null when the step was recorded without keyframes. */
  keyframes: unknown;
  /** null when the step was recorded without the output stage. */
  output: OutputHistoryState | null;
}

function parseSnapshot(json: string): ParsedStep {
  const parsed = JSON.parse(json) as { project: Project; keyframes?: unknown; output?: OutputHistoryState | null };
  return { project: parsed.project, keyframes: parsed.keyframes ?? null, output: parsed.output ?? null };
}

/**
 * Playback state on a layer's media: whether it is playing and where frame
 * stepping is. Pressing play is not an edit, so it is not part of a step,
 * and an undo keeps the live transport (re-attached by source id, like the
 * runtime references).
 */
const SOURCE_TRANSPORT_KEYS = [
  'isPlaying',
  '_lastFrameTime',
  '_timelapseFrame',
  '_timelapseTotalFrames',
] as const;

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

/** Re-attach the runtime references (textures, video elements) and the
 *  transport of the live layer whose source has the same id. */
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function byKey<T>(list: unknown, key: string): Map<unknown, T> {
  const map = new Map<unknown, T>();
  if (!Array.isArray(list)) return map;
  for (const item of list) if (isRecord(item)) map.set(item[key], item as T);
  return map;
}

/**
 * A list of records keyed by `idKey` (keyframe tracks, Screens) as an undo
 * or redo should leave it: an item that is the same in `to` and `from` was
 * not touched by the step and keeps its live state (present or not); one
 * the step changed comes back as the step has it, merged onto its live
 * state by `mergeItem` when given. Items on neither step (made without a
 * step since) are kept.
 */
function mergeById(
  live: unknown,
  to: unknown[],
  from: unknown,
  idKey: string,
  mergeItem?: (live: Record<string, unknown>, to: Record<string, unknown>, from: Record<string, unknown>) => unknown,
): unknown[] {
  const liveById = byKey<Record<string, unknown>>(live, idKey);
  const fromById = byKey<Record<string, unknown>>(from, idKey);
  const inStep = new Set<unknown>();
  const out: unknown[] = [];
  for (const item of to) {
    if (!isRecord(item)) continue;
    inStep.add(item[idKey]);
    const before = fromById.get(item[idKey]);
    const now = liveById.get(item[idKey]);
    if (before && sameJson(item, before)) {
      if (now) out.push(now);
    } else if (before && now && mergeItem) {
      out.push(mergeItem(now, item, before));
    } else {
      out.push(item);
    }
  }
  for (const [id, item] of liveById) {
    if (!inStep.has(id) && !fromById.has(id)) out.push(item);
  }
  return out;
}

/**
 * The keyframe timelines an undo or redo should leave live, or null when the
 * step did not change them (or was recorded without them, which must never
 * wipe the live keyframes).
 *
 * Merged per track like mergeProjectStep merges layers: a track the step did
 * not change keeps its live keyframes, so undoing a keyframe edit takes back
 * that edit and not the keyframes another track gained since without a step
 * (an armed track under live control).
 */
export function mergeKeyframeStep(live: unknown, to: unknown, from: unknown): KeyframeHistoryState | null {
  if (!Array.isArray(to)) return null;
  if (!Array.isArray(from)) return to as KeyframeHistoryState;
  if (sameJson(to, from)) return null;
  const toById = byKey<Record<string, unknown>>(to, 'layerId');
  const fromById = byKey<Record<string, unknown>>(from, 'layerId');
  const liveById = byKey<Record<string, unknown>>(live, 'layerId');
  const out: KeyframeHistoryState = [];
  for (const layerId of new Set([...toById.keys(), ...liveById.keys()])) {
    const step = toById.get(layerId);
    const now = liveById.get(layerId);
    const before = fromById.get(layerId);
    if ((step && before && sameJson(step, before)) || (!step && !before)) {
      // Not touched by this step (or made since without one): as it is live.
      if (now) out.push(now as KeyframeHistoryState[number]);
      continue;
    }
    const stepTracks = Array.isArray(step?.tracks) ? step.tracks as unknown[] : [];
    const tracks = mergeById(now?.tracks, stepTracks, before?.tracks ?? [], 'key');
    if (step || tracks.length > 0) out.push({ ...(now ?? step), layerId, tracks } as KeyframeHistoryState[number]);
  }
  return sameJson(out, live) ? null : out;
}

/** `live` with the fields `to` and `from` disagree on taken from `to`
 *  (dropped where `to` has none). */
function mergeFields(live: unknown, to: unknown, from: unknown): unknown {
  if (!isRecord(live) || !isRecord(to) || !isRecord(from)) return to;
  const out: Record<string, unknown> = { ...live };
  for (const field of new Set([...Object.keys(to), ...Object.keys(from)])) {
    if (sameJson(to[field], from[field])) continue;
    if (field in to) out[field] = to[field];
    else delete out[field];
  }
  return out;
}

/**
 * What an undo or redo should write back to the output stage, or null when
 * the step did not touch it.
 *
 * `to` is the step being moved to and `from` the step being left. Only what
 * differs between the two recorded steps is written: a key the step did not
 * change is left out, and within the Screens and the Master Warp only the
 * Screens and fields it changed are restored, onto their live state. So an
 * undo cannot revert what changed without being recorded since (a Screen
 * re-found on a renumbered display, a Stage 3D sync, another window), nor a
 * different Screen or field than the one the step edited.
 */
export function mergeOutputStep(
  live: OutputHistoryState | null,
  to: OutputHistoryState | null,
  from: OutputHistoryState | null,
): OutputHistoryState | null {
  if (!isRecord(to)) return null;
  if (!isRecord(from)) return { ...to };
  const patch: OutputHistoryState = {};
  for (const key of Object.keys(to)) {
    if (sameJson(to[key], from[key])) continue;
    const [now, step, before] = [live?.[key], to[key], from[key]];
    // Screens per Screen and per field; the Master Warp per field.
    patch[key] = key === 'slices' && Array.isArray(step) && Array.isArray(before) && Array.isArray(now)
      ? mergeById(now, step, before, 'id', mergeFields)
      : mergeFields(now, step, before);
  }
  return Object.keys(patch).length ? patch : null;
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
}

/** The live state an undo or redo is merged onto. */
interface HistoryLiveState {
  project: Project;
  keyframes: unknown;
  output: OutputHistoryState | null;
}

interface HistoryState {
  past: HistoryEntry[];       // previous steps, oldest first
  future: HistoryEntry[];     // undone steps, next first
  current: HistoryEntry | null;
}

let nextEntryId = 1;
function makeEntry(json: string, project: Project | null | undefined): HistoryEntry {
  return { id: nextEntryId++, json, selectedLayerId: project?.selectedLayerId ?? null };
}

function createHistoryStore() {
  const { subscribe, set, update } = writable<HistoryState>({
    past: [],
    future: [],
    current: null,
  });

  // Counter-based guard to suppress recording during undo/redo
  let suppressCount = 0;

  /** Move one step back (`direction` -1) or forward (+1). Returns what to
   *  make live: the step merged onto the live state of each store it spans
   *  (see mergeProjectStep, mergeKeyframeStep and mergeOutputStep). */
  function step(direction: -1 | 1, live: HistoryLiveState): HistorySnapshot | null {
    let result: HistorySnapshot | null = null;
    update((state) => {
      const source = direction < 0 ? state.past : state.future;
      if (source.length === 0) return state;
      const target = direction < 0 ? source[source.length - 1] : source[0];
      const leaving = state.current;
      const parsed = parseSnapshot(target.json);
      const left = leaving ? parseSnapshot(leaving.json) : null;
      result = {
        project: mergeProjectStep(live.project, parsed.project, left?.project ?? null, target.selectedLayerId),
        keyframes: mergeKeyframeStep(live.keyframes, parsed.keyframes, left ? left.keyframes : null),
        output: mergeOutputStep(live.output ?? null, parsed.output, left?.output ?? null),
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

    // Initialize with a project state (and the keyframes and output stage
    // beside it)
    init(project: Project, keyframes: unknown = null, output: OutputHistoryState | null = null) {
      set({
        past: [],
        future: [],
        current: makeEntry(serializeSnapshot(project, keyframes, output), project),
      });
    },

    // Record a new state (called after discrete user actions)
    record(project: Project, keyframes: unknown = null, output: OutputHistoryState | null = null) {
      if (suppressCount > 0) return;

      const serialized = serializeSnapshot(project, keyframes, output);

      update((state) => {
        // Skip if identical to current state
        if (state.current?.json === serialized) return state;

        const newPast = state.current
          ? [...state.past, state.current].slice(-MAX_HISTORY_SIZE)
          : state.past;

        return {
          past: newPast,
          future: [],
          current: makeEntry(serialized, project),
        };
      });
    },

    /** Replace the latest step with this state, without adding a step
     *  (see amendLastHistoryStep). */
    amend(project: Project, keyframes: unknown = null, output: OutputHistoryState | null = null) {
      if (suppressCount > 0) return;
      const serialized = serializeSnapshot(project, keyframes, output);
      update((state) => {
        if (!state.current || state.current.json === serialized) return state;
        return { ...state, current: { ...state.current, json: serialized } };
      });
    },

    // Suppress/unsuppress recording during undo/redo
    suppress() { suppressCount++; },
    unsuppress() { setTimeout(() => { suppressCount = Math.max(0, suppressCount - 1); }, 50); },

    /** Undo — returns what to restore: the previous step merged onto the
     *  live state. */
    undo(liveProject: Project, liveKeyframes: unknown = null, liveOutput: OutputHistoryState | null = null): HistorySnapshot | null {
      return step(-1, { project: liveProject, keyframes: liveKeyframes, output: liveOutput });
    },

    /** Redo — the next step, merged the same way. */
    redo(liveProject: Project, liveKeyframes: unknown = null, liveOutput: OutputHistoryState | null = null): HistorySnapshot | null {
      return step(1, { project: liveProject, keyframes: liveKeyframes, output: liveOutput });
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
    },
  };
}

export const history = createHistoryStore();

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
