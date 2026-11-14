/**
 * Zoom and pan of the mapping canvas, and the steps of the nudge pad.
 *
 * The canvas is drawn at `scale` and moved by `x`, `y` screen pixels from
 * the top-left of its frame (CSS: translate(x, y) scale(scale), origin 0 0).
 */
export type View = { scale: number; x: number; y: number };
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
export const IDENTITY: View = { scale: 1, x: 0, y: 0 };

/** Keep the canvas covering the frame, with a margin to reach points just off the edge. */
export function clampView(v: View, width: number, height: number, margin = 0.2): View {
  const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number.isFinite(v.scale) ? v.scale : 1));
  if (scale <= MIN_ZOOM + 1e-3) return { ...IDENTITY };
  const mx = width * margin,
    my = height * margin;
  const x = Math.max(width - width * scale - mx, Math.min(mx, v.x));
  const y = Math.max(height - height * scale - my, Math.min(my, v.y));
  return { scale, x, y };
}

/**
 * A two-finger gesture. `start` is the view and the fingers' centre and
 * spread when the second finger landed; `now` is where they are. The point
 * of the canvas that was under the centre stays under it.
 */
export function pinchView(
  start: View,
  from: { x: number; y: number; spread: number },
  now: { x: number; y: number; spread: number },
  width: number,
  height: number,
): View {
  const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, start.scale * (now.spread / Math.max(1, from.spread))));
  const cx = (from.x - start.x) / start.scale,
    cy = (from.y - start.y) / start.scale;
  return clampView({ scale, x: now.x - cx * scale, y: now.y - cy * scale }, width, height);
}

/** Zoom by `factor` about a point of the frame (double-tap, buttons). */
export function zoomAt(v: View, factor: number, at: { x: number; y: number }, width: number, height: number): View {
  const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.scale * factor));
  const cx = (at.x - v.x) / v.scale,
    cy = (at.y - v.y) / v.scale;
  return clampView({ scale, x: at.x - cx * scale, y: at.y - cy * scale }, width, height);
}

/** The view that centres a normalised point of the canvas at the given zoom. */
export function focusView(point: { x: number; y: number }, scale: number, width: number, height: number): View {
  return clampView({ scale, x: width / 2 - point.x * width * scale, y: height / 2 - point.y * height * scale }, width, height);
}

/** Output size the nudge pad counts pixels in: the connected display, else 1920 × 1080. */
export function nudgeBasis(display?: { width: number; height: number } | null): { width: number; height: number } {
  const w = Math.round(Number(display?.width)),
    h = Math.round(Number(display?.height));
  return w >= 320 && h >= 200 ? { width: w, height: h } : { width: 1920, height: 1080 };
}

/** One nudge of `pixels` output pixels along x and y, as a normalised step. */
export function nudgeDelta(dx: number, dy: number, pixels: number, basis: { width: number; height: number }) {
  return { x: (dx * pixels) / basis.width, y: (dy * pixels) / basis.height };
}

/** A normalised position as output pixels, to one decimal place. */
export function inPixels(p: { x: number; y: number }, basis: { width: number; height: number }) {
  return { x: Math.round(p.x * basis.width * 10) / 10, y: Math.round(p.y * basis.height * 10) / 10 };
}
