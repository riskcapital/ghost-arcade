/**
 * Loop sources: what a looper MIDI track records besides the keyboards.
 *
 * A MIDI loop track records notes from the keys (the letter keys, the
 * on-screen keys, MIDI) on its instrument, or one of the tab instruments
 * that are not keyboards:
 *
 *  - `xy`: the Sound bath's XY pad. Its notes, plus the puck's movement as
 *    automation (time-stamped points, thinned), so playback moves the puck
 *    and the tone as played.
 *  - `dub`: the Dub set's echo shots. Each tap is a hit: note = shot index.
 *  - `pads`: the drum machine's pads. Each tap is a hit: note = pad index.
 *
 * Hits are notes like any other (beat, length, velocity), so the note editor
 * edits them like a drum loop, one row per shot or pad.
 *
 * Pure: the station (loopStation.ts) keeps what is played and plays it back.
 */

import { INSTRUMENT_LABELS } from './instruments';
import type { InstrumentId } from './noteEvents';
import type { StudioSet } from './studioSets';

export type LoopSource = 'xy' | 'dub' | 'pads';
export const LOOP_SOURCES: readonly LoopSource[] = ['xy', 'dub', 'pads'];

export const isLoopSource = (v: unknown): v is LoopSource => LOOP_SOURCES.includes(v as LoopSource);

/** How a track header names a source. */
export const SOURCE_LABELS: Record<LoopSource, string> = { xy: 'XY', dub: 'Dub shots', pads: 'Drum pads' };

/** The instrument a source's notes are tagged with (visuals, roles, the insert chain's channel). */
export const SOURCE_INSTRUMENT: Record<LoopSource, InstrumentId> = { xy: 'xy', dub: 'shots', pads: 'drums' };

/** A source whose notes are hits on numbered shots or pads (note = index). */
export const isHitSource = (s: LoopSource | null | undefined): s is 'dub' | 'pads' => s === 'dub' || s === 'pads';

/** The source a tab plays besides the keys: the Sound bath's XY pad, the Dub set's shots, the drum machine's pads. */
export function tabSource(set: StudioSet): LoopSource | null {
  return set === 'bath' ? 'xy' : set === 'dub' ? 'dub' : set === 'machine' ? 'pads' : null;
}

/** "XY", "Dub shots", "Drum pads", or the instrument's name. */
export function trackSoundLabel(t: { source?: LoopSource; instrument: InstrumentId | null }, fallback: InstrumentId): string {
  return t.source ? SOURCE_LABELS[t.source] : INSTRUMENT_LABELS[t.instrument ?? fallback];
}

// ── XY automation ─────────────────────────────────────────────────────

/** Where the XY puck was, at a beat: 0-1 across and up. */
export interface XyPoint {
  beat: number;
  x: number;
  y: number;
}
export type XyLayer = XyPoint[];

/** Thinning: a point closer than this in time to the last kept one goes, unless it jumped. */
export const XY_MIN_GAP_BEATS = 1 / 32;
/** Thinning: a point that moved less than this from the last kept one goes. */
export const XY_MIN_MOVE = 0.004;
/** A move this big is always kept. */
export const XY_JUMP = 0.08;
/** A pause this long before a point keeps the point before it (where the puck rested). */
export const XY_REST_BEATS = 1 / 4;
/** Points one layer keeps at most. */
export const MAX_XY_POINTS = 4096;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5);
const moved = (a: XyPoint, b: XyPoint) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * Fewer points, the same movement: the first and last stay, a point stays
 * when it jumped, or when it is far enough in time and space from the last
 * one kept, and the point where the puck rested before a pause stays.
 */
export function thinXy(points: readonly XyPoint[]): XyPoint[] {
  const sorted = [...points].sort((a, b) => a.beat - b.beat);
  if (sorted.length <= 2) return sorted.map((p) => ({ ...p }));
  const out: XyPoint[] = [{ ...sorted[0] }];
  for (let k = 1; k < sorted.length; k++) {
    const p = sorted[k];
    const last = out[out.length - 1];
    const next = sorted[k + 1];
    const isLast = !next;
    const rests = !!next && next.beat - p.beat >= XY_REST_BEATS;
    const d = moved(p, last);
    if (isLast || (rests && d > 0) || d >= XY_JUMP || (p.beat - last.beat >= XY_MIN_GAP_BEATS && d >= XY_MIN_MOVE)) out.push({ ...p });
  }
  return out.length > MAX_XY_POINTS ? out.filter((_, k) => k % Math.ceil(out.length / MAX_XY_POINTS) === 0) : out;
}

const wrap = (x: number, length: number) => {
  const w = ((x % length) + length) % length;
  return Math.abs(w - length) < 1e-6 ? 0 : w + 0;
};

/**
 * The XY moves made in [from, to), as a layer of a loop that started on
 * `origin` and repeats every `beats`: thinned, times wrapped into the loop.
 * When the pad was already held at the punch-in (`held`), where the puck was
 * starts the layer. Empty when nothing moved in the window.
 */
export function xyLayerFor(moves: readonly XyPoint[], from: number, to: number, origin: number, beats: number, held = false): XyLayer {
  if (!(to > from) || !(beats > 0)) return [];
  const inside = moves.filter((p) => p.beat >= from && p.beat < to);
  if (!inside.length) return [];
  let before: XyPoint | null = null;
  if (held) for (const p of moves) if (p.beat < from && p.beat >= from - beats && (!before || p.beat >= before.beat)) before = p;
  const points = before && inside[0].beat > from + 1e-6 ? [{ ...before, beat: from }, ...inside] : inside;
  return thinXy(points)
    .map((p) => ({ beat: wrap(p.beat - origin, beats), x: clamp01(p.x), y: clamp01(p.y) }))
    .sort((a, b) => a.beat - b.beat);
}

/** Every layer's points together, in time order. */
export function mergeXy(...layers: readonly XyLayer[]): XyLayer {
  return layers.flat().map((p) => ({ ...p })).sort((a, b) => a.beat - b.beat);
}

/** The points the loop plays in [fromBeat, toBeat), with pass 0 starting on `origin`. */
export function loopXyInWindow(points: readonly XyPoint[], origin: number, beats: number, fromBeat: number, toBeat: number): Array<XyPoint & { at: number }> {
  if (!(toBeat > fromBeat) || !(beats > 0)) return [];
  const out: Array<XyPoint & { at: number }> = [];
  const first = Math.max(0, Math.floor((fromBeat - origin) / beats));
  const last = Math.floor((toBeat - origin) / beats);
  for (let pass = first; pass <= last; pass++) {
    const start = origin + pass * beats;
    for (const p of points) {
      const at = start + p.beat;
      if (at < fromBeat || at >= toBeat || at < origin) continue;
      out.push({ ...p, at });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** A loop's points after its length changed from `from` beats to `to`: repeated to fill a longer loop, cut to a shorter one. */
export function fitXy(points: readonly XyPoint[], from: number, to: number): XyLayer {
  if (!(from > 0) || !(to > 0) || from === to) return points.filter((p) => p.beat < to).map((p) => ({ ...p }));
  const out: XyLayer = [];
  for (let start = 0; start < to; start += from) for (const p of points) if (start + p.beat < to) out.push({ ...p, beat: start + p.beat });
  return out.sort((a, b) => a.beat - b.beat);
}

/** `n` layers of points, one per note layer: missing ones empty, extra ones dropped. */
export function alignXy(xy: readonly XyLayer[] | undefined, n: number): XyLayer[] {
  return Array.from({ length: n }, (_, k) => (xy?.[k] ?? []).map((p) => ({ ...p })));
}

/** Saved points made safe: inside the loop, 0-1, in time order, `n` layers. */
export function normalizeXyLayers(raw: unknown, n: number, beats: number): XyLayer[] {
  const layers = Array.isArray(raw) ? raw : [];
  return Array.from({ length: n }, (_, k) => normalizeXyPoints(layers[k], beats));
}

export function normalizeXyPoints(raw: unknown, beats: number): XyLayer {
  const out: XyLayer = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Partial<XyPoint>;
    const beat = Number(r.beat);
    if (!Number.isFinite(beat) || beat < 0 || beat >= beats) continue;
    out.push({ beat, x: clamp01(Number(r.x)), y: clamp01(Number(r.y)) });
  }
  return out.sort((a, b) => a.beat - b.beat).slice(0, MAX_XY_POINTS);
}
