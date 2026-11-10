/**
 * Edits of a Timeline document's lines that follow its blocks: moving a
 * block carries the lines drawn for it, deleting a block deletes them.
 * Pure: each returns a new list, or the same list when nothing changed.
 */
import type { ControlLine, LinePoint } from './lineModel';
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
    if (move.rowTarget && sameTarget(line.target, move.rowTarget) && line.points.some((p) => p.t >= move.from - EPS && p.t <= move.to + EPS)) {
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
    const t = b.target;
    const target: ParamTarget | null = (t.scope === 'layer' || t.scope === 'block' || t.scope === 'look') && typeof t.id === 'string'
      ? { scope: t.scope, id: t.id }
      : t.scope === 'stage' || t.scope === 'led' ? { scope: t.scope } : null;
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
