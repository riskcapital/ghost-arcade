/**
 * Edits of a Timeline document's lines that follow its blocks: moving a
 * block carries the lines drawn for it, deleting a block deletes them.
 * Pure: each returns a new list, or the same list when nothing changed.
 */
import { normalizeTarget, type ControlLine, type LinePoint } from './lineModel';
import { sameTarget, type ParamTarget } from './paramRegistry';

const EPS = 1e-4;

function shiftPoints(points: readonly LinePoint[], delta: number, from = -Infinity, to = Infinity): LinePoint[] {
  return points
    .map((p) => (p.t >= from - EPS && p.t <= to + EPS ? { ...p, t: Math.max(0, p.t + delta) } : p))
    .sort((a, b) => a.t - b.t);
}

function shiftLine(line: ControlLine, delta: number, from?: number, to?: number): ControlLine {
  const points = shiftPoints(line.points, delta, from, to);
  const depth = line.follow?.depthPoints;
  return {
    ...line,
    points,
    ...(line.follow && depth?.length ? { follow: { ...line.follow, depthPoints: shiftPoints(depth, delta, from, to) } } : {}),
  };
}

/** A point of the line (or of its follow depth) inside [from, to]. */
function hasPointIn(line: ControlLine, from: number, to: number): boolean {
  const inside = (p: LinePoint) => p.t >= from - EPS && p.t <= to + EPS;
  return line.points.some(inside) || !!line.follow?.depthPoints?.some(inside);
}

/**
 * A block moved by `delta`: its own lines (block target) move whole; the
 * row's lines move their points inside the block's old span [from, to],
 * as the ◆ lanes did.
 */
export function shiftLinesWithBlock(
  lines: readonly ControlLine[],
  move: { clipId: string; rowTarget?: ParamTarget | null; from: number; to: number; delta: number },
): ControlLine[] {
  if (!lines.length || Math.abs(move.delta) < 1e-9) return lines as ControlLine[];
  let changed = false;
  const out = lines.map((line) => {
    if (line.target.scope === 'block' && line.target.id === move.clipId) {
      changed = true;
      return shiftLine(line, move.delta);
    }
    if (move.rowTarget && sameTarget(line.target, move.rowTarget) && hasPointIn(line, move.from, move.to)) {
      changed = true;
      return shiftLine(line, move.delta, move.from, move.to);
    }
    return line;
  });
  return changed ? out : (lines as ControlLine[]);
}

/** A look block moved: its lines move whole. */
export function shiftLinesOnTarget(lines: readonly ControlLine[], target: ParamTarget, delta: number): ControlLine[] {
  if (Math.abs(delta) < 1e-9 || !lines.some((l) => sameTarget(l.target, target))) return lines as ControlLine[];
  return lines.map((l) => (sameTarget(l.target, target) ? shiftLine(l, delta) : l));
}

/**
 * A ripple on a row: the row's points from `from` on (and their follow
 * depth) move by `delta`, as the row's later blocks did.
 */
export function shiftRowLinesFrom(lines: readonly ControlLine[], rowTarget: ParamTarget, from: number, delta: number): ControlLine[] {
  if (!lines.length || Math.abs(delta) < 1e-9) return lines as ControlLine[];
  let changed = false;
  const out = lines.map((line) => {
    if (!sameTarget(line.target, rowTarget) || !hasPointIn(line, from, Infinity)) return line;
    changed = true;
    return shiftLine(line, delta, from, Infinity);
  });
  return changed ? out : (lines as ControlLine[]);
}

/** The points one half of a cut needs: those inside [from, to] and the nearest on each side, so the curve inside is unchanged. */
function pointsFor(points: readonly LinePoint[], from: number, to: number): LinePoint[] {
  let lo = 0;
  while (lo < points.length - 1 && points[lo + 1].t <= from + EPS) lo++;
  let hi = points.length - 1;
  while (hi > 0 && points[hi - 1].t >= to - EPS) hi--;
  return points.slice(lo, hi + 1).map((p) => ({ ...p }));
}

/**
 * A block cut in two at `t`: its lines are kept by the left half and copied
 * (new id) onto the right half `rightId`. Each half keeps the points it plays
 * through plus one either side, so both draw the same curve as before.
 */
export function splitLinesForBlock(
  lines: readonly ControlLine[],
  split: { clipId: string; rightId: string; start: number; t: number; end: number },
  newId: () => string,
): ControlLine[] {
  if (!lines.some((l) => l.target.scope === 'block' && l.target.id === split.clipId)) return lines as ControlLine[];
  const out: ControlLine[] = [];
  for (const line of lines) {
    if (line.target.scope !== 'block' || line.target.id !== split.clipId) { out.push(line); continue; }
    const half = (from: number, to: number): Pick<ControlLine, 'points' | 'follow'> => {
      const depth = line.follow?.depthPoints;
      return {
        points: pointsFor(line.points, from, to),
        ...(line.follow ? { follow: { ...line.follow, ...(depth ? { depthPoints: pointsFor(depth, from, to) } : {}) } } : {}),
      };
    };
    out.push({ ...line, ...half(split.start, split.t) });
    out.push({ ...line, ...half(split.t, split.end), id: newId(), target: { scope: 'block', id: split.rightId } });
  }
  return out;
}

/**
 * Blocks moved onto other rows: the source row's points inside each block's
 * old span move (by `delta`) onto the target row's line of the same key,
 * which is made when the target row has none. Points of keys only the source
 * has stay put when the source is not a row line.
 */
export function carryRowLinesAcross(
  lines: readonly ControlLine[],
  move: { source: ParamTarget; target: ParamTarget; from: number; to: number; delta: number },
  newId: () => string,
): ControlLine[] {
  if (sameTarget(move.source, move.target)) {
    return shiftLinesWithBlock(lines, { clipId: '', rowTarget: move.source, from: move.from, to: move.to, delta: move.delta });
  }
  const inside = (p: LinePoint) => p.t >= move.from - EPS && p.t <= move.to + EPS;
  const moved = (pts: readonly LinePoint[]) => pts.filter(inside).map((p) => ({ ...p, t: Math.max(0, p.t + move.delta) }));
  const carried = new Map<string, { points: LinePoint[]; depth: LinePoint[]; line: ControlLine }>();
  let out = lines.map((line) => {
    if (!sameTarget(line.target, move.source) || !hasPointIn(line, move.from, move.to)) return line;
    const depth = line.follow?.depthPoints ?? [];
    carried.set(line.key, { points: moved(line.points), depth: moved(depth), line });
    return {
      ...line,
      points: line.points.filter((p) => !inside(p)),
      ...(line.follow && line.follow.depthPoints ? { follow: { ...line.follow, depthPoints: depth.filter((p) => !inside(p)) } } : {}),
    };
  });
  if (!carried.size) return lines as ControlLine[];
  const merge = (a: readonly LinePoint[], b: readonly LinePoint[]) => [...a, ...b].sort((x, y) => x.t - y.t);
  out = out.map((line) => {
    if (!sameTarget(line.target, move.target)) return line;
    const c = carried.get(line.key);
    if (!c) return line;
    carried.delete(line.key);
    const depth = line.follow?.depthPoints;
    return {
      ...line,
      points: merge(line.points, c.points),
      ...(c.depth.length ? { follow: { ...(line.follow ?? c.line.follow!), depthPoints: merge(depth ?? [], c.depth) } } : {}),
    };
  });
  for (const c of carried.values()) {
    out.push({
      ...c.line,
      id: newId(),
      target: move.target,
      points: c.points,
      ...(c.line.follow ? { follow: { ...c.line.follow, ...(c.line.follow.depthPoints ? { depthPoints: c.depth } : {}) } } : {}),
    });
  }
  return out;
}

/** Blocks (or look blocks) were deleted: their lines go with them. */
export function removeLinesForBlocks(lines: readonly ControlLine[], clipIds: Iterable<string>): ControlLine[] {
  const ids = new Set(clipIds);
  if (!ids.size) return lines as ControlLine[];
  const out = lines.filter((l) => !((l.target.scope === 'block' || l.target.scope === 'look') && ids.has(l.target.id)));
  return out.length === lines.length ? (lines as ControlLine[]) : out;
}

/** The last point time of any line (the document's length counts it). */
export function linesEnd(lines: readonly ControlLine[]): number {
  let end = 0;
  for (const l of lines) {
    const last = l.points[l.points.length - 1];
    if (last && last.t > end) end = last.t;
    const depth = l.follow?.depthPoints;
    const d = depth?.[depth.length - 1];
    if (d && d.t > end) end = d.t;
  }
  return end;
}

/** Bindings from a saved file (anything unreadable dropped). */
export function normalizeBindings(raw: unknown): import('./lineControls').LineBinding[] {
  if (!Array.isArray(raw)) return [];
  const out: import('./lineControls').LineBinding[] = [];
  for (const b of raw as any[]) {
    if (!b || typeof b.id !== 'string' || typeof b.key !== 'string' || !b.target || !b.source) continue;
    // Scopes registered at runtime (or written by a newer build) are kept as written.
    const target = normalizeTarget(b.target);
    if (!target) continue;
    const s = b.source;
    if (s.kind === 'midi' && Number.isFinite(s.cc) && Number.isFinite(s.channel)) {
      out.push({ id: b.id, key: b.key, target, source: { kind: 'midi', cc: s.cc, channel: s.channel, ...(typeof s.input === 'string' ? { input: s.input } : {}) } });
    } else if (s.kind === 'live-param' && Number.isFinite(s.track) && Number.isFinite(s.device) && Number.isFinite(s.param)) {
      out.push({ id: b.id, key: b.key, target, source: { kind: 'live-param', track: s.track, device: s.device, param: s.param } });
    } else if (s.kind === 'osc' && typeof s.address === 'string') {
      out.push({ id: b.id, key: b.key, target, source: { kind: 'osc', address: s.address } });
    }
  }
  return out;
}
