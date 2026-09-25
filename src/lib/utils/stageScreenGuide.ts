import type { Layer, Point2D } from '../types';
import { evaluateMeshGrid } from './meshWarp';

/** Canvas outline for a live VJ screen, using the same corner and mesh
 * transforms as the mapping renderer. This is editor UI only. */
export function stageScreenGuidePoints(screen: Layer): Point2D[] {
  const shape = screen.layerShape;
  const vertices: Point2D[] = [];
  const pushLine = (a: Point2D, b: Point2D, steps = 8) => {
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      vertices.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  };
  if (shape?.enabled && shape.type === 'custom' && (shape.params.customPoints?.length ?? 0) >= 3) {
    const points = shape.params.customPoints!;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (!a.cpOut && !b.cpIn) { pushLine(a, b); continue; }
      const p1 = a.cpOut ?? a;
      const p2 = b.cpIn ?? b;
      for (let step = 0; step < 12; step++) {
        const t = step / 12;
        const u = 1 - t;
        vertices.push({
          x: u*u*u*a.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*b.x,
          y: u*u*u*a.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*b.y,
        });
      }
    }
  } else if (shape?.enabled && (shape.type === 'circle' || shape.type === 'ellipse')) {
    const rx = Math.min(0.5, 0.5 * (shape.params.radiusX ?? 1));
    const ry = Math.min(0.5, 0.5 * (shape.params.radiusY ?? 1));
    for (let i = 0; i < 64; i++) {
      const angle = i * Math.PI * 2 / 64;
      vertices.push({ x: 0.5 + rx * Math.cos(angle), y: 0.5 + ry * Math.sin(angle) });
    }
  } else if (shape?.enabled && ['triangle', 'polygon', 'star'].includes(shape.type)) {
    const star = shape.type === 'star';
    const count = shape.type === 'triangle' ? 3 : Math.max(3, Math.min(12, shape.params.sides ?? (star ? 5 : 6)));
    const total = star ? count * 2 : count;
    const corners: Point2D[] = [];
    for (let i = 0; i < total; i++) {
      const angle = Math.PI / 2 + i * Math.PI * 2 / total;
      const radius = star && i % 2 ? 0.5 * (shape.params.innerRadius ?? 0.5) : 0.5;
      corners.push({ x: 0.5 + radius * Math.cos(angle), y: 0.5 + radius * Math.sin(angle) });
    }
    corners.forEach((point, index) => pushLine(point, corners[(index + 1) % corners.length]));
  } else {
    const corners = [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }];
    corners.forEach((point, index) => pushLine(point, corners[(index + 1) % corners.length]));
  }

  const warp = (point: Point2D): Point2D => {
    let { x, y } = point;
    const mesh = screen.warpMode === 'mesh' ? screen.meshGrid : null;
    if (mesh && mesh.rows >= 2 && mesh.cols >= 2 && mesh.points.length === mesh.rows
      && mesh.points.every((row) => row?.length === mesh.cols)) {
      // Straight cells interpolate bilinearly; a Bezier mesh follows its curves.
      ({ x, y } = evaluateMeshGrid(mesh, x, y));
    }
    const q = screen.corners;
    const u = 1 - x, v = 1 - y;
    return {
      x: q.bottomLeft.x*u*v + q.bottomRight.x*x*v + q.topLeft.x*u*y + q.topRight.x*x*y,
      y: q.bottomLeft.y*u*v + q.bottomRight.y*x*v + q.topLeft.y*u*y + q.topRight.y*x*y,
    };
  };
  return vertices.map(warp);
}

export function stageScreenGuidePath(screen: Layer, width: number, height: number): string {
  return stageScreenGuidePoints(screen).map((mapped, index) => {
    return `${index ? 'L' : 'M'}${(mapped.x * width).toFixed(2)},${((1 - mapped.y) * height).toFixed(2)}`;
  }).join(' ') + ' Z';
}
