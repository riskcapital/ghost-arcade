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

/** `inUse: false` for a string inside a show fragment, which keeps it itself. */
function internLarge(value: string, inUse = true): string {
  let id = idByLarge.get(value);
  if (id === undefined) {
    id = nextLargeId++;
    idByLarge.set(value, id);
    largeById.set(id, value);
  }
  if (inUse) largeInUse?.add(id);
  return LARGE_REF + id;
}

// ============================================================================
// SHOW FRAGMENTS — the show arrangement is most of a step when the show is
// big (300 shader clips carry 300 shader sources and a template per track),
// and nearly all of it is the same from one step to the next. In the show
// part of a step every object or array whose JSON is at least
// SHOW_FRAGMENT_MIN long (a list of plain values, like a lane's keys, as
// one) is stored once in a shared table, by content, and the step (or the
// fragment holding it) refers to it by id; strings of
// SHOW_STRING_MIN or more are kept once like the large strings above. An
// edit to one clip then adds that clip, its track's clip list and the few
// containers above it; everything else is shared with the steps around it.
// Equal content always gets the same id, so two steps' shows are compared
// by their ids alone, and a restored show is exactly what was recorded.
// ============================================================================

const SHOW_STRING_MIN = 1024;
const SHOW_FRAGMENT_MIN = 256;
const FRAGMENT_REF = '\u0000ga-frag:';
/** Fragment JSON by id; ids share the large strings' counter. */
const fragmentById = new Map<number, string>();
const idByFragment = new Map<string, number>();
/** The ids a fragment refers to (fragments and large strings). */
const fragmentRefs = new Map<number, number[]>();

function internFragment(json: string, refs: number[]): number {
  let id = idByFragment.get(json);
  if (id === undefined) {
    id = nextLargeId++;
    idByFragment.set(json, id);
    fragmentById.set(id, json);
    if (refs.length) fragmentRefs.set(id, refs);
  }
  return id;
}

function refId(value: string, prefix: string): number {
  return Number(value.slice(prefix.length));
}

/** Put the large strings and show fragments back into a parsed step, in place. */
function restoreLarge(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.charCodeAt(0) !== 0) return value;
    if (value.startsWith(LARGE_REF)) return largeById.get(refId(value, LARGE_REF)) ?? value;
    if (value.startsWith(FRAGMENT_REF)) {
      const json = fragmentById.get(refId(value, FRAGMENT_REF));
      return json === undefined ? value : restoreLarge(JSON.parse(json));
    }
    return value;
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

/** Forget large strings and fragments no step refers to any more. */
function pruneLarge(entries: Iterable<HistoryEntry | null>): void {
  if (largeById.size === 0 && fragmentById.size === 0) return;
  const keep = new Set<number>();
  const pending: number[] = [];
  const add = (id: number) => {
    if (keep.has(id)) return;
    keep.add(id);
    pending.push(id);
  };
  for (const entry of entries) {
    for (const id of entry?.large ?? []) add(id);
    for (const id of entry?.recorded?.large ?? []) add(id);
  }
  // A kept fragment keeps everything it refers to.
  while (pending.length) {
    for (const id of fragmentRefs.get(pending.pop()!) ?? []) add(id);
  }
  for (const [id, value] of largeById) {
    if (keep.has(id)) continue;
    largeById.delete(id);
    idByLarge.delete(value);
  }
  for (const [id, json] of fragmentById) {
    if (keep.has(id)) continue;
    fragmentById.delete(id);
    idByFragment.delete(json);
    fragmentRefs.delete(id);
  }
}

/** Sizes of the shared tables, for tests. */
export function historyTableStats(): { strings: number; fragments: number; fragmentChars: number } {
  let fragmentChars = 0;
  for (const json of fragmentById.values()) fragmentChars += json.length;
  return { strings: largeById.size, fragments: fragmentById.size, fragmentChars };
}

/**
 * True for a plain object or array holding only numbers, booleans, null,
 * short strings, what JSON leaves out and (to `depth`) more of the same: a
 * keyframe, or a lane's list of them. There showJson() would write what
 * JSON.stringify writes, and the native stringify is much faster.
 */
function isLeaf(value: object, depth: number): boolean {
  const isArray = Array.isArray(value);
  if (!isArray) {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.toJSON === 'function') return false;
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return false;
    if (!isArray && RUNTIME_KEYS.has(key)) return false;
    const v = record[key];
    const t = typeof v;
    if (t === 'string') {
      if ((v as string).length >= SHOW_STRING_MIN) return false;
    } else if (t === 'object' && v !== null) {
      if (depth <= 1 || isRuntimeRef(v) || !isLeaf(v as object, depth - 1)) return false;
    } else if (t === 'bigint') {
      return false;
    }
  }
  return true;
}

/**
 * The show part of a step as JSON text: sanitize() and JSON.stringify() in
 * one pass, storing fragments and long strings in the shared tables (see
 * SHOW FRAGMENTS). Each node is written once and its text reused by the
 * node above it. Leaves out exactly what sanitize() leaves out, and writes
 * what JSON.stringify would, so a restored show is the same as an inline
 * copy. undefined when JSON would leave the value out. The ids the text
 * refers to directly are added to `refs`.
 */
function showJson(value: unknown, ancestors: WeakSet<object>, refs: number[]): string | undefined {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string': {
      if (value.length < SHOW_STRING_MIN) return JSON.stringify(value);
      const ref = internLarge(value, false);
      refs.push(refId(ref, LARGE_REF));
      return JSON.stringify(ref);
    }
    case 'number':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object':
      break;
    default:
      return undefined;
  }
  if (isRuntimeRef(value)) return undefined;
  const obj = value as object;
  if (ancestors.has(obj)) return undefined;
  ancestors.add(obj);

  const inner: number[] = [];
  let json: string;
  if (isLeaf(obj, 2)) {
    json = JSON.stringify(obj);
  } else if (Array.isArray(value)) {
    const parts: string[] = new Array(value.length);
    for (let i = 0; i < value.length; i++) parts[i] = showJson(value[i], ancestors, inner) ?? 'null';
    json = '[' + parts.join(',') + ']';
  } else {
    const src = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(src)) {
      if (RUNTIME_KEYS.has(key)) continue;
      const text = showJson(src[key], ancestors, inner);
      if (text !== undefined) parts.push(JSON.stringify(key) + ':' + text);
    }
    json = '{' + parts.join(',') + '}';
  }
  ancestors.delete(obj);

  if (json.length < SHOW_FRAGMENT_MIN) {
    for (const id of inner) refs.push(id);
    return json;
  }
  const id = internFragment(json, inner);
  refs.push(id);
  return JSON.stringify(FRAGMENT_REF + id);
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
  /** The show timeline's arrangement at this step (showTimeline
   *  .exportArrangement()); undefined when the step was recorded without
   *  one. Like the output stage, the caller restores it only when it
   *  differs from `leavingShow`, so a step that never touched the show
   *  leaves the live show (and its transport) alone. */
  show?: unknown;
  leavingShow?: unknown;
  /** Whether `show` differs from `leavingShow` (see showHistoryRestore);
   *  set by undo and redo, which can tell from the recorded steps without
   *  comparing the two arrangements in full. */
  showChanged?: boolean;
}

/**
 * Serialize a snapshot for history. sanitize() strips all runtime refs
 * (textures, DOM elements) BEFORE JSON.stringify sees them, so no toJSON()
 * hooks run — avoiding the "Unable to serialize Texture." flood that
 * otherwise starves the renderer when VJ clips hold live textures.
 */
function serializeSnapshot(project: Project, keyframes: unknown, output: OutputHistoryState | null, show?: unknown): { json: string; large: number[] } {
  largeInUse = new Set();
  try {
    const step: Record<string, unknown> = { project: sanitize(withoutViewState(project)), keyframes: sanitize(keyframes), output: sanitize(output) };
    let json = JSON.stringify(step);
    if (show !== undefined) {
      // The show goes last, as `step.show = …` would have put it.
      const refs: number[] = [];
      const text = showJson(show, new WeakSet(), refs);
      for (const id of refs) largeInUse.add(id);
      if (text !== undefined) json = json.slice(0, -1) + ',"show":' + text + '}';
    }
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
function parseSnapshot(json: string, withLarge = true): { project: Project; keyframes: unknown; output: OutputHistoryState | null; show: unknown } {
  const parsed = JSON.parse(json) as { project: Project; keyframes: unknown; output?: OutputHistoryState | null; show?: unknown };
  if (withLarge && (json.includes('\\u0000ga-large:') || json.includes('\\u0000ga-frag:'))) restoreLarge(parsed);
  return { project: parsed.project, keyframes: parsed.keyframes ?? null, output: parsed.output ?? null, show: parsed.show };
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
  /** The step as its edit recorded it, before live changes made later were
   *  folded into `json` (amend with `live`); absent when the same. What the
   *  edit itself changed is this against the step before's `json`, so an
   *  undo or redo of it leaves the live changes alone. */
  recorded?: { json: string; large: number[] };
}

/** The step as its edit recorded it (see HistoryEntry.recorded). */
const recordedJson = (entry: HistoryEntry) => entry.recorded?.json ?? entry.json;

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
      // An undo goes back from the edit as recorded to the step before;
      // a redo from the step before to the edit as recorded. Live changes
      // folded into a step later are then the same on both sides and kept.
      const parsed = parseSnapshot(direction < 0 ? target.json : recordedJson(target), false);
      const left = leaving ? parseSnapshot(direction < 0 ? recordedJson(leaving) : leaving.json, false) : null;
      const project = mergeProjectStep(liveProject, parsed.project, left?.project ?? null, target.selectedLayerId);
      // The shows are compared as recorded (fragment ids): equal content
      // has equal ids, so this is the full comparison, at the cost of a
      // few ids. An unchanged show is restored once and stands for both.
      const showChanged = parsed.show !== undefined && parsed.show !== null
        && JSON.stringify(parsed.show) !== JSON.stringify(left?.show);
      const show = restoreLarge(parsed.show);
      result = {
        project: restoreLarge(project) as Project,
        keyframes: restoreLarge(parsed.keyframes),
        output: restoreLarge(parsed.output) as OutputHistoryState | null,
        leavingOutput: restoreLarge(left?.output ?? null) as OutputHistoryState | null,
        show,
        leavingShow: showChanged || show === undefined || show === null ? restoreLarge(left?.show) : show,
        showChanged,
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
    init(project: Project, keyframes: unknown = null, output: OutputHistoryState | null = null, show?: unknown) {
      const current = makeEntry(serializeSnapshot(project, keyframes, output, show), project);
      set({ past: [], future: [], current });
      pruneLarge([current]);
    },

    // Record a new state (called after discrete user actions)
    record(project: Project, keyframes: unknown = null, output: OutputHistoryState | null = null, show?: unknown) {
      if (suppressCount > 0) return;

      const serialized = serializeSnapshot(project, keyframes, output, show);

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
     *  (see amendLastHistoryStep). `live`: the state adds only live changes
     *  made since (see noteLiveChange in historyHooks), which are not part
     *  of the step's own edit. */
    amend(project: Project, keyframes: unknown = null, output: OutputHistoryState | null = null, options: { live?: boolean } = {}, show?: unknown) {
      if (suppressCount > 0) return;
      const serialized = serializeSnapshot(project, keyframes, output, show);
      let kept: HistoryState | null = null;
      update((state) => {
        const current = state.current;
        if (!current || current.json === serialized.json) return state;
        const recorded = options.live ? (current.recorded ?? { json: current.json, large: current.large }) : undefined;
        kept = { ...state, current: { ...current, json: serialized.json, large: serialized.large, recorded } };
        return kept;
      });
      if (kept) pruneLarge(entriesOf(kept));
    },

    /**
     * Name the project in every step. Its name follows its file (Save As
     * names it), so undo must not take it back to the old name.
     */
    renameSteps(name: string) {
      const renamed = (json: string): string => {
        const parsed = JSON.parse(json) as { project?: { name?: string } };
        if (!parsed.project || parsed.project.name === name) return json;
        parsed.project.name = name;
        return JSON.stringify(parsed);
      };
      const rename = (entry: HistoryEntry | null): HistoryEntry | null => {
        if (!entry) return entry;
        const json = renamed(entry.json);
        const recorded = entry.recorded ? { ...entry.recorded, json: renamed(entry.recorded.json) } : undefined;
        if (json === entry.json && recorded?.json === entry.recorded?.json) return entry;
        return { ...entry, json, recorded };
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
/**
 * The show arrangement an undo or redo should restore, or undefined when the
 * step did not change it (same rule as outputHistoryPatch: compare the two
 * recorded steps, never the live show).
 */
export function showHistoryRestore(to: unknown, from: unknown, changed?: boolean): unknown {
  if (to === undefined || to === null) return undefined;
  if (changed !== undefined) return changed ? to : undefined;
  if (to === from) return undefined;
  return JSON.stringify(to) === JSON.stringify(from) ? undefined : to;
}

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
