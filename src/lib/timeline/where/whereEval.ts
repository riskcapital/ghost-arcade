/**
 * A block's where line at one instant: which spots are lit and how much.
 * Pure (an order cache keyed by its inputs only saves work).
 */
import { computeSpatialOrder, type SpatialOrder, type WhereSpot } from './spatialOrder';
import { resolveOrderSpec, type WhereNamedOrder, type WhereOrderSpec, type WhereSpec } from './whereModel';
import { whereWindowAt, type WhereLineValues, type WhereMotionContext } from './whereMotion';
import { slotWeight, type WhereWindow } from './whereWindow';

export interface WhereResult {
  order: SpatialOrder;
  window: WhereWindow;
  /** Spot id → 0..1 (spots outside the window are left out). */
  weights: Map<string, number>;
}

/** The spots a block's where takes part with. `pieces` limits the pieces (a look block's scope). */
export function whereMembers(spec: Pick<WhereSpec, 'members'>, spots: readonly WhereSpot[], pieces?: ReadonlySet<string> | null): WhereSpot[] {
  return spots.filter((s) => {
    if (s.kind === 'piece') return spec.members !== 'leds' && (!pieces || pieces.has(s.id));
    return spec.members !== 'pieces';
  });
}

const orderCache = new Map<string, { spots: readonly WhereSpot[]; order: SpatialOrder }>();

function orderKey(spec: WhereOrderSpec, aspect: number, spots: readonly WhereSpot[]): string {
  return `${spec.order}|${spec.angle ?? 0}|${spec.groups ? 'g' : ''}|${(spec.hand ?? []).join(',')}|${(spec.slots ?? []).map((s) => s.join(',')).join('/')}|${aspect.toFixed(4)}|${spots.map((s) => `${s.id}@${s.x.toFixed(5)},${s.y.toFixed(5)},${s.group ?? ''}`).join(';')}`;
}

export function cachedOrder(spots: readonly WhereSpot[], spec: WhereOrderSpec, aspect: number): SpatialOrder {
  const key = orderKey(spec, aspect, spots);
  const hit = orderCache.get(key);
  if (hit) return hit.order;
  const order = computeSpatialOrder(spots, spec, aspect);
  if (orderCache.size > 128) orderCache.clear();
  orderCache.set(key, { spots, order });
  return order;
}

export interface WhereEvalInput {
  spec: WhereSpec;
  named?: readonly WhereNamedOrder[];
  /** Every spot on the stage; filtered by the spec's members and `pieces`. */
  spots: readonly WhereSpot[];
  pieces?: ReadonlySet<string> | null;
  aspect?: number;
  time: number;
  start: number;
  ctx: WhereMotionContext;
  lines?: WhereLineValues;
}

export function evaluateWhere(input: WhereEvalInput): WhereResult {
  const members = whereMembers(input.spec, input.spots, input.pieces);
  const order = cachedOrder(members, resolveOrderSpec(input.spec, input.named), input.aspect ?? 16 / 9);
  const n = order.slots.length;
  const window = whereWindowAt(input.spec, input.time, input.start, n, input.ctx, input.lines);
  const weights = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const w = slotWeight(i, n, window);
    if (w <= 0) continue;
    for (const id of order.slots[i]) weights.set(id, w);
  }
  return { order, window, weights };
}

/** Test seam. */
export function _clearWhereOrderCache(): void {
  orderCache.clear();
}
