/**
 * Drawing helpers for control lines (pure): a freehand pen stroke or a
 * recorded pass becomes a few clean points; points snap to the beat grid;
 * a selection scales and shifts.
 */
import { beatAtSeconds, secondsAtBeat } from '../../show/tempoMap';
import type { ShowTempoMap } from '../../types';
import { pointsValueAt } from './lineEvaluator';
import type { LineCurve, LinePoint } from './lineModel';

export interface Sample {
  t: number;
  v: number;
}

/** Two points closer in time than this are the same point. */
export const POINT_EPSILON = 1e-4;

/**
 * Samples in time order: a pen that goes back over time it already drew
 * redraws it (the later sample wins), so the result is a function of time.
 */
export function monotoneSamples(samples: readonly Sample[]): Sample[] {
  const out: Sample[] = [];
  for (const s of samples) {
    if (!Number.isFinite(s.t) || !Number.isFinite(s.v)) continue;
    while (out.length && out[out.length - 1].t >= s.t - POINT_EPSILON) out.pop();
    out.push({ t: s.t, v: s.v });
  }
  return out;
}

/** Moving average over `window` seconds (centred), keeping the end points. */
export function smoothSamples(samples: readonly Sample[], window: number): Sample[] {
  if (!(window > 0) || samples.length < 3) return samples.map((s) => ({ ...s }));
  const half = window / 2;
  const out: Sample[] = [];
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = samples[i].t;
    while (hi < samples.length && samples[hi].t <= t + half) sum += samples[hi++].v;
    while (samples[lo].t < t - half) sum -= samples[lo++].v;
    out.push({ t, v: i === 0 || i === samples.length - 1 ? samples[i].v : sum / (hi - lo) });
  }
  return out;
}

/**
 * Ramer–Douglas–Peucker on value error: keeps the fewest points such that
 * the straight lines between them are never more than `tolerance` (value
 * units) away from any dropped sample. End points are always kept.
 */
export function thinSamples(samples: readonly Sample[], tolerance: number): Sample[] {
  const n = samples.length;
  if (n <= 2) return samples.map((s) => ({ ...s }));
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ta = samples[a].t;
    const va = samples[a].v;
    const span = samples[b].t - ta;
    const slope = span > 0 ? (samples[b].v - va) / span : 0;
    let worst = -1;
    let index = -1;
    for (let i = a + 1; i < b; i++) {
      const err = Math.abs(samples[i].v - (va + slope * (samples[i].t - ta)));
      if (err > worst) {
        worst = err;
        index = i;
      }
    }
    if (index >= 0 && worst > tolerance) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  const out: Sample[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push({ ...samples[i] });
  return out;
}

export interface StrokeOptions {
  /** Max value error of the thinned line, in value units (default 1 % of the range). */
  tolerance?: number;
  /** Value range, for the default tolerance and clamping. */
  min?: number;
  max?: number;
  /** Seconds of smoothing before thinning (default 0.05). */
  smooth?: number;
  /** Curve between the kept points (default 'linear', so the error bound holds exactly). */
  curve?: LineCurve;
}

/** A freehand pen stroke (or a recorded pass) as a few clean points. */
export function strokeToPoints(samples: readonly Sample[], opts: StrokeOptions = {}): LinePoint[] {
  const min = opts.min ?? 0;
  const max = opts.max ?? 1;
  const ordered = monotoneSamples(samples).map((s) => ({ t: Math.max(0, s.t), v: Math.max(min, Math.min(max, s.v)) }));
  const smooth = smoothSamples(ordered, opts.smooth ?? 0.05);
  const thin = thinSamples(smooth, opts.tolerance ?? Math.abs(max - min) * 0.01);
  const curve = opts.curve ?? 'linear';
  return thin.map((s) => (curve === 'linear' ? { t: s.t, v: s.v } : { t: s.t, v: s.v, c: curve }));
}

/**
 * Put `stroke` (sorted points) in place of the line's points between its
 * first and last time. The old line's values just outside the stroke are
 * kept as anchors, so the line before and after does not move.
 */
export function spliceStroke(points: readonly LinePoint[], stroke: readonly LinePoint[], opts: { glide?: number; colour?: boolean } = {}): LinePoint[] {
  if (!stroke.length) return points.slice();
  const t0 = stroke[0].t;
  const t1 = stroke[stroke.length - 1].t;
  const glide = Math.max(POINT_EPSILON * 2, opts.glide ?? 0);
  const before = points.filter((p) => p.t < t0 - POINT_EPSILON);
  const after = points.filter((p) => p.t > t1 + glide + POINT_EPSILON);
  const out: LinePoint[] = [...before];
  if (points.length) {
    const lead = pointsValueAt(points, t0 - POINT_EPSILON, 'linear', opts.colour);
    if (lead !== undefined && (!before.length || before[before.length - 1].t < t0 - 2 * POINT_EPSILON)) {
      out.push({ t: Math.max(0, t0 - POINT_EPSILON), v: lead });
    }
  }
  out.push(...stroke.map((p) => ({ ...p })));
  if (points.length) {
    const tail = pointsValueAt(points, t1 + glide, 'linear', opts.colour);
    if (tail !== undefined && (!after.length || after[0].t > t1 + glide + POINT_EPSILON)) out.push({ t: t1 + glide, v: tail });
  }
  out.push(...after);
  return out.filter((p, i, list) => i === 0 || p.t > list[i - 1].t);
}

/** Snap the points (or the ones at `indices`) to the grid: every `quarters` quarter notes. */
export function snapToBeats(points: readonly LinePoint[], tempo: ShowTempoMap, quarters = 1, indices?: readonly number[]): LinePoint[] {
  const pick = indices ? new Set(indices) : null;
  const q = Math.max(1 / 64, quarters);
  const out = points.map((p, i) => {
    if (pick && !pick.has(i)) return { ...p };
    const beat = Math.round(beatAtSeconds(tempo, p.t) / q) * q;
    return { ...p, t: Math.max(0, secondsAtBeat(tempo, beat)) };
  });
  out.sort((a, b) => a.t - b.t);
  // Two points on one grid line: the later one wins.
  return out.filter((p, i) => i === out.length - 1 || out[i + 1].t - p.t > POINT_EPSILON);
}

export interface ScaleOffset {
  /** Time scale about `timeAnchor` (default: the selection's start). */
  timeScale?: number;
  timeAnchor?: number;
  timeOffset?: number;
  /** Value scale about `valueAnchor` (default: the selection's minimum). */
  valueScale?: number;
  valueAnchor?: number;
  valueOffset?: number;
  min?: number;
  max?: number;
}

/**
 * Scale and shift the selected points (`indices`, default all) in time and
 * value. Values clamp to [min, max]; points stay in time order (a selected
 * point moved past an unselected one replaces it).
 */
export function scaleOffsetPoints(points: readonly LinePoint[], change: ScaleOffset, indices?: readonly number[]): LinePoint[] {
  const pick = indices ? new Set(indices) : null;
  const selected = points.filter((_, i) => !pick || pick.has(i));
  if (!selected.length) return points.slice();
  const timeAnchor = change.timeAnchor ?? selected[0].t;
  const valueAnchor = change.valueAnchor ?? Math.min(...selected.map((p) => p.v));
  const ts = change.timeScale ?? 1;
  const vs = change.valueScale ?? 1;
  const lo = change.min ?? -Infinity;
  const hi = change.max ?? Infinity;
  const moved = selected.map((p) => ({
    ...p,
    t: Math.max(0, timeAnchor + (p.t - timeAnchor) * ts + (change.timeOffset ?? 0)),
    v: Math.max(lo, Math.min(hi, valueAnchor + (p.v - valueAnchor) * vs + (change.valueOffset ?? 0))),
  }));
  const start = Math.min(...moved.map((p) => p.t));
  const end = Math.max(...moved.map((p) => p.t));
  const rest = points.filter((p, i) => (pick ? !pick.has(i) : false) && (p.t < start - POINT_EPSILON || p.t > end + POINT_EPSILON));
  return [...rest, ...moved].sort((a, b) => a.t - b.t);
}
