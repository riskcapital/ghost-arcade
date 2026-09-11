import { describe, expect, it } from 'vitest';
import { migrateStageLayerCorners } from './stageTextureOrientation';

const savedStageLayer = {
  stageTextureFlipV: true,
  corners: {
    topLeft: { x: 0.1, y: 0.2 },
    topRight: { x: 0.9, y: 0.2 },
    bottomLeft: { x: 0.1, y: 0.6 },
    bottomRight: { x: 0.9, y: 0.6 },
  },
};

describe('migrateStageLayerCorners', () => {
  it('lifts a saved Stage layer into canvas Y-up corners', () => {
    const migrated = migrateStageLayerCorners(savedStageLayer);
    expect(migrated.corners.topLeft).toEqual({ x: 0.1, y: 0.8 });
    expect(migrated.corners.bottomRight).toEqual({ x: 0.9, y: 0.4 });
    // The slice's top edge must end up above its bottom edge.
    expect(migrated.corners.topLeft.y).toBeGreaterThan(migrated.corners.bottomLeft.y);
    expect(migrated.stageTextureFlipV).toBe(false);
  });

  it('is idempotent, so re-imported state cannot flip twice', () => {
    const once = migrateStageLayerCorners(savedStageLayer);
    expect(migrateStageLayerCorners(once)).toEqual(once);
  });

  it('leaves layers the Stage did not author untouched', () => {
    const ordinary = {
      corners: {
        topLeft: { x: 0, y: 1 },
        topRight: { x: 1, y: 1 },
        bottomLeft: { x: 0, y: 0 },
        bottomRight: { x: 1, y: 0 },
      },
    };
    expect(migrateStageLayerCorners(ordinary)).toBe(ordinary);
  });

  it('flips a mesh grid and reverses its rows so row 0 stays the top row', () => {
    const withMesh = {
      ...savedStageLayer,
      meshGrid: {
        rows: 2,
        cols: 2,
        points: [
          [{ x: 0, y: 0.2 }, { x: 1, y: 0.2 }],
          [{ x: 0, y: 0.6 }, { x: 1, y: 0.6 }],
        ],
      },
    };
    const migrated = migrateStageLayerCorners(withMesh);
    expect(migrated.meshGrid.points[0]).toEqual([{ x: 0, y: 0.4 }, { x: 1, y: 0.4 }]);
    expect(migrated.meshGrid.points[1]).toEqual([{ x: 0, y: 0.8 }, { x: 1, y: 0.8 }]);
  });
});
