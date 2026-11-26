/**
 * Geometry helpers for the light-painting draw overlay.
 *
 * The overlay covers the whole (untransformed) viewport; the canvas inside
 * it is offset, then zoomed and panned. Normalized stroke points (0..1 of
 * the canvas) and overlay pixels convert through the same transform in both
 * directions, so handles, previews and pointer input stay aligned at any
 * zoom level.
 */

export interface OverlayView {
  canvasOffsetX: number;
  canvasOffsetY: number;
  canvasWidth: number;
  canvasHeight: number;
  viewportZoom: number;
  viewportPanX: number;
  viewportPanY: number;
}

/** Normalized canvas point → overlay pixel. */
export function normToOverlayPx(nx: number, ny: number, v: OverlayView): { x: number; y: number } {
  return {
    x: (v.canvasOffsetX + nx * v.canvasWidth) * v.viewportZoom + v.viewportPanX,
    y: (v.canvasOffsetY + ny * v.canvasHeight) * v.viewportZoom + v.viewportPanY,
  };
}

/** Overlay pixel → normalized canvas point (inverse of normToOverlayPx). */
export function overlayPxToNorm(px: number, py: number, v: OverlayView): { x: number; y: number } {
  const zoom = v.viewportZoom || 1;
  const vx = (px - v.viewportPanX) / zoom - v.canvasOffsetX;
  const vy = (py - v.viewportPanY) / zoom - v.canvasOffsetY;
  return { x: vx / (v.canvasWidth || 1), y: vy / (v.canvasHeight || 1) };
}

/**
 * One StreamLine step: exponential moving average from the last smoothed
 * point toward the raw pointer position. smoothing 0 = raw input.
 */
export function streamLineStep(
  last: { x: number; y: number } | null,
  raw: { x: number; y: number },
  smoothing: number,
): { x: number; y: number } {
  if (!(smoothing > 0) || !last) return { x: raw.x, y: raw.y };
  const alpha = 1 - Math.min(1, smoothing) * 0.85; // never fully zero
  return {
    x: last.x + (raw.x - last.x) * alpha,
    y: last.y + (raw.y - last.y) * alpha,
  };
}

/**
 * Point to append when the stroke ends so the smoothed line reaches where
 * the pen was lifted instead of stopping short. Null when already there.
 */
export function streamLineCatchUp<T extends { x: number; y: number }>(
  lastStored: { x: number; y: number } | undefined,
  raw: T | null,
  minDist: number,
): T | null {
  if (!raw || !lastStored) return null;
  const dx = raw.x - lastStored.x, dy = raw.y - lastStored.y;
  return dx * dx + dy * dy >= minDist * minDist ? raw : null;
}

/**
 * True when a pointer/mouse press is the viewport's pan gesture (middle
 * button, Alt+left, or Space+left) and must be left to the viewport.
 */
export function isViewportPanGesture(e: { button: number; altKey: boolean }, spaceHeld: boolean): boolean {
  return e.button === 1 || (e.button === 0 && (e.altKey || spaceHeld));
}

/**
 * Identity of the path-edit handle layout. The multi-selection holds handle
 * indices, so it only needs clearing when this changes (different stroke,
 * Show-all toggled, or handles added/removed) — not on every point move
 * while a selection is being dragged.
 */
export function pathEditLayoutKey(
  strokeId: string | null,
  showAllRawPoints: boolean,
  handleCount: number | null,
): string {
  return `${strokeId ?? ''}|${showAllRawPoints ? 1 : 0}|${handleCount ?? -1}`;
}
