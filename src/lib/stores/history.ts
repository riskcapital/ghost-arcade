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
// any runtime refs detected by shape/type. Uses a WeakSet to handle cycles.
// Everything returned is plain JSON-safe data, so JSON.stringify on the
// result never triggers any toJSON() hooks.
function sanitize(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t === 'function' || t === 'symbol' || t === 'bigint') return undefined;
  if (t !== 'object') return undefined;

  if (isRuntimeRef(value)) return undefined;

  const obj = value as object;
  if (seen.has(obj)) return undefined;
  seen.add(obj);

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const s = sanitize(item, seen);
      out.push(s === undefined ? null : s);
    }
    return out;
  }

  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src)) {
    if (RUNTIME_KEYS.has(key)) continue;
    const s = sanitize(src[key], seen);
    if (s !== undefined) out[key] = s;
  }
  return out;
}

/**
 * Serialize a Project into a JSON snapshot for history. sanitize() strips all
 * runtime refs (textures, DOM elements) BEFORE JSON.stringify sees them, so
 * no toJSON() hooks run — avoiding the "Unable to serialize Texture." flood
 * that otherwise starves the renderer when VJ clips hold live textures.
 */
function serializeSnapshot(project: Project): string {
  return JSON.stringify(sanitize(project));
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
    init(project: Project) {
      set({
        past: [],
        future: [],
        current: serializeSnapshot(project),
      });
    },

    // Record a new state (called after discrete user actions)
    record(project: Project) {
      if (suppressCount > 0) return;

      const serialized = serializeSnapshot(project);

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

    // Undo — returns the previous project state (hydrated with live refs)
    undo(liveProject: Project): Project | null {
      let result: Project | null = null;

      update((state) => {
        if (state.past.length === 0) return state;

        const previousJson = state.past[state.past.length - 1];
        const newPast = state.past.slice(0, -1);
        const newFuture = state.current
          ? [state.current, ...state.future]
          : state.future;

        const parsed = JSON.parse(previousJson) as Project;
        result = hydrateProject(parsed, liveProject);

        return {
          past: newPast,
          future: newFuture,
          current: previousJson,
        };
      });

      return result;
    },

    // Redo — returns the next project state (hydrated with live refs)
    redo(liveProject: Project): Project | null {
      let result: Project | null = null;

      update((state) => {
        if (state.future.length === 0) return state;

        const nextJson = state.future[0];
        const newFuture = state.future.slice(1);
        const newPast = state.current
          ? [...state.past, state.current]
          : state.past;

        const parsed = JSON.parse(nextJson) as Project;
        result = hydrateProject(parsed, liveProject);

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
