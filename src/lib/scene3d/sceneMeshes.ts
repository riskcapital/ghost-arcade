/**
 * Mesh nodes of a scene as one list of world-space triangles for the GPU:
 * eight floats a vertex (position, normal, material index). Shapes are unit
 * sized in their own space (a 1 m box, sphere and cylinder of 1 m diameter, a
 * 1 m plane on XZ) and the node's transform places them. An outline is a flat
 * shape on the node's XY plane, triangulated and extruded along its Z.
 */
import type { MeshNode, SceneNode, Transform, Vec3 } from './sceneModel';

export const VERTEX_FLOATS = 8;
/** Vertices one scene may hold: about 2.4 MB on the GPU. */
export const MAX_SCENE_VERTICES = 300_000;
const SPHERE_SEGMENTS = 48;
const SPHERE_RINGS = 24;
const CYLINDER_SEGMENTS = 48;

type Tri = { a: Vec3; b: Vec3; c: Vec3; na: Vec3; nb: Vec3; nc: Vec3 };

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const flat = (a: Vec3, b: Vec3, c: Vec3): Tri => {
  const n = normalize(cross(sub(b, a), sub(c, a)));
  return { a, b, c, na: n, nb: n, nc: n };
};

/** Two triangles for the quad a-b-c-d (counter-clockwise seen from outside). */
const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): Tri[] => [flat(a, b, c), flat(a, c, d)];

function boxTris(): Tri[] {
  const h = 0.5;
  const p = (x: number, y: number, z: number): Vec3 => [x * h, y * h, z * h];
  return [
    ...quad(p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1)),
    ...quad(p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), p(-1, -1, -1)),
    ...quad(p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1)),
    ...quad(p(-1, -1, 1), p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1)),
    ...quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1)),
    ...quad(p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1)),
  ];
}

function planeTris(): Tri[] {
  return quad([-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 0, -0.5], [-0.5, 0, -0.5]);
}

function sphereTris(): Tri[] {
  const out: Tri[] = [];
  const at = (s: number, r: number): Vec3 => {
    const theta = (s / SPHERE_SEGMENTS) * Math.PI * 2;
    const phi = (r / SPHERE_RINGS) * Math.PI;
    return [Math.sin(phi) * Math.cos(theta) * 0.5, Math.cos(phi) * 0.5, -Math.sin(phi) * Math.sin(theta) * 0.5];
  };
  for (let r = 0; r < SPHERE_RINGS; r++) {
    for (let s = 0; s < SPHERE_SEGMENTS; s++) {
      const a = at(s, r), b = at(s, r + 1), c = at(s + 1, r + 1), d = at(s + 1, r);
      const n = (v: Vec3) => normalize(v);
      if (r > 0) out.push({ a, b, c: d, na: n(a), nb: n(b), nc: n(d) });
      if (r < SPHERE_RINGS - 1) out.push({ a: d, b, c, na: n(d), nb: n(b), nc: n(c) });
    }
  }
  return out;
}

function cylinderTris(): Tri[] {
  const out: Tri[] = [];
  const ring = (s: number, y: number): Vec3 => {
    const t = (s / CYLINDER_SEGMENTS) * Math.PI * 2;
    return [Math.cos(t) * 0.5, y, -Math.sin(t) * 0.5];
  };
  for (let s = 0; s < CYLINDER_SEGMENTS; s++) {
    const a = ring(s, -0.5), b = ring(s + 1, -0.5), c = ring(s + 1, 0.5), d = ring(s, 0.5);
    const na = normalize([a[0], 0, a[2]]), nb = normalize([b[0], 0, b[2]]);
    out.push({ a, b, c, na, nb, nc: nb }, { a, b: c, c: d, na, nb, nc: na });
    out.push(flat([0, 0.5, 0], d, c), flat([0, -0.5, 0], b, a));
  }
  return out;
}

/** Ear clipping for a simple polygon (any winding, concave allowed). */
export function triangulate(points: { x: number; y: number }[]): [number, number, number][] {
  const n = points.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  const idx = Array.from({ length: n }, (_, i) => i);
  if (area < 0) idx.reverse();
  const cross2 = (o: number, a: number, b: number) =>
    (points[a].x - points[o].x) * (points[b].y - points[o].y) - (points[a].y - points[o].y) * (points[b].x - points[o].x);
  const inside = (p: number, a: number, b: number, c: number) =>
    cross2(a, b, p) >= 0 && cross2(b, c, p) >= 0 && cross2(c, a, p) >= 0;
  const out: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (cross2(a, b, c) <= 1e-12) continue;
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

/** The triangle, flipped if needed so its face points along `want`. */
function facing(t: Tri, want: Vec3): Tri {
  const n = t.na;
  return n[0] * want[0] + n[1] * want[1] + n[2] * want[2] >= 0 ? t : flat(t.a, t.c, t.b);
}

function outlineTris(node: MeshNode): Tri[] {
  const o = node.outline;
  if (!o) return [];
  const pts = o.points;
  const out: Tri[] = [];
  const at = (i: number, z: number): Vec3 => [pts[i].x, pts[i].y, z];
  // The front cap sits on the node's XY plane facing +Z; the back is `depth` behind it.
  for (const [a, b, c] of triangulate(pts)) {
    out.push(facing(flat(at(a, 0), at(b, 0), at(c, 0)), [0, 0, 1]));
    out.push(facing(flat(at(a, -o.depth), at(b, -o.depth), at(c, -o.depth)), [0, 0, -1]));
  }
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  const sign = area >= 0 ? 1 : -1;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
    // Outward in the plane: the edge turned a quarter away from the inside.
    const outward: Vec3 = [dy * sign, -dx * sign, 0];
    for (const t of quad(at(i, 0), at(i, -o.depth), at(j, -o.depth), at(j, 0))) out.push(facing(t, outward));
  }
  return out;
}

const UNIT_SHAPES = { box: boxTris(), plane: planeTris(), sphere: sphereTris(), cylinder: cylinderTris() };

/** The node's model matrix, column major: translate · rotate Z·Y·X · scale. */
export function modelMatrix(t: Transform): number[] {
  const [rx, ry, rz] = t.rotation.map((d) => (d * Math.PI) / 180);
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx), Math.sin(rx), Math.cos(ry), Math.sin(ry), Math.cos(rz), Math.sin(rz)];
  // R = Rz · Ry · Rx, rows.
  const r = [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
  const [kx, ky, kz] = t.scale;
  const [px, py, pz] = t.position;
  return [
    r[0][0] * kx, r[1][0] * kx, r[2][0] * kx, 0,
    r[0][1] * ky, r[1][1] * ky, r[2][1] * ky, 0,
    r[0][2] * kz, r[1][2] * kz, r[2][2] * kz, 0,
    px, py, pz, 1,
  ];
}

const apply = (m: number[], v: Vec3): Vec3 => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
];
/** Normals take the inverse scale, so a stretched sphere still shades round. */
const applyNormal = (m: number[], s: Vec3, n: Vec3): Vec3 => {
  const k: Vec3 = [n[0] / (s[0] * s[0]), n[1] / (s[1] * s[1]), n[2] / (s[2] * s[2])];
  return normalize([m[0] * k[0] + m[4] * k[1] + m[8] * k[2], m[1] * k[0] + m[5] * k[1] + m[9] * k[2], m[2] * k[0] + m[6] * k[1] + m[10] * k[2]]);
};

export type SceneMeshes = {
  /** VERTEX_FLOATS per vertex. */
  vertices: Float32Array;
  count: number;
  /** Material index per mesh node id (into the scene's material list). */
  meshIds: string[];
  /** Meshes left out because the vertex budget was full. */
  dropped: string[];
};

/**
 * Build the vertex list. `materialIndex` maps a mesh node to its slot in the
 * material buffer. A mirrored node (an odd number of negative scales) has its
 * triangles flipped so they still face outward.
 */
export function buildSceneMeshes(nodes: SceneNode[], materialIndex: (node: SceneNode & MeshNode) => number): SceneMeshes {
  const meshes = nodes.filter((n): n is SceneNode & MeshNode => n.kind === 'mesh' && n.visible);
  const parts: { tris: Tri[]; m: number[]; s: Vec3; mat: number; mirror: boolean; id: string }[] = [];
  let count = 0;
  const dropped: string[] = [];
  for (const node of meshes) {
    const tris = node.shape === 'outline' ? outlineTris(node) : UNIT_SHAPES[node.shape];
    if (count + tris.length * 3 > MAX_SCENE_VERTICES) {
      dropped.push(node.id);
      continue;
    }
    count += tris.length * 3;
    const s = node.transform.scale;
    parts.push({ tris, m: modelMatrix(node.transform), s, mat: materialIndex(node), mirror: s[0] * s[1] * s[2] < 0, id: node.id });
  }
  const vertices = new Float32Array(Math.max(1, count) * VERTEX_FLOATS);
  let o = 0;
  const put = (p: Vec3, n: Vec3, mat: number) => {
    vertices.set([p[0], p[1], p[2], n[0], n[1], n[2], mat, 0], o);
    o += VERTEX_FLOATS;
  };
  for (const part of parts) {
    for (const t of part.tris) {
      const order: [Vec3, Vec3][] = part.mirror ? [[t.a, t.na], [t.c, t.nc], [t.b, t.nb]] : [[t.a, t.na], [t.b, t.nb], [t.c, t.nc]];
      for (const [p, n] of order) put(apply(part.m, p), applyNormal(part.m, part.s, n), part.mat);
    }
  }
  return { vertices, count, meshIds: parts.map((p) => p.id), dropped };
}
