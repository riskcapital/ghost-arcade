// Shape Geometry Generator
// Creates warpable geometries for different layer shape types
// Each shape has its own vertices and UV mapping appropriate for the shape

import * as THREE from 'three';
import type { LayerShapeType, Point2D } from '../types';

export interface ShapeGeometryResult {
  geometry: THREE.BufferGeometry;
  // Normalized vertices for the shape (used for warp control)
  // For quad: 4 corners
  // For circle: edge points
  // For triangle: 3 vertices
  // For polygon: N vertices
  controlPoints: Point2D[];
  // Default UV coordinates for each control point
  defaultUVs: Point2D[];
}

/**
 * Create a quad (rectangle) geometry - the standard layer shape
 * 4 corners, simple bilinear UV mapping
 */
export function createQuadGeometry(subdivisions: number = 1): ShapeGeometryResult {
  // For a simple quad with optional subdivisions for smoother warping
  const segments = Math.max(1, subdivisions);
  const geometry = new THREE.PlaneGeometry(2, 2, segments, segments);

  // Control points are the 4 corners (in normalized 0-1 space)
  const controlPoints: Point2D[] = [
    { x: 0, y: 1 }, // top-left
    { x: 1, y: 1 }, // top-right
    { x: 0, y: 0 }, // bottom-left
    { x: 1, y: 0 }, // bottom-right
  ];

  const defaultUVs: Point2D[] = [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ];

  return { geometry, controlPoints, defaultUVs };
}

/**
 * Create a circle/ellipse geometry with radial UV mapping
 * The circle has edge vertices that can be individually moved
 * Uses polar UV coordinates - center of texture maps to center of circle
 */
export function createCircleGeometry(
  segments: number = 32,
  rings: number = 8,
  radiusX: number = 1,
  radiusY: number = 1
): ShapeGeometryResult {
  // Create a disc geometry with radial segments
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Center point
  positions.push(0, 0, 0);
  uvs.push(0.5, 0.5); // Center of texture

  // Create rings from center outward
  for (let ring = 1; ring <= rings; ring++) {
    const ringRadius = ring / rings;
    for (let seg = 0; seg < segments; seg++) {
      const angle = (seg / segments) * Math.PI * 2;

      // Position in clip space (-1 to 1)
      const x = Math.cos(angle) * ringRadius * radiusX;
      const y = Math.sin(angle) * ringRadius * radiusY;
      positions.push(x, y, 0);

      // UV: radial mapping - texture center at circle center
      // Map so full texture fills the circle
      const u = 0.5 + Math.cos(angle) * ringRadius * 0.5;
      const v = 0.5 + Math.sin(angle) * ringRadius * 0.5;
      uvs.push(u, v);
    }
  }

  // Create triangles for center ring
  for (let seg = 0; seg < segments; seg++) {
    const next = (seg + 1) % segments;
    indices.push(0, seg + 1, next + 1);
  }

  // Create triangles for outer rings
  for (let ring = 1; ring < rings; ring++) {
    const ringStart = 1 + (ring - 1) * segments;
    const nextRingStart = 1 + ring * segments;

    for (let seg = 0; seg < segments; seg++) {
      const next = (seg + 1) % segments;

      const curr = ringStart + seg;
      const currNext = ringStart + next;
      const outer = nextRingStart + seg;
      const outerNext = nextRingStart + next;

      // Two triangles per quad section
      indices.push(curr, outer, currNext);
      indices.push(currNext, outer, outerNext);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  // Control points are the outer edge vertices (normalized to 0-1)
  const controlPoints: Point2D[] = [];
  const defaultUVs: Point2D[] = [];

  // outerRingStart = 1 + (rings - 1) * segments; // computed for reference, not directly used
  for (let seg = 0; seg < segments; seg++) {
    const angle = (seg / segments) * Math.PI * 2;
    // Convert from clip space (-1 to 1) to normalized (0 to 1)
    controlPoints.push({
      x: 0.5 + Math.cos(angle) * radiusX * 0.5,
      y: 0.5 + Math.sin(angle) * radiusY * 0.5,
    });
    defaultUVs.push({
      x: 0.5 + Math.cos(angle) * 0.5,
      y: 0.5 + Math.sin(angle) * 0.5,
    });
  }

  return { geometry, controlPoints, defaultUVs };
}

/**
 * Create a triangle geometry
 * 3 vertices with triangular UV mapping
 */
export function createTriangleGeometry(
  type: 'equilateral' | 'isosceles' | 'right' = 'equilateral'
): ShapeGeometryResult {
  const positions: number[] = [];
  const uvs: number[] = [];

  let p1: Point2D, p2: Point2D, p3: Point2D;

  if (type === 'equilateral') {
    // Equilateral triangle centered at origin
    const h = Math.sqrt(3) / 2;
    p1 = { x: 0, y: h * 0.667 };      // top
    p2 = { x: -0.5, y: -h * 0.333 };  // bottom-left
    p3 = { x: 0.5, y: -h * 0.333 };   // bottom-right
  } else if (type === 'isosceles') {
    p1 = { x: 0, y: 0.5 };      // top
    p2 = { x: -0.5, y: -0.5 };  // bottom-left
    p3 = { x: 0.5, y: -0.5 };   // bottom-right
  } else { // right
    p1 = { x: -0.5, y: 0.5 };   // top-left
    p2 = { x: -0.5, y: -0.5 };  // bottom-left
    p3 = { x: 0.5, y: -0.5 };   // bottom-right
  }

  // Positions in clip space
  positions.push(p1.x, p1.y, 0);
  positions.push(p2.x, p2.y, 0);
  positions.push(p3.x, p3.y, 0);

  // UVs map the triangle to fill the texture
  uvs.push(0.5, 1.0); // top
  uvs.push(0.0, 0.0); // bottom-left
  uvs.push(1.0, 0.0); // bottom-right

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2]);

  // Control points (normalized 0-1)
  const controlPoints: Point2D[] = [
    { x: p1.x + 0.5, y: p1.y + 0.5 },
    { x: p2.x + 0.5, y: p2.y + 0.5 },
    { x: p3.x + 0.5, y: p3.y + 0.5 },
  ];

  const defaultUVs: Point2D[] = [
    { x: 0.5, y: 1.0 },
    { x: 0.0, y: 0.0 },
    { x: 1.0, y: 0.0 },
  ];

  return { geometry, controlPoints, defaultUVs };
}

/**
 * Create a regular polygon geometry
 * N vertices with radial UV mapping
 */
export function createPolygonGeometry(
  sides: number = 6,
  rings: number = 4
): ShapeGeometryResult {
  sides = Math.max(3, Math.min(12, sides));

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Center point
  positions.push(0, 0, 0);
  uvs.push(0.5, 0.5);

  // Create rings
  for (let ring = 1; ring <= rings; ring++) {
    const ringRadius = ring / rings;
    for (let v = 0; v < sides; v++) {
      const angle = (v / sides) * Math.PI * 2 - Math.PI / 2; // Start from top

      const x = Math.cos(angle) * ringRadius;
      const y = Math.sin(angle) * ringRadius;
      positions.push(x, y, 0);

      const u = 0.5 + Math.cos(angle) * ringRadius * 0.5;
      const uv = 0.5 + Math.sin(angle) * ringRadius * 0.5;
      uvs.push(u, uv);
    }
  }

  // Triangles for center
  for (let v = 0; v < sides; v++) {
    const next = (v + 1) % sides;
    indices.push(0, v + 1, next + 1);
  }

  // Triangles for outer rings
  for (let ring = 1; ring < rings; ring++) {
    const ringStart = 1 + (ring - 1) * sides;
    const nextRingStart = 1 + ring * sides;

    for (let v = 0; v < sides; v++) {
      const next = (v + 1) % sides;

      const curr = ringStart + v;
      const currNext = ringStart + next;
      const outer = nextRingStart + v;
      const outerNext = nextRingStart + next;

      indices.push(curr, outer, currNext);
      indices.push(currNext, outer, outerNext);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  // Control points are the outer vertices
  const controlPoints: Point2D[] = [];
  const defaultUVs: Point2D[] = [];

  for (let v = 0; v < sides; v++) {
    const angle = (v / sides) * Math.PI * 2 - Math.PI / 2;
    controlPoints.push({
      x: 0.5 + Math.cos(angle) * 0.5,
      y: 0.5 + Math.sin(angle) * 0.5,
    });
    defaultUVs.push({
      x: 0.5 + Math.cos(angle) * 0.5,
      y: 0.5 + Math.sin(angle) * 0.5,
    });
  }

  return { geometry, controlPoints, defaultUVs };
}

/**
 * Create a star geometry
 * Alternating inner/outer vertices with radial UV mapping
 */
export function createStarGeometry(
  points: number = 5,
  innerRadius: number = 0.4,
  rings: number = 4
): ShapeGeometryResult {
  points = Math.max(3, Math.min(12, points));
  const totalVertices = points * 2; // Alternating inner/outer

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Center point
  positions.push(0, 0, 0);
  uvs.push(0.5, 0.5);

  // Create rings
  for (let ring = 1; ring <= rings; ring++) {
    const ringRatio = ring / rings;

    for (let v = 0; v < totalVertices; v++) {
      const angle = (v / totalVertices) * Math.PI * 2 - Math.PI / 2;
      const isOuter = v % 2 === 0;
      const radius = isOuter ? ringRatio : ringRatio * innerRadius;

      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      positions.push(x, y, 0);

      const u = 0.5 + Math.cos(angle) * radius * 0.5;
      const uv = 0.5 + Math.sin(angle) * radius * 0.5;
      uvs.push(u, uv);
    }
  }

  // Triangles for center
  for (let v = 0; v < totalVertices; v++) {
    const next = (v + 1) % totalVertices;
    indices.push(0, v + 1, next + 1);
  }

  // Triangles for outer rings
  for (let ring = 1; ring < rings; ring++) {
    const ringStart = 1 + (ring - 1) * totalVertices;
    const nextRingStart = 1 + ring * totalVertices;

    for (let v = 0; v < totalVertices; v++) {
      const next = (v + 1) % totalVertices;

      const curr = ringStart + v;
      const currNext = ringStart + next;
      const outer = nextRingStart + v;
      const outerNext = nextRingStart + next;

      indices.push(curr, outer, currNext);
      indices.push(currNext, outer, outerNext);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  // Control points are the outer ring vertices (both inner and outer points)
  const controlPoints: Point2D[] = [];
  const defaultUVs: Point2D[] = [];

  for (let v = 0; v < totalVertices; v++) {
    const angle = (v / totalVertices) * Math.PI * 2 - Math.PI / 2;
    const isOuter = v % 2 === 0;
    const radius = isOuter ? 1 : innerRadius;

    controlPoints.push({
      x: 0.5 + Math.cos(angle) * radius * 0.5,
      y: 0.5 + Math.sin(angle) * radius * 0.5,
    });
    defaultUVs.push({
      x: 0.5 + Math.cos(angle) * radius * 0.5,
      y: 0.5 + Math.sin(angle) * radius * 0.5,
    });
  }

  return { geometry, controlPoints, defaultUVs };
}

/**
 * Create a line geometry (ribbon/strip)
 * A line defined by points with width, suitable for projection on thin surfaces
 */
export function createLineGeometry(
  points: Point2D[],
  width: number = 0.1,
  _segments: number = 4
): ShapeGeometryResult {
  if (points.length < 2) {
    // Default line if not enough points
    points = [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }];
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Convert normalized points (0-1) to clip space (-1 to 1)
  const clipPoints = points.map(p => ({
    x: p.x * 2 - 1,
    y: p.y * 2 - 1,
  }));

  // Calculate total line length for UV mapping
  let totalLength = 0;
  const segmentLengths: number[] = [0];
  for (let i = 1; i < clipPoints.length; i++) {
    const dx = clipPoints[i].x - clipPoints[i - 1].x;
    const dy = clipPoints[i].y - clipPoints[i - 1].y;
    totalLength += Math.sqrt(dx * dx + dy * dy);
    segmentLengths.push(totalLength);
  }

  // Create vertices along the line
  for (let i = 0; i < clipPoints.length; i++) {
    const p = clipPoints[i];

    // Calculate perpendicular direction
    let perpX = 0, perpY = 0;
    if (i === 0) {
      const dx = clipPoints[1].x - p.x;
      const dy = clipPoints[1].y - p.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      perpX = -dy / len;
      perpY = dx / len;
    } else if (i === clipPoints.length - 1) {
      const dx = p.x - clipPoints[i - 1].x;
      const dy = p.y - clipPoints[i - 1].y;
      const len = Math.sqrt(dx * dx + dy * dy);
      perpX = -dy / len;
      perpY = dx / len;
    } else {
      // Average of adjacent segments
      const dx1 = p.x - clipPoints[i - 1].x;
      const dy1 = p.y - clipPoints[i - 1].y;
      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const dx2 = clipPoints[i + 1].x - p.x;
      const dy2 = clipPoints[i + 1].y - p.y;
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

      perpX = (-dy1 / len1 - dy2 / len2) / 2;
      perpY = (dx1 / len1 + dx2 / len2) / 2;
      const perpLen = Math.sqrt(perpX * perpX + perpY * perpY);
      perpX /= perpLen;
      perpY /= perpLen;
    }

    const halfWidth = width;

    // Two vertices per point (left and right of line)
    positions.push(p.x + perpX * halfWidth, p.y + perpY * halfWidth, 0);
    positions.push(p.x - perpX * halfWidth, p.y - perpY * halfWidth, 0);

    // UV: v is along length, u is across width
    const v = totalLength > 0 ? segmentLengths[i] / totalLength : 0;
    uvs.push(0, v);
    uvs.push(1, v);
  }

  // Create quad indices
  for (let i = 0; i < clipPoints.length - 1; i++) {
    const base = i * 2;
    indices.push(base, base + 2, base + 1);
    indices.push(base + 1, base + 2, base + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  // Control points are the line points themselves
  const controlPoints = points.map(p => ({ x: p.x, y: p.y }));
  const defaultUVs = points.map((_, i) => ({
    x: 0.5,
    y: totalLength > 0 ? segmentLengths[i] / totalLength : 0,
  }));

  return { geometry, controlPoints, defaultUVs };
}

/**
 * Create geometry based on shape type
 */
export function createShapeGeometry(
  shapeType: LayerShapeType | 'quad',
  params?: {
    radiusX?: number;
    radiusY?: number;
    sides?: number;
    innerRadius?: number;
    triangleType?: 'equilateral' | 'isosceles' | 'right';
    linePoints?: Point2D[];
    lineWidth?: number;
    subdivisions?: number;
  }
): ShapeGeometryResult {
  switch (shapeType) {
    case 'quad':
    case 'rectangle':
      return createQuadGeometry(params?.subdivisions ?? 1);

    case 'circle':
      return createCircleGeometry(32, 8, params?.radiusX ?? 1, params?.radiusY ?? 1);

    case 'ellipse':
      return createCircleGeometry(32, 8, params?.radiusX ?? 1, params?.radiusY ?? 0.6);

    case 'triangle':
      return createTriangleGeometry(params?.triangleType ?? 'equilateral');

    case 'polygon':
      return createPolygonGeometry(params?.sides ?? 6);

    case 'star':
      return createStarGeometry(params?.sides ?? 5, params?.innerRadius ?? 0.4);

    case 'line':
    case 'polyline':
      return createLineGeometry(params?.linePoints ?? [], params?.lineWidth ?? 0.1);

    default:
      return createQuadGeometry();
  }
}

/**
 * Update geometry vertex positions based on warped control points
 * This allows each shape's vertices to be individually moved
 */
export function updateGeometryFromControlPoints(
  geometry: THREE.BufferGeometry,
  shapeType: LayerShapeType | 'quad',
  controlPoints: Point2D[],
  _originalControlPoints: Point2D[]
): void {
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const posArray = positions.array as Float32Array;

  // For simple shapes, apply direct vertex movement
  // For complex shapes with rings, interpolate based on control point movement

  if (shapeType === 'quad' || shapeType === 'rectangle') {
    // For quad, use bilinear interpolation similar to corner warp
    // This is handled by the existing mesh warp system
    return;
  }

  if (shapeType === 'triangle') {
    // Direct vertex update for triangle
    for (let i = 0; i < 3 && i < controlPoints.length; i++) {
      posArray[i * 3] = controlPoints[i].x * 2 - 1;
      posArray[i * 3 + 1] = controlPoints[i].y * 2 - 1;
    }
    positions.needsUpdate = true;
    return;
  }

  // For circle, polygon, star - update all vertices based on control point deltas
  // The outer ring vertices are the control points, inner vertices are interpolated

  // TODO: Implement radial interpolation for inner vertices
  // For now, just update outer vertices and regenerate geometry when needed

  positions.needsUpdate = true;
}
