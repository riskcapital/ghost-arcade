import type { BezierPoint, Layer, MaskShape, MeshPointTangents, Point2D, WarpCorners } from '../types';
import { layerUvToCanvas, canvasToLayerUv, quadInverse, quadPoint } from './layerQuad';
import {
  layerRenderMeshGrid,
  meshTangentSides,
  meshTangentsAfterDrag,
  resolveMeshTangents,
  withMeshPointTangents,
  withMeshPoints,
  type MeshTangentSide,
} from './meshWarp';
import { warpNudgeStepPixels, type WarpGranularity } from './warpNudge';
import { EDGE_CORNERS, translateCorners, type WarpEdge } from './warpDrag';

/**
 * Arrow keys on the mapping canvas.
 *
 * Whatever point was pressed last stays selected (a layer corner or edge, a
 * mesh point or one of its tangent handles, a custom shape vertex or curve
 * handle, a shape warp point, a mask point), and the arrow keys move it one
 * project pixel at a time on screen (Shift ten, Alt a tenth), whatever the
 * layer's warp. With nothing selected they move the selected layers.
 *
 * Everything here is pure so it can be tested: the canvas reads the key,
 * asks planMappingArrowKey what to change, and writes the result.
 */

export type MappingPointRef =
  | { kind: 'corner'; layerId: string; corner: keyof WarpCorners }
  | { kind: 'edge'; layerId: string; edge: WarpEdge }
  | { kind: 'mesh'; layerId: string; row: number; col: number; tangent?: MeshTangentSide }
  | { kind: 'shape-vertex'; layerId: string; index: number; handle?: 'cpIn' | 'cpOut' }
  | { kind: 'shape-control'; layerId: string; index: number }
  | { kind: 'mask-point'; layerId: string; shapeIndex: number; index: number; handle?: 'cpIn' | 'cpOut' };

/** What the canvas is showing besides the layer itself. */
export interface MappingEditContext {
  /** Shape warp editing is on, so its points are showing. */
  shapeWarpEditing: boolean;
  /** The mask pen is open on the selected layer. */
  maskEditing: boolean;
}

type NudgeLayer = Pick<Layer, 'id' | 'type' | 'corners'> &
  Partial<Pick<Layer, 'locked' | 'warpMode' | 'meshGrid' | 'layerShape' | 'mask' | 'parentGroupId'>>;

/** Edge handles are hidden on a shaped layer (its own outline is edited
 *  instead); corner handles on a mesh layer too (the mesh has its own). */
function showsEdgeHandles(layer: NudgeLayer): boolean {
  if (layer.type === 'mask') return false;
  const shape = layer.layerShape;
  return !(shape?.enabled && shape.type && shape.type !== 'rectangle');
}

function showsCornerHandles(layer: NudgeLayer): boolean {
  return layer.warpMode !== 'mesh' && showsEdgeHandles(layer);
}

/**
 * The selected point, if it is still something on the selected layer that
 * the canvas shows and can move. Anything else (a point of another layer,
 * an index that no longer exists, a corner of a layer now in mesh mode)
 * counts as nothing selected.
 */
export function resolveMappingPoint(
  ref: MappingPointRef | null | undefined,
  layer: NudgeLayer | null | undefined,
  ctx: MappingEditContext,
): MappingPointRef | null {
  if (!ref || !layer || ref.layerId !== layer.id) return null;
  switch (ref.kind) {
    case 'corner':
      return showsCornerHandles(layer) && layer.corners?.[ref.corner] ? ref : null;
    case 'edge':
      return showsEdgeHandles(layer) && EDGE_CORNERS[ref.edge] ? ref : null;
    case 'mesh': {
      const grid = layer.meshGrid;
      if (layer.warpMode !== 'mesh' || !grid?.points[ref.row]?.[ref.col]) return null;
      if (!ref.tangent) return ref;
      const keeps = !!grid.bezier && meshTangentSides(grid, ref.row, ref.col).includes(ref.tangent);
      return keeps ? ref : { kind: 'mesh', layerId: ref.layerId, row: ref.row, col: ref.col };
    }
    case 'shape-vertex': {
      const shape = layer.layerShape;
      if (shape?.type !== 'custom' || !shape.params?.customClosed) return null;
      const point = (shape.params.customPoints ?? [])[ref.index];
      if (!point) return null;
      if (ref.handle && !point[ref.handle]) return { kind: 'shape-vertex', layerId: ref.layerId, index: ref.index };
      return ref;
    }
    case 'shape-control':
      return ctx.shapeWarpEditing && layer.layerShape?.controlPoints?.[ref.index] ? ref : null;
    case 'mask-point': {
      if (!ctx.maskEditing || !layer.mask?.enabled) return null;
      const point = layer.mask.shapes?.[ref.shapeIndex]?.points[ref.index];
      if (!point) return null;
      if (ref.handle && !point[ref.handle]) return { kind: 'mask-point', layerId: ref.layerId, shapeIndex: ref.shapeIndex, index: ref.index };
      return ref;
    }
  }
  return null;
}

/** True when the selection is a curve handle rather than a point: Alt then
 *  moves that handle on its own instead of making the step finer. */
export function selectsHandle(ref: MappingPointRef | null): boolean {
  if (!ref) return false;
  if (ref.kind === 'mesh') return !!ref.tangent;
  if (ref.kind === 'shape-vertex' || ref.kind === 'mask-point') return !!ref.handle;
  return false;
}

// ─── Keys ─────────────────────────────────────────────────────────────────

/** An arrow key's direction on screen (y down), or null. */
export function arrowDirection(key: string): { x: number; y: number } | null {
  switch (key) {
    case 'ArrowLeft': return { x: -1, y: 0 };
    case 'ArrowRight': return { x: 1, y: 0 };
    case 'ArrowUp': return { x: 0, y: -1 };
    case 'ArrowDown': return { x: 0, y: 1 };
    default: return null;
  }
}

/** One press, in project pixels: the drag granularity step, Shift ten
 *  times, `fine` (Alt) a tenth. */
export function nudgeStepPixels(granularity: WarpGranularity | undefined, shift: boolean, fine: boolean): number {
  return warpNudgeStepPixels(granularity) * (shift ? 10 : fine ? 0.1 : 1);
}

/**
 * A move of (dxPx, dyPx) project pixels on screen (y down) as a canvas
 * offset. Layers keep y up, so screen-up is +y there; screens and the
 * Master Warp keep y down.
 */
export function projectPixelOffset(dxPx: number, dyPx: number, projectWidth: number, projectHeight: number, yUp: boolean): Point2D {
  return {
    x: dxPx / Math.max(1, projectWidth),
    y: (yUp ? 0 - dyPx : dyPx) / Math.max(1, projectHeight),
  };
}

/** What had focus when the key was pressed. Arrow keys belong to typing
 *  fields and to controls that use them (sliders, lists, menus, dialogs). */
export type ArrowKeyTarget = 'text' | 'adjust' | 'other';

interface KeyTargetLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week']);
const ARROW_ROLES = new Set(['slider', 'spinbutton', 'listbox', 'option', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'combobox', 'radiogroup', 'radio', 'tab', 'tablist', 'tree', 'treeitem', 'grid', 'gridcell', 'scrollbar']);
const ARROW_CONTAINERS = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog, [role="listbox"], [role="menu"], [role="menubar"], [role="tablist"], [role="radiogroup"], [role="tree"], [role="grid"]';

export function classifyKeyTarget(el: KeyTargetLike | null | undefined): ArrowKeyTarget {
  if (!el || !el.tagName) return 'other';
  const tag = el.tagName.toUpperCase();
  if (el.isContentEditable || tag === 'TEXTAREA') return 'text';
  if (tag === 'INPUT') {
    const type = (el.type ?? 'text').toLowerCase();
    if (TEXT_INPUT_TYPES.has(type)) return 'text';
    if (type === 'range' || type === 'radio' || type === 'color') return 'adjust';
    return 'other';
  }
  if (tag === 'SELECT') return 'adjust';
  const role = el.getAttribute?.('role');
  if (role === 'textbox') return 'text';
  if (role && ARROW_ROLES.has(role)) return 'adjust';
  if (el.closest?.(ARROW_CONTAINERS)) return 'adjust';
  return 'other';
}

/** The arrow keys move mapping points only when nothing else wants them. */
export function arrowKeysFree(press: { metaKey: boolean; ctrlKey: boolean; target: ArrowKeyTarget; focus: ArrowKeyTarget }): boolean {
  return !press.metaKey && !press.ctrlKey && press.target === 'other' && press.focus === 'other';
}

// ─── Moving points ────────────────────────────────────────────────────────

const add = (p: Point2D, d: Point2D): Point2D => ({ x: p.x + d.x, y: p.y + d.y });
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function moveBezierPoint(point: BezierPoint, to: Point2D): BezierPoint {
  const dx = to.x - point.x;
  const dy = to.y - point.y;
  const next: BezierPoint = { ...point, x: to.x, y: to.y };
  if (point.cpIn) next.cpIn = { x: point.cpIn.x + dx, y: point.cpIn.y + dy };
  if (point.cpOut) next.cpOut = { x: point.cpOut.x + dx, y: point.cpOut.y + dy };
  return next;
}

/** A curve handle moved to `to`; its partner mirrors through the point
 *  unless `unlink`. */
function moveBezierHandle(point: BezierPoint, handle: 'cpIn' | 'cpOut', to: Point2D, unlink: boolean): BezierPoint {
  const other = handle === 'cpIn' ? 'cpOut' : 'cpIn';
  const next: BezierPoint = { ...point, [handle]: to };
  if (!unlink && point[other]) next[other] = { x: 2 * point.x - to.x, y: 2 * point.y - to.y };
  return next;
}

/**
 * The change one arrow press makes to the selected point, as a layer patch
 * (null when there is nothing to move). `offset` is the move on the canvas
 * (normalized, y up); `unlink` moves a curve handle without its partner.
 */
export function nudgeMappingPoint(
  layer: NudgeLayer,
  ref: MappingPointRef,
  offset: Point2D,
  unlink = false,
): Partial<Layer> | null {
  if (layer.locked) return null;
  switch (ref.kind) {
    case 'corner': {
      const c = layer.corners[ref.corner];
      return c ? { corners: { ...layer.corners, [ref.corner]: add(c, offset) } } : null;
    }
    case 'edge': {
      const [a, b] = EDGE_CORNERS[ref.edge];
      return { corners: { ...layer.corners, [a]: add(layer.corners[a], offset), [b]: add(layer.corners[b], offset) } };
    }
    case 'mesh': {
      // Mesh points sit inside the corner quad: move the point where it is
      // drawn and map back, so it moves straight across the screen however
      // the quad is sized or turned.
      const grid = layer.meshGrid;
      const p = grid?.points[ref.row]?.[ref.col];
      if (!grid || !p) return null;
      if (ref.tangent) {
        const t = resolveMeshTangents(grid, ref.row, ref.col)[ref.tangent];
        const end = quadInverse(layer.corners, add(quadPoint(layer.corners, p.x + t.x, p.y + t.y), offset));
        if (!end) return null;
        const tangents: MeshPointTangents = meshTangentsAfterDrag(grid, ref.row, ref.col, ref.tangent, { x: end.x - p.x, y: end.y - p.y }, unlink);
        return { meshGrid: withMeshPointTangents(grid, ref.row, ref.col, tangents) };
      }
      const local = quadInverse(layer.corners, add(quadPoint(layer.corners, p.x, p.y), offset));
      if (!local) return null;
      const points = grid.points.map((row, r) => row.map((pt, c) => (r === ref.row && c === ref.col ? local : pt)));
      return { meshGrid: withMeshPoints(grid, points) };
    }
    case 'shape-vertex': {
      // Vertices are in layer UV and drawn through the mesh and corners.
      const shape = layer.layerShape;
      const points = (shape?.params?.customPoints ?? []) as BezierPoint[];
      const point = points[ref.index];
      if (!shape || !point) return null;
      const mesh = layerRenderMeshGrid({ warpMode: layer.warpMode ?? 'corners', meshGrid: layer.meshGrid ?? null });
      const from = ref.handle ? point[ref.handle] : point;
      if (!from) return null;
      const to = canvasToLayerUv(layer.corners, mesh, add(layerUvToCanvas(layer.corners, mesh, from), offset));
      if (!to) return null;
      const moved = ref.handle ? moveBezierHandle(point, ref.handle, to, unlink) : moveBezierPoint(point, to);
      return {
        layerShape: {
          ...shape,
          params: { ...shape.params, customPoints: points.map((p, i) => (i === ref.index ? moved : p)) },
        },
      };
    }
    case 'shape-control': {
      // Shape warp points are drawn through the corners; like their drag,
      // they stay on the layer.
      const shape = layer.layerShape;
      const p = shape?.controlPoints?.[ref.index];
      if (!shape?.controlPoints || !p) return null;
      const local = quadInverse(layer.corners, add(quadPoint(layer.corners, p.x, p.y), offset));
      if (!local) return null;
      const next = { x: clamp01(local.x), y: clamp01(local.y) };
      return { layerShape: { ...shape, controlPoints: shape.controlPoints.map((q, i) => (i === ref.index ? next : q)) } };
    }
    case 'mask-point': {
      // Mask points are canvas positions, kept on the canvas like their drag.
      const mask = layer.mask;
      const shape = mask?.shapes?.[ref.shapeIndex];
      const point = shape?.points[ref.index];
      if (!mask || !shape || !point) return null;
      const from = ref.handle ? point[ref.handle] : point;
      if (!from) return null;
      const to = { x: clamp01(from.x + offset.x), y: clamp01(from.y + offset.y) };
      const moved = ref.handle ? moveBezierHandle(point, ref.handle, to, unlink) : moveBezierPoint(point, to);
      const shapes: MaskShape[] = mask.shapes.map((s, si) => (si !== ref.shapeIndex ? s : {
        ...s,
        points: s.points.map((p, pi) => (pi === ref.index ? moved : p)),
      }));
      return { mask: { ...mask, shapes } };
    }
  }
  return null;
}

/**
 * The layers that move when the arrows move whole layers: the selected
 * ones (or the primary alone), with every layer inside a selected group,
 * leaving out locked ones and mask layers.
 */
export function layersMovedTogether(
  layers: Array<Pick<Layer, 'id' | 'type'> & Partial<Pick<Layer, 'locked' | 'parentGroupId'>>>,
  primaryId: string | null | undefined,
  selectedIds: readonly string[],
): string[] {
  const ids = new Set<string>(selectedIds.length ? selectedIds : primaryId ? [primaryId] : []);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of layers) {
      if (!ids.has(l.id) && l.parentGroupId && ids.has(l.parentGroupId)) {
        ids.add(l.id);
        grew = true;
      }
    }
  }
  return layers.filter((l) => ids.has(l.id) && !l.locked && l.type !== 'mask').map((l) => l.id);
}

// ─── One key press ────────────────────────────────────────────────────────

export interface MappingKeyPress {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  /** The element the key went to. */
  target: ArrowKeyTarget;
  /** The focused element. */
  focus: ArrowKeyTarget;
}

export interface MappingKeyState {
  layer: NudgeLayer | null;
  layers: NudgeLayer[];
  selectedIds: readonly string[];
  selection: MappingPointRef | null;
  ctx: MappingEditContext;
  granularity: WarpGranularity | undefined;
  projectWidth: number;
  projectHeight: number;
}

export type MappingKeyPlan =
  | { type: 'nudge'; patches: Array<{ layerId: string; patch: Partial<Layer> }> }
  | { type: 'release-handle'; selection: MappingPointRef }
  | { type: 'clear-selection' };

/** What an arrow key or Escape does on the mapping canvas, or null when it
 *  is not the canvas's to handle. */
export function planMappingArrowKey(press: MappingKeyPress, state: MappingKeyState): MappingKeyPlan | null {
  if (press.key === 'Escape') {
    if (press.target === 'text' || press.focus === 'text' || !state.selection) return null;
    const ref = resolveMappingPoint(state.selection, state.layer, state.ctx);
    // A selected curve handle lets go first, then the point.
    if (ref && selectsHandle(ref)) {
      const point: MappingPointRef = ref.kind === 'mesh'
        ? { kind: 'mesh', layerId: ref.layerId, row: ref.row, col: ref.col }
        : ref.kind === 'shape-vertex'
          ? { kind: 'shape-vertex', layerId: ref.layerId, index: ref.index }
          : ref.kind === 'mask-point'
            ? { kind: 'mask-point', layerId: ref.layerId, shapeIndex: ref.shapeIndex, index: ref.index }
            : ref;
      return { type: 'release-handle', selection: point };
    }
    return { type: 'clear-selection' };
  }
  const dir = arrowDirection(press.key);
  if (!dir || !state.layer || !arrowKeysFree(press)) return null;
  const ref = resolveMappingPoint(state.selection, state.layer, state.ctx);
  // A selection that no longer fits (its point is gone, the layer changed
  // mode) lets go; this press moves nothing rather than the whole layer.
  if (state.selection && !ref) return { type: 'clear-selection' };
  const handle = selectsHandle(ref);
  const step = nudgeStepPixels(state.granularity, press.shiftKey, press.altKey && !handle);
  const offset = projectPixelOffset(dir.x * step, dir.y * step, state.projectWidth, state.projectHeight, true);
  if (ref) {
    const patch = nudgeMappingPoint(state.layer, ref, offset, press.altKey && handle);
    return { type: 'nudge', patches: patch ? [{ layerId: state.layer.id, patch }] : [] };
  }
  if (state.layer.type === 'mask') return null;
  const byId = new Map(state.layers.map((l) => [l.id, l]));
  const patches = layersMovedTogether(state.layers, state.layer.id, state.selectedIds)
    .map((id) => byId.get(id)!)
    .filter((l) => !!l.corners)
    .map((l) => ({ layerId: l.id, patch: { corners: translateCorners(l.corners, offset) } as Partial<Layer> }));
  return { type: 'nudge', patches };
}
