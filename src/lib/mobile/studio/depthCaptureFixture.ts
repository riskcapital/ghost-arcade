/**
 * A synthetic room scan: a floor, a wall and a box, seen by an ARKit-style
 * LiDAR camera (any roll) while a known projector lights them. It makes the
 * same depth map, stripe decode, pose and turn the real auto-map does, so
 * depthCapture.test.ts can check the capture against the truth, and a
 * fixture build (VITE_DEPTH_FIXTURE=1) can show the room scan screens in the
 * simulator, which has no LiDAR.
 */
import { sampleScan, type DepthScan } from './meshMap';
import { turnIntrinsics, turnRaster } from './lidarScan';
import type { Decoded, UV } from './structuredLight';
import { buildDepthCapture, gravityInScan, turnVector, type Turn, type Vec3 } from './depthCapture';
import { projectorBasis, projectPoint } from '../../scene3d/projector';

// ── A synthetic room, in ARKit's gravity-aligned world (+Y up, meters) ──────
// A floor at y = 0, a wall at z = −3 and a box standing on the floor.
export const BOX = { x0: -0.35, x1: 0.35, y1: 0.5, z0: -2.1, z1: -1.5 };
type V = Vec3;
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

/** The nearest hit of a ray with the room. */
function hit(o: V, d: V): V | null {
  let best = Infinity;
  const take = (t: number, ok: (p: V) => boolean) => { if (t > 0.05 && t < best) { const p: V = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t]; if (ok(p)) best = t; } };
  const inBox = (p: V, e = 1e-6) => p[0] >= BOX.x0 - e && p[0] <= BOX.x1 + e && p[1] >= -e && p[1] <= BOX.y1 + e && p[2] >= BOX.z0 - e && p[2] <= BOX.z1 + e;
  if (d[1]) take(-o[1] / d[1], (p) => p[2] > -3);
  if (d[2]) take((-3 - o[2]) / d[2], () => true);
  if (d[1]) take((BOX.y1 - o[1]) / d[1], inBox);
  if (d[2]) take((BOX.z1 - o[2]) / d[2], inBox);
  if (d[0]) { take((BOX.x0 - o[0]) / d[0], inBox); take((BOX.x1 - o[0]) / d[0], inBox); }
  return best < Infinity ? [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best] : null;
}

/** An ARKit camera: where it is, which way it looks, and how far it is rolled (degrees). */
export function arCamera(position: V, target: V, roll: number) {
  const fwd = norm(sub(target, position));
  let right = norm(cross(fwd, [0, 1, 0]));
  let up = cross(right, fwd);
  const r = (roll * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  [right, up] = [norm([right[0] * c + up[0] * s, right[1] * c + up[1] * s, right[2] * c + up[2] * s]), norm([up[0] * c - right[0] * s, up[1] * c - right[1] * s, up[2] * c - right[2] * s])];
  const back: V = [-fwd[0], -fwd[1], -fwd[2]];
  // Column-major camera-to-world, as StudioLiveCapture packs frame.camera.transform.
  const pose = [...right, 0, ...up, 0, ...back, 0, ...position, 1];
  return { position, right, up, back, pose };
}

/** The turn the native code picks to make the photo upright (StudioLiveCapture.patternBegin). */
export function nativeTurn(pose: number[]): Turn {
  const upX = pose[1], upY = -pose[5];
  return (Math.abs(upX) > Math.abs(upY) ? (upX < 0 ? 90 : 270) : upY > 0 ? 180 : 0) as Turn;
}

/** Native (sensor) normalised pixel to the upright picture's, by `turn` — written out on its own, not via the code under test. */
export function uprightUV(u: number, v: number, turn: Turn): UV {
  if (turn === 90) return { x: 1 - v, y: u };
  if (turn === 180) return { x: 1 - u, y: 1 - v };
  if (turn === 270) return { x: v, y: 1 - u };
  return { x: u, y: v };
}

const W = 256, H = 192;
const K = { fx: 0.78, fy: 1.04, cx: 0.5, cy: 0.5 };
export const PROJECTOR = projectorBasis([0.1, 1.6, 0.4], [0, 0.3, -2], 38, 16 / 9);
export const SCREEN = { id: 'screen-1', width: 1280, height: 720 };

export function syntheticRoomScan(roll: number) {
  const cam = arCamera([0, 1.3, 0.2], [0, 0.25, -2], roll);
  const turn = nativeTurn(cam.pose);
  const meters = new Float32Array(W * H), projX = new Float32Array(W * H), projY = new Float32Array(W * H), valid = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = ((i + 0.5) / W - K.cx) / K.fx, yDown = ((j + 0.5) / H - K.cy) / K.fy;
    // ARKit camera direction (x right, y up, z back), forward part −1.
    const d: V = [cam.right[0] * x - cam.up[0] * yDown - cam.back[0], cam.right[1] * x - cam.up[1] * yDown - cam.back[1], cam.right[2] * x - cam.up[2] * yDown - cam.back[2]];
    const p = hit(cam.position, d);
    if (!p) continue;
    meters[j * W + i] = -dot(sub(p, cam.position), cam.back);
    const q = projectPoint(PROJECTOR, p);
    if (q.x > 0 && q.x < 1 && q.y > 0 && q.y < 1) { projX[j * W + i] = q.x * SCREEN.width; projY[j * W + i] = q.y * SCREEN.height; valid[j * W + i] = 1; }
  }
  const up = <T extends Float32Array | Uint8Array>(a: T) => turnRaster(a, W, H, turn);
  const m = up(meters), px = up(projX), py = up(projY), ok = up(valid);
  const depth: DepthScan = { width: m.width, height: m.height, meters: m.data, intrinsics: turnIntrinsics(K, turn), pose: cam.pose, turn };
  const decoded: Decoded = { width: m.width, height: m.height, valid: ok.data, projX: px.data, projY: py.data, coverage: 0.5 };
  // Outlines of the box top and the wall, drawn on the upright photo from the true geometry.
  const photo = (p: V): UV => {
    const rel = sub(p, cam.position);
    const z = -dot(rel, cam.back);
    return uprightUV(dot(rel, cam.right) / z * K.fx + K.cx, -dot(rel, cam.up) / z * K.fy + K.cy, turn);
  };
  const top = ([[BOX.x0, BOX.y1, BOX.z0], [BOX.x1, BOX.y1, BOX.z0], [BOX.x1, BOX.y1, BOX.z1], [BOX.x0, BOX.y1, BOX.z1]] as V[]).map(photo);
  const wall = ([[-1.4, 1.6, -3], [1.4, 1.6, -3], [1.4, 0.55, -3], [-1.4, 0.55, -3]] as V[]).map(photo);
  const front = ([[BOX.x0, BOX.y1, BOX.z1], [BOX.x1, BOX.y1, BOX.z1], [BOX.x1, 0.02, BOX.z1], [BOX.x0, 0.02, BOX.z1]] as V[]).map(photo);
  return { cam, turn, depth, decoded, grid: sampleScan(decoded, depth, 32), top, wall, front };
}

/** A capture point back in ARKit's world: undo the turn, the axis flip and the pose. */
export function toWorld(p: V, cam: ReturnType<typeof arCamera>, turn: Turn): V {
  const back = turn === 90 ? 270 : turn === 270 ? 90 : turn;
  const [x, yDown, z] = turnVector(p, back as Turn);
  return [0, 1, 2].map((k) => cam.position[k] + cam.right[k] * x - cam.up[k] * yDown - cam.back[k] * z) as V;
}


/** A finished room scan of the synthetic room (phone on its side), for the fixture build. */
export function fixtureDepthCapture() {
  const s = syntheticRoomScan(90);
  return buildDepthCapture({
    grid: s.grid,
    screen: SCREEN,
    down: gravityInScan(s.depth.pose!, s.turn),
    surfaces: [
      { id: 'top', name: 'Box top', photo: s.top },
      { id: 'front', name: 'Box front', photo: s.front },
      { id: 'wall', name: 'Wall', photo: s.wall },
    ],
    device: 'Simulator',
  });
}
