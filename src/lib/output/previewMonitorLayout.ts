/**
 * Where the Preview monitor's pictures go. Multiview is the broadcast
 * arrangement: the program large on the left, Deck A over Deck B on the
 * right, a status line along the bottom. Program only fills the screen
 * above the status line. Every picture keeps the output's shape, letterboxed
 * in its cell, with room above it for its name.
 */

export type PreviewMonitorLayout = 'multiview' | 'program';
export type PreviewTile = 'program' | 'deck-a' | 'deck-b';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewMonitorGeometry {
  /** The picture itself, where the presenter draws. */
  tiles: Partial<Record<PreviewTile, Rect>>;
  /** Each picture's name plate, just above it. */
  labels: Partial<Record<PreviewTile, Rect>>;
  status: Rect;
}

export interface PreviewMonitorSpacing {
  /** Space around and between the cells. */
  gap: number;
  /** A name plate's height. */
  label: number;
  /** The status line's height. */
  status: number;
}

/** Spacing for a screen of this height: a 1080p display gets 16 / 28 / 64 px. */
export function previewMonitorSpacing(height: number): PreviewMonitorSpacing {
  const unit = Math.max(0.5, Math.min(2, height / 1080));
  return { gap: Math.round(16 * unit), label: Math.round(28 * unit), status: Math.round(64 * unit) };
}

/** The largest rectangle of this shape inside a cell, centred, in whole pixels. */
export function fitAspect(cell: Rect, aspect: number): Rect {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  let width = cell.width;
  let height = width / a;
  if (height > cell.height) {
    height = cell.height;
    width = height * a;
  }
  const x = Math.round(cell.x + (cell.width - width) / 2);
  const y = Math.round(cell.y + (cell.height - height) / 2);
  return { x, y, width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/** A picture in a cell, its name plate taking the top of the cell. */
function placeTile(cell: Rect, aspect: number, labelHeight: number): { tile: Rect; label: Rect } {
  const tile = fitAspect({ x: cell.x, y: cell.y + labelHeight, width: cell.width, height: Math.max(1, cell.height - labelHeight) }, aspect);
  // The plate sits on the picture's top edge, as wide as the picture.
  return { tile, label: { x: tile.x, y: tile.y - labelHeight, width: tile.width, height: labelHeight } };
}

/**
 * The geometry for a screen `width` x `height` (CSS pixels) showing pictures
 * of shape `aspect`. Multiview without decks (the crossfader off) shows the
 * program alone: Deck A would only repeat it.
 */
export function previewMonitorGeometry(
  width: number,
  height: number,
  aspect: number,
  layout: PreviewMonitorLayout,
  decks: boolean,
): PreviewMonitorGeometry {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const { gap, label, status } = previewMonitorSpacing(h);
  const statusRect: Rect = { x: gap, y: h - gap - status, width: Math.max(1, w - gap * 2), height: status };
  const top = gap;
  const bottom = statusRect.y - gap;
  const area: Rect = { x: gap, y: top, width: Math.max(1, w - gap * 2), height: Math.max(1, bottom - top) };
  const tiles: PreviewMonitorGeometry['tiles'] = {};
  const labels: PreviewMonitorGeometry['labels'] = {};

  if (layout === 'program' || !decks) {
    const placed = placeTile(area, aspect, label);
    tiles.program = placed.tile;
    labels.program = placed.label;
    return { tiles, labels, status: statusRect };
  }

  // Two thirds for the program, a third for the decks stacked.
  const programWidth = Math.round((area.width - gap) * (2 / 3));
  const programCell: Rect = { x: area.x, y: area.y, width: programWidth, height: area.height };
  const deckX = area.x + programWidth + gap;
  const deckWidth = Math.max(1, area.x + area.width - deckX);
  const deckHeight = Math.max(1, Math.floor((area.height - gap) / 2));
  const program = placeTile(programCell, aspect, label);
  const a = placeTile({ x: deckX, y: area.y, width: deckWidth, height: deckHeight }, aspect, label);
  const b = placeTile({ x: deckX, y: area.y + deckHeight + gap, width: deckWidth, height: deckHeight }, aspect, label);
  tiles.program = program.tile;
  labels.program = program.label;
  tiles['deck-a'] = a.tile;
  labels['deck-a'] = a.label;
  tiles['deck-b'] = b.tile;
  labels['deck-b'] = b.label;
  return { tiles, labels, status: statusRect };
}

/** An SVG path covering the screen except the pictures (fill-rule evenodd), so they show through. */
export function maskPath(width: number, height: number, holes: Rect[]): string {
  const outer = `M0 0H${width}V${height}H0Z`;
  return outer + holes.map((r) => `M${r.x} ${r.y}h${r.width}v${r.height}h${-r.width}Z`).join('');
}
