/**
 * The where window: which slots of a spatial order are lit, and how much.
 *
 * Slot coordinates: slot i sits at i. Without wrap, position 0..1 maps onto
 * the first..last slot (centre = position × (n − 1)); with wrap the order is
 * a ring of n slots (centre = position × n, the last slot neighbours the
 * first) so a sweep loops without a jump.
 *
 * The window is 1 + spread × (n − 1) slots wide (× n on a ring): spread 0
 * lights one slot, spread 1 lights them all (centred, or anywhere on a ring). Its edge fades over `soft` slots
 * (0 = hard; at 1 two neighbours share the light evenly half-way between
 * them). A slot exactly on a hard edge gets 0.5. Pure.
 */

export interface WhereWindow {
  position: number;
  spread: number;
  soft: number;
  wrap?: boolean;
}

const EPS = 1e-9;
const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
const smoothstep = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};

/** Window centre and half-width in slot units. */
export function windowSpan(n: number, w: WhereWindow): { centre: number; half: number } {
  const p = Number.isFinite(w.position) ? w.position : 0;
  const centre = w.wrap ? (((p % 1) + 1) % 1) * n : clamp01(p) * Math.max(0, n - 1);
  const half = (1 + clamp01(Number.isFinite(w.spread) ? w.spread : 0) * Math.max(0, w.wrap ? n : n - 1)) / 2;
  return { centre, half };
}

/** How lit slot `i` of `n` is (0..1). */
export function slotWeight(i: number, n: number, w: WhereWindow): number {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  const { centre, half } = windowSpan(n, w);
  let d = Math.abs(i - centre);
  if (w.wrap) d = Math.min(d, n - d);
  const soft = clamp01(Number.isFinite(w.soft) ? w.soft : 0);
  if (soft <= EPS) {
    if (d < half - EPS) return 1;
    if (d <= half + EPS) return 0.5;
    return 0;
  }
  return smoothstep((half + soft / 2 - d) / soft);
}

/** Every slot's weight (`out` reused when long enough). */
export function windowWeights(n: number, w: WhereWindow, out?: Float64Array): Float64Array {
  const weights = out && out.length >= n ? out : new Float64Array(n);
  for (let i = 0; i < n; i++) weights[i] = slotWeight(i, n, w);
  return weights;
}
