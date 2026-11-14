/**
 * Depth mode by hand: from the mapped outlines, which way is down on the
 * output, and how steeply the projector looks down, work out where each face
 * is in 3D (a room, roomModel.ts).
 *
 * Everything is in the projector's own frame: it stands at the origin
 * looking down −Z, unrolled, so each corner of an outline is somewhere on
 * its ray, and only each face's plane is unknown.
 *
 * - Down: the arrow says which way gravity points on the output (at its
 *   middle), the angle how far the projector's axis dips below level.
 * - Normals: a Top lies level (its normal is up). A Side stands upright
 *   along its bottom edge: that edge is level, and seen from the projector
 *   it lies in the plane through the projector and its image, which fixes
 *   its direction. A Backdrop stands upright facing the projector.
 * - Offsets: a corner of one face that lies on another face's outline is a
 *   point the two share, so its ray meets both planes at the same place;
 *   each group of touching faces stands on the ground (its lowest corner, as
 *   seen along the arrow); and the corners sit `distance` away on average.
 *   Least squares over those, which is linear in the plane offsets. A
 *   corner can also lie on another outline only as seen (where a nearer
 *   face hides a farther one, or two objects nearly touch): such contacts
 *   disagree with the rest, so after each solve the worst is dropped and
 *   it solves again.
 *
 * Role guess: a face is whichever of Top or upright-along-one-of-its-edges
 * makes its outline most nearly right-angled in 3D (a rectangle's image
 * fixes its plane); a face covering much of the output is the Backdrop.
 *
 * Pure and exported for tests.
 */
import type { Point } from '../mobile/studio/interactive';
import { add, cross, dot, length, normalize, scale, sub, type FaceRole, type Room, type RoomFace } from './roomModel';
import type { Vec3 } from './sceneModel';
import { projectorBasis, rayDirection, type ProjectorBasis } from './worldGeometry';

export type SolveSurface = { id: string; points: Point[]; role?: FaceRole };

export type SolveInput = {
  surfaces: SolveSurface[];
  /** The output's width / height. */
  aspect: number;
  /** Which way is down on the output (x right, y down). */
  arrow: Point;
  /** Degrees the projector's axis dips below level (negative: it looks up). */
  elevation: number;
  /** The projector's vertical field of view, degrees. */
  fov: number;
  /** Meters from the projector to the objects, on average. */
  distance?: number;
};

export type SolveResult = {
  room: Room;
  /** The role each face was given (guessed unless the input said). */
  roles: Record<string, FaceRole>;
  /** Root mean square mismatch where faces meet, meters. */
  mismatch: number;
  /** Corners where faces were found to meet. */
  contacts: number;
};

/** How close (output units) a corner must be to another outline to touch it. */
const TOUCH = 0.012;
const DEFAULT_DISTANCE = 4;
/** A face this big (share of the output) is the backdrop. */
const BACKDROP_AREA = 0.35;

/** Which way is down, in the projector's frame. */
export function downFromArrow(arrow: Point, elevation: number): Vec3 {
  const s = normalize([arrow.x, -arrow.y, 0]);
  const flat = length(s) > 0.5 ? s : ([0, -1, 0] as Vec3);
  const e = (elevation * Math.PI) / 180;
  return [flat[0] * Math.cos(e), flat[1] * Math.cos(e), -Math.sin(e)];
}

const polygonArea = (pts: Point[]) => Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p.x * q.y - q.x * p.y; }, 0)) / 2;

/** The outline's corners on the plane n·P = −1 (any offset keeps the shape). */
function lift(rays: Vec3[], n: Vec3): Vec3[] | null {
  const out: Vec3[] = [];
  for (const r of rays) {
    const a = dot(n, r);
    if (a > -1e-6) return null;  // seen edge-on or from behind
    out.push(scale(r, -1 / a));
  }
  return out;
}

/** How far a polygon in 3D is from right-angled: the mean squared cosine of its corners. */
function squareness(pts: Vec3[]): number {
  let sum = 0;
  pts.forEach((p, i) => {
    const a = normalize(sub(pts[(i + pts.length - 1) % pts.length], p));
    const b = normalize(sub(pts[(i + 1) % pts.length], p));
    sum += dot(a, b) ** 2;
  });
  return sum / pts.length;
}

/** Facing the projector (at the origin), from a point on the face. */
const facing = (n: Vec3, at: Vec3): Vec3 => (dot(n, at) > 0 ? scale(n, -1) : n);

/** An upright plane's normal, standing along the edge from ray a to ray b. */
function uprightAlong(ra: Vec3, rb: Vec3, down: Vec3): Vec3 | null {
  const m = cross(ra, rb);
  const h = normalize(cross(m, down));
  if (length(h) < 0.5) return null;
  const n = normalize(cross(h, down));
  return length(n) > 0.5 ? n : null;
}

type Plane = { role: FaceRole; n: Vec3 };

/** The best plane for an outline in a role, or the best role (and plane) when none is given. */
export function facePlane(rays: Vec3[], points: Point[], down: Vec3, pr: ProjectorBasis, role?: FaceRole): Plane {
  const middle = normalize(rays.reduce(add, [0, 0, 0] as Vec3));
  const up = scale(down, -1);
  const backdrop = (): Plane => {
    const level = sub(pr.fwd, scale(down, dot(pr.fwd, down)));
    return { role: 'backdrop', n: facing(normalize(length(level) > 1e-3 ? level : pr.fwd), middle) };
  };
  if (role === 'backdrop' || (!role && polygonArea(points) > BACKDROP_AREA)) return backdrop();
  const candidates: (Plane & { score: number })[] = [];
  const consider = (r: FaceRole, n: Vec3 | null, bias = 0) => {
    if (!n) return;
    const nf = facing(n, middle);
    const pts = lift(rays, nf);
    if (!pts) return;
    candidates.push({ role: r, n: nf, score: (points.length === 4 ? squareness(pts) : 0) + bias });
  };
  if (role !== 'side') consider('top', up);
  if (role !== 'top') {
    rays.forEach((ra, i) => {
      const rb = rays[(i + 1) % rays.length];
      // Not a quad: lean towards the edge that runs most across the arrow.
      const across = points.length === 4 ? 0 : Math.abs(dot(normalize(sub(rb, ra)), normalize(down)));
      consider('side', uprightAlong(ra, rb, down), across);
    });
  }
  if (!candidates.length) return role === 'top' ? { role: 'top', n: facing(up, middle) } : backdrop();
  candidates.sort((a, b) => a.score - b.score);
  // Not a quad and no role given: a side, unless only a top could be seen.
  if (points.length !== 4 && !role) return candidates.find((c) => c.role === 'side') ?? candidates[0];
  return candidates[0];
}

function distanceToOutline(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / Math.max(ex * ex + ey * ey, 1e-12)));
    best = Math.min(best, Math.hypot(p.x - a.x - ex * t, p.y - a.y - ey * t));
  }
  return best;
}

/** Least squares: rows of (coefficients, target, weight). */
function leastSquares(rows: { c: number[]; y: number; w: number }[], n: number): number[] {
  const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (const { c, y, w } of rows) {
    for (let i = 0; i < n; i++) {
      if (!c[i]) continue;
      for (let j = 0; j < n; j++) A[i][j] += w * c[i] * c[j];
      A[i][n] += w * c[i] * y;
    }
  }
  // A little pull to zero keeps an unconstrained unknown from blowing up.
  for (let i = 0; i < n; i++) A[i][i] += 1e-9;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    const d = A[col][col] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col] / d;
      if (f) for (let k = col; k <= n; k++) A[r][k] -= f * A[col][k];
    }
  }
  return A.map((row, i) => row[n] / (row[i] || 1e-12));
}

export function solveRoom(input: SolveInput): SolveResult {
  const pr = projectorBasis([0, 0, 0], [0, 0, -1], input.fov, input.aspect);
  const down = downFromArrow(input.arrow, input.elevation);
  const distance = input.distance ?? DEFAULT_DISTANCE;
  const faces = input.surfaces.filter((s) => s.points.length >= 3).map((s) => {
    const rays = s.points.map((p) => rayDirection(pr, p));
    return { s, rays, plane: facePlane(rays, s.points, down, pr, s.role) };
  });
  const k = faces.length;
  // Unknowns: each face's offset d (n·P = d), then the ground's level g (down·P = g).
  const row = () => new Array(k + 1).fill(0);
  // Where a corner of face i touches face j's outline, both planes meet its ray at one place.
  const touches: { i: number; j: number; row: { c: number[]; y: number; w: number } }[] = [];
  faces.forEach((fi, i) => {
    fi.s.points.forEach((p, c) => {
      const r = fi.rays[c];
      faces.forEach((fj, j) => {
        if (i === j || distanceToOutline(p, fj.s.points) > TOUCH) return;
        const ai = dot(fi.plane.n, r), aj = dot(fj.plane.n, r);
        if (ai > -1e-6 || aj > -1e-6) return;
        const x = row();
        x[i] = 1 / ai;
        x[j] = -1 / aj;
        touches.push({ i, j, row: { c: x, y: 0, w: 1 } });
      });
    });
  });
  const residual = (r: { c: number[] }, sol: number[]) => r.c.reduce((a, c, i) => a + c * sol[i], 0);
  let kept = touches;
  let sol: number[] = [];
  let mismatch = 0;
  // One at a time: with bad contacts in, the error spreads over good ones too.
  for (let pass = 0; pass < 400; pass++) {
    sol = solveOffsets(faces, kept, down, distance, input.arrow, k);
    const res = kept.map((t) => Math.abs(residual(t.row, sol)));
    mismatch = res.length ? Math.sqrt(res.reduce((a, r) => a + r * r, 0) / res.length) : 0;
    const sorted = [...res].sort((a, b) => a - b);
    const limit = Math.max(3 * (sorted[Math.floor(sorted.length / 2)] ?? 0), 0.002 * distance);
    const worst = res.indexOf(sorted[sorted.length - 1]);
    if (worst < 0 || res[worst] <= limit) break;
    kept = kept.filter((_, n) => n !== worst);
  }

  const roles: Record<string, FaceRole> = {};
  const roomFaces: RoomFace[] = faces.map((f, i) => {
    roles[f.s.id] = f.plane.role;
    const n = f.plane.n;
    // In front of the projector, whatever the solve said.
    const d = Math.min(sol[i], -0.05);
    const pts = f.rays.map((r) => scale(r, d / Math.min(dot(n, r), -1e-6)));
    const origin = scale(pts.reduce(add, [0, 0, 0] as Vec3), 1 / pts.length);
    let u = normalize(sub(pts[1], pts[0]));
    u = normalize(sub(u, scale(n, dot(u, n))));
    const v = cross(n, u);
    const flat = pts.map((p) => ({ x: dot(sub(p, origin), u), y: dot(sub(p, origin), v) }));
    const extent = Math.max(...flat.map((p) => Math.hypot(p.x, p.y)));
    return {
      surfaceId: f.s.id, role: f.plane.role, origin, u, v, points: flat,
      depth: f.plane.role === 'backdrop' ? 0.1 : Math.max(0.05, Math.min(1.5, extent)),
    };
  });
  return {
    room: { source: 'manual', projector: { position: [0, 0, 0], target: [0, 0, -1], fov: input.fov }, down, floor: true, faces: roomFaces },
    roles,
    mismatch,
    contacts: kept.length,
  };
}

type SolveFace = { s: SolveSurface; rays: Vec3[]; plane: Plane };

/** The plane offsets (and the ground's level, last) for a set of contacts. */
function solveOffsets(faces: SolveFace[], touches: { i: number; j: number; row: { c: number[]; y: number; w: number } }[], down: Vec3, distance: number, arrow: Point, k: number): number[] {
  const row = () => new Array(k + 1).fill(0);
  const rows = touches.map((t) => t.row);
  const links = faces.map(() => new Set<number>());
  for (const t of touches) { links[t.i].add(t.j); links[t.j].add(t.i); }
  // Each group of touching faces stands on the ground at its lowest corner along the arrow.
  const group = new Array(k).fill(-1);
  let groups = 0;
  for (let i = 0; i < k; i++) {
    if (group[i] >= 0) continue;
    const stack = [i];
    group[i] = groups;
    while (stack.length) for (const j of links[stack.pop()!]) if (group[j] < 0) { group[j] = groups; stack.push(j); }
    groups++;
  }
  const along = (p: Point) => p.x * arrow.x + p.y * arrow.y;
  for (let g = 0; g < groups; g++) {
    let best: { i: number; c: number } | null = null;
    faces.forEach((f, i) => {
      if (group[i] !== g || f.plane.role === 'backdrop') return;
      f.s.points.forEach((p, c) => { if (!best || along(p) > along(faces[best.i].s.points[best.c])) best = { i, c }; });
    });
    if (!best) continue;
    const { i, c } = best as { i: number; c: number };
    const r = faces[i].rays[c];
    const a = dot(faces[i].plane.n, r);
    if (a > -1e-6) continue;
    const x = row();
    x[i] = dot(down, r) / a;
    x[k] = -1;
    rows.push({ c: x, y: 0, w: 1 });
  }
  // The scale: corners `distance` in front on average.
  const mean = row();
  let corners = 0;
  faces.forEach((f, i) => f.rays.forEach((r) => { const a = dot(f.plane.n, r); if (a < -1e-6) { mean[i] += 1 / a; corners++; } }));
  rows.push({ c: mean.map((x) => x / Math.max(1, corners)), y: distance, w: 100 });
  // A face nothing else fixes still sits at the distance.
  faces.forEach((f, i) => {
    if (links[i].size || f.plane.role !== 'backdrop') return;
    const x = row();
    f.rays.forEach((r) => { const a = dot(f.plane.n, r); if (a < -1e-6) x[i] += 1 / a / f.rays.length; });
    rows.push({ c: x, y: distance * 1.3, w: 1 });
  });
  return leastSquares(rows, k + 1);
}
