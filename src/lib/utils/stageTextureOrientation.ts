import type { Layer } from '../types';

/**
 * Stage Designer surfaces were historically stored in canvas coordinates
 * (Y grows downward), while the layer compositor samples textures in UV
 * coordinates (Y grows upward). New Stage-generated layers carry an explicit
 * flag; the corner check keeps existing saved presets compatible.
 */
export function stageTextureNeedsVerticalFlip(
  layer: Pick<Layer, 'corners' | 'stageTextureFlipV'>,
): boolean {
  if (typeof layer.stageTextureFlipV === 'boolean') {
    return layer.stageTextureFlipV;
  }

  const topY = (layer.corners.topLeft.y + layer.corners.topRight.y) * 0.5;
  const bottomY = (layer.corners.bottomLeft.y + layer.corners.bottomRight.y) * 0.5;
  return topY < bottomY;
}
