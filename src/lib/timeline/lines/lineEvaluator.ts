/**
 * Evaluates control lines at a show time. Pure apart from per-line caches:
 * the same lines, show time and context always give the same values
 * (live-only sources aside), so scrub = play = export.
 *
 * Built for 60 fps with hundreds of lines: lines are compiled once (typed
 * arrays, monotone tangents) and cached by object identity; each frame
 * writes into records reused from the last frame; a per-line cursor makes a
 * playing show's point search O(1).
 */
import { applyEasing } from '../../keyframes/easing';
import { beatAtSeconds } from '../../show/tempoMap';
import type { KeyframeEasing, ShowTempoMap } from '../../types';
import { LINE_CURVES, isLiveOnlySource, type BeatShape, type ControlLine, type FollowSource, type LineCurve, type LinePoint } from './lineModel';
import { sampleFeature, sampleStem, type SongFeatures } from './songFeatures';
import { unpackColor } from './stageLedParams';

export type OverrideRecord = Record<string, number | boolean>;

/** A song placed on the show: its features and where it plays. */
export interface PlacedSong {
  trackId: string;
  /** Show time the track starts at. */
  startTime: number;
  /** Seconds into the file at startTime. */
  offset: number;
  /** Playback rate (1 = as recorded). */
  rate?: number;
  /** Show seconds the track plays for (the clip length); unset: the file's. */
  length?: number;
  features: SongFeatures;
}

export interface LineContext {
  tempo?: ShowTempoMap | null;
  /** Songs with offline features. A source without `track` reads the first
   *  song playing at the time. */
  songs?: readonly PlacedSong[];
  /** Live-only sources: false during an export (they then add nothing). */
  liveInputs?: boolean;
  /** A Live knob, 0..1, or null when unknown. */
  liveParam?: (track: number, device: number, param: number) => number | null;
  /** A Live track's level, 0..1. */
  liveLevel?: (track: number) => number | null;
  /** A MIDI CC's last value, 0..1. */
  midiCC?: (channel: number, cc: number, input?: string) => number | null;
  /** Seconds since the last evaluation, for live smoothing (default 1/60). */
  dt?: number;
  /** Values a controller is writing right now (record / live touch): they
   *  replace the line's value. Key: `${line.id}`. */
  touch?: ReadonlyMap<string, number> | null;
}

/** Overrides at one instant, grouped as the scene applies them. */
export interface LineFrame {
  time: number;
  layers: Map<string, OverrideRecord>;
  stage: OverrideRecord | null;
  leds: OverrideRecord | null;
  /** By Timeline block (clip id): applied to the layer showing that block. */
  blocks?: Map<string, OverrideRecord>;
  /** By look block (clip id): applied to that block's effects on the shapes. */
  looks?: Map<string, OverrideRecord>;
}

// ── Curves ───────────────────────────────────────────────────────────────

const CURVE_CODE: Record<LineCurve, number> = Object.fromEntries(LINE_CURVES.map((c, i) => [c, i])) as Record<LineCurve, number>;
const HOLD = CURVE_CODE.hold;
const LINEAR = CURVE_CODE.linear;
const SMOOTH = CURVE_CODE.smooth;

export interface CompiledPoints {
  n: number;
  t: Float64Array;
  v: Float64Array;
  /** Monotone tangents (value per second) for 'smooth' segments. */
  m: Float64Array;
  c: Uint8Array;
}

/** Fritsch–Carlson monotone cubic tangents: smooth, never overshoots. */
function monotoneTangents(t: Float64Array, v: Float64Array, n: number): Float64Array {
  const m = new Float64Array(n);
  if (n < 2) return m;
  const d = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const h = t[i + 1] - t[i];
    d[i] = h > 0 ? (v[i + 1] - v[i]) / h : 0;
  }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return m;
}

const compiledPoints = new WeakMap<readonly LinePoint[], CompiledPoints>();

export function compilePoints(points: readonly LinePoint[], defaultCurve: LineCurve = 'linear'): CompiledPoints {
  let hit = compiledPoints.get(points);
  if (hit) return hit;
  const n = points.length;
  const t = new Float64Array(n);
  const v = new Float64Array(n);
  const c = new Uint8Array(n);
  const def = CURVE_CODE[defaultCurve];
  for (let i = 0; i < n; i++) {
    t[i] = points[i].t;
    v[i] = points[i].v;
    const code = points[i].c ? CURVE_CODE[points[i].c!] : undefined;
    c[i] = code ?? def;
  }
  hit = { n, t, v, m: monotoneTangents(t, v, n), c };
  compiledPoints.set(points, hit);
  return hit;
}

/** Index of the last point at or before `time` (−1 before the first), using `hint` first. */
export function findSegment(cp: CompiledPoints, time: number, hint: number): number {
  const { n, t } = cp;
  if (n === 0 || time < t[0]) return -1;
  if (hint >= 0 && hint < n && t[hint] <= time && (hint === n - 1 || time < t[hint + 1])) return hint;
  const next = hint + 1;
  if (next >= 0 && next < n && t[next] <= time && (next === n - 1 || time < t[next + 1])) return next;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Value of segment `i` at `time` (i from findSegment). */
export function segmentValue(cp: CompiledPoints, i: number, time: number, colour = false): number {
  const { n, t, v, m, c } = cp;
  if (i < 0) return v[0];
  if (i >= n - 1) return v[n - 1];
  const t0 = t[i];
  const h = t[i + 1] - t0;
  if (!(h > 0)) return v[i + 1];
  const code = c[i];
  if (code === HOLD) return v[i];
  const u = (time - t0) / h;
  if (colour) {
    // Colours ease per channel (smooth/easing shape the mix, no overshoot).
    const k = code === LINEAR || code === SMOOTH ? (code === SMOOTH ? u * u * (3 - 2 * u) : u) : applyEasing(u, LINE_CURVES[code] as KeyframeEasing);
    const a = unpackColor(v[i]);
    const b = unpackColor(v[i + 1]);
    const mix = (x: number, y: number) => Math.max(0, Math.min(255, Math.round(x + (y - x) * k)));
    return (mix(a[0], b[0]) << 16) | (mix(a[1], b[1]) << 8) | mix(a[2], b[2]);
  }
  if (code === LINEAR) return v[i] + (v[i + 1] - v[i]) * u;
  if (code === SMOOTH) {
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * v[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * v[i + 1] + (u3 - u2) * h * m[i + 1];
  }
  return v[i] + (v[i + 1] - v[i]) * applyEasing(u, LINE_CURVES[code] as KeyframeEasing);
}

/** A drawn line at `time` (no cursor). */
export function pointsValueAt(points: readonly LinePoint[], time: number, defaultCurve: LineCurve = 'linear', colour = false): number | undefined {
  if (!points.length) return undefined;
  const cp = compilePoints(points, defaultCurve);
  return segmentValue(cp, findSegment(cp, time, -1), time, colour);
}

// ── Sources ──────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;

export function beatShapeValue(shape: BeatShape, phase: number): number {
  const p = phase - Math.floor(phase);
  switch (shape) {
    case 'sine': return 0.5 - 0.5 * Math.cos(TAU * p);
    case 'triangle': return p < 0.5 ? p * 2 : 2 - p * 2;
    case 'saw': return p;
    case 'ramp': return 1 - p;
    case 'square': return p < 0.5 ? 1 : 0;
    case 'pulse': return Math.exp(-p * 8);
  }
}

function songAt(songs: readonly PlacedSong[] | undefined, trackId: string | undefined, time: number): { song: PlacedSong; at: number } | null {
  if (!songs?.length) return null;
  for (const song of songs) {
    if (trackId && song.trackId !== trackId) continue;
    const local = time - song.startTime;
    if (local < 0) continue;
    if (song.length !== undefined && local > song.length) continue;
    const at = song.offset + local * (song.rate ?? 1);
    if (at > song.features.duration) continue;
    return { song, at };
  }
  return null;
}

/**
 * The source at show `time`, 0..1, or null when it has no value there
 * (no song playing, a live source during export or not connected).
 * Smoothing of offline sources is a centred window (deterministic).
 */
export function sourceValue(source: FollowSource, time: number, ctx: LineContext, smooth = 0): number | null {
  switch (source.kind) {
    case 'audio': {
      const hit = songAt(ctx.songs, source.track, time);
      return hit ? sampleFeature(hit.song.features, source.feature, hit.at, smooth) : null;
    }
    case 'stem': {
      const hit = songAt(ctx.songs, source.track, time);
      return hit ? sampleStem(hit.song.features, source.stem, hit.at, smooth) : null;
    }
    case 'beat': {
      const quarters = ctx.tempo ? beatAtSeconds(ctx.tempo, time) : time * 2;
      return beatShapeValue(source.shape, quarters / Math.max(1 / 16, source.beats) + (source.phase ?? 0));
    }
    case 'live-param':
      return ctx.liveInputs === false ? null : ctx.liveParam?.(source.track, source.device, source.param) ?? null;
    case 'live-level':
      return ctx.liveInputs === false ? null : ctx.liveLevel?.(source.track) ?? null;
    case 'midi':
      return ctx.liveInputs === false ? null : ctx.midiCC?.(source.channel, source.cc, source.input) ?? null;
  }
}

// ── Lines ────────────────────────────────────────────────────────────────

interface CompiledLine {
  line: ControlLine;
  points: CompiledPoints | null;
  depth: CompiledPoints | null;
  cursor: number;
  depthCursor: number;
  /** Live smoothing state (one-pole), NaN until first value. */
  live: number;
  out: OverrideRecord;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** A line's value at `time` (number, or boolean for bool lines). Undefined
 *  when the line has nothing to say (no points, no follow). */
export function lineValueAt(line: ControlLine, time: number, ctx: LineContext = {}): number | boolean | undefined {
  const c = compileLine(line, {});
  return evalCompiled(c, time, ctx);
}

function compileLine(line: ControlLine, out: OverrideRecord): CompiledLine {
  const isBool = line.kind === 'bool' || line.kind === 'stepped';
  return {
    line,
    points: line.points.length ? compilePoints(line.points, isBool ? 'hold' : 'linear') : null,
    depth: line.follow?.depthPoints?.length ? compilePoints(line.follow.depthPoints, 'linear') : null,
    cursor: -1,
    depthCursor: -1,
    live: Number.NaN,
    out,
  };
}

function evalCompiled(c: CompiledLine, time: number, ctx: LineContext): number | boolean | undefined {
  const line = c.line;
  const colour = line.kind === 'colour';
  const touched = ctx.touch?.get(line.id);
  let value: number;
  if (touched !== undefined) {
    value = touched;
  } else {
    const follow = line.follow;
    if (!c.points && !follow) return undefined;
    let base: number;
    if (c.points) {
      c.cursor = findSegment(c.points, time, c.cursor);
      base = segmentValue(c.points, c.cursor, time, colour);
    } else {
      base = follow?.base ?? line.default ?? line.min;
    }
    value = base;
    if (follow) {
      const smooth = follow.smooth ?? 0;
      const live = isLiveOnlySource(follow.source);
      let s = sourceValue(follow.source, time, ctx, live ? 0 : smooth);
      if (s !== null) {
        if (live && smooth > 0) {
          const dt = ctx.dt ?? 1 / 60;
          c.live = Number.isNaN(c.live) ? s : c.live + (s - c.live) * (1 - Math.exp(-dt / smooth));
          s = c.live;
        }
        s = clamp(s, 0, 1);
        if (follow.curve && follow.curve !== 1) s = Math.pow(s, follow.curve);
        if (follow.bipolar) s = s * 2 - 1;
        let depth = follow.depth;
        if (c.depth) {
          c.depthCursor = findSegment(c.depth, time, c.depthCursor);
          depth = clamp(segmentValue(c.depth, c.depthCursor, time), 0, 1) * (follow.depth < 0 ? -1 : 1);
        }
        if (colour) {
          const target = follow.color ?? 0xffffff;
          const k = clamp(Math.abs(depth) * s, 0, 1);
          const a = unpackColor(base);
          const b = unpackColor(target);
          const mix = (x: number, y: number) => Math.round(x + (y - x) * k);
          value = (mix(a[0], b[0]) << 16) | (mix(a[1], b[1]) << 8) | mix(a[2], b[2]);
        } else {
          value = base + depth * (line.max - line.min) * s;
        }
      }
    }
  }
  if (line.kind === 'bool') return value >= (line.min + line.max) / 2;
  value = clamp(value, line.min, line.max);
  if (line.kind === 'stepped') {
    const step = line.step && line.step > 0 ? line.step : 1;
    value = clamp(line.min + Math.round((value - line.min) / step) * step, line.min, line.max);
  } else if (colour) {
    value = Math.round(value);
  }
  return value;
}

/**
 * A reusable evaluator. Call `evaluate` every frame with the current lines;
 * a new lines array (or a changed line object) recompiles only what changed.
 */
export function createLineEvaluator() {
  let lastLines: readonly ControlLine[] | null = null;
  let compiled: CompiledLine[] = [];
  const byLine = new Map<ControlLine, CompiledLine>();
  const frame: LineFrame = { time: 0, layers: new Map(), stage: null, leds: null, blocks: new Map(), looks: new Map() };

  function recompile(lines: readonly ControlLine[]) {
    const keep = new Set<ControlLine>();
    frame.layers = new Map();
    frame.stage = null;
    frame.leds = null;
    frame.blocks = new Map();
    frame.looks = new Map();
    compiled = [];
    for (const line of lines) {
      if (line.enabled === false) continue;
      if (!line.points.length && !line.follow) continue;
      let out: OverrideRecord;
      if (line.target.scope === 'layer' || line.target.scope === 'block' || line.target.scope === 'look') {
        const map = line.target.scope === 'layer' ? frame.layers : line.target.scope === 'block' ? frame.blocks! : frame.looks!;
        out = map.get(line.target.id) ?? {};
        map.set(line.target.id, out);
      } else if (line.target.scope === 'stage') {
        out = frame.stage ??= {};
      } else {
        out = frame.leds ??= {};
      }
      const prev = byLine.get(line);
      const c = prev ? { ...prev, out } : compileLine(line, out);
      byLine.set(line, c);
      keep.add(line);
      compiled.push(c);
    }
    for (const line of byLine.keys()) if (!keep.has(line)) byLine.delete(line);
    lastLines = lines;
  }

  return {
    /** Overrides at show time `time`. The returned frame and its records are
     *  reused by the next call: copy what you keep. */
    evaluate(lines: readonly ControlLine[], time: number, ctx: LineContext = {}): LineFrame {
      if (lines !== lastLines) recompile(lines);
      frame.time = time;
      for (let i = 0; i < compiled.length; i++) {
        const c = compiled[i];
        const value = evalCompiled(c, time, ctx);
        if (value === undefined) delete c.out[c.line.key];
        else c.out[c.line.key] = value;
      }
      return frame;
    },
    /** Forget cursors and live smoothing (after a seek). */
    reset() {
      for (const c of compiled) {
        c.cursor = -1;
        c.depthCursor = -1;
        c.live = Number.NaN;
      }
    },
  };
}

export type LineEvaluator = ReturnType<typeof createLineEvaluator>;

/** A deep copy of a frame's values (for publishing or keeping). */
function copyRecords(map: Map<string, OverrideRecord> | undefined): Map<string, OverrideRecord> {
  const out = new Map<string, OverrideRecord>();
  if (map) for (const [id, rec] of map) if (Object.keys(rec).length) out.set(id, { ...rec });
  return out;
}

export function snapshotFrame(frame: LineFrame): LineFrame {
  return {
    time: frame.time,
    layers: copyRecords(frame.layers),
    stage: frame.stage && Object.keys(frame.stage).length ? { ...frame.stage } : null,
    leds: frame.leds && Object.keys(frame.leds).length ? { ...frame.leds } : null,
    blocks: copyRecords(frame.blocks),
    looks: copyRecords(frame.looks),
  };
}

/** No values at all. */
export function frameIsEmpty(frame: LineFrame | null): boolean {
  return !frame || (!frame.layers.size && !frame.stage && !frame.leds && !frame.blocks?.size && !frame.looks?.size);
}

/** Same values to the precision they take effect (32-bit float). */
export function sameFrameValues(a: LineFrame | null, b: LineFrame | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const same = (x: OverrideRecord | null | undefined, y: OverrideRecord | null | undefined) => {
    if (!x || !y) return !x === !y;
    let n = 0;
    for (const k in x) {
      const p = x[k];
      const q = y[k];
      if (typeof p === 'number' && typeof q === 'number' ? Math.fround(p) !== Math.fround(q) : p !== q) return false;
      n++;
    }
    for (const _ in y) n--;
    return n === 0;
  };
  const sameMap = (x: Map<string, OverrideRecord> | undefined, y: Map<string, OverrideRecord> | undefined) => {
    if ((x?.size ?? 0) !== (y?.size ?? 0)) return false;
    if (x) for (const [id, rec] of x) if (!same(rec, y?.get(id))) return false;
    return true;
  };
  return sameMap(a.layers, b.layers) && sameMap(a.blocks, b.blocks) && sameMap(a.looks, b.looks) && same(a.stage, b.stage) && same(a.leds, b.leds);
}

/**
 * For the show's layer tracks (`evaluateShowTracks` `laneValues`): the
 * track's own keyframe lanes, then this frame's line values for its piece
 * on top (a line wins on the same key).
 */
export function mergeLineValues(
  laneValues: OverrideRecord | null,
  frame: LineFrame | null,
  layerId: string,
): OverrideRecord | null {
  const lines = frame?.layers.get(layerId);
  if (!lines || !Object.keys(lines).length) return laneValues;
  return laneValues ? { ...laneValues, ...lines } : { ...lines };
}
