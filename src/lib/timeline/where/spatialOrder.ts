/**
 * Spatial order of the stage: the pieces (and LED fixtures) taking part in a
 * where line, ordered by where they sit.
 *
 * A spot is a piece's outline centroid or an LED fixture's mapped centre, in
 * output coordinates (0..1, y down: the top of the picture is 0). Orders:
 *
 *   left-right / right-left   by x, ties by y (top first), then list order
 *   top-bottom / bottom-top   by y, ties by x (left first), then list order
 *   centre-out                by distance from the centre of the spots' box
 *                             (x measured on the output aspect), ties by angle
 *   around                    by angle about that centre, clockwise from
 *                             `angle` degrees (0 = 12 o'clock), ties nearer first
 *   hand                      the listed ids in order, the rest left to right
 *   slots (given)             sets of ids in the order given (only those)
 *
 * With `groups`, the members of a group are one slot (they light together),
 * placed at their mean position. Pure.
 */
import type { Layer, WLEDController } from '../../types';
import { getShapeVertices } from '../../types';
import { isLookTarget } from '../../looks/edgeLooks';
import { resolveWLEDMapping } from '../../wled/mapping';
import type { WhereOrderSpec } from './whereModel';

export interface WhereSpot {
  /** A piece's layer id, or an LED fixture's id (`led:<controller>` / `led:<controller>#<range>`). */
  id: string;
  kind: 'piece' | 'led';
  /** Centre, output 0..1, y down. */
  x: number;
  y: number;
  /** A piece's group (its parent group's id). */
  group?: string;
  label: string;
}

/** Ordered slots: each slot is one or more spot ids (a group is one slot). */
export interface SpatialOrder {
  slots: string[][];
  /** Spot id → slot index. */
  slotOf: Map<string, number>;
}

const EPS = 1e-6;

export const LED_SPOT_PREFIX = 'led:';

export function ledSpotId(controllerId: string, rangeId?: string | null): string {
  return rangeId ? `${LED_SPOT_PREFIX}${controllerId}#${rangeId}` : `${LED_SPOT_PREFIX}${controllerId}`;
}

/** `led:<controller>[#<range>]` → its parts, else null. */
export function parseLedSpotId(id: string): { controllerId: string; rangeId: string | null } | null {
  if (!id.startsWith(LED_SPOT_PREFIX)) return null;
  const rest = id.slice(LED_SPOT_PREFIX.length);
  const cut = rest.indexOf('#');
  return cut < 0 ? { controllerId: rest, rangeId: null } : { controllerId: rest.slice(0, cut), rangeId: rest.slice(cut + 1) };
}

/** Centroid of a layer's outline (output 0..1, y down), as the stage draws it. */
export function pieceCentre(layer: Pick<Layer, 'corners' | 'layerShape'>): { x: number; y: number } | null {
  const c = layer.corners;
  if (!c) return null;
  const shape = layer.layerShape;
  const uv = shape && shape.enabled !== false ? getShapeVertices(shape) : [];
  const pts = uv.length >= 3 ? uv : [{ x: 0.5, y: 0.5 }];
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    const topX = c.topLeft.x + (c.topRight.x - c.topLeft.x) * p.x;
    const topY = c.topLeft.y + (c.topRight.y - c.topLeft.y) * p.x;
    const botX = c.bottomLeft.x + (c.bottomRight.x - c.bottomLeft.x) * p.x;
    const botY = c.bottomLeft.y + (c.bottomRight.y - c.bottomLeft.y) * p.x;
    sx += botX + (topX - botX) * p.y;
    sy += botY + (topY - botY) * p.y;
  }
  // Layer corners are y up; spots are y down like the LED maps.
  return { x: sx / pts.length, y: 1 - sy / pts.length };
}

/** The pieces on the stage as spots (`only`: just these layer ids). */
export function pieceSpots(layers: readonly Layer[], only?: ReadonlySet<string> | null): WhereSpot[] {
  const out: WhereSpot[] = [];
  for (const layer of layers) {
    if (!isLookTarget(layer)) continue;
    if (only && !only.has(layer.id)) continue;
    const c = pieceCentre(layer);
    if (!c) continue;
    out.push({ id: layer.id, kind: 'piece', x: c.x, y: c.y, label: layer.name || layer.id, ...(layer.parentGroupId ? { group: layer.parentGroupId } : {}) });
  }
  return out;
}

/** An LED controller's fixtures as spots: one per named range, else the whole strip. */
export function ledSpots(controllers: readonly WLEDController[], aspect = 16 / 9): WhereSpot[] {
  const out: WhereSpot[] = [];
  for (const c of controllers) {
    const mapping = resolveWLEDMapping(c.ledCount, c.mapping, aspect);
    const pts = mapping.points;
    const centreOf = (start: number, count: number) => {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let i = start; i < Math.min(pts.length, start + count); i++) {
        sx += pts[i].x;
        sy += pts[i].y;
        n++;
      }
      return n ? { x: sx / n, y: sy / n } : { x: 0.5, y: 0.5 };
    };
    const ranges = (c.ranges ?? []).filter((r) => r.count > 0);
    if (ranges.length) {
      for (const r of ranges) {
        const at = centreOf(r.start, r.count);
        out.push({ id: ledSpotId(c.id, r.id), kind: 'led', ...at, label: `${c.name} · ${r.name}` });
      }
    } else {
      out.push({ id: ledSpotId(c.id), kind: 'led', ...centreOf(0, pts.length), label: c.name });
    }
  }
  return out;
}

interface Slot {
  ids: string[];
  x: number;
  y: number;
  index: number;
}

function slotsOf(spots: readonly WhereSpot[], groups: boolean): Slot[] {
  if (!groups) return spots.map((s, index) => ({ ids: [s.id], x: s.x, y: s.y, index }));
  const out: Slot[] = [];
  const byGroup = new Map<string, Slot & { n: number }>();
  spots.forEach((s, index) => {
    if (!s.group) {
      out.push({ ids: [s.id], x: s.x, y: s.y, index });
      return;
    }
    let g = byGroup.get(s.group);
    if (!g) {
      g = { ids: [], x: 0, y: 0, index, n: 0 };
      byGroup.set(s.group, g);
      out.push(g);
    }
    g.ids.push(s.id);
    g.x = (g.x * g.n + s.x) / (g.n + 1);
    g.y = (g.y * g.n + s.y) / (g.n + 1);
    g.n++;
  });
  return out;
}

function cmp(a: number, b: number): number {
  return Math.abs(a - b) <= EPS ? 0 : a < b ? -1 : 1;
}

/** The order a spec gives as its slots (sets of ids, in order): only the
 *  listed spots that are on the stage, empty slots left out. */
function givenSlots(spots: readonly WhereSpot[], given: readonly string[][]): SpatialOrder {
  const here = new Set(spots.map((s) => s.id));
  const slots = given.map((slot) => slot.filter((id) => here.has(id))).filter((slot) => slot.length > 0);
  const slotOf = new Map<string, number>();
  slots.forEach((ids, i) => { for (const id of ids) if (!slotOf.has(id)) slotOf.set(id, i); });
  return { slots, slotOf };
}

/** Slots in the order a spec asks for. `aspect` = output width / height. */
export function computeSpatialOrder(spots: readonly WhereSpot[], spec: WhereOrderSpec, aspect = 16 / 9): SpatialOrder {
  if (spec.slots?.length) return givenSlots(spots, spec.slots);
  const slots = slotsOf(spots, spec.groups === true);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of slots) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minY = Math.min(minY, s.y);
    maxY = Math.max(maxY, s.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const a = aspect > 0 ? aspect : 16 / 9;
  const dist = (s: Slot) => Math.hypot((s.x - cx) * a, s.y - cy);
  const start = ((spec.angle ?? 0) % 360 + 360) % 360;
  /** Clockwise from 12 o'clock (y down), minus the start, 0..360. */
  const angle = (s: Slot) => {
    if (Math.hypot((s.x - cx) * a, s.y - cy) <= EPS) return 0;
    const deg = (Math.atan2((s.x - cx) * a, -(s.y - cy)) * 180) / Math.PI;
    const v = ((deg - start) % 360 + 360) % 360;
    return v >= 360 - EPS ? 0 : v;
  };
  const leftRight = (p: Slot, q: Slot) => cmp(p.x, q.x) || cmp(p.y, q.y) || p.index - q.index;
  let order: Slot[];
  switch (spec.order) {
    case 'right-left':
      order = [...slots].sort((p, q) => cmp(q.x, p.x) || cmp(p.y, q.y) || p.index - q.index);
      break;
    case 'top-bottom':
      order = [...slots].sort((p, q) => cmp(p.y, q.y) || cmp(p.x, q.x) || p.index - q.index);
      break;
    case 'bottom-top':
      order = [...slots].sort((p, q) => cmp(q.y, p.y) || cmp(p.x, q.x) || p.index - q.index);
      break;
    case 'centre-out':
      order = [...slots].sort((p, q) => cmp(dist(p), dist(q)) || cmp(angle(p), angle(q)) || p.index - q.index);
      break;
    case 'around':
      order = [...slots].sort((p, q) => cmp(angle(p), angle(q)) || cmp(dist(p), dist(q)) || p.index - q.index);
      break;
    case 'hand': {
      const rank = new Map<string, number>();
      (spec.hand ?? []).forEach((id, i) => { if (!rank.has(id)) rank.set(id, i); });
      const rankOf = (s: Slot) => Math.min(...s.ids.map((id) => rank.get(id) ?? Infinity));
      order = [...slots].sort((p, q) => {
        const rp = rankOf(p);
        const rq = rankOf(q);
        if (rp !== rq) return rp < rq ? -1 : 1;
        return leftRight(p, q);
      });
      break;
    }
    case 'left-right':
    default:
      order = [...slots].sort(leftRight);
  }
  const slotOf = new Map<string, number>();
  order.forEach((s, i) => { for (const id of s.ids) slotOf.set(id, i); });
  return { slots: order.map((s) => s.ids), slotOf };
}
