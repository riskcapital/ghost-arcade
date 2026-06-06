// Sync the 3D stage layout to the editor's 2D mapping mode. The
// user's intent: design a stage in 3D (positions, sizes, curvatures),
// then hit "Sync" so the editor's master canvas gets carved into the
// same set of regions, one per LED screen. From there the user paints
// each region in 2D VJ mode and the 3D scene plays the corresponding
// content on each wall.
//
// Layout strategy:
//   - Project each LED screen into a 2D rect using a bin-packed grid
//     sized by the screen's aspect ratio + relative footprint.
//   - Preserve OutputSlice ids when a previous sync exists so re-syncing
//     just updates rectangles instead of orphaning the operator's paint.
//   - Auto-link each LED screen's `source` to the matching slice id so
//     "what shows where" is round-tripped without manual rebinding.

import { get } from 'svelte/store';
import {
  settings,
  createDefaultSlice,
  type OutputSlice,
} from '../stores/settings';
import { stage3dScene } from './store';
import type { Stage3DScene, StageLedScreenNode } from './types';

export interface SyncToMappingResult {
  slicesCreated: number;
  slicesReused: number;
}

/** Project each LED screen into a 2D rectangle that fits inside a 16:9
 *  master canvas. Layout algorithm:
 *  - sort screens by area (largest first)
 *  - place each into a row that has remaining horizontal space; start
 *    a new row when none fit
 *  - normalise to 0..1 within the union bounds
 *
 *  This produces a compact mosaic that scales with screen count without
 *  forcing the user into a regular grid (which would make a 4-wall
 *  festival rig look like a 2x2 — visually identical screens). */
function packRectangles(screens: StageLedScreenNode[]): { node: StageLedScreenNode; rect: { x: number; y: number; w: number; h: number } }[] {
  if (screens.length === 0) return [];
  if (screens.length === 1) {
    return [{ node: screens[0], rect: { x: 0, y: 0, w: 1, h: 1 } }];
  }

  // Aspect-aware packing: each screen claims a width proportional to
  // its panel area, and its height matches the row height (one
  // canonical row height per row). We compute row widths greedily then
  // normalise.
  const TARGET_ASPECT = 16 / 9;
  const sorted = [...screens].sort((a, b) => (b.width * b.height) - (a.width * a.height));

  type Row = { items: StageLedScreenNode[]; width: number; height: number };
  const rows: Row[] = [];
  const MAX_ROW_WIDTH = TARGET_ASPECT * 2; // arbitrary unit — gets normalised

  for (const screen of sorted) {
    const aspect = screen.width / Math.max(0.0001, screen.height);
    // Pick a tentative height for this row based on screen height ratio.
    // For uniform results, every row settles to the height of its first
    // (largest-area) screen scaled by `1` and we resize horizontally.
    let placed = false;
    for (const row of rows) {
      const itemHeight = row.height;
      const itemWidth = itemHeight * aspect;
      if (row.width + itemWidth <= MAX_ROW_WIDTH) {
        row.items.push(screen);
        row.width += itemWidth;
        placed = true;
        break;
      }
    }
    if (!placed) {
      const newHeight = Math.min(1, 1 - rows.reduce((s, r) => s + r.height, 0));
      // First row gets the screen's natural height bias; subsequent rows
      // shrink so they fit the remaining canvas space.
      const h = rows.length === 0 ? 1 : Math.max(0.2, newHeight);
      rows.push({ items: [screen], width: h * aspect, height: h });
    }
  }

  // Compute total height so we can normalise the rectangles to a 0..1
  // canvas. The horizontal dimension uses each row's actual width.
  const totalHeight = rows.reduce((s, r) => s + r.height, 0);
  const result: { node: StageLedScreenNode; rect: { x: number; y: number; w: number; h: number } }[] = [];
  let y = 0;
  for (const row of rows) {
    const rowH = row.height / totalHeight;
    let x = 0;
    const rowWidth = row.width || 1;
    for (const item of row.items) {
      const aspect = item.width / Math.max(0.0001, item.height);
      const w = (row.height * aspect) / rowWidth;
      result.push({ node: item, rect: { x, y, w, h: rowH } });
      x += w;
    }
    y += rowH;
  }
  return result;
}

/** Sync the active 3D scene's LED screens to the editor's OutputSlice
 *  array. Returns a summary of how many slices were created vs reused. */
export function syncStage3DToMapping(stage: Stage3DScene = get(stage3dScene)): SyncToMappingResult {
  const ledScreens = stage.nodes.filter((n): n is StageLedScreenNode => n.type === 'led-screen' && n.visible);
  if (ledScreens.length === 0) {
    return { slicesCreated: 0, slicesReused: 0 };
  }

  const packed = packRectangles(ledScreens);
  const existing = get(settings).output?.slices ?? [];
  const existingById = new Map(existing.map(s => [s.id, s]));

  let created = 0;
  let reused = 0;
  const nextSlices: OutputSlice[] = [];

  for (const { node, rect } of packed) {
    // Slice id derived from the LED screen so subsequent syncs update
    // in place rather than orphaning slices the operator has painted.
    const sliceId = `stage3d-${node.id}`;
    const previous = existingById.get(sliceId);
    if (previous) {
      reused++;
      nextSlices.push({
        ...previous,
        name: node.name,
        cropX: rect.x,
        cropY: rect.y,
        cropW: rect.w,
        cropH: rect.h,
      });
    } else {
      created++;
      const slice = createDefaultSlice(sliceId, node.name, sliceId.slice(-6), rect.x, rect.w);
      slice.cropY = rect.y;
      slice.cropH = rect.h;
      nextSlices.push(slice);
    }
  }

  // Preserve any slices the operator created manually that DON'T match
  // a 3D screen. Append them after the synced ones so the new layout
  // is at the top of the panel; the operator can hide/delete as desired.
  for (const slice of existing) {
    if (!nextSlices.some(s => s.id === slice.id)) {
      nextSlices.push(slice);
    }
  }

  settings.update(s => ({
    ...s,
    output: { ...s.output, slices: nextSlices },
  }));

  // Auto-link each LED screen's source to the matching slice. Existing
  // explicit bindings (a screen the user pointed at a specific layer)
  // are preserved — we only overwrite `auto` and stale slice ids.
  for (const { node } of packed) {
    const sliceId = `stage3d-${node.id}`;
    const currentSource = node.source;
    const shouldRewrite =
      !currentSource ||
      currentSource === 'auto' ||
      currentSource === 'master' ||
      (currentSource.startsWith('stage3d-') && currentSource !== sliceId);
    if (shouldRewrite) {
      stage3dScene.updateLedScreen(node.id, { source: sliceId });
    }
  }

  return { slicesCreated: created, slicesReused: reused };
}
