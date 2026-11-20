/**
 * Where the Live key bar sits. Across the top of the canvas it covered the
 * selected layer's rotate handle (it sits above the layer's top edge). It
 * goes beside the canvas when there is room, else along its bottom edge.
 */
export interface LiveBarPlace {
  /** px from the viewport's left; with `centered`, the bar's middle. */
  left: number;
  /** px from the viewport's top; with `above`, the bar's bottom edge. */
  top: number;
  centered: boolean;
  above: boolean;
  /** Beside the canvas: the most it may take (its message ellipsizes). */
  maxWidth: number | null;
}

export const LIVE_BAR_ROOM = 300;

export function liveEditBarPlace(canvas: { x: number; y: number; width: number; height: number }, room = LIVE_BAR_ROOM): LiveBarPlace {
  if (canvas.x >= room + 24) return { left: 12, top: canvas.y + 10, centered: false, above: false, maxWidth: canvas.x - 24 };
  return { left: canvas.x + canvas.width / 2, top: canvas.y + canvas.height - 10, centered: true, above: true, maxWidth: null };
}
