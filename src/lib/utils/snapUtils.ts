// Cross-Layer Snap Utilities
// Provides snap-to-edge and snap-to-corner detection across layers
// Used by WarpHandles and MeshWarpHandles for projection mapping alignment

import type { Point2D, WarpCorners, Layer } from '../types';

export interface SnapTarget {
  point: Point2D;            // The point to snap to (normalized 0-1 coords)
  type: 'corner' | 'edge';  // Whether snapping to a corner point or a point on an edge line
  layerId: string;           // Which layer this snap target belongs to
  edgeIndex?: number;        // 0=top, 1=right, 2=bottom, 3=left (for edge snaps)
}

export interface SnapResult {
  snapped: boolean;
  point: Point2D;            // The (possibly snapped) point
  target: SnapTarget | null; // The snap target that was matched, or null
}

// Thresholds in normalized coordinates (0-1 space)
const CORNER_SNAP_THRESHOLD = 0.02;      // ~2% for corner-to-corner (tighter)
const EDGE_SNAP_THRESHOLD = 0.025;       // ~2.5% for point-to-edge

/**
 * Get the 4 corners of a layer as an array: [TL, TR, BR, BL]
 */
export function getCornersArray(corners: WarpCorners): Point2D[] {
  return [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ];
}

/**
 * Get the 4 edges as line segments: [start, end]
 * Order: top, right, bottom, left
 */
export function getEdges(corners: WarpCorners): [Point2D, Point2D][] {
  return [
    [corners.topLeft, corners.topRight],       // 0: top
    [corners.topRight, corners.bottomRight],   // 1: right
    [corners.bottomRight, corners.bottomLeft], // 2: bottom
    [corners.bottomLeft, corners.topLeft],     // 3: left
  ];
}

/**
 * Project a point onto a line segment.
 * Returns the closest point on the segment and the distance to it.
 */
export function projectPointOntoSegment(
  point: Point2D,
  segStart: Point2D,
  segEnd: Point2D
): { projected: Point2D; distance: number } {
  const dx = segEnd.x - segStart.x;
  const dy = segEnd.y - segStart.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq < 1e-10) {
    // Degenerate segment (zero length)
    const dist = Math.sqrt((point.x - segStart.x) ** 2 + (point.y - segStart.y) ** 2);
    return { projected: { x: segStart.x, y: segStart.y }, distance: dist };
  }

  // Parameter t along segment [0, 1]
  let t = ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t)); // Clamp to segment bounds

  const projected: Point2D = {
    x: segStart.x + t * dx,
    y: segStart.y + t * dy,
  };

  const distance = Math.sqrt((point.x - projected.x) ** 2 + (point.y - projected.y) ** 2);
  return { projected, distance };
}

/**
 * Find the closest snap target for a point among all visible layers (except the excluded one).
 * Checks both corner-to-corner and point-to-edge proximity.
 * Corner snaps have priority over edge snaps.
 */
export function findSnapTarget(
  point: Point2D,
  allLayers: Layer[],
  excludeLayerId: string,
  cornerThreshold: number = CORNER_SNAP_THRESHOLD,
  edgeThreshold: number = EDGE_SNAP_THRESHOLD
): SnapResult {
  let bestCornerDist = Infinity;
  let bestCornerTarget: SnapTarget | null = null;

  let bestEdgeDist = Infinity;
  let bestEdgeTarget: SnapTarget | null = null;

  for (const layer of allLayers) {
    if (!layer.visible || layer.id === excludeLayerId) continue;

    // Check corners
    const cornerArray = getCornersArray(layer.corners);
    for (const corner of cornerArray) {
      const dist = Math.sqrt((point.x - corner.x) ** 2 + (point.y - corner.y) ** 2);
      if (dist < cornerThreshold && dist < bestCornerDist) {
        bestCornerDist = dist;
        bestCornerTarget = {
          point: { x: corner.x, y: corner.y },
          type: 'corner',
          layerId: layer.id,
        };
      }
    }

    // Check edges (line segments)
    const edges = getEdges(layer.corners);
    for (let i = 0; i < 4; i++) {
      const { projected, distance } = projectPointOntoSegment(point, edges[i][0], edges[i][1]);
      if (distance < edgeThreshold && distance < bestEdgeDist) {
        bestEdgeDist = distance;
        bestEdgeTarget = {
          point: { x: projected.x, y: projected.y },
          type: 'edge',
          layerId: layer.id,
          edgeIndex: i,
        };
      }
    }
  }

  // Corner snap takes priority over edge snap
  if (bestCornerTarget) {
    return { snapped: true, point: bestCornerTarget.point, target: bestCornerTarget };
  }
  if (bestEdgeTarget) {
    return { snapped: true, point: bestEdgeTarget.point, target: bestEdgeTarget };
  }

  return { snapped: false, point, target: null };
}

/**
 * Get outlines of all other visible layers for rendering spatial context.
 * Returns arrays of 4 corner points per layer.
 */
export function getOtherLayerOutlines(
  allLayers: Layer[],
  excludeLayerId: string
): { layerId: string; corners: Point2D[] }[] {
  const outlines: { layerId: string; corners: Point2D[] }[] = [];
  for (const layer of allLayers) {
    if (!layer.visible || layer.id === excludeLayerId) continue;
    outlines.push({
      layerId: layer.id,
      corners: getCornersArray(layer.corners),
    });
  }
  return outlines;
}
