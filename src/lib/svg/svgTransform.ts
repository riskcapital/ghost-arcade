/**
 * The SVG layer's transform (pan, scale, rotate) as the canvas gizmo, the
 * inspector sliders and the renderers all read it. One set of limits, so a
 * value the gizmo sets is one the sliders can show and the renderer draws.
 */

/** Pan is in half-canvas units: ±1 puts the centre on the canvas edge. */
export const SVG_PAN_MIN = -2;
export const SVG_PAN_MAX = 2;
export const SVG_SCALE_MIN = 0.05;
export const SVG_SCALE_MAX = 8;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const clampSvgPan = (v: number) => clamp(v, SVG_PAN_MIN, SVG_PAN_MAX);
export const clampSvgScale = (v: number) => clamp(v, SVG_SCALE_MIN, SVG_SCALE_MAX);

/**
 * Pointer travel (screen pixels) to pan travel. The gizmo sits inside the
 * zoomed viewport, so a pixel on screen is 1/zoom of a canvas pixel: without
 * this the picture ran ahead of the pointer when zoomed in and lagged it
 * when zoomed out.
 */
export function svgPanDelta(
  dxScreen: number,
  dyScreen: number,
  canvasWidth: number,
  canvasHeight: number,
  zoom: number,
): { x: number; y: number } {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const w = Math.max(1, canvasWidth);
  const h = Math.max(1, canvasHeight);
  return { x: (dxScreen * 2) / (w * z), y: (dyScreen * 2) / (h * z) };
}

export type GizmoShortcut =
  | { kind: 'mode'; mode: 'move' | 'rotate' | 'scale' }
  | { kind: 'axis'; axis: 'x' | 'y' | 'z' }
  | { kind: 'frame' };

/**
 * The gizmo's single-key shortcuts (W/E/S, X/Y/Z, F). A key held with
 * Cmd, Ctrl or Alt belongs to the app (Undo, Save, Cut, Close…), never to
 * the gizmo.
 */
export function gizmoShortcutFor(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>): GizmoShortcut | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = (event.key ?? '').toLowerCase();
  if (key === 'w') return { kind: 'mode', mode: 'move' };
  if (key === 'e') return { kind: 'mode', mode: 'rotate' };
  if (key === 's') return { kind: 'mode', mode: 'scale' };
  if (key === 'x' || key === 'y' || key === 'z') return { kind: 'axis', axis: key };
  if (key === 'f') return { kind: 'frame' };
  return null;
}
