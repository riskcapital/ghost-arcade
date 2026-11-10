/**
 * Zooming and scrolling the show grid: wheel and pinch zoom anchored at the
 * pointer, the header column's wheel, and the playhead kept on screen.
 */

/** Wheel deltas in pixels, whatever unit the event came in. */
export function wheelPixels(delta: number, deltaMode: number, pageSize = 800): number {
  if (deltaMode === 1) return delta * 16; // lines (Windows mouse wheels, Firefox)
  if (deltaMode === 2) return delta * pageSize; // pages
  return delta;
}

/** Zoom per wheel pixel. A mouse wheel notch (~100 px) is about ×1.28; a
 *  trackpad pinch, which sends many small deltas, zooms smoothly with it. */
const ZOOM_PER_PIXEL = 0.0025;
/** One event never zooms by more than this (a fast flick, a page delta). */
const MAX_STEP = 1.5;

/** The zoom factor for one wheel or pinch event (Ctrl/Cmd + wheel). */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const px = wheelPixels(deltaY, deltaMode);
  if (!Number.isFinite(px) || px === 0) return 1;
  const f = Math.exp(-px * ZOOM_PER_PIXEL);
  return Math.max(1 / MAX_STEP, Math.min(MAX_STEP, f));
}

/**
 * The scrollLeft that keeps show time `time` under the pointer, `pointerX`
 * pixels in from the grid's left edge, at `zoom` pixels per second.
 */
export function anchoredScrollLeft(time: number, zoom: number, pointerX: number): number {
  return Math.max(0, time * zoom - pointerX);
}

/** Room kept to the right of the playhead before the view pages on. */
export const FOLLOW_MARGIN = 24;

/**
 * Playhead follow. When the playhead was on screen and has just moved off it
 * (or into the right-hand margin), the view pages so the playhead sits near
 * the left again. A playhead that was already off screen (the user scrolled
 * away to look at something) is left alone. Returns the new scrollLeft, or
 * null for no change.
 */
export function followScrollLeft(prevX: number | null, x: number, scrollLeft: number, width: number): number | null {
  if (prevX === null || width <= FOLLOW_MARGIN * 2) return null;
  const right = scrollLeft + width - FOLLOW_MARGIN;
  const wasOn = prevX >= scrollLeft && prevX <= right;
  if (!wasOn) return null;
  if (x >= scrollLeft && x <= right) return null;
  return Math.max(0, x - Math.round(width * 0.1));
}
