/**
 * A synthetic room for testing the auto-map end to end, with no phone: boxes
 * on a floor against a wall (world metres, y up, as ARKit), a projector and a
 * phone camera with known poses and lenses. It renders the stripe photos the
 * phone would take (Lambertian light that falls off with the angle of
 * incidence, albedo, ambient light, blur, noise, 8-bit clipping) and the LiDAR
 * depth (256 x 192, millimetres of noise, holes), and knows where every face
 * truly lands in the projector's picture.
 *
 * Test-only: imported by the *.test.ts files, never by the app.
 */
import type { Capture, PatternPlan } from './structuredLight';
import { patternValue, planPatterns } from './structuredLight';
import type { DepthScan } from './meshMap';
import { STRIPE_CELL } from './structuredLightCodes';

export type Vec = [number, number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec): Vec => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

export type Box = { name: string; centre: Vec; size: Vec; yawDeg: number; albedo: number };
export type Lens = { width: number; height: number; fx: number; fy: number; cx: number; cy: number }; // pixels
export type Pose = { position: Vec; target: Vec };
export type Room = { boxes: Box[]; wallZ: number; wallAlbedo: number; floorAlbedo: number; projector: { lens: Lens; pose: Pose }; camera: { lens: Lens; pose: Pose } };

/** The owner's test: two boxes, a projector lighting the front and top of each (four faces). */
export function twoBoxRoom(overrides: Partial<Room> = {}): Room {
  const projW = 1920, projH = 1080;
  const camW = 1280, camH = 960;
  return {
    // Brown cardboard in front of a white wall: the box faces come back far darker than the wall.
    boxes: [
      { name: 'A', centre: [-0.32, 0.15, -0.55], size: [0.4, 0.3, 0.3], yawDeg: 0, albedo: 0.35 },
      { name: 'B', centre: [0.3, 0.225, -0.7], size: [0.32, 0.45, 0.3], yawDeg: -20, albedo: 0.35 },
    ],
    wallZ: -1.4, wallAlbedo: 0.85, floorAlbedo: 0.3,
    // Throw ratio about 1.4 and lens shift (the picture rises above the lens axis), like a real projector.
    projector: { lens: { width: projW, height: projH, fx: 1.4 * projW, fy: 1.4 * projW, cx: projW / 2, cy: 0.85 * projH }, pose: { position: [0.15, 1.1, 1.5], target: [0, -0.25, -0.6] } },
    // The phone propped a little to the left of the projector, wide lens.
    camera: { lens: { width: camW, height: camH, fx: 0.78 * camW, fy: 0.78 * camW, cx: camW / 2, cy: camH / 2 }, pose: { position: [-0.45, 0.95, 1.25], target: [0, 0.15, -0.6] } },
    ...overrides,
  };
}

type Frame = { o: Vec; r: Vec; d: Vec; f: Vec };
/** x right, y down, z forward, from a look-at with world y up. */
function frameOf(pose: Pose): Frame {
  const f = unit(sub(pose.target, pose.position));
  const r = unit(cross(f, [0, 1, 0]));
  const d = cross(f, r);
  return { o: pose.position, r, d, f };
}
const toLocal = (fr: Frame, p: Vec): Vec => { const q = sub(p, fr.o); return [dot(q, fr.r), dot(q, fr.d), dot(q, fr.f)]; };

export function project(lens: Lens, pose: Pose, p: Vec): { u: number; v: number; z: number } {
  const q = toLocal(frameOf(pose), p);
  return { u: lens.fx * q[0] / q[2] + lens.cx, v: lens.fy * q[1] / q[2] + lens.cy, z: q[2] };
}

export type Face = { id: string; box: string; corners: Vec[]; normal: Vec };

/** The six faces of each box, corners in order. */
export function boxFaces(box: Box): Face[] {
  const a = (box.yawDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const ex: Vec = [c * box.size[0] / 2, 0, -s * box.size[0] / 2], ey: Vec = [0, box.size[1] / 2, 0], ez: Vec = [s * box.size[2] / 2, 0, c * box.size[2] / 2];
  const at = (i: number, j: number, k: number) => add(box.centre, add(mul(ex, i), add(mul(ey, j), mul(ez, k))));
  const faces: [string, Vec, Vec[]][] = [
    ['front', unit(ez), [at(-1, 1, 1), at(1, 1, 1), at(1, -1, 1), at(-1, -1, 1)]],
    ['top', unit(ey), [at(-1, 1, -1), at(1, 1, -1), at(1, 1, 1), at(-1, 1, 1)]],
    ['right', unit(ex), [at(1, 1, 1), at(1, 1, -1), at(1, -1, -1), at(1, -1, 1)]],
    ['left', mul(unit(ex), -1), [at(-1, 1, -1), at(-1, 1, 1), at(-1, -1, 1), at(-1, -1, -1)]],
  ];
  return faces.map(([name, normal, corners]) => ({ id: `${box.name}-${name}`, box: box.name, corners, normal }));
}

type Hit = { t: number; n: Vec; albedo: number; id: string };

function hitBox(box: Box, o: Vec, d: Vec): Hit | null {
  const a = (box.yawDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const ax: Vec = [c, 0, -s], ay: Vec = [0, 1, 0], az: Vec = [s, 0, c];
  const q = sub(o, box.centre);
  const lo: Vec = [dot(q, ax), dot(q, ay), dot(q, az)], ld: Vec = [dot(d, ax), dot(d, ay), dot(d, az)];
  let t0 = -Infinity, t1 = Infinity, axis = -1, sign = 0;
  for (let k = 0; k < 3; k++) {
    const h = box.size[k] / 2;
    if (Math.abs(ld[k]) < 1e-12) { if (Math.abs(lo[k]) > h) return null; continue; }
    let ta = (-h - lo[k]) / ld[k], tb = (h - lo[k]) / ld[k], sg = -1;
    if (ta > tb) { [ta, tb] = [tb, ta]; sg = 1; }
    if (ta > t0) { t0 = ta; axis = k; sign = sg; }
    t1 = Math.min(t1, tb);
  }
  if (t0 > t1 || t0 < 1e-6 || axis < 0) return null;
  const n = mul([ax, ay, az][axis], sign);
  const face = axis === 1 ? (sign > 0 ? 'top' : 'bottom') : axis === 2 ? (sign > 0 ? 'front' : 'back') : sign > 0 ? 'right' : 'left';
  return { t: t0, n, albedo: box.albedo, id: `${box.name}-${face}` };
}

export function castRay(room: Room, o: Vec, d: Vec): Hit | null {
  let best: Hit | null = null;
  const take = (h: Hit | null) => { if (h && (!best || h.t < best.t)) best = h; };
  if (d[1] < -1e-9) take({ t: -o[1] / d[1], n: [0, 1, 0], albedo: room.floorAlbedo, id: 'floor' });
  if (d[2] < -1e-9) take({ t: (room.wallZ - o[2]) / d[2], n: [0, 0, 1], albedo: room.wallAlbedo, id: 'wall' });
  for (const box of room.boxes) take(hitBox(box, o, d));
  return best;
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}

export type RenderOptions = { supersample?: number; ambient?: number; exposure?: number; noise?: number; seed?: number; cell?: number };

/**
 * The stripe photos (one per frame of the plan, in order) and, per camera
 * pixel, which surface it sees: what the phone would capture.
 */
export function renderScan(room: Room, options: RenderOptions = {}): { plan: PatternPlan; captures: Capture[]; ids: string[]; idOf: Int16Array } {
  const ss = options.supersample ?? 2, ambient = options.ambient ?? 0.04, noise = options.noise ?? 2, exposure = options.exposure ?? 330;
  const { lens: cl, pose: cp } = room.camera, { lens: pl, pose: pp } = room.projector;
  const plan = planPatterns(pl.width, pl.height, options.cell ?? STRIPE_CELL);
  const cam = frameOf(cp), proj = frameOf(pp);
  const W = cl.width, H = cl.height, S = ss * ss;
  // Per subsample: albedo, irradiance from the projector (0 when shadowed or outside its picture), projector pixel.
  const albedo = new Float32Array(W * H * S), light = new Float32Array(W * H * S), pu = new Float32Array(W * H * S), pv = new Float32Array(W * H * S);
  const ids: string[] = [];
  const idOf = new Int16Array(W * H).fill(-1);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
    const k = (j * W + i) * S + sy * ss + sx;
    const x = (i + (sx + 0.5) / ss - cl.cx) / cl.fx, y = (j + (sy + 0.5) / ss - cl.cy) / cl.fy;
    const d = unit(add(cam.f, add(mul(cam.r, x), mul(cam.d, y))));
    const hit = castRay(room, cam.o, d);
    if (!hit) continue;
    const p = add(cam.o, mul(d, hit.t));
    if (sx === 0 && sy === 0) { let id = ids.indexOf(hit.id); if (id < 0) { id = ids.length; ids.push(hit.id); } idOf[j * W + i] = id; }
    albedo[k] = hit.albedo;
    const toProj = sub(proj.o, p), dist = Math.hypot(...toProj), l = mul(toProj, 1 / dist);
    const cos = dot(hit.n, l);
    if (cos <= 0) continue;
    const shadow = castRay(room, add(p, mul(hit.n, 1e-5)), l);
    if (shadow && shadow.t < dist - 1e-4) continue;
    const q = toLocal(proj, p);
    const u = pl.fx * q[0] / q[2] + pl.cx, v = pl.fy * q[1] / q[2] + pl.cy;
    if (!(q[2] > 0) || u < 0 || v < 0 || u >= pl.width || v >= pl.height) continue;
    light[k] = cos / (dist * dist) * 4; // 1 at 2 m head on
    pu[k] = u; pv[k] = v;
  }
  const random = mulberry32(options.seed ?? 3);
  const gauss = () => { let s = 0; for (let n = 0; n < 4; n++) s += random(); return (s - 2) * Math.sqrt(3); };
  const captures: Capture[] = plan.frames.map(frame => {
    const raw = new Float32Array(W * H);
    for (let g = 0; g < W * H; g++) {
      let sum = 0;
      for (let s = 0; s < S; s++) {
        const k = g * S + s;
        const on = light[k] > 0 ? patternValue(plan, frame, pu[k], pv[k]) : 0;
        sum += albedo[k] * (ambient + light[k] * on);
      }
      raw[g] = sum / S;
    }
    // A little lens blur (3x3), then sensor noise and 8-bit clipping.
    const luma = new Uint8ClampedArray(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = i + dx, y = j + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const w = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
        sum += raw[y * W + x] * w; n += w;
      }
      luma[j * W + i] = Math.round(sum / n * exposure + noise * gauss());
    }
    return { width: W, height: H, luma };
  });
  return { plan, captures, ids, idOf };
}

/** LiDAR depth on a 256 x 192 grid lined up with the photos (same field of view), camera z in metres. */
export function renderDepth(room: Room, options: { width?: number; height?: number; noise?: number; holes?: number; seed?: number } = {}): DepthScan {
  const w = options.width ?? 256, h = options.height ?? 192;
  const { lens: cl, pose: cp } = room.camera;
  const cam = frameOf(cp);
  const random = mulberry32(options.seed ?? 11);
  const gauss = () => { let s = 0; for (let n = 0; n < 4; n++) s += random(); return (s - 2) * Math.sqrt(3); };
  const meters = new Float32Array(w * h);
  const k = { fx: cl.fx / cl.width, fy: cl.fy / cl.height, cx: cl.cx / cl.width, cy: cl.cy / cl.height };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = ((i + 0.5) / w - k.cx) / k.fx, y = ((j + 0.5) / h - k.cy) / k.fy;
    const d = add(cam.f, add(mul(cam.r, x), mul(cam.d, y)));
    const hit = castRay(room, cam.o, unit(d));
    if (!hit || random() < (options.holes ?? 0.02)) continue;
    const z = hit.t / Math.hypot(...d); // distance along the optical axis
    meters[j * w + i] = z + (options.noise ?? 0.006) * gauss();
  }
  return { width: w, height: h, meters, intrinsics: k };
}

export type FaceTruth = { id: string; projector: { x: number; y: number }[]; samples: { cam: { x: number; y: number }; proj: { x: number; y: number } }[] };

/**
 * For each box face the projector lights and the camera sees: its corners in
 * the projector's picture (pixels), and points on it in both pictures.
 */
export function faceTruth(room: Room, minShare = 0.6, grid = 24): FaceTruth[] {
  const { lens: cl, pose: cp } = room.camera, { lens: pl, pose: pp } = room.projector;
  const out: FaceTruth[] = [];
  for (const box of room.boxes) for (const face of boxFaces(box)) {
    const samples: FaceTruth['samples'] = [];
    let total = 0;
    for (let a = 0; a < grid; a++) for (let b = 0; b < grid; b++) {
      const s = (a + 0.5) / grid, t = (b + 0.5) / grid;
      const [c0, c1, c2, c3] = face.corners;
      const p = add(add(mul(c0, (1 - s) * (1 - t)), mul(c1, s * (1 - t))), add(mul(c2, s * t), mul(c3, (1 - s) * t)));
      total++;
      const seen = (pose: Pose) => { const o = pose.position, d = sub(p, o), dist = Math.hypot(...d); const hit = castRay(room, o, mul(d, 1 / dist)); return !!hit && hit.id === face.id && Math.abs(hit.t - dist) < 1e-3; };
      if (dot(face.normal, sub(pp.position, p)) <= 0 || dot(face.normal, sub(cp.position, p)) <= 0) continue;
      if (!seen(pp) || !seen(cp)) continue;
      const q = project(pl, pp, p), c = project(cl, cp, p);
      if (q.u < 0 || q.v < 0 || q.u >= pl.width || q.v >= pl.height) continue;
      samples.push({ cam: { x: c.u, y: c.v }, proj: { x: q.u, y: q.v } });
    }
    if (samples.length < minShare * total) continue;
    out.push({ id: face.id, projector: face.corners.map(p => { const q = project(pl, pp, p); return { x: q.u, y: q.v }; }), samples });
  }
  return out;
}
