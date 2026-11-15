/**
 * Depth mode from a phone scan: the room from what an iPhone with a depth
 * camera measured while the projector showed the auto-map stripes.
 *
 * A capture holds, for each surface the auto-map found, its outline on the
 * output and points on it in 3D (from the depth camera, in the phone's
 * world, meters), each with the projector pixel the stripes decoded there,
 * and which way gravity points. From those:
 *
 * - The projector: every (3D point, projector pixel) pair is one view of the
 *   same pinhole, so a direct linear solve gives its 3×4 projection, which
 *   splits into where it stands, which way it faces, its field of view and
 *   its lens shift.
 * - Each face: a plane fitted to its points; its outline is the surface's
 *   outline on the output carried along the projector's rays onto that plane,
 *   so seen from the projector each face lands exactly on its outline.
 * - Roles: a face facing up is a Top, otherwise a Side.
 *
 * Everything ends up in the projector's frame, as a hand setup does
 * (roomSolve.ts): the projector at the origin looking down −Z.
 *
 * The capture itself is made on the phone (the native depth capture is part
 * of the iOS app). Pure and exported for tests.
 */
import type { Point } from '../mobile/studio/interactive';
import { projectorBasis, rayDirection } from './projector';
import { add, cross, dot, length, normalize, scale, sub, type FaceRole, type Room, type RoomFace } from './roomModel';
import type { Vec3 } from './sceneModel';

export type CaptureSample = { p: Vec3; uv: Point };
export type CaptureSurface = { id: string; name: string; outline: Point[]; samples: CaptureSample[] };
/** Where a Screen's picture sits in the output (0..1 of the output). */
export type CaptureRegion = { x: number; y: number; width: number; height: number };
/**
 * The Screen the stripes were shown on: its pixel size and the part of the
 * output it shows (the whole output when not given). A Screen stretches its
 * part of the output over its own pixels, so when the two shapes differ the
 * output's pixels are not square through that projector.
 */
export type CaptureScreen = { width: number; height: number; region?: CaptureRegion };
export type DepthCapture = {
  /** Which way gravity points in the phone's world. */
  down: Vec3;
  surfaces: CaptureSurface[];
  screen?: CaptureScreen;
};

export type CaptureReport = {
  /** How far the measured points land from their decoded pixels, as solved (output pixels at 1920 wide). */
  pixelError: number;
  /** How far the points sit off their faces' planes, on average (meters). */
  planeError: number;
  fov: number;
  shift: { x: number; y: number };
  samples: number;
};

/** What a capture may hold (the phone is told the same in the desktop's capabilities). */
export const CAPTURE_LIMITS = { surfaces: 48, samplesPerSurface: 4000, samplesTotal: 60000, outline: 64 } as const;
/** Larger than this is not a capture: refused before any work. */
const RAW_LIMIT = 1_000_000;

// ── Fitting a capture into the limits ─────────────────────────────────────

/** `count` items spread evenly over the list, first and last kept, in order. */
export function resampleEvenly<T>(items: readonly T[], count: number): T[] {
  const n = items.length;
  if (n <= count) return items.slice();
  if (count <= 0) return [];
  if (count === 1) return [items[0]];
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(items[Math.round((i * (n - 1)) / (count - 1))]);
  return out;
}

/** Distance from p to the segment a–b. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * A closed outline cut down to at most `max` corners, keeping its shape:
 * Ramer–Douglas–Peucker run by priority, so the corners that move the
 * outline most are kept first. Starts from the two corners farthest apart,
 * then keeps adding the corner furthest off the outline so far.
 */
export function simplifyOutline(points: readonly Point[], max: number = CAPTURE_LIMITS.outline): Point[] {
  const n = points.length;
  if (n <= max) return points.slice();
  if (max < 3) throw new Error('An outline needs at least three corners.');
  // The farthest corner from the first, then the farthest from that: two anchors across the shape.
  const far = (from: number) => {
    let best = from, d = -1;
    for (let i = 0; i < n; i++) {
      const di = Math.hypot(points[i].x - points[from].x, points[i].y - points[from].y);
      if (di > d) { d = di; best = i; }
    }
    return best;
  };
  const a = far(0), b = far(a);
  const kept = new Set<number>([a, b]);
  // Each span runs from one kept corner forward (wrapping) to the next.
  type Span = { from: number; to: number; at: number; off: number };
  const measure = (from: number, to: number): Span => {
    let at = -1, off = -1;
    for (let i = (from + 1) % n; i !== to; i = (i + 1) % n) {
      const d = segmentDistance(points[i], points[from], points[to]);
      if (d > off) { off = d; at = i; }
    }
    return { from, to, at, off };
  };
  const spans: Span[] = [measure(a, b), measure(b, a)];
  while (kept.size < max) {
    let worst = 0;
    for (let i = 1; i < spans.length; i++) if (spans[i].off > spans[worst].off) worst = i;
    const span = spans[worst];
    if (span.at < 0) break;
    kept.add(span.at);
    spans.splice(worst, 1, measure(span.from, span.at), measure(span.at, span.to));
  }
  return [...kept].sort((x, y) => x - y).map((i) => points[i]);
}

/**
 * A capture inside the limits: the surfaces with the most samples, each
 * surface's samples thinned evenly (to its own limit, then all together to
 * the total), outlines simplified. Never cut off at the end of a list: a
 * scan that runs over still covers every face end to end.
 */
export function fitCaptureToLimits(capture: DepthCapture): DepthCapture {
  let surfaces = capture.surfaces;
  if (surfaces.length > CAPTURE_LIMITS.surfaces) {
    const keep = new Set(
      surfaces.map((s, i) => ({ i, n: s.samples.length })).sort((x, y) => y.n - x.n || x.i - y.i).slice(0, CAPTURE_LIMITS.surfaces).map((x) => x.i),
    );
    surfaces = surfaces.filter((_, i) => keep.has(i));
  }
  surfaces = surfaces.map((s) => ({ ...s, outline: simplifyOutline(s.outline), samples: resampleEvenly(s.samples, CAPTURE_LIMITS.samplesPerSurface) }));
  const total = surfaces.reduce((a, s) => a + s.samples.length, 0);
  if (total > CAPTURE_LIMITS.samplesTotal) {
    const share = CAPTURE_LIMITS.samplesTotal / total;
    surfaces = surfaces.map((s) => ({ ...s, samples: resampleEvenly(s.samples, Math.floor(s.samples.length * share)) }));
  }
  return { down: capture.down, surfaces, ...(capture.screen ? { screen: capture.screen } : {}) };
}

/**
 * The shape of the projector's picture over the whole output (the ratio of
 * its horizontal to vertical field across the output). A Screen showing the
 * part `region` of the output on `width` × `height` square pixels: the
 * output's own aspect when the Screen keeps the shape, something else when
 * it stretches (a 16:9 Screen showing a 16:10 output). Without a Screen, the
 * output's aspect.
 */
export function lensAspect(screen: CaptureScreen | undefined, outputAspect: number): number {
  if (!screen || !(screen.width > 0) || !(screen.height > 0)) return outputAspect;
  const r = screen.region ?? { x: 0, y: 0, width: 1, height: 1 };
  const a = (screen.width / screen.height) * (r.height / r.width);
  return Number.isFinite(a) && a > 0.05 && a < 20 ? a : outputAspect;
}

// ── Validation ────────────────────────────────────────────────────────────

const fail = (where: string, what: string): never => {
  throw new Error(`Depth capture ${where}: ${what}.`);
};
const finite = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
const vec = (raw: unknown, where: string): Vec3 => {
  if (!Array.isArray(raw) || raw.length !== 3 || !raw.every(finite)) fail(where, 'not three numbers');
  return raw as Vec3;
};
const point = (raw: unknown, where: string): Point => {
  const p = raw as { x?: unknown; y?: unknown } | null;
  if (!p || !finite(p.x) || !finite(p.y)) fail(where, 'not a point');
  return { x: p!.x as number, y: p!.y as number };
};

/**
 * A capture from anywhere (a file the phone app saved, or one it sent),
 * checked and fitted into the limits. Larger captures are thinned evenly,
 * not cut off.
 */
export function validateDepthCapture(raw: unknown): DepthCapture {
  const c = raw as { down?: unknown; surfaces?: unknown; source?: unknown } | null;
  if (!c || typeof c !== 'object') fail('', 'not an object');
  const down = normalize(vec(c!.down, 'down'));
  if (length(down) < 0.5) fail('down', 'no direction');
  if (!Array.isArray(c!.surfaces) || !c!.surfaces.length) fail('surfaces', 'none');
  if ((c!.surfaces as unknown[]).length > 1000) fail('surfaces', 'more than 1000');
  let points = 0;
  const surfaces = (c!.surfaces as unknown[]).map((raw, i): CaptureSurface => {
    const s = raw as { id?: unknown; name?: unknown; outline?: unknown; samples?: unknown };
    const where = `surface ${i + 1}`;
    if (!s || typeof s.id !== 'string' || !s.id) fail(where, 'no id');
    if (!Array.isArray(s.outline) || s.outline.length < 3) fail(where, 'outline of fewer than three points');
    if (!Array.isArray(s.samples)) fail(where, 'no samples');
    points += (s.outline as unknown[]).length + (s.samples as unknown[]).length;
    if (points > RAW_LIMIT) fail('', 'more than a million points');
    return {
      id: s.id as string,
      name: typeof s.name === 'string' ? s.name.slice(0, 80) : `Face ${i + 1}`,
      outline: (s.outline as unknown[]).map((p, j) => point(p, `${where} outline ${j + 1}`)),
      samples: (s.samples as unknown[]).map((q, j) => {
        const sample = q as { p?: unknown; uv?: unknown };
        return { p: vec(sample?.p, `${where} sample ${j + 1}`), uv: point(sample?.uv, `${where} sample ${j + 1}`) };
      }),
    };
  });
  const screen = captureScreen((c!.source as { screen?: unknown } | undefined)?.screen);
  return fitCaptureToLimits({ down, surfaces, ...(screen ? { screen } : {}) });
}

/** The capture's Screen, when it names a usable size (and region); otherwise none (the output's shape is assumed). */
function captureScreen(raw: unknown): CaptureScreen | undefined {
  const s = raw as { width?: unknown; height?: unknown; region?: unknown } | null | undefined;
  if (!s || typeof s !== 'object' || !finite(s.width) || !finite(s.height) || (s.width as number) < 1 || (s.height as number) < 1) return undefined;
  const screen: CaptureScreen = { width: s.width as number, height: s.height as number };
  const r = s.region as Partial<CaptureRegion> | null | undefined;
  if (r && typeof r === 'object' && [r.x, r.y, r.width, r.height].every(finite) && r.width! > 1e-3 && r.height! > 1e-3) {
    screen.region = { x: r.x!, y: r.y!, width: r.width!, height: r.height! };
  }
  return screen;
}

// ── Linear algebra ────────────────────────────────────────────────────────

/** Eigenvalues and eigenvectors (columns) of a symmetric matrix, by Jacobi rotations. */
export function symmetricEigen(input: number[][]): { values: number[]; vectors: number[][] } {
  const n = input.length;
  const a = input.map((r) => [...r]);
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: a.map((r, i) => r[i]), vectors: v };
}

/** The eigenvector of the smallest eigenvalue. */
function smallest(m: number[][]): number[] {
  const { values, vectors } = symmetricEigen(m);
  const i = values.indexOf(Math.min(...values));
  return vectors.map((row) => row[i]);
}

function invert3(m: number[][]): number[][] {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

// ── The projector ─────────────────────────────────────────────────────────

export type SolvedProjector = {
  /** Where it stands, and its axes (unit), in the capture's world. */
  position: Vec3;
  right: Vec3;
  up: Vec3;
  fwd: Vec3;
  fov: number;
  shift: { x: number; y: number };
};

/**
 * The projector from points and the pixels they show at. Output points are
 * taken as x right, y up from −1 to 1 (a pixel's place on the output), so
 * a pinhole maps (camera x, y, z forward) to (fx·x/z + cx, fy·y/z + cy).
 * `aspect` is the shape of the projector's picture over the output
 * (lensAspect): fx·aspect = fy for a lens with square pixels.
 */
export function solveProjector(pairs: CaptureSample[], aspect: number): SolvedProjector {
  if (pairs.length < 6) throw new Error('Depth capture: fewer than six points to place the projector.');
  // Condition the points: centered, unit spread.
  const mid = scale(pairs.reduce((a, s) => add(a, s.p), [0, 0, 0] as Vec3), 1 / pairs.length);
  const spread = Math.sqrt(pairs.reduce((a, s) => a + dot(sub(s.p, mid), sub(s.p, mid)), 0) / pairs.length) || 1;
  const ata = Array.from({ length: 12 }, () => new Array(12).fill(0));
  const addRow = (r: number[]) => {
    for (let i = 0; i < 12; i++) if (r[i]) for (let j = 0; j < 12; j++) ata[i][j] += r[i] * r[j];
  };
  for (const s of pairs) {
    const [X, Y, Z] = scale(sub(s.p, mid), 1 / spread);
    const x = s.uv.x * 2 - 1, y = 1 - s.uv.y * 2;
    addRow([X, Y, Z, 1, 0, 0, 0, 0, -x * X, -x * Y, -x * Z, -x]);
    addRow([0, 0, 0, 0, X, Y, Z, 1, -y * X, -y * Y, -y * Z, -y]);
  }
  const h = smallest(ata);
  let P = [h.slice(0, 4), h.slice(4, 8), h.slice(8, 12)];
  // Undo the conditioning: P·[(X − mid)/spread; 1].
  P = P.map((r) => [r[0] / spread, r[1] / spread, r[2] / spread, r[3] - (r[0] * mid[0] + r[1] * mid[1] + r[2] * mid[2]) / spread]);
  // In front of it: depth (the third row) positive.
  const depth = pairs.reduce((a, s) => a + P[2][0] * s.p[0] + P[2][1] * s.p[1] + P[2][2] * s.p[2] + P[2][3], 0);
  if (depth < 0) P = P.map((r) => r.map((x) => -x));
  // M = K·R, K upper triangular: Gram-Schmidt from the last row up.
  const m = P.map((r) => [r[0], r[1], r[2]] as Vec3);
  const k22 = length(m[2]);
  const fwd = scale(m[2], 1 / k22);
  const k12 = dot(m[1], fwd);
  const r2 = sub(m[1], scale(fwd, k12));
  const k11 = length(r2);
  const up = scale(r2, 1 / k11);
  const k02 = dot(m[0], fwd), k01 = dot(m[0], up);
  const r1 = sub(sub(m[0], scale(up, k01)), scale(fwd, k02));
  const k00 = length(r1);
  const right = scale(r1, 1 / k00);
  const fx = k00 / k22, fy = k11 / k22;
  // The lens is taken square-pixeled: the field of view from both axes.
  const tanHalf = (1 / fy + 1 / (fx * aspect)) / 2;
  const inv = invert3(m.map((r) => [...r]));
  const p4 = [P[0][3], P[1][3], P[2][3]];
  const position: Vec3 = [0, 1, 2].map((i) => -(inv[i][0] * p4[0] + inv[i][1] * p4[1] + inv[i][2] * p4[2])) as Vec3;
  return { position, right, up, fwd, fov: (2 * Math.atan(tanHalf) * 180) / Math.PI, shift: { x: k02 / k22, y: k12 / k22 } };
}

// ── The room ──────────────────────────────────────────────────────────────

/** A plane through points: their middle and the direction they spread least in. */
export function fitPlane(points: Vec3[]): { at: Vec3; n: Vec3; error: number } {
  const at = scale(points.reduce((a, p) => add(a, p), [0, 0, 0] as Vec3), 1 / points.length);
  const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = sub(p, at);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i][j] += d[i] * d[j];
  }
  const n = normalize(smallest(c) as Vec3);
  const error = points.reduce((a, p) => a + Math.abs(dot(sub(p, at), n)), 0) / points.length;
  return { at, n, error };
}

/** A face upward of this (cosine with up) is a Top. */
const TOP = Math.cos((35 * Math.PI) / 180);

/**
 * The room from a capture. Faces are named after the capture's surfaces;
 * `surfaceId` turns a capture surface's id into the scene object it becomes.
 */
export function roomFromCapture(capture: DepthCapture, aspect: number, surfaceId: (id: string) => string = (id) => id): { room: Room; report: CaptureReport } {
  const pairs = capture.surfaces.flatMap((s) => s.samples);
  // uv is on the output; the lens's own pixels are square, so through a
  // Screen that stretches the output its shape over the output differs.
  const lens = lensAspect(capture.screen, aspect);
  const pr = solveProjector(pairs, lens);
  // Into the projector's frame: it at the origin, right +X, up +Y, looking down −Z.
  const into = (p: Vec3): Vec3 => { const r = sub(p, pr.position); return [dot(r, pr.right), dot(r, pr.up), -dot(r, pr.fwd)]; };
  const turn = (d: Vec3): Vec3 => [dot(d, pr.right), dot(d, pr.up), -dot(d, pr.fwd)];
  const down = normalize(turn(capture.down));
  const up = scale(down, -1);
  const basis = projectorBasis([0, 0, 0], [0, 0, -1], pr.fov, lens, [pr.shift.x, pr.shift.y]);
  let pixel = 0;
  let planeError = 0, planes = 0;
  for (const s of pairs) {
    const c = into(s.p);
    const nx = (c[0] / -c[2]) / Math.max(1e-9, length(basis.right)) + pr.shift.x;
    const ny = (c[1] / -c[2]) / Math.max(1e-9, length(basis.up)) + pr.shift.y;
    pixel += Math.hypot((nx - (s.uv.x * 2 - 1)) * 960, (ny - (1 - s.uv.y * 2)) * 960 / aspect);
  }
  const faces: RoomFace[] = [];
  for (const s of capture.surfaces) {
    if (s.samples.length < 3) continue;
    const fit = fitPlane(s.samples.map((q) => into(q.p)));
    planeError += fit.error;
    planes++;
    // Facing the projector (at the origin).
    const n = dot(fit.n, fit.at) > 0 ? scale(fit.n, -1) : fit.n;
    const d = dot(n, fit.at);
    const pts = s.outline.map((p) => {
      const r = rayDirection(basis, p);
      return scale(r, d / Math.min(dot(n, r), -1e-6));
    });
    const origin = scale(pts.reduce((a, p) => add(a, p), [0, 0, 0] as Vec3), 1 / pts.length);
    let u = normalize(sub(pts[1], pts[0]));
    u = normalize(sub(u, scale(n, dot(u, n))));
    const v = cross(n, u);
    const flat = pts.map((p) => ({ x: dot(sub(p, origin), u), y: dot(sub(p, origin), v) }));
    const extent = Math.max(...flat.map((p) => Math.hypot(p.x, p.y)));
    const role: FaceRole = dot(n, up) > TOP ? 'top' : 'side';
    faces.push({ surfaceId: surfaceId(s.id), role, origin, u, v, points: flat, depth: Math.max(0.05, Math.min(1.5, extent)) });
  }
  return {
    room: {
      source: 'phone',
      projector: { position: [0, 0, 0], target: [0, 0, -1], fov: pr.fov, shift: { ...pr.shift }, ...(Math.abs(lens / aspect - 1) > 1e-3 ? { aspect: lens } : {}) },
      down, floor: true, faces,
    },
    report: { pixelError: pixel / Math.max(1, pairs.length), planeError: planeError / Math.max(1, planes), fov: pr.fov, shift: pr.shift, samples: pairs.length },
  };
}
