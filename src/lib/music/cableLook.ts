/**
 * How a patch cable looks, shared by every patchable instrument (the Music
 * Studio, Analog Synth): its colours and how it hangs between two jacks. The
 * strokes themselves are in components/music/cableStyles.css.
 */

export const CABLE_COLORS = ['#5278ff', '#a8bcff', '#7ec8e3', '#ff8577', '#e6ebf7'];

/** The colour of the cable in a drag, before it is plugged. */
export const CABLE_LIVE_COLOR = '#a8bcff';

/**
 * A cable hangs: the lower the ends and the longer the run, the deeper the
 * sag. `floor`, when given, is the lowest the cable may hang (the bottom of
 * the panel), so cables between low jacks stay in view.
 */
export function cablePath(x1: number, y1: number, x2: number, y2: number, floor?: number): string {
  const sag = Math.min(130, 24 + Math.hypot(x2 - x1, y2 - y1) * 0.12);
  // The curve's lowest point is three quarters of the way to its control points.
  const deepest = floor === undefined ? Infinity : (floor - (y1 + y2) / 8) / 0.75;
  const low = Math.max(Math.max(y1, y2) + 6, Math.min(Math.max(y1, y2) + sag, deepest));
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + (x2 - x1) * 0.2).toFixed(1)} ${low.toFixed(1)}, ${(x2 - (x2 - x1) * 0.2).toFixed(1)} ${low.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}
