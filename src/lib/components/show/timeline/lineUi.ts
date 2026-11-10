/**
 * Control lines in the Timeline tray: which lines show under which row,
 * how tall that makes the row, and the pure maths of drawing and editing
 * them (curve paths, hit testing, point drags, the parameter picker).
 *
 * Lines appear only when used. A row's lines are its piece's (or, for an
 * added layer, its own copy's) and those of the blocks on it; the Looks
 * row has its look blocks' lines; the Stage row its Stage FX and LED lines.
 * A row shows them collapsed (one lane, every curve overlaid in its own
 * colour) or expanded (one lane per line, plus a thin depth lane for a line
 * whose follow depth is drawn).
 */
import { derived, get, writable, type Readable } from 'svelte/store';
import type { ShowLayerTrack } from '../../../types';
import type { ControlLine, LineCurve, LinePoint } from '../../../timeline/lines/lineModel';
import { pointsValueAt } from '../../../timeline/lines/lineEvaluator';
import { rowLineTarget } from '../../../timeline/lines/laneConversion';
import { sameTarget, type ParamEntry, type ParamTarget } from '../../../timeline/lines/paramRegistry';
import { showSlice } from './timelineSlices';

export const LINE_OVERLAY_HEIGHT = 56;
export const LINE_LANE_HEIGHT = 40;
export const LINE_DEPTH_HEIGHT = 20;
/** The Stage row's own strip (its name and ⌇+), above its lines. */
export const STAGE_ROW_HEIGHT = 24;
/** Group ids that are not rows. */
export const LOOKS_GROUP = 'looks';
export const STAGE_GROUP = 'stage';

// ── Which lines go where ───────────────────────────────────────────────────

/** A row's lines: its piece's (or its own copy's) and its blocks'. */
export function linesForTrack(track: Pick<ShowLayerTrack, 'id' | 'layerId' | 'subRow' | 'clips'>, lines: readonly ControlLine[]): ControlLine[] {
  const target = rowLineTarget(track);
  const clipIds = new Set(track.clips.map((c) => c.id));
  return lines.filter((l) => sameTarget(l.target, target) || (l.target.scope === 'block' && clipIds.has(l.target.id)));
}

export function linesForLooks(lines: readonly ControlLine[]): ControlLine[] {
  return lines.filter((l) => l.target.scope === 'look');
}

export function linesForStage(lines: readonly ControlLine[]): ControlLine[] {
  return lines.filter((l) => l.target.scope === 'stage' || l.target.scope === 'led');
}

/** Height of a group's lines. */
export function lineGroupHeight(lines: readonly ControlLine[], expanded: boolean): number {
  if (!lines.length) return 0;
  if (!expanded) return LINE_OVERLAY_HEIGHT;
  let h = 0;
  for (const l of lines) h += LINE_LANE_HEIGHT + (l.follow?.depthPoints ? LINE_DEPTH_HEIGHT : 0);
  return h;
}

/** Groups shown one lane per line (session only). */
export const expandedLineGroups = writable<ReadonlySet<string>>(new Set());

export function toggleLineGroup(groupId: string): void {
  expandedLineGroups.update((s) => {
    const next = new Set(s);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    return next;
  });
}

export interface LineLayout {
  /** Lines per group (row id, LOOKS_GROUP, STAGE_GROUP). */
  lines: Map<string, ControlLine[]>;
  heights: Map<string, number>;
  expanded: ReadonlySet<string>;
}

export function computeLineLayout(tracks: readonly ShowLayerTrack[], lines: readonly ControlLine[], expanded: ReadonlySet<string>): LineLayout {
  const out: LineLayout = { lines: new Map(), heights: new Map(), expanded };
  const put = (id: string, list: ControlLine[]) => {
    if (!list.length) return;
    out.lines.set(id, list);
    out.heights.set(id, lineGroupHeight(list, expanded.has(id)));
  };
  if (lines.length) {
    for (const t of tracks) put(t.id, linesForTrack(t, lines));
    put(LOOKS_GROUP, linesForLooks(lines));
    put(STAGE_GROUP, linesForStage(lines));
  }
  return out;
}

const EMPTY_LAYOUT: LineLayout = { lines: new Map(), heights: new Map(), expanded: new Set() };
let currentLayout: LineLayout = EMPTY_LAYOUT;

/** The tray's line layout. Rows read their heights from it. */
export const lineLayout: Readable<LineLayout> = derived(
  [showSlice('lines'), showSlice('layerTracks'), expandedLineGroups],
  ([lines, tracks, expanded]) => computeLineLayout(tracks, lines, expanded),
);
lineLayout.subscribe((layout) => { currentLayout = layout; });

/** Height of a group's lines in the current layout (0 when it has none). */
export function lineRowsHeight(groupId: string): number {
  return currentLayout.heights.get(groupId) ?? 0;
}

// ── Geometry ───────────────────────────────────────────────────────────────

const PAD = 4;

export function valueToY(v: number, min: number, max: number, h: number): number {
  const span = max - min || 1;
  const f = Math.max(0, Math.min(1, (v - min) / span));
  return PAD + (1 - f) * (h - PAD * 2);
}

export function yToValue(y: number, min: number, max: number, h: number): number {
  const inner = Math.max(1, h - PAD * 2);
  const f = Math.max(0, Math.min(1, 1 - (y - PAD) / inner));
  return min + f * (max - min);
}

/** A colour line is drawn by its brightness. */
function plotValue(line: Pick<ControlLine, 'kind'>, v: number): number {
  if (line.kind !== 'colour') return v;
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function plotRange(line: Pick<ControlLine, 'kind' | 'min' | 'max'>): [number, number] {
  return line.kind === 'colour' ? [0, 1] : [line.min, line.max];
}

export function defaultCurveFor(line: Pick<ControlLine, 'kind'>): LineCurve {
  return line.kind === 'bool' || line.kind === 'stepped' ? 'hold' : 'linear';
}

/**
 * The SVG path of a line's points over [t0, t1] (x = t × zoom). Sampled
 * every `stepPx` pixels, plus each point exactly (both sides of a hold), so
 * corners and steps are drawn where they are.
 */
export function curvePath(
  line: Pick<ControlLine, 'points' | 'kind' | 'min' | 'max'>,
  t0: number,
  t1: number,
  zoom: number,
  h: number,
  stepPx = 3,
  points: readonly LinePoint[] = line.points,
  range?: [number, number],
): string {
  if (!points.length || t1 <= t0 || zoom <= 0) return '';
  const [lo, hi] = range ?? plotRange(line);
  const curve = defaultCurveFor(line);
  const colour = line.kind === 'colour';
  const times: number[] = [];
  const dt = stepPx / zoom;
  for (let t = t0; t < t1; t += dt) times.push(t);
  times.push(t1);
  for (const p of points) {
    if (p.t > t0 && p.t < t1) times.push(p.t - 1e-6, p.t);
  }
  times.sort((a, b) => a - b);
  let d = '';
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const v = pointsValueAt(points, t, curve, colour) ?? lo;
    const x = t * zoom;
    const y = valueToY(plotValue(line, v), lo, hi, h);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

/** A sampled trace (value per time) as a path. */
export function tracePath(samples: ReadonlyArray<{ t: number; v: number }>, zoom: number, h: number, min: number, max: number): string {
  let d = '';
  samples.forEach((s, i) => {
    d += `${i === 0 ? 'M' : 'L'}${(s.t * zoom).toFixed(1)} ${valueToY(s.v, min, max, h).toFixed(1)}`;
  });
  return d;
}

// ── Hit testing ────────────────────────────────────────────────────────────

/** The point under (x, y) within `radius` px (the nearest), or −1. */
export function hitPoint(
  line: Pick<ControlLine, 'kind' | 'min' | 'max'>,
  points: readonly LinePoint[],
  x: number,
  y: number,
  zoom: number,
  h: number,
  radius = 6,
  range?: [number, number],
): number {
  const [lo, hi] = range ?? plotRange(line);
  let best = -1;
  let bestD = radius * radius;
  for (let i = 0; i < points.length; i++) {
    const px = points[i].t * zoom;
    if (Math.abs(px - x) > radius) continue;
    const py = valueToY(plotValue(line, points[i].v), lo, hi, h);
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Vertical distance in px from (x, y) to the line's curve (Infinity off its points). */
export function curveDistance(line: Pick<ControlLine, 'points' | 'kind' | 'min' | 'max'>, x: number, y: number, zoom: number, h: number): number {
  if (!line.points.length) return Infinity;
  const [lo, hi] = plotRange(line);
  const v = pointsValueAt(line.points, x / zoom, defaultCurveFor(line), line.kind === 'colour');
  if (v === undefined) return Infinity;
  return Math.abs(valueToY(plotValue(line, v), lo, hi, h) - y);
}

/** Which of several overlaid lines a press at (x, y) means: a point first, then the nearest curve within `radius`. */
export function hitOverlay(lines: readonly ControlLine[], x: number, y: number, zoom: number, h: number, radius = 6): { lineId: string; point: number } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const p = hitPoint(lines[i], lines[i].points, x, y, zoom, h, radius);
    if (p >= 0) return { lineId: lines[i].id, point: p };
  }
  let best: { lineId: string; point: number } | null = null;
  let bestD = radius;
  for (const line of lines) {
    const d = curveDistance(line, x, y, zoom, h);
    if (d <= bestD) {
      bestD = d;
      best = { lineId: line.id, point: -1 };
    }
  }
  return best;
}

/** Indices of the points inside a rectangle (px). */
export function pointsInRect(
  line: Pick<ControlLine, 'kind' | 'min' | 'max'>,
  points: readonly LinePoint[],
  rect: { x0: number; y0: number; x1: number; y1: number },
  zoom: number,
  h: number,
  range?: [number, number],
): number[] {
  const [lo, hi] = range ?? plotRange(line);
  const xa = Math.min(rect.x0, rect.x1);
  const xb = Math.max(rect.x0, rect.x1);
  const ya = Math.min(rect.y0, rect.y1);
  const yb = Math.max(rect.y0, rect.y1);
  const out: number[] = [];
  points.forEach((p, i) => {
    const x = p.t * zoom;
    const y = valueToY(plotValue(line, p.v), lo, hi, h);
    if (x >= xa && x <= xb && y >= ya && y <= yb) out.push(i);
  });
  return out;
}

// ── Point edits (pure) ─────────────────────────────────────────────────────

const EPS = 1e-4;

/** Add a point at (t, v); a point already at t is replaced. Returns the new list and the new point's index. */
export function insertPoint(points: readonly LinePoint[], t: number, v: number, curve?: LineCurve): { points: LinePoint[]; index: number } {
  const p: LinePoint = curve ? { t: Math.max(0, t), v, c: curve } : { t: Math.max(0, t), v };
  const rest = points.filter((x) => Math.abs(x.t - p.t) > EPS);
  const out = [...rest, p].sort((a, b) => a.t - b.t);
  return { points: out, index: out.indexOf(p) };
}

export interface PointDrag {
  /** The points at the start of the drag. */
  points: readonly LinePoint[];
  /** Selected indices (into `points`). */
  indices: readonly number[];
  /** The grabbed point's index. */
  grabbed: number;
}

/**
 * Move the selected points by (dt, dv): the grabbed point's new time can be
 * snapped (`snap`), the rest keep their distance to it. Times stay between
 * the unselected neighbours (points never pass each other); values clamp to
 * [min, max]. Returns the new list and the selected points' new indices.
 */
export function dragPoints(
  drag: PointDrag,
  dt: number,
  dv: number,
  opts: { min: number; max: number; snap?: (t: number) => number; step?: number },
): { points: LinePoint[]; indices: number[] } {
  const { points, indices } = drag;
  const sel = new Set(indices);
  if (!sel.size) return { points: points.slice(), indices: [] };
  const grabbed = points[drag.grabbed] ?? points[indices[0]];
  let shift = dt;
  if (opts.snap) shift = opts.snap(grabbed.t + dt) - grabbed.t;
  // Keep the selection between its unselected neighbours.
  const sorted = [...sel].sort((a, b) => a - b);
  let lo = -Infinity;
  let hi = Infinity;
  for (const i of sorted) {
    let j = i - 1;
    while (j >= 0 && sel.has(j)) j--;
    if (j >= 0) lo = Math.max(lo, points[j].t + EPS * 2 - points[i].t);
    else lo = Math.max(lo, -points[i].t);
    let k = i + 1;
    while (k < points.length && sel.has(k)) k++;
    if (k < points.length) hi = Math.min(hi, points[k].t - EPS * 2 - points[i].t);
  }
  shift = Math.max(lo, Math.min(hi, shift));
  const quant = (v: number) => (opts.step && opts.step > 0 ? Math.round((v - opts.min) / opts.step) * opts.step + opts.min : v);
  const out = points.map((p, i) => (sel.has(i) ? { ...p, t: Math.max(0, p.t + shift), v: Math.max(opts.min, Math.min(opts.max, quant(p.v + dv))) } : p));
  return { points: out, indices: sorted };
}

/** Delete points by index. */
export function deletePoints(points: readonly LinePoint[], indices: readonly number[]): LinePoint[] {
  const drop = new Set(indices);
  return points.filter((_, i) => !drop.has(i));
}

/** Set the curve (to the next point) of the given points. */
export function setPointCurves(points: readonly LinePoint[], indices: readonly number[], curve: LineCurve): LinePoint[] {
  const pick = new Set(indices);
  return points.map((p, i) => {
    if (!pick.has(i)) return p;
    if (curve === 'linear') {
      const { c: _c, ...rest } = p;
      return rest;
    }
    return { ...p, c: curve };
  });
}

// ── Picker ─────────────────────────────────────────────────────────────────

/** Parameters matching `query` (every word in the label, group or key), grouped, without the keys already used. */
export function filterParams(entries: readonly ParamEntry[], query: string, used: ReadonlySet<string> = new Set()): Array<[string, ParamEntry[]]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const groups = new Map<string, ParamEntry[]>();
  for (const e of entries) {
    if (used.has(e.key)) continue;
    const hay = `${e.label} ${e.group} ${e.key}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const list = groups.get(e.group) ?? [];
    list.push(e);
    groups.set(e.group, list);
  }
  return [...groups.entries()];
}

/** A line's value for display. */
export function formatLineValue(line: Pick<ControlLine, 'kind' | 'max' | 'min'>, v: number | boolean | undefined): string {
  if (v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (line.kind === 'bool') return v >= (line.min + line.max) / 2 ? 'on' : 'off';
  if (line.kind === 'colour') return `#${Math.round(v).toString(16).padStart(6, '0')}`;
  if (line.kind === 'stepped') return String(Math.round(v));
  const span = Math.abs(line.max - line.min);
  return span <= 2 ? v.toFixed(2) : span <= 50 ? v.toFixed(1) : String(Math.round(v));
}

/** The line a group edits when its curves are overlaid: the selected one if it is here, else the first. */
export function activeLineIn(lines: readonly ControlLine[], selectedId: string | null | undefined): ControlLine | null {
  return lines.find((l) => l.id === selectedId) ?? lines[0] ?? null;
}

/** Test seam. */
export function _currentLineLayout(): LineLayout {
  return get(lineLayout);
}

/** The pen: a press on a line lane draws it freehand. */
export const linePenTool = writable(false);

/** The value a line is sending right now (from the published frame). */
export function frameValue(frame: import('../../../timeline/lines/lineEvaluator').LineFrame | null, line: Pick<ControlLine, 'target' | 'key'>): number | boolean | undefined {
  if (!frame) return undefined;
  const t = line.target;
  const rec = t.scope === 'layer' ? frame.layers.get(t.id)
    : t.scope === 'block' ? frame.blocks?.get(t.id)
      : t.scope === 'look' ? frame.looks?.get(t.id)
        : t.scope === 'stage' ? frame.stage : frame.leds;
  return rec?.[line.key];
}

/** Follow sources as the "follows" menu lists them. */
export const FOLLOW_CHOICES: ReadonlyArray<{ id: string; label: string; source: import('../../../timeline/lines/lineModel').FollowSource | null }> = [
  { id: 'none', label: 'Nothing', source: null },
  { id: 'audio:level', label: 'Song level', source: { kind: 'audio', feature: 'level' } },
  { id: 'audio:energy', label: 'Energy', source: { kind: 'audio', feature: 'energy' } },
  { id: 'audio:bass', label: 'Bass', source: { kind: 'audio', feature: 'bass' } },
  { id: 'audio:mid', label: 'Mid', source: { kind: 'audio', feature: 'mid' } },
  { id: 'audio:high', label: 'High', source: { kind: 'audio', feature: 'high' } },
  { id: 'audio:kick', label: 'Kick', source: { kind: 'audio', feature: 'kick' } },
  { id: 'audio:snare', label: 'Snare', source: { kind: 'audio', feature: 'snare' } },
  { id: 'audio:hats', label: 'Hats', source: { kind: 'audio', feature: 'hats' } },
  { id: 'stem:drums', label: 'Drums (stem)', source: { kind: 'stem', stem: 'drums' } },
  { id: 'stem:bass', label: 'Bass (stem)', source: { kind: 'stem', stem: 'bass' } },
  { id: 'stem:vocals', label: 'Vocals (stem)', source: { kind: 'stem', stem: 'vocals' } },
  { id: 'stem:other', label: 'Other (stem)', source: { kind: 'stem', stem: 'other' } },
  { id: 'beat', label: 'Beat LFO', source: { kind: 'beat', shape: 'sine', beats: 4 } },
  { id: 'live-param', label: 'Live knob', source: { kind: 'live-param', track: 0, device: 0, param: 0 } },
  { id: 'live-level', label: 'Live track level', source: { kind: 'live-level', track: 0 } },
  { id: 'midi', label: 'MIDI CC', source: { kind: 'midi', cc: 1, channel: -1 } },
];

export function followChoiceId(source: import('../../../timeline/lines/lineModel').FollowSource | null | undefined): string {
  if (!source) return 'none';
  if (source.kind === 'audio') return `audio:${source.feature}`;
  if (source.kind === 'stem') return `stem:${source.stem}`;
  return source.kind;
}

/** A short name for what a line follows (header button). */
export function followLabel(source: import('../../../timeline/lines/lineModel').FollowSource | null | undefined): string {
  if (!source) return 'follows';
  if (source.kind === 'midi') return `CC ${source.cc}`;
  if (source.kind === 'beat') return `LFO ${source.beats / 4} bar`;
  return FOLLOW_CHOICES.find((c) => c.id === followChoiceId(source))?.label ?? 'follows';
}
