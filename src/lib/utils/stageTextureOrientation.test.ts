import { describe, expect, it } from 'vitest';
import type { WarpCorners } from '../types';
import { stageTextureNeedsVerticalFlip } from './stageTextureOrientation';

const yDownCorners: WarpCorners = {
  topLeft: { x: 0, y: 0.1 },
  topRight: { x: 1, y: 0.1 },
  bottomLeft: { x: 0, y: 0.9 },
  bottomRight: { x: 1, y: 0.9 },
};

const yUpCorners: WarpCorners = {
  topLeft: { x: 0, y: 0.9 },
  topRight: { x: 1, y: 0.9 },
  bottomLeft: { x: 0, y: 0.1 },
  bottomRight: { x: 1, y: 0.1 },
};

describe('stageTextureNeedsVerticalFlip', () => {
  it('migrates legacy Stage layers authored in canvas Y-down coordinates', () => {
    expect(stageTextureNeedsVerticalFlip({ corners: yDownCorners })).toBe(true);
  });

  it('leaves older UV Y-up Stage layers unchanged', () => {
    expect(stageTextureNeedsVerticalFlip({ corners: yUpCorners })).toBe(false);
  });

  it('keeps the explicit Stage contract after the user rotates or warps a layer', () => {
    expect(stageTextureNeedsVerticalFlip({
      corners: yUpCorners,
      stageTextureFlipV: true,
    })).toBe(true);
  });

  it('lets an explicit compatibility override win over corner inference', () => {
    expect(stageTextureNeedsVerticalFlip({
      corners: yDownCorners,
      stageTextureFlipV: false,
    })).toBe(false);
  });
});
