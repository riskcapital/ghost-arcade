/**
 * Keys (line points) edited as a set, the way a video or motion editor
 * edits keyframes: across any number of lines and rows at once.
 *
 * A key is addressed by its line and its time (`KeyAt`), not by its index,
 * so a selection survives the line being replaced by another edit (a block
 * carrying its points along, a recorded pass) as long as the point is still
 * there. Every function here is pure: it takes the show's lines and returns
 * new ones (the same array when nothing changed).
 */
import type { ControlLine, LinePoint } from './lineModel';
import { sameTarget, type ParamTarget } from './paramRegistry';

export interface KeyAt {
  lineId: string;
  t: number;
}

/** A line's selected point indices, taken from the point list `of`. */
export interface KeyRef {
  lineId: string;
  points: number[];
  of?: readonly LinePoint[];
}

const EPS = 1e-6;
/** Two points closer than this are one moment (a moved point replaces the other). */
const SAME_TIME = 1e-4;

const byLine = (keys: readonly KeyAt[]): Map<string, number[]> => {
  const out = new Map<string, number[]>();
  for (const k of keys) {
    const list = out.get(k.lineId);
    if (list) list.push(k.t);
    else out.set(k.lineId, [k.t]);
  }
  return out;
};

const hasTime = (times: readonly number[], t: number) => times.some((x) => Math.abs(x - t) < EPS);

/** Index-based selections as keys (entries whose point list has been replaced are dropped). */
export function refsToKeys(lines: readonly ControlLine[], refs: readonly KeyRef[]): KeyAt[] {
  const out: KeyAt[] = [];
  for (const ref of refs) {
    const line = lines.find((l) => l.id === ref.lineId);
    if (!line || (ref.of && ref.of !== line.points)) continue;
    for (const i of ref.points) {
      const p = line.points[i];
      if (p) out.push({ lineId: line.id, t: p.t });
    }
  }
  return out;
}

/** Keys as index selections on the lines as they are now (keys that are gone are dropped). */
export function keysToRefs(lines: readonly ControlLine[], keys: readonly KeyAt[]): KeyRef[] {
  const out: KeyRef[] = [];
  for (const [lineId, times] of byLine(keys)) {
    const line = lines.find((l) => l.id === lineId);
    if (!line) continue;
    const points: number[] = [];
    line.points.forEach((p, i) => { if (hasTime(times, p.t)) points.push(i); });
    if (points.length) out.push({ lineId, points, of: line.points });
  }
  return out;
}

/**
 * Move keys by `dt` seconds (never before 0: the whole set stops together, so
 * its spacing holds). A moved key landing on an unmoved one of its line
 * replaces it. Returns the lines and where the keys are now.
 */
export function shiftKeys(lines: readonly ControlLine[], keys: readonly KeyAt[], dt: number): { lines: ControlLine[]; keys: KeyAt[] } {
  if (!keys.length || Math.abs(dt) < EPS) return { lines: lines as ControlLine[], keys: keys.slice() };
  const minT = Math.min(...keys.map((k) => k.t));
  const d = Math.max(dt, -minT);
  if (Math.abs(d) < EPS) return { lines: lines as ControlLine[], keys: keys.slice() };
  const sel = byLine(keys);
  const moved: KeyAt[] = [];
  let changed = false;
  const out = lines.map((line) => {
    const times = sel.get(line.id);
    if (!times) return line;
    const going: LinePoint[] = [];
    const staying: LinePoint[] = [];
    for (const p of line.points) (hasTime(times, p.t) ? going : staying).push(p);
    if (!going.length) return line;
    changed = true;
    const shifted = going.map((p) => ({ ...p, t: Math.max(0, p.t + d) }));
    for (const p of shifted) moved.push({ lineId: line.id, t: p.t });
    const kept = staying.filter((p) => !shifted.some((q) => Math.abs(q.t - p.t) < SAME_TIME));
    return { ...line, points: [...kept, ...shifted].sort((a, b) => a.t - b.t) };
  });
  return changed ? { lines: out, keys: moved } : { lines: lines as ControlLine[], keys: keys.slice() };
}

/** Delete keys. A line left with no points stays (it can be drawn on again). */
export function deleteKeys(lines: readonly ControlLine[], keys: readonly KeyAt[]): ControlLine[] {
  if (!keys.length) return lines as ControlLine[];
  const sel = byLine(keys);
  let changed = false;
  const out = lines.map((line) => {
    const times = sel.get(line.id);
    if (!times) return line;
    const points = line.points.filter((p) => !hasTime(times, p.t));
    if (points.length === line.points.length) return line;
    changed = true;
    return { ...line, points };
  });
  return changed ? out : (lines as ControlLine[]);
}

/** Every key from `t0` to `t1` (inclusive), on the given lines (default: all). */
export function keysBetween(lines: readonly ControlLine[], t0: number, t1: number, lineIds?: ReadonlySet<string>): KeyAt[] {
  const lo = Math.min(t0, t1) - EPS;
  const hi = Math.max(t0, t1) + EPS;
  const out: KeyAt[] = [];
  for (const line of lines) {
    if (lineIds && !lineIds.has(line.id)) continue;
    for (const p of line.points) if (p.t >= lo && p.t <= hi) out.push({ lineId: line.id, t: p.t });
  }
  return out;
}

/** Copied keys: each line's points relative to the earliest copied key. */
export interface KeyClipboard {
  items: Array<{ lineId: string; target: ParamTarget; key: string; points: LinePoint[] }>;
}

export function copyKeys(lines: readonly ControlLine[], keys: readonly KeyAt[]): KeyClipboard | null {
  if (!keys.length) return null;
  const anchor = Math.min(...keys.map((k) => k.t));
  const items: KeyClipboard['items'] = [];
  for (const [lineId, times] of byLine(keys)) {
    const line = lines.find((l) => l.id === lineId);
    if (!line) continue;
    const points = line.points.filter((p) => hasTime(times, p.t)).map((p) => ({ ...p, t: p.t - anchor }));
    if (points.length) items.push({ lineId, target: line.target, key: line.key, points });
  }
  return items.length ? { items } : null;
}

/**
 * Paste copied keys with their earliest at `at`, onto the lines they came
 * from (or the same parameter's line, when that one is gone). Keys pasted
 * onto a moment that has a point replace it. Lines that no longer exist
 * anywhere are skipped.
 */
export function pasteKeys(lines: readonly ControlLine[], clip: KeyClipboard, at: number): { lines: ControlLine[]; keys: KeyAt[] } {
  const base = Math.max(0, at);
  const keys: KeyAt[] = [];
  let out = lines as ControlLine[];
  for (const item of clip.items) {
    const line = out.find((l) => l.id === item.lineId) ?? out.find((l) => l.key === item.key && sameTarget(l.target, item.target));
    if (!line) continue;
    const incoming = item.points.map((p) => ({ ...p, t: base + p.t }));
    const kept = line.points.filter((p) => !incoming.some((q) => Math.abs(q.t - p.t) < SAME_TIME));
    const next = { ...line, points: [...kept, ...incoming].sort((a, b) => a.t - b.t) };
    out = out.map((l) => (l.id === line.id ? next : l));
    for (const p of incoming) keys.push({ lineId: line.id, t: p.t });
  }
  return { lines: out, keys };
}

/**
 * Moments with keys on `lines` between `t0` and `t1`, merged when closer
 * than `minPx` at `zoom` (pixels per second): one diamond per moment, with
 * every key under it.
 */
export function keyMoments(lines: readonly ControlLine[], t0: number, t1: number, zoom: number, minPx = 6): Array<{ t: number; keys: KeyAt[] }> {
  const all = keysBetween(lines, t0, t1).sort((a, b) => a.t - b.t);
  const out: Array<{ t: number; keys: KeyAt[] }> = [];
  const gap = minPx / Math.max(zoom, 1e-6);
  for (const k of all) {
    const last = out[out.length - 1];
    if (last && k.t - last.keys[last.keys.length - 1].t <= gap) last.keys.push(k);
    else out.push({ t: k.t, keys: [k] });
  }
  return out;
}

/** Is this key one of `keys`. */
export function hasKey(keys: readonly KeyAt[], k: KeyAt): boolean {
  return keys.some((x) => x.lineId === k.lineId && Math.abs(x.t - k.t) < EPS);
}

/** `a` and `b` together, without repeats. */
export function unionKeys(a: readonly KeyAt[], b: readonly KeyAt[]): KeyAt[] {
  const out = a.slice();
  for (const k of b) if (!hasKey(out, k)) out.push(k);
  return out;
}
