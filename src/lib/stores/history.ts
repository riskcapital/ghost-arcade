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
function serializeSnapshot(project: Project, keyframes: unknown, output: OutputHistoryState | null): string {
  return JSON.stringify({ project: sanitize(project), keyframes: sanitize(keyframes), output: sanitize(output) });
}

function parseSnapshot(json: string): { project: Project; keyframes: unknown; output: OutputHistoryState | null } {
  const parsed = JSON.parse(json) as { project: Project; keyframes: unknown; output?: OutputHistoryState | null };
  return { project: parsed.project, keyframes: parsed.keyframes ?? null, output: parsed.output ?? null };
}

function outputOf(json: string | null): OutputHistoryState | null {
  return json ? parseSnapshot(json).output : null;
}

/**
 * After restoring a history snapshot, re-attach runtime references
 * (textures, video elements, iframe elements) from the live project state.
 * Matches sources by their `id` field.
 */
function hydrateProject(snapshot: Project, live: Project): Project {
  // Build a lookup of runtime refs by source id from the live project
  const liveSourceMap = new Map<string, Record<string, unknown>>();
  for (const layer of live.layers) {
    if (layer.source) {
      const refs: Record<string, unknown> = {};
      for (const key of RUNTIME_KEYS) {
        const val = (layer.source as any)[key];
        if (val !== undefined) refs[key] = val;
      }
      if (Object.keys(refs).length > 0) {
        liveSourceMap.set(layer.source.id, refs);
      }
    }
  }

  // Re-attach runtime refs to the restored snapshot
  for (const layer of snapshot.layers) {
    if (layer.source) {
      const refs = liveSourceMap.get(layer.source.id);
      if (refs) {
        Object.assign(layer.source, refs);
      }
    }
  }

  return snapshot;
}

// ============================================================================

interface HistoryState {
  past: string[];       // JSON-serialized previous states
  future: string[];     // JSON-serialized future states
  current: string | null;
}

function createHistoryStore() {
  const { subscribe, set, update } = writable<HistoryState>({
    past: [],
    future: [],
    current: null,
  });

  // Counter-based guard to suppress recording during undo/redo
  let suppressCount = 0;

  return {
    subscribe,

    // Initialize with a project state
    init(project: Project, keyframes: unknown = null, output: OutputHistoryState | null = null) {
      set({
        past: [],
        future: [],
        current: serializeSnapshot(project, keyframes, output),
      });
    },

    // Record a new state (called after discrete user actions)
    record(project: Project, keyframes: unknown = null, output: OutputHistoryState | null = null) {
      if (suppressCount > 0) return;

      const serialized = serializeSnapshot(project, keyframes, output);

      update((state) => {
        // Skip if identical to current state
        if (state.current === serialized) return state;

        const newPast = state.current
          ? [...state.past, state.current].slice(-MAX_HISTORY_SIZE)
          : state.past;

        return {
          past: newPast,
          future: [],
          current: serialized,
        };
      });
    },

    // Suppress/unsuppress recording during undo/redo
    suppress() { suppressCount++; },
    unsuppress() { setTimeout(() => { suppressCount = Math.max(0, suppressCount - 1); }, 50); },

    // Undo — returns the previous snapshot (project hydrated with live refs)
    undo(liveProject: Project): HistorySnapshot | null {
      let result: HistorySnapshot | null = null;

      update((state) => {
        if (state.past.length === 0) return state;

        const previousJson = state.past[state.past.length - 1];
        const newPast = state.past.slice(0, -1);
        const newFuture = state.current
          ? [state.current, ...state.future]
          : state.future;

        const parsed = parseSnapshot(previousJson);
        result = {
          project: hydrateProject(parsed.project, liveProject),
          keyframes: parsed.keyframes,
          output: parsed.output,
          leavingOutput: outputOf(state.current),
        };

        return {
          past: newPast,
          future: newFuture,
          current: previousJson,
        };
      });

      return result;
    },

    // Redo — returns the next snapshot (project hydrated with live refs)
    redo(liveProject: Project): HistorySnapshot | null {
      let result: HistorySnapshot | null = null;

      update((state) => {
        if (state.future.length === 0) return state;

        const nextJson = state.future[0];
        const newFuture = state.future.slice(1);
        const newPast = state.current
          ? [...state.past, state.current]
          : state.past;

        const parsed = parseSnapshot(nextJson);
        result = {
          project: hydrateProject(parsed.project, liveProject),
          keyframes: parsed.keyframes,
          output: parsed.output,
          leavingOutput: outputOf(state.current),
        };

        return {
          past: newPast,
          future: newFuture,
          current: nextJson,
        };
      });

      return result;
    },

    // Clear history
    clear() {
      set({ past: [], future: [], current: null });
      suppressCount = 0;
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
