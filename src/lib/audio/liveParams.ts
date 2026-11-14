/**
 * Live values: what the engines that move parameters on their own work out
 * each frame (Auto, audio and LFO modulation, Music motion, the Music
 * Studio's note and voice inputs).
 *
 * They used to be written into the project store and the VJ launcher store
 * every frame. That woke everything that watches those stores (panels, the
 * recorders, undo, the scene builders) many times a second, and a project
 * saved mid-sweep kept whatever value the engine had just written. Now each
 * engine hands its frame here, and:
 *   - the frame sync puts them on over the stored values, as it does
 *     keyframes and Timeline lines (nativeRendererSync applyTimelineOverrides
 *     and the composition chain), and
 *   - a panel showing a moving value reads it from here, at most
 *     LIVE_PARAMS_UI_HZ times a second (liveParamsTick).
 * Nothing here is saved or an undo step. The stored values are the bases.
 *
 * Targets and their keys (the keyframe keys, see applyParamOverrides.ts):
 *   mapping layer, by layer id: shader:<input>, fx:<effectId>:<param>,
 *     edge:<effectId>:<path>, gpu:<param>, splat:<field>,
 *     interactive:<effectId>:<param>
 *   VJ deck row, by deck and row, for the clip it was worked out for:
 *     shader:<input>, fx:<effectId>:<param>, interactive:<effectId>:<param>
 *   composition effect, mapping ('map') or VJ ('vj'), by effect id: <param>
 */
import { writable, type Readable } from 'svelte/store';

/** Who wrote a value. Later ones win on the same key. */
export type LiveProducer = 'auto' | 'mod' | 'music' | 'studio';
const ORDER: LiveProducer[] = ['auto', 'mod', 'music', 'studio'];

export type LiveValues = Record<string, number>;
export type LiveDeck = 'A' | 'B';
export type LiveCompositionScope = 'map' | 'vj';

interface LayerEntry {
  /** The layer's shader source when the values were worked out. */
  sourceId: string | undefined;
  values: LiveValues;
}
interface DeckEntry {
  clipId: string;
  values: LiveValues;
}
interface Frame {
  layers: Map<string, LayerEntry>;
  decks: Map<string, DeckEntry>;
  compositions: Map<string, LiveValues>;
}

const emptyFrame = (): Frame => ({ layers: new Map(), decks: new Map(), compositions: new Map() });
const frames = new Map<LiveProducer, Frame>();
let version = 0;

// Merged views, worked out once per version on first read.
let mergedAt = -1;
let mergedLayers = new Map<string, LayerEntry>();
let mergedBySource = new Map<string, LayerEntry>();
let mergedDecks = new Map<string, DeckEntry>();
let mergedCompositions = new Map<string, LiveValues>();

const deckKey = (deck: LiveDeck, row: number) => `${deck}:${row}`;
const compositionKey = (scope: LiveCompositionScope, effectId: string) => `${scope}:${effectId}`;

function isEmpty(frame: Frame | undefined): boolean {
  return !frame || (frame.layers.size === 0 && frame.decks.size === 0 && frame.compositions.size === 0);
}

/** One engine's values for one frame. Build it, then `commit()` it in one go. */
export class LiveFrameWriter {
  private frame = emptyFrame();
  constructor(private producer: LiveProducer) {}

  layer(layerId: string, sourceId: string | undefined, key: string, value: number): void {
    if (!Number.isFinite(value)) return;
    let entry = this.frame.layers.get(layerId);
    if (!entry) this.frame.layers.set(layerId, (entry = { sourceId, values: {} }));
    entry.values[key] = value;
  }

  deck(deck: LiveDeck, row: number, clipId: string, key: string, value: number): void {
    if (!Number.isFinite(value) || !clipId) return;
    const k = deckKey(deck, row);
    let entry = this.frame.decks.get(k);
    if (!entry || entry.clipId !== clipId) this.frame.decks.set(k, (entry = { clipId, values: {} }));
    entry.values[key] = value;
  }

  composition(scope: LiveCompositionScope, effectId: string, param: string, value: number): void {
    if (!Number.isFinite(value)) return;
    const k = compositionKey(scope, effectId);
    let entry = this.frame.compositions.get(k);
    if (!entry) this.frame.compositions.set(k, (entry = {}));
    entry[param] = value;
  }

  /** Replace what this engine said last frame. Clears the writer for the next frame. */
  commit(): void {
    const next = this.frame;
    this.frame = emptyFrame();
    if (isEmpty(next) && isEmpty(frames.get(this.producer))) return;
    if (isEmpty(next)) frames.delete(this.producer);
    else frames.set(this.producer, next);
    changed();
  }
}

/** Drop everything an engine said (it stopped). */
export function clearLiveValues(producer: LiveProducer): void {
  if (!frames.has(producer)) return;
  frames.delete(producer);
  changed();
}

/** True when any engine has a live value this frame. */
export function hasLiveValues(): boolean {
  return frames.size > 0;
}

/** Bumped whenever any engine commits a frame that differs from nothing. */
export function liveValuesVersion(): number {
  return version;
}

function merge(): void {
  if (mergedAt === version) return;
  mergedAt = version;
  mergedLayers = new Map();
  mergedDecks = new Map();
  mergedCompositions = new Map();
  for (const producer of ORDER) {
    const frame = frames.get(producer);
    if (!frame) continue;
    for (const [id, entry] of frame.layers) {
      const at = mergedLayers.get(id);
      if (!at) mergedLayers.set(id, { sourceId: entry.sourceId, values: { ...entry.values } });
      else Object.assign(at.values, entry.values);
    }
    for (const [key, entry] of frame.decks) {
      const at = mergedDecks.get(key);
      if (!at || at.clipId !== entry.clipId) mergedDecks.set(key, { clipId: entry.clipId, values: { ...entry.values } });
      else Object.assign(at.values, entry.values);
    }
    for (const [key, values] of frame.compositions) {
      const at = mergedCompositions.get(key);
      if (!at) mergedCompositions.set(key, { ...values });
      else Object.assign(at, values);
    }
  }
  // A Timeline copy of a layer (another id, the same shader source) follows
  // it: only for sources one driven layer shows.
  const bySource = new Map<string, LayerEntry | null>();
  for (const entry of mergedLayers.values()) {
    if (!entry.sourceId) continue;
    bySource.set(entry.sourceId, bySource.has(entry.sourceId) ? null : entry);
  }
  mergedBySource = new Map([...bySource].filter((e): e is [string, LayerEntry] => e[1] !== null));
}

function withoutShaderKeys(values: LiveValues): LiveValues | undefined {
  let out: LiveValues | undefined;
  for (const key in values) {
    if (key.startsWith('shader:')) continue;
    (out ??= {})[key] = values[key];
  }
  return out;
}

/**
 * This frame's values for a mapping layer as the scene shows it: its own, or
 * those of the driven layer whose shader it shows (a Timeline copy). A layer
 * now showing another source (a block's clip on the piece) keeps its effect
 * values but not the shader's.
 */
export function liveValuesForLayer(layer: { id: string; source?: { id?: string } | null }): LiveValues | undefined {
  if (frames.size === 0) return undefined;
  merge();
  const sourceId = layer.source?.id;
  const own = mergedLayers.get(layer.id);
  if (own) return own.sourceId === sourceId ? own.values : withoutShaderKeys(own.values);
  return sourceId ? mergedBySource.get(sourceId)?.values : undefined;
}

/** One value of a mapping layer by its id (panels). */
export function liveLayerValue(layerId: string | undefined, key: string): number | undefined {
  if (frames.size === 0 || !layerId) return undefined;
  merge();
  return mergedLayers.get(layerId)?.values[key];
}

/** This frame's values for a VJ deck row, when it still shows the clip they were worked out for. */
export function liveValuesForDeck(deck: LiveDeck, row: number, clipId: string | undefined): LiveValues | undefined {
  if (frames.size === 0 || !clipId) return undefined;
  merge();
  const entry = mergedDecks.get(deckKey(deck, row));
  return entry && entry.clipId === clipId ? entry.values : undefined;
}

/** One value of a VJ deck row (panels). */
export function liveDeckValue(deck: LiveDeck, row: number, clipId: string | undefined, key: string): number | undefined {
  return liveValuesForDeck(deck, row, clipId)?.[key];
}

/** This frame's values for a composition effect. */
export function liveCompositionValues(scope: LiveCompositionScope, effectId: string): LiveValues | undefined {
  if (frames.size === 0) return undefined;
  merge();
  return mergedCompositions.get(compositionKey(scope, effectId));
}

/** A VJ layer id as the scene builds it (`vj-layer-<row>`, `-A` / `-B` with
 *  the crossfader on), or a clip-transition input of one
 *  (`__vj-clip:vj-layer-<row>[-A|B]:<token>:in|out`, vjClipTransitionNative.ts),
 *  which is how a playing clip reaches the core while clip transitions are on. */
const VJ_LAYER_ID = /^(?:__vj-clip:)?vj-layer-(\d+)(?:-([AB]))?(?::[^:]+:(?:in|out))?$/;
export function liveDeckOfLayerId(id: string): { deck: LiveDeck; row: number } | null {
  const m = VJ_LAYER_ID.exec(id);
  return m ? { deck: (m[2] as LiveDeck | undefined) ?? 'A', row: Number(m[1]) } : null;
}

/** This frame's values for a layer as a scene renders it: a VJ row's
 *  (`vj-layer-N`) for the clip it shows, or a mapping layer's. */
export function liveValuesForRenderedLayer(layer: { id: string; source?: { id?: string } | null }): LiveValues | undefined {
  if (frames.size === 0) return undefined;
  const row = liveDeckOfLayerId(layer.id);
  return row ? liveValuesForDeck(row.deck, row.row, layer.source?.id) : liveValuesForLayer(layer);
}

// ─── Panels ────────────────────────────────────────────────────────────────
// A panel that shows a moving value subscribes to this tick and reads the
// value with the functions above. It moves at most this many times a
// second, and stops when nothing is live (one last tick puts the stored
// values back).
export const LIVE_PARAMS_UI_HZ = 15;
const tick = writable(0);
let lastTickAt = -Infinity;
let tickTimer: ReturnType<typeof setTimeout> | null = null;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function publishTick(): void {
  lastTickAt = now();
  tick.update((n) => n + 1);
}

function changed(): void {
  version += 1;
  if (tickTimer !== null) return;
  const wait = lastTickAt + 1000 / LIVE_PARAMS_UI_HZ - now();
  if (wait <= 0) {
    publishTick();
    return;
  }
  tickTimer = setTimeout(() => {
    tickTimer = null;
    publishTick();
  }, wait);
}

/** Moves when live values change, at most LIVE_PARAMS_UI_HZ times a second. */
export const liveParamsTick: Readable<number> = { subscribe: tick.subscribe };

/** For tests: forget everything. */
export function resetLiveValuesForTest(): void {
  frames.clear();
  mergedAt = -1;
  version += 1;
  if (tickTimer !== null) clearTimeout(tickTimer);
  tickTimer = null;
  lastTickAt = -Infinity;
}
