/**
 * Editing operations of the mapping canvas, as pure functions over the list
 * of surfaces: dragging any kind of point (with welded neighbours), moving,
 * scaling and turning a selection, mirroring, duplicating, reordering and
 * grouping. The canvas component only turns gestures into these calls.
 */
import { copy, movePoint, uid, type Point, type Surface } from '../model';
import { bendEdge, cornerIndices, gridOf, setHandle, type MeshTangent } from './meshGrid';
import { insertPoint, moveHandle, movePathPoint, type PathPoint } from './pathGeometry';
import { isShape, mapSurface, surfaceOutline, withShape } from './surfaceShape';

/** What a finger can grab on the selected surface. */
export type Handle =
  | { kind: 'point'; index: number }
  | { kind: 'tangent'; index: number; side: keyof MeshTangent }
  | { kind: 'bend'; a: number; b: number }
  | { kind: 'path'; index: number }
  | { kind: 'pathHandle'; index: number; side: 'in' | 'out' }
  | { kind: 'pathMid'; index: number };

const EPS = 1e-6;
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
const clampPoint = (p: Point): Point => ({ x: Math.max(-0.5, Math.min(1.5, p.x)), y: Math.max(-0.5, Math.min(1.5, p.y)) });

/** The points of a surface a weld can hold: corners of a quad, every mesh point, every outline point of a shape. */
export function weldablePoints(s: Surface): { handle: Handle; at: Point }[] {
  if (isShape(s)) return s.shape!.points.map((p, index) => ({ handle: { kind: 'path', index } as Handle, at: { x: p.x, y: p.y } }));
  if (s.mode === 'corners') return cornerIndices(gridOf(s)).map((index) => ({ handle: { kind: 'point', index } as Handle, at: s.points[index] }));
  return s.points.map((at, index) => ({ handle: { kind: 'point', index } as Handle, at }));
}

/** Where a handle sits now (output frame), or null for handles that are not points. */
export function handlePosition(s: Surface, h: Handle): Point | null {
  if (h.kind === 'point') return s.points[h.index] ?? null;
  if (h.kind === 'path') return s.shape?.points[h.index] ?? null;
  return null;
}

/** Move one point-like handle of one surface (no welds). */
function moveOne(s: Surface, h: Handle, to: Point): Surface {
  to = clampPoint(to);
  if (h.kind === 'point') return movePoint(s, h.index, to);
  if (h.kind === 'path' && s.shape) return withShape(s, movePathPoint(s.shape.points, h.index, to));
  return s;
}

export const isWelded = (s: Surface, at: Point) => !!s.welds?.some((w) => same(w, at));

/**
 * Drag a handle of surface `index` to `to`, starting from `start` (the
 * surfaces as they were when the finger landed). Welded points of other
 * surfaces that sat on the same spot move with it.
 */
export function dragHandle(start: Surface[], index: number, h: Handle, to: Point, broken = false): Surface[] {
  const s = start[index];
  if (!s || s.locked) return start;
  const next = start.slice();
  if (h.kind === 'point' || h.kind === 'path') {
    const from = handlePosition(s, h);
    if (!from) return start;
    const target = clampPoint(to);
    next[index] = moveOne(s, h, target);
    if (isWelded(s, from)) {
      next[index] = { ...next[index], welds: s.welds!.map((w) => (same(w, from) ? { ...target } : w)) };
      start.forEach((other, j) => {
        if (j === index || other.locked || !isWelded(other, from)) return;
        let moved = other;
        for (const p of weldablePoints(other)) if (same(p.at, from)) moved = moveOne(moved, p.handle, target);
        next[j] = { ...moved, welds: other.welds!.map((w) => (same(w, from) ? { ...target } : w)) };
      });
    }
    return next;
  }
  if (h.kind === 'tangent') {
    const p = s.points[h.index];
    next[index] = { ...s, bezier: true, tangents: setHandle(s, h.index, h.side, { x: to.x - p.x, y: to.y - p.y }, broken) };
    return next;
  }
  if (h.kind === 'bend') {
    next[index] = { ...s, bezier: true, tangents: bendEdge(s, h.a, h.b, to) };
    return next;
  }
  if (h.kind === 'pathHandle' && s.shape) {
    const p = s.shape.points[h.index];
    next[index] = withShape(s, moveHandle(s.shape.points, h.index, h.side, { x: to.x - p.x, y: to.y - p.y }, broken));
    return next;
  }
  if (h.kind === 'pathMid' && s.shape) {
    next[index] = withShape(s, bendSegment(s.shape.points, h.index, to));
    return next;
  }
  return start;
}

/** Curve segment i of a path so it passes through `through` at its middle. */
export function bendSegment(points: PathPoint[], i: number, through: Point): PathPoint[] {
  const n = points.length;
  const a = points[i],
    b = points[(i + 1) % n];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const w = { x: ((through.x - mid.x) * 4) / 3, y: ((through.y - mid.y) * 4) / 3 };
  const out = points.map((p) => ({ ...p }));
  out[i] = { ...out[i], out: { x: (b.x - a.x) / 3 + w.x, y: (b.y - a.y) / 3 + w.y } };
  out[(i + 1) % n] = { ...out[(i + 1) % n], in: { x: (a.x - b.x) / 3 + w.x, y: (a.y - b.y) / 3 + w.y } };
  return out;
}

/** Insert a point in the middle of a shape's segment i. Returns the surfaces and the new point's index. */
export function addPathPoint(surfaces: Surface[], index: number, segment: number): { surfaces: Surface[]; point: number } {
  const s = surfaces[index];
  if (!s?.shape || s.locked) return { surfaces, point: -1 };
  const next = surfaces.slice();
  const points = insertPoint(s.shape.points, segment, 0.5);
  if (points === s.shape.points) return { surfaces, point: -1 };
  next[index] = withShape(s, points);
  return { surfaces: next, point: segment + 1 };
}

/**
 * Weld the point of surface `index` at `at` to every other surface's
 * weldable point on that exact spot. Returns the surfaces unchanged when
 * nothing else is there.
 */
export function weldAt(surfaces: Surface[], index: number, at: Point): Surface[] {
  const partners = surfaces.map((s, j) => j !== index && weldablePoints(s).some((p) => same(p.at, at)));
  if (!partners.some(Boolean)) return surfaces;
  const add = (s: Surface) => (isWelded(s, at) ? s : { ...s, welds: [...(s.welds ?? []), { x: at.x, y: at.y }] });
  return surfaces.map((s, j) => (j === index || partners[j] ? add(s) : s));
}

/** Release the weld at `at` on surface `index`; partners left alone are released too. */
export function unweldAt(surfaces: Surface[], index: number, at: Point): Surface[] {
  const drop = (s: Surface) => {
    const welds = (s.welds ?? []).filter((w) => !same(w, at));
    const { welds: _w, ...rest } = s;
    return welds.length ? { ...s, welds } : (rest as Surface);
  };
  let next = surfaces.map((s, j) => (j === index ? drop(s) : s));
  const holders = next.filter((s) => isWelded(s, at) && weldablePoints(s).some((p) => same(p.at, at)));
  if (holders.length < 2) next = next.map((s) => (isWelded(s, at) ? drop(s) : s));
  return next;
}

/** How many other surfaces share a welded point with this one. */
export function weldCount(surfaces: Surface[], index: number): number {
  const s = surfaces[index];
  if (!s?.welds?.length) return 0;
  return surfaces.filter((o, j) => j !== index && o.welds?.some((w) => s.welds!.some((v) => same(v, w)))).length;
}

// ── Whole surfaces ──────────────────────────────────────────────────────────

/** Centre of the selected surfaces' outlines together. */
export function selectionCentre(surfaces: Surface[], indices: number[]): Point {
  const pts = indices.flatMap((i) => surfaceOutline(surfaces[i], 4));
  if (!pts.length) return { x: 0.5, y: 0.5 };
  const xs = pts.map((p) => p.x),
    ys = pts.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

export function selectionBox(surfaces: Surface[], indices: number[]): { x0: number; y0: number; x1: number; y1: number } | null {
  const pts = indices.flatMap((i) => surfaceOutline(surfaces[i], 6));
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x),
    ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * Move, scale and turn the selected (unlocked) surfaces about `centre`.
 * Turning runs in output pixels (`aspect` = width ÷ height) so shapes do not shear.
 */
export function transformSelection(start: Surface[], indices: number[], t: { dx?: number; dy?: number; scale?: number; angle?: number; centre?: Point }, aspect = 16 / 9): Surface[] {
  const c = t.centre ?? selectionCentre(start, indices);
  const k = t.scale ?? 1,
    a = t.angle ?? 0,
    dx = t.dx ?? 0,
    dy = t.dy ?? 0;
  const cos = Math.cos(a),
    sin = Math.sin(a);
  const f = (p: Point): Point => {
    const x = (p.x - c.x) * aspect,
      y = p.y - c.y;
    return { x: c.x + ((x * cos - y * sin) * k) / aspect + dx, y: c.y + (x * sin + y * cos) * k + dy };
  };
  const chosen = new Set(indices);
  return start.map((s, i) => (chosen.has(i) && !s.locked ? mapSurface(s, f) : s));
}

/** Corners of the selected surfaces, used to snap a moving selection. */
export function selectionAnchors(surfaces: Surface[], indices: number[]): Point[] {
  return indices.flatMap((i) => weldablePoints(surfaces[i]).map((p) => p.at));
}

/**
 * Mirror a surface left–right (`h`) or top–bottom about its own centre. The
 * outline is mirrored; the picture stays readable (the lattice is re-ordered
 * so its first column is again on the left), and masks are mirrored with
 * the outline so they still cut the same parts.
 */
export function mirrorSurface(s: Surface, h: boolean): Surface {
  const c = selectionCentre([s], [0]);
  const flip = (p: Point): Point => (h ? { x: 2 * c.x - p.x, y: p.y } : { x: p.x, y: 2 * c.y - p.y });
  const g = gridOf(s);
  const reorder = <T,>(list: T[]) =>
    Array.from({ length: g.cols * g.rows }, (_, i) => {
      const col = i % g.cols,
        row = Math.floor(i / g.cols);
      return list[h ? row * g.cols + (g.cols - 1 - col) : (g.rows - 1 - row) * g.cols + col];
    });
  const mapped = mapSurface(s, flip);
  const out: Surface = { ...mapped, points: reorder(mapped.points) };
  if (mapped.tangents) {
    const swap = (t: MeshTangent | null) => {
      if (!t) return null;
      return h ? { right: t.left, left: t.right, down: t.down, up: t.up } : { right: t.right, left: t.left, down: t.up, up: t.down };
    };
    out.tangents = reorder(mapped.tangents).map((t) => {
      const q = swap(t);
      if (!q) return null;
      const clean: MeshTangent = {};
      for (const k of ['right', 'down', 'left', 'up'] as const) if (q[k]) clean[k] = q[k];
      return clean;
    });
  }
  if (s.masks) {
    const mf = (p: Point): Point => (h ? { x: 1 - p.x, y: p.y } : { x: p.x, y: 1 - p.y });
    out.masks = s.masks.map((m) => ({
      ...m,
      points: m.points.map((p) => {
        const q: PathPoint = { ...p, ...mf(p) };
        if (p.in) q.in = h ? { x: -p.in.x, y: p.in.y } : { x: p.in.x, y: -p.in.y };
        if (p.out) q.out = h ? { x: -p.out.x, y: p.out.y } : { x: p.out.x, y: -p.out.y };
        return q;
      }),
      ellipse: m.ellipse ? { ...m.ellipse, ...(h ? { cx: 1 - m.ellipse.cx } : { cy: 1 - m.ellipse.cy }) } : undefined,
    }));
    for (const m of out.masks) if (m.ellipse === undefined) delete m.ellipse;
  }
  return out;
}

/** A copy beside the original: new id, a name that says so, no welds or group. */
export function duplicateSurface(s: Surface, offset: Point = { x: 0.04, y: 0.04 }): Surface {
  const moved = mapSurface(copy(s), (p) => ({ x: p.x + offset.x, y: p.y + offset.y }));
  const { welds: _w, group: _g, ...rest } = moved;
  return { ...(rest as Surface), id: uid(), name: `${s.name} copy`.slice(0, 80), locked: false };
}

/** Move surface `from` to position `to` in the drawing order (later draws on top). */
export function reorderSurfaces(surfaces: Surface[], from: number, to: number): Surface[] {
  if (from === to || from < 0 || to < 0 || from >= surfaces.length || to >= surfaces.length) return surfaces;
  const next = surfaces.slice();
  const [s] = next.splice(from, 1);
  next.splice(to, 0, s);
  return next;
}

/** Put the selected surfaces in one new group (or take them out of any group). */
export function setGroup(surfaces: Surface[], indices: number[], grouped: boolean): Surface[] {
  const id = grouped ? uid() : '';
  const chosen = new Set(indices);
  return surfaces.map((s, i) => {
    if (!chosen.has(i)) return s;
    if (grouped) return { ...s, group: id };
    const { group: _g, ...rest } = s;
    return rest as Surface;
  });
}

/** Every surface in the same group as any of `indices`, plus those indices. */
export function withGroups(surfaces: Surface[], indices: number[]): number[] {
  const groups = new Set(indices.map((i) => surfaces[i]?.group).filter(Boolean));
  return surfaces.map((s, i) => (indices.includes(i) || (s.group && groups.has(s.group)) ? i : -1)).filter((i) => i >= 0);
}

// ── Points of the selected surface ─────────────────────────────────────────

/** The points a person steps through on a surface: four corners, every mesh point, or every outline point. */
export function selectablePoints(s: Surface | undefined): number[] {
  if (!s) return [];
  if (isShape(s)) return s.shape!.points.map((_, i) => i);
  if (s.mode === 'corners') {
    const [tl, tr, br, bl] = cornerIndices(gridOf(s));
    return [tl, tr, br, bl];
  }
  return s.points.map((_, i) => i);
}

/** The handle for point `index` of a surface. */
export const pointHandle = (s: Surface, index: number): Handle => (isShape(s) ? { kind: 'path', index } : { kind: 'point', index });

export function pointAt(s: Surface | undefined, index: number): Point | null {
  if (!s) return null;
  return handlePosition(s, pointHandle(s, index));
}

/** A point nudged by (dx, dy), welded neighbours included; or the whole selection when several are picked. */
export function nudge(surfaces: Surface[], index: number, point: number, dx: number, dy: number, selection: number[] = []): Surface[] {
  if (selection.length > 1) return transformSelection(surfaces, withGroups(surfaces, selection), { dx, dy });
  const s = surfaces[index];
  const at = pointAt(s, point);
  if (!s || !at) return surfaces;
  return dragHandle(surfaces, index, pointHandle(s, point), { x: at.x + dx, y: at.y + dy });
}

/** Drop weld marks no other surface shares any more (after a surface is removed or moved away). */
export function pruneWelds(surfaces: Surface[]): Surface[] {
  return surfaces.map((s, i) => {
    if (!s.welds?.length) return s;
    const welds = s.welds.filter((w) => surfaces.some((o, j) => j !== i && isWelded(o, w) && weldablePoints(o).some((p) => same(p.at, w))) && weldablePoints(s).some((p) => same(p.at, w)));
    if (welds.length === s.welds.length) return s;
    const { welds: _w, ...rest } = s;
    return welds.length ? { ...s, welds } : (rest as Surface);
  });
}
