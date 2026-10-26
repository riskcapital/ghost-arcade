import type { BezierPoint, Point2D } from '../types';

/** A Stage Designer anchor or one of its curve handles. */
export interface SliceVertexRef {
  sliceId: string;
  idx: number;
  kind: 'anchor' | 'cpIn' | 'cpOut';
}

const add = (p: Point2D, d: Point2D): Point2D => ({ x: p.x + d.x, y: p.y + d.y });

/**
 * A slice outline moved by `offset` surface pixels (y down): the selected
 * anchor with its handles, or one handle, when `vertex` is on this slice;
 * otherwise the whole outline. Null when the selected point is gone.
 */
export function nudgeSlicePolygon(
  polygon: BezierPoint[],
  vertex: Pick<SliceVertexRef, 'idx' | 'kind'> | null,
  offset: Point2D,
): BezierPoint[] | null {
  if (!vertex) {
    return polygon.map((p) => ({
      ...p,
      x: p.x + offset.x,
      y: p.y + offset.y,
      cpIn: p.cpIn ? add(p.cpIn, offset) : undefined,
      cpOut: p.cpOut ? add(p.cpOut, offset) : undefined,
    }));
  }
  const point = polygon[vertex.idx];
  if (!point) return null;
  let moved: BezierPoint;
  if (vertex.kind === 'anchor') {
    moved = {
      ...point,
      x: point.x + offset.x,
      y: point.y + offset.y,
      cpIn: point.cpIn ? add(point.cpIn, offset) : undefined,
      cpOut: point.cpOut ? add(point.cpOut, offset) : undefined,
    };
  } else {
    const handle = point[vertex.kind];
    if (!handle) return null;
    moved = { ...point, [vertex.kind]: add(handle, offset) };
  }
  return polygon.map((p, i) => (i === vertex.idx ? moved : p));
}
