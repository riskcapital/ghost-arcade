import type { WarpCorners } from '../types';

export type SelectionEdge = 'top' | 'bottom' | 'left' | 'right';

export interface SelectionBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function scaleWarpCornersFromSelectionEdge(
  corners: WarpCorners,
  bounds: SelectionBounds,
  edge: SelectionEdge,
  deltaX: number,
  deltaY: number,
): WarpCorners {
  const width = Math.max(Number.EPSILON, bounds.maxX - bounds.minX);
  const height = Math.max(Number.EPSILON, bounds.maxY - bounds.minY);
  let scaleX = 1;
  let scaleY = 1;
  let anchorX = bounds.minX;
  let anchorY = bounds.minY;

  if (edge === 'right') {
    scaleX = Math.max(0.01, (width + deltaX) / width);
    anchorX = bounds.minX;
  } else if (edge === 'left') {
    scaleX = Math.max(0.01, (width - deltaX) / width);
    anchorX = bounds.maxX;
  } else if (edge === 'top') {
    scaleY = Math.max(0.01, (height + deltaY) / height);
    anchorY = bounds.minY;
  } else {
    scaleY = Math.max(0.01, (height - deltaY) / height);
    anchorY = bounds.maxY;
  }

  const transform = (point: { x: number; y: number }) => ({
    x: anchorX + (point.x - anchorX) * scaleX,
    y: anchorY + (point.y - anchorY) * scaleY,
  });

  return {
    topLeft: transform(corners.topLeft),
    topRight: transform(corners.topRight),
    bottomLeft: transform(corners.bottomLeft),
    bottomRight: transform(corners.bottomRight),
  };
}
