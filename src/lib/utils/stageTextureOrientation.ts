/**
 * Stage-generated screen layers were authored in the Stage Designer's own
 * canvas coordinates (Y down, y=0 at the top) until 2026-09-11, while
 * everything that consumes layer corners reads them Y-up: createDefaultCorners,
 * the warp handles, the LED wall and dome placement, both unified-group crops
 * and the native compositor. An applied slice therefore landed in the mirrored
 * half of the canvas and drew its content upside down.
 *
 * Apply Stage now writes Y-up corners. Layers saved before that are converted
 * once, on load.
 *
 * `stageTextureFlipV: true` is the marker Apply Stage wrote alongside the
 * Y-down corners, so it identifies exactly the layers that need converting.
 * Migration clears it, which also makes this idempotent: the Stage 3D and
 * output windows re-import project state the main window has already migrated,
 * and a second pass must not flip those layers back.
 */

type StagePoint = { x: number; y: number };

type StageMigratableLayer = {
  corners?: {
    topLeft: StagePoint;
    topRight: StagePoint;
    bottomLeft: StagePoint;
    bottomRight: StagePoint;
  } | null;
  meshGrid?: { rows: number; cols: number; points: StagePoint[][] } | null;
  stageTextureFlipV?: boolean;
};

const flipY = (point: StagePoint): StagePoint => ({ x: point.x, y: 1 - point.y });

export function migrateStageLayerCorners<T extends StageMigratableLayer>(layer: T): T {
  if (!layer || layer.stageTextureFlipV !== true) return layer;

  const corners = layer.corners
    ? {
        // Corner names are kept: the slice's top edge stays its top edge, it
        // just moves to the larger y.
        topLeft: flipY(layer.corners.topLeft),
        topRight: flipY(layer.corners.topRight),
        bottomLeft: flipY(layer.corners.bottomLeft),
        bottomRight: flipY(layer.corners.bottomRight),
      }
    : layer.corners;

  // A Stage layer switched to mesh warp carries a grid in the same mirrored
  // space, and its first row is the one drawn at the top.
  const grid = layer.meshGrid;
  const meshGrid = grid && Array.isArray(grid.points)
    ? {
        ...grid,
        points: [...grid.points]
          .reverse()
          .map((row) => (Array.isArray(row) ? row.map(flipY) : row)),
      }
    : grid;

  return { ...layer, corners, meshGrid, stageTextureFlipV: false } as T;
}
