// Atlas layout packer for multi-slice zero-copy senders.
//
// Packs every Spout/Syphon *sender* slice into a single atlas canvas:
// each slice occupies a rectangular tile at its OUTPUT resolution
// (rotation-aware). The slice-atlas OSR window renders each slice into
// its tile; the native addon sub-copies each tile into a per-name sender
// from the one captured atlas texture. Tiles carry a 1px gap (`pad`) so
// edge-blend gradients never sample a neighbour.
//
// Coordinates: tile (x, y) is TOP-LEFT in atlas pixels (the convention
// the native sub-copy uses). The GL renderer converts to bottom-left.

import type { OutputSlice } from '../stores/settings';

export interface AtlasTile {
  sliceId: string;
  senderName: string;
  outputType: 'spout' | 'syphon';
  /** Top-left + size of this slice's tile within the atlas, in pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasLayout {
  atlasW: number;
  atlasH: number;
  tiles: AtlasTile[];
  /** True if any slice had to be dropped because the atlas would exceed
   *  maxDim. Caller surfaces this (degraded badge) and Phase 5 handles
   *  overflow by splitting to a second atlas window. */
  overflow: boolean;
}

/** Output pixel size of a slice on the master canvas, rotation-aware.
 *  90/270 swap width/height (the shader rotates sample UVs, the tile is
 *  the rotated output rect). */
export function sliceOutputSize(
  slice: OutputSlice,
  masterW: number,
  masterH: number,
): { w: number; h: number } {
  const baseW = Math.max(1, Math.round((slice.cropW ?? 1) * masterW));
  const baseH = Math.max(1, Math.round((slice.cropH ?? 1) * masterH));
  const rot = slice.rotation ?? 0;
  return (rot === 90 || rot === 270) ? { w: baseH, h: baseW } : { w: baseW, h: baseH };
}

/** Is this slice a Spout/Syphon texture-share sender (vs a physical
 *  display or an NDI sender)? Only these go in the atlas. */
export function isAtlasSenderSlice(slice: OutputSlice): boolean {
  if (slice.enabled === false) return false;
  if ((slice.targetType ?? 'sender') !== 'sender') return false;
  const out = slice.outputType ?? 'spout';
  return out === 'spout' || out === 'syphon';
}

/**
 * Shelf-pack sender slices into an atlas. Preserves input order for
 * stable layouts (so adding one slice doesn't reshuffle the rest). Wraps
 * to a new shelf when a row would exceed maxDim; drops slices that can't
 * fit within maxDim in either axis (overflow=true) — Phase 5 splits to a
 * second atlas window for that rare case.
 */
export function packAtlas(
  slices: OutputSlice[],
  masterW: number,
  masterH: number,
  maxDim = 8192,
  pad = 2,
): AtlasLayout {
  const senders = slices.filter(isAtlasSenderSlice);
  const tiles: AtlasTile[] = [];
  let overflow = false;

  let shelfX = 0;
  let shelfY = 0;
  let shelfH = 0;
  let atlasW = 0;

  for (const slice of senders) {
    const { w, h } = sliceOutputSize(slice, masterW, masterH);
    // A single tile bigger than the atlas can't be packed at all.
    if (w > maxDim || h > maxDim) { overflow = true; continue; }

    // Wrap to a new shelf if this tile would overflow the row width.
    if (shelfX > 0 && shelfX + w > maxDim) {
      shelfY += shelfH + pad;
      shelfX = 0;
      shelfH = 0;
    }
    // Vertical overflow — atlas would exceed maxDim height. Drop the rest.
    if (shelfY + h > maxDim) { overflow = true; continue; }

    tiles.push({
      sliceId: slice.id,
      senderName: slice.spoutName,
      outputType: (slice.outputType ?? 'spout') as 'spout' | 'syphon',
      x: shelfX,
      y: shelfY,
      w,
      h,
    });
    shelfX += w + pad;
    if (h > shelfH) shelfH = h;
    if (shelfX - pad > atlasW) atlasW = shelfX - pad;
  }

  const atlasH = tiles.length ? shelfY + shelfH : 0;
  return { atlasW, atlasH, tiles, overflow };
}

/** Stable signature of a layout — lets the renderer/main detect when the
 *  atlas needs reconfiguring (slice added/removed/resized/reordered)
 *  without deep comparison each frame. */
export function atlasLayoutSignature(layout: AtlasLayout): string {
  return `${layout.atlasW}x${layout.atlasH}|` +
    layout.tiles.map(t => `${t.sliceId}:${t.senderName}:${t.outputType}:${t.x},${t.y},${t.w},${t.h}`).join('|');
}

export interface CoreAtlasTile {
  sliceId: string;
  senderName: string;
  outputType: 'spout' | 'syphon';
  /** Normalized crop of the composite (0-1, top-left origin). */
  nx: number;
  ny: number;
  nw: number;
  nh: number;
}

/**
 * Sender layout when the render core is primary: main crops each sender
 * straight from the core's output texture, so tiles are the slices'
 * normalized crop rects rather than packed atlas positions. Rotation,
 * warp, colour and edge blend are not applied on this path.
 */
export function coreAtlasLayout(slices: OutputSlice[]): { source: 'core'; tiles: CoreAtlasTile[] } {
  const clamp = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
  const tiles: CoreAtlasTile[] = [];
  for (const slice of slices.filter(isAtlasSenderSlice)) {
    const nx = clamp(slice.cropX ?? 0);
    const ny = clamp(slice.cropY ?? 0);
    const nw = clamp(slice.cropW ?? 1);
    const nh = clamp(slice.cropH ?? 1);
    if (nw <= 0 || nh <= 0) continue;
    tiles.push({
      sliceId: slice.id,
      senderName: slice.spoutName,
      outputType: (slice.outputType ?? 'spout') as 'spout' | 'syphon',
      nx, ny, nw: Math.min(nw, 1 - nx), nh: Math.min(nh, 1 - ny),
    });
  }
  return { source: 'core', tiles };
}
