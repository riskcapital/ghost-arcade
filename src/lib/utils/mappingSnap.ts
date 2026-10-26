import type { BezierPoint, Layer, Point2D } from '../types';
import { layerRenderMeshGrid } from './meshWarp';
import { layerUvToCanvas } from './layerQuad';

/**
 * Snapping for points dragged on the mapping canvas.
 *
 * Everything is measured on screen, so the pull feels the same at any canvas
 * zoom and in both directions on a wide canvas: a point snaps when it comes
 * within SNAP_RADIUS_PX screen pixels of a target. Targets are the corners
 * and edges of the other layers as they are drawn (a mesh or custom shape
 * outline, not its bounding quad), the canvas edges, and grid lines when
 * grid snap is on.
 *
 * A drag never snaps before the pointer has moved more than the radius, and
 * a target the point started on is ignored until the point has left it, so
 * grabbing a point that sits on another layer's corner (every new layer
 * starts on the canvas corners) no longer pins it there.
 *
 * Positions are canvas-normalized (0..1). Distances do not care whether y
 * runs up or down.
 */

/** How close, in screen pixels, a point must come to a target to snap. */
export const SNAP_RADIUS_PX = 8;
/** Grid lines pull from at most this share of a cell, so a fine grid still
 *  leaves most positions free. */
export const GRID_SNAP_CELL_FRACTION = 0.25;
/** Shift-drag moves the point this much per pixel of pointer travel. */
export const FINE_DRAG_FACTOR = 0.1;

/** The canvas container: unzoomed CSS size and the canvas zoom. */
export interface SnapView {
  width: number;
  height: number;
  zoom: number;
}

export interface SnapConfig {
  /** Other layers' corners and edges. */
  layers: boolean;
  /** The canvas edges. */
  canvasEdges: boolean;
  /** Grid lines, when grid snap is on. */
  grid: { columns: number; rows: number } | null;
}

/** A layer as a snap target: its outline as drawn. */
export interface SnapOutline {
  layerId: string;
  /** Points a dragged point snaps onto (quad corners, shape vertices). */
  corners: Point2D[];
  /** The outline, closed. Its segments are the edge targets. */
  path: Point2D[];
}

export type SnapHitKind = 'corner' | 'edge' | 'axis';

export interface SnapHit {
  kind: SnapHitKind;
  /** Where the snapped point landed (for the indicator). */
  point: Point2D;
  /** Canvas line(s) the point snapped to, for axis snaps. */
  lineX?: number;
  lineY?: number;
}

export interface SnapResult {
  /** Add this to the raw point(s). */
  correction: Point2D;
  snappedX: boolean;
  snappedY: boolean;
  hit: SnapHit | null;
}

const NO_SNAP: SnapResult = { correction: { x: 0, y: 0 }, snappedX: false, snappedY: false, hit: null };

function pxScale(view: SnapView): { sx: number; sy: number } {
  const zoom = view.zoom > 0 ? view.zoom : 1;
  return { sx: Math.max(1e-6, view.width * zoom), sy: Math.max(1e-6, view.height * zoom) };
}

/** The snap radius in normalized canvas units, per axis. */
export function snapRadiusNormalized(view: SnapView, radiusPx = SNAP_RADIUS_PX): Point2D {
  const { sx, sy } = pxScale(view);
  return { x: radiusPx / sx, y: radiusPx / sy };
}

/** Screen distance in pixels between two canvas positions. */
export function screenDistancePx(view: SnapView, a: Point2D, b: Point2D): number {
  const { sx, sy } = pxScale(view);
  return Math.hypot((a.x - b.x) * sx, (a.y - b.y) * sy);
}

/** Closest point on segment a-b to p, measured on screen. */
function projectOnSegment(view: SnapView, p: Point2D, a: Point2D, b: Point2D): { point: Point2D; distance: number } {
  const { sx, sy } = pxScale(view);
  const ax = a.x * sx, ay = a.y * sy;
  const dx = b.x * sx - ax, dy = b.y * sy - ay;
  const px = p.x * sx, py = p.y * sy;
  const len2 = dx * dx + dy * dy;
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const qx = ax + t * dx, qy = ay + t * dy;
  return { point: { x: qx / sx, y: qy / sy }, distance: Math.hypot(px - qx, py - qy) };
}

// ─── Targets ──────────────────────────────────────────────────────────────

type SnapLayer = Pick<Layer, 'id' | 'type' | 'visible' | 'corners'> &
  Partial<Pick<Layer, 'warpMode' | 'meshGrid' | 'layerShape' | 'parentGroupId'>>;

const CURVE_STEPS = 12;
const MESH_SIDE_STEPS = 16;

function cubicAt(a: Point2D, c1: Point2D, c2: Point2D, b: Point2D, t: number): Point2D {
  const s = 1 - t;
  return {
    x: s * s * s * a.x + 3 * s * s * t * c1.x + 3 * s * t * t * c2.x + t * t * t * b.x,
    y: s * s * s * a.y + 3 * s * s * t * c1.y + 3 * s * t * t * c2.y + t * t * t * b.y,
  };
}

/**
 * A layer's outline as drawn on the canvas, or null when it has none worth
 * snapping to (a group, a mask, a round or star shape, an unfinished custom
 * shape).
 */
export function layerSnapOutline(layer: SnapLayer): SnapOutline | null {
  if (!layer.corners || layer.type === 'group' || layer.type === 'mask') return null;
  const mesh = layer.meshGrid ? layerRenderMeshGrid({ warpMode: layer.warpMode ?? 'corners', meshGrid: layer.meshGrid }) : null;
  const map = (uv: Point2D) => layerUvToCanvas(layer.corners, mesh, uv);
  const shape = layer.layerShape;
  if (shape?.enabled && shape.type && shape.type !== 'rectangle') {
    if (shape.type !== 'custom') return null;
    const anchors = (shape.params?.customPoints ?? []) as BezierPoint[];
    if (!shape.params?.customClosed || anchors.length < 3) return null;
    const path: Point2D[] = [];
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const b = anchors[(i + 1) % anchors.length];
      const curved = !!(a.cpOut || b.cpIn);
      const steps = curved || mesh ? CURVE_STEPS : 1;
      const c1 = a.cpOut ?? a;
      const c2 = b.cpIn ?? b;
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        path.push(map(curved ? cubicAt(a, c1, c2, b, t) : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
      }
    }
    return { layerId: layer.id, corners: anchors.map((a) => map(a)), path };
  }
  // Clockwise from top-left, in layer UV (y up).
  const uvCorners: Point2D[] = [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }];
  if (!mesh) {
    const c = layer.corners;
    const corners = [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft].map((p) => ({ x: p.x, y: p.y }));
    return { layerId: layer.id, corners, path: corners };
  }
  const path: Point2D[] = [];
  for (let i = 0; i < 4; i++) {
    const a = uvCorners[i];
    const b = uvCorners[(i + 1) % 4];
    for (let s = 0; s < MESH_SIDE_STEPS; s++) {
      const t = s / MESH_SIDE_STEPS;
      path.push(map({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
    }
  }
  return { layerId: layer.id, corners: uvCorners.map(map), path };
}

/**
 * Layers a drag must not snap to: the ones being moved (the selected layer
 * and the rest of a multi-selection), everything inside them (a group's
 * children move with it), and the groups they sit in (a group's outline
 * is its children's, so it follows them).
 */
export function snapExcludedLayerIds(
  layers: Array<Pick<Layer, 'id'> & Partial<Pick<Layer, 'parentGroupId'>>>,
  primaryId: string | null | undefined,
  selectedIds: readonly string[] = [],
): Set<string> {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const moving = new Set<string>([...(primaryId ? [primaryId] : []), ...selectedIds]);
  const out = new Set<string>(moving);
  for (const id of moving) {
    let parent = byId.get(id)?.parentGroupId ?? null;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      out.add(parent);
      parent = byId.get(parent)?.parentGroupId ?? null;
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of layers) {
      if (!out.has(l.id) && l.parentGroupId && moving.has(l.parentGroupId)) {
        out.add(l.id);
        moving.add(l.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Outlines of every visible layer a drag may snap to. */
export function collectSnapOutlines(layers: SnapLayer[], excluded: ReadonlySet<string>): SnapOutline[] {
  const out: SnapOutline[] = [];
  for (const layer of layers) {
    if (layer.visible === false || excluded.has(layer.id)) continue;
    const outline = layerSnapOutline(layer);
    if (outline) out.push(outline);
  }
  return out;
}

// ─── Session ──────────────────────────────────────────────────────────────

type Target =
  | { key: string; kind: 'corner'; p: Point2D }
  | { key: string; kind: 'edge'; a: Point2D; b: Point2D }
  | { key: string; kind: 'line'; axis: 'x' | 'y'; value: number };

/** One drag's snapping state. */
export interface SnapSession {
  view: SnapView;
  config: SnapConfig;
  targets: Target[];
  /** Per dragged point: targets it started on, ignored until it leaves them. */
  ignored: Set<string>[];
  /** Becomes true once the pointer has moved more than the radius. */
  armed: boolean;
}

function buildTargets(outlines: SnapOutline[], config: SnapConfig): Target[] {
  const targets: Target[] = [];
  if (config.layers) {
    for (const o of outlines) {
      o.corners.forEach((p, i) => targets.push({ key: `c:${o.layerId}:${i}`, kind: 'corner', p }));
      for (let i = 0; i < o.path.length; i++) {
        targets.push({ key: `e:${o.layerId}:${i}`, kind: 'edge', a: o.path[i], b: o.path[(i + 1) % o.path.length] });
      }
    }
  }
  if (config.canvasEdges) {
    for (const value of [0, 1]) {
      targets.push({ key: `x:${value}`, kind: 'line', axis: 'x', value });
      targets.push({ key: `y:${value}`, kind: 'line', axis: 'y', value });
    }
  }
  return targets;
}

function targetDistance(view: SnapView, t: Target, p: Point2D): number {
  if (t.kind === 'corner') return screenDistancePx(view, p, t.p);
  if (t.kind === 'edge') return projectOnSegment(view, p, t.a, t.b).distance;
  const { sx, sy } = pxScale(view);
  return t.axis === 'x' ? Math.abs(p.x - t.value) * sx : Math.abs(p.y - t.value) * sy;
}

/** Start snapping a drag of these points (where they are at the press). */
export function beginSnapSession(
  startPoints: Point2D[],
  outlines: SnapOutline[],
  config: SnapConfig,
  view: SnapView,
): SnapSession {
  const targets = buildTargets(outlines, config);
  const ignored = startPoints.map((p) => {
    const set = new Set<string>();
    for (const t of targets) if (targetDistance(view, t, p) <= SNAP_RADIUS_PX) set.add(t.key);
    return set;
  });
  return { view, config, targets, ignored, armed: false };
}

function release(session: SnapSession, index: number, p: Point2D): Set<string> {
  const ignored = session.ignored[index] ?? new Set<string>();
  if (ignored.size === 0) return ignored;
  for (const t of session.targets) {
    if (ignored.has(t.key) && targetDistance(session.view, t, p) > SNAP_RADIUS_PX) ignored.delete(t.key);
  }
  return ignored;
}

interface PointCandidate { kind: 'corner' | 'edge'; target: Point2D; distance: number }
interface LineCandidate { value: number; distance: number }

function pointCandidate(session: SnapSession, p: Point2D, ignored: Set<string>): PointCandidate | null {
  let corner: PointCandidate | null = null;
  let edge: PointCandidate | null = null;
  for (const t of session.targets) {
    if (ignored.has(t.key)) continue;
    if (t.kind === 'corner') {
      const d = screenDistancePx(session.view, p, t.p);
      if (d <= SNAP_RADIUS_PX && (!corner || d < corner.distance)) corner = { kind: 'corner', target: t.p, distance: d };
    } else if (t.kind === 'edge' && !corner) {
      const hit = projectOnSegment(session.view, p, t.a, t.b);
      if (hit.distance <= SNAP_RADIUS_PX && (!edge || hit.distance < edge.distance)) {
        edge = { kind: 'edge', target: hit.point, distance: hit.distance };
      }
    }
  }
  return corner ?? edge;
}

function lineCandidate(session: SnapSession, p: Point2D, ignored: Set<string>, axis: 'x' | 'y'): LineCandidate | null {
  const { sx, sy } = pxScale(session.view);
  const s = axis === 'x' ? sx : sy;
  const value = axis === 'x' ? p.x : p.y;
  let best: LineCandidate | null = null;
  for (const t of session.targets) {
    if (t.kind !== 'line' || t.axis !== axis || ignored.has(t.key)) continue;
    const d = Math.abs(value - t.value) * s;
    if (d <= SNAP_RADIUS_PX && (!best || d < best.distance)) best = { value: t.value, distance: d };
  }
  const grid = session.config.grid;
  const divisions = grid ? Math.round(axis === 'x' ? grid.columns : grid.rows) : 0;
  if (divisions > 0) {
    const line = Math.round(value * divisions) / divisions;
    const d = Math.abs(value - line) * s;
    const threshold = Math.min(SNAP_RADIUS_PX, (GRID_SNAP_CELL_FRACTION * s) / divisions);
    if (d <= threshold && (!best || d < best.distance)) best = { value: line, distance: d };
  }
  return best;
}

function arm(session: SnapSession, travelPx: number): boolean {
  if (!session.armed && travelPx > SNAP_RADIUS_PX) session.armed = true;
  return session.armed;
}

/**
 * Snap a set of points that move together (one point, the two ends of an
 * edge, a whole outline): one correction for all of them, so a moved shape
 * keeps its size. A corner target beats an edge, an edge beats a canvas or
 * grid line; along lines each axis snaps on its own.
 *
 * `travelPx` is how far the pointer has moved since the press, on screen.
 * `bypass` (Cmd or Ctrl held) turns snapping off for this move.
 */
export function snapPoints(session: SnapSession, points: Point2D[], travelPx: number, bypass = false): SnapResult {
  const ignored = points.map((p, i) => release(session, i, p));
  if (bypass || !arm(session, travelPx)) return NO_SNAP;
  let best: { candidate: PointCandidate; from: Point2D } | null = null;
  points.forEach((p, i) => {
    const c = pointCandidate(session, p, ignored[i]);
    if (!c) return;
    const better = !best
      || (c.kind === 'corner' && best.candidate.kind === 'edge')
      || (c.kind === best.candidate.kind && c.distance < best.candidate.distance);
    if (better) best = { candidate: c, from: p };
  });
  if (best) {
    const { candidate, from } = best as { candidate: PointCandidate; from: Point2D };
    return {
      correction: { x: candidate.target.x - from.x, y: candidate.target.y - from.y },
      snappedX: true,
      snappedY: true,
      hit: { kind: candidate.kind, point: candidate.target },
    };
  }
  let bx: { line: LineCandidate; from: Point2D } | null = null;
  let by: { line: LineCandidate; from: Point2D } | null = null;
  points.forEach((p, i) => {
    const lx = lineCandidate(session, p, ignored[i], 'x');
    if (lx && (!bx || lx.distance < bx.line.distance)) bx = { line: lx, from: p };
    const ly = lineCandidate(session, p, ignored[i], 'y');
    if (ly && (!by || ly.distance < by.line.distance)) by = { line: ly, from: p };
  });
  if (!bx && !by) return NO_SNAP;
  const sx = bx as { line: LineCandidate; from: Point2D } | null;
  const sy = by as { line: LineCandidate; from: Point2D } | null;
  const correction = {
    x: sx ? sx.line.value - sx.from.x : 0,
    y: sy ? sy.line.value - sy.from.y : 0,
  };
  const anchor = sx?.from ?? sy!.from;
  return {
    correction,
    snappedX: !!sx,
    snappedY: !!sy,
    hit: {
      kind: 'axis',
      point: { x: anchor.x + correction.x, y: anchor.y + correction.y },
      lineX: sx?.line.value,
      lineY: sy?.line.value,
    },
  };
}

/** Snap one dragged point. A snapped axis lands exactly on its target. */
export function snapPoint(session: SnapSession, point: Point2D, travelPx: number, bypass = false): { point: Point2D } & SnapResult {
  const result = snapPoints(session, [point], travelPx, bypass);
  const hit = result.hit;
  if (hit && hit.kind !== 'axis') return { ...result, point: { x: hit.point.x, y: hit.point.y } };
  return {
    ...result,
    point: {
      x: hit?.lineX ?? point.x,
      y: hit?.lineY ?? point.y,
    },
  };
}

// ─── Pointer travel ───────────────────────────────────────────────────────

/** How far a drag has moved its point, in screen pixels. Shift moves it a
 *  tenth as far as the pointer, so the point never jumps when Shift is
 *  pressed or released mid-drag. */
export interface DragTravel {
  lastX: number;
  lastY: number;
  x: number;
  y: number;
}

export function beginDragTravel(clientX: number, clientY: number): DragTravel {
  return { lastX: clientX, lastY: clientY, x: 0, y: 0 };
}

export function advanceDragTravel(t: DragTravel, clientX: number, clientY: number, fine: boolean): DragTravel {
  const k = fine ? FINE_DRAG_FACTOR : 1;
  return {
    lastX: clientX,
    lastY: clientY,
    x: t.x + (clientX - t.lastX) * k,
    y: t.y + (clientY - t.lastY) * k,
  };
}

export function dragTravelPx(t: DragTravel): number {
  return Math.hypot(t.x, t.y);
}

/** Travel as a canvas-normalized offset. Layers have y up, so screen-down
 *  is negative there; screens and the Master Warp have y down. */
export function dragTravelNormalized(t: DragTravel, view: SnapView, yUp: boolean): Point2D {
  const { sx, sy } = pxScale(view);
  return { x: t.x / sx, y: (yUp ? -t.y : t.y) / sy };
}

// ─── Project pixels ───────────────────────────────────────────────────────

/** Round a canvas-normalized value to the project's pixel grid (`stepPx`
 *  project pixels; null leaves it free). */
export function quantizeNormalized(value: number, projectSize: number, stepPx: number | null): number {
  if (!stepPx || stepPx <= 0) return value;
  const size = Math.max(1, projectSize);
  return (Math.round((value * size) / stepPx) * stepPx) / size;
}
