/**
 * The relief world as a ghost-scene: a wall facing the camera, the scene's
 * solid objects standing out of it as blocks, a sun and a fill light.
 *
 * The wall is 4 m high and 4·aspect wide at z = 0; the camera looks at it
 * face-on from +Z, close enough that the wall fills the output exactly. A
 * block's front face is its 2D outline unprojected to its depth, so seen from
 * the camera the front face lands exactly on the outline the Studio draws:
 * the 2D overlay stays the outline editor, and the flat effects line up with
 * the blocks.
 *
 * Pure and exported for tests; the same rays drive input (worldInput.ts).
 */
import type { InteractiveScene, InteractiveSurface, Point } from '../mobile/studio/interactive';
import { defaultScene3D, identityTransform, material, type Material, type Scene3D, type SceneNode, type Transform, type Vec3 } from './sceneModel';
import { defaultSurfaceFinish, type ReliefWorld, type SurfaceFinish } from './worldModel';

export const WALL_HEIGHT = 4;
const MIN_FOV = 8;
const MAX_FOV = 40;
/** The deepest a block may stand, as a share of the camera distance. */
const MAX_DEPTH_SHARE = 0.6;

export type ReliefFrame = {
  /** Wall width and height in meters. */
  W: number;
  H: number;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Camera distance from the wall. */
  camZ: number;
};

export function reliefFrame(aspect: number, lens: number): ReliefFrame {
  const H = WALL_HEIGHT;
  const W = H * Math.max(0.1, aspect);
  const fov = MIN_FOV + (MAX_FOV - MIN_FOV) * Math.max(0, Math.min(1, lens));
  const camZ = H / 2 / Math.tan((fov * Math.PI) / 360);
  return { W, H, fov, camZ };
}

/** A point on the output (0..1, y down) at depth `d` in front of the wall. */
export function unproject(frame: ReliefFrame, p: Point, d: number): { x: number; y: number } {
  const k = 1 - d / frame.camZ;
  return { x: (p.x - 0.5) * frame.W * k, y: (0.5 - p.y) * frame.H * k };
}

/** Where a world point shows on the output (0..1, y down). */
export function project(frame: ReliefFrame, v: Vec3): Point {
  const k = frame.camZ / (frame.camZ - v[2]);
  return { x: 0.5 + (v[0] * k) / frame.W, y: 0.5 - (v[1] * k) / frame.H };
}

/** The objects that stand out of the wall as blocks. */
export function reliefSolids(scene: InteractiveScene): InteractiveSurface[] {
  return scene.surfaces.filter((s) => s.behavior === 'solid' && s.points.length >= 3);
}

/** How far a block stands out of the wall, in meters. */
export function blockDepth(surface: InteractiveSurface, world: ReliefWorld, frame: ReliefFrame): number {
  return Math.min(frame.camZ * MAX_DEPTH_SHARE, Math.max(0.01, (surface.height ?? 0.2) * world.depthScale));
}

/** The deepest block, in meters (0 with none). */
export function deepestBlock(scene: InteractiveScene, world: ReliefWorld, frame: ReliefFrame): number {
  return reliefSolids(scene).reduce((d, s) => Math.max(d, blockDepth(s, world, frame)), 0);
}

/**
 * The invisible front pane that keeps balls in the world: far enough in front
 * of the deepest block for a big ball to pass in front of it.
 */
export function frontPaneDepth(scene: InteractiveScene, world: ReliefWorld, frame: ReliefFrame): number {
  return Math.max(0.5, deepestBlock(scene, world, frame)) + 0.45;
}

/** How far the floor ledge stands out: under everything up to the pane. */
export function floorDepth(scene: InteractiveScene, world: ReliefWorld, frame: ReliefFrame): number {
  return Math.max(0.8, frontPaneDepth(scene, world, frame));
}

/** A finish as a ghost-scene material. `light` draws only the light that falls on it. */
export function finishMaterial(finish: SurfaceFinish = defaultSurfaceFinish()): Material {
  switch (finish.preset) {
    case 'stone':
      return material('matte', { base: finish.color, rough: 0.78 });
    case 'matte':
      return material('matte', { base: finish.color });
    case 'chrome':
      return material('chrome', { base: finish.color });
    case 'glass':
      return material('glass', { base: finish.color });
    case 'neon':
      return material('neon', { base: finish.color });
    case 'ink':
      return material('ink', { base: finish.color });
    case 'light':
      return material('matte', { base: '#ffffff', rough: 1 });
  }
}

const node = (id: string, name: string, body: Record<string, unknown>, transform: Partial<Transform> = {}): SceneNode =>
  ({ id, name, visible: true, transform: { ...identityTransform(), ...transform }, ...body }) as SceneNode;

/** Towards the sun: degrees round the wall from 12 o'clock, degrees up off it. */
export function sunDirection(azimuth: number, elevation: number): Vec3 {
  const a = (azimuth * Math.PI) / 180, e = (elevation * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e) * 6, Math.cos(a) * Math.cos(e) * 6, Math.sin(e) * 6];
}

/**
 * The block for a solid object. An outline mesh extrudes along its own −Z, so
 * placed at z = d with no turn its front face sits at z = d and its back on
 * the wall.
 */
function blockNode(surface: InteractiveSurface, world: ReliefWorld, frame: ReliefFrame): SceneNode {
  const d = blockDepth(surface, world, frame);
  const points = surface.points.map((p) => unproject(frame, p, d));
  return node(`block:${surface.id}`, surface.name || 'Block', {
    kind: 'mesh', shape: 'outline', material: finishMaterial(surface.finish), collider: 'static',
    catcher: surface.finish?.preset === 'light', outline: { points, depth: d },
  }, { position: [0, 0, d] });
}

/** The Studio's Orbit view: degrees the camera has turned round the wall. */
export type ReliefView = { yaw: number; pitch: number };

/** The camera, face-on or turned round a point halfway into the blocks. */
export function reliefCamera(frame: ReliefFrame, world: ReliefWorld, view?: ReliefView): Scene3D['camera'] {
  if (!view || (!view.yaw && !view.pitch)) return { mode: 'free', fov: frame.fov, position: [0, 0, frame.camZ], target: [0, 0, 0] };
  const pivot = Math.min(frame.camZ * MAX_DEPTH_SHARE, world.depthScale * 0.2);
  const yaw = (Math.max(-80, Math.min(80, view.yaw)) * Math.PI) / 180;
  const pitch = (Math.max(-80, Math.min(80, view.pitch)) * Math.PI) / 180;
  const r = frame.camZ - pivot;
  return {
    mode: 'free',
    fov: frame.fov,
    position: [r * Math.sin(yaw) * Math.cos(pitch), r * Math.sin(pitch), pivot + r * Math.cos(yaw) * Math.cos(pitch)],
    target: [0, 0, pivot],
  };
}

/** The world as a ghost-scene the 3D engine draws. */
export function reliefScene(scene: InteractiveScene, world: ReliefWorld, aspect: number, view?: ReliefView): Scene3D {
  const frame = reliefFrame(aspect, world.lens);
  const nodes: SceneNode[] = [];
  // The wall: a unit plane (its normal +Y) turned to face the camera.
  nodes.push(node('wall', 'Wall', {
    kind: 'mesh', shape: 'plane', material: material('matte', { base: world.wall.color, rough: world.wall.rough }),
    collider: 'static', catcher: world.wall.catcher,
  }, { rotation: [90, 0, 0], scale: [frame.W * 1.04, 1, frame.H * 1.04] }));
  if (world.floor) {
    nodes.push(node('floor', 'Floor', {
      kind: 'mesh', shape: 'box', material: material('matte', { base: world.wall.color, rough: world.wall.rough }), collider: 'static', catcher: world.wall.catcher,
    }, ((d) => ({ position: [0, -frame.H / 2 - 0.05, d / 2] as Vec3, scale: [frame.W * 1.04, 0.1, d] as Vec3 }))(floorDepth(scene, world, frame))));
  }
  for (const s of reliefSolids(scene)) nodes.push(blockNode(s, world, frame));
  nodes.push(node('sun', 'Sun', { kind: 'light', light: 'key', color: world.sun.color, power: world.sun.power, shadows: true, orbit: 0 }, {
    position: sunDirection(world.sun.azimuth, world.sun.elevation),
  }));
  if (world.fill.power > 0) {
    nodes.push(node('fill', 'Fill', { kind: 'light', light: 'point', color: world.fill.color, power: world.fill.power * 6, shadows: false, orbit: 0 }, {
      position: [frame.W * 0.42, -frame.H * 0.3, frame.camZ * 0.35],
    }));
  }
  const base = defaultScene3D();
  return {
    ...base,
    name: 'Relief',
    nodes,
    environment: { sky: 'void', intensity: 0.35, fog: 0 },
    camera: reliefCamera(frame, world, view),
    post: { ...base.post, bloom: world.bloom, exposure: world.exposure },
    react: { light: 0.25, particles: 0.3, bloom: 0.35, camera: 0 },
  };
}

// ── Picking ───────────────────────────────────────────────────────────────

export type Ray = { origin: Vec3; dir: Vec3 };
export type ReliefHit = { surfaceId: string | null; point: Vec3; normal: Vec3; t: number };

/** The camera ray through a point of the output (0..1, y down). */
export function rayFromUv(frame: ReliefFrame, p: Point): Ray {
  const target = unproject(frame, p, 0);
  const dir: Vec3 = [target.x, target.y, -frame.camZ];
  const len = Math.hypot(...dir);
  return { origin: [0, 0, frame.camZ], dir: [dir[0] / len, dir[1] / len, dir[2] / len] };
}

function inside(poly: { x: number; y: number }[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/**
 * What the ray meets first: a block's front face or side, or the wall. Blocks
 * are prisms along Z, so a block is hit at its front face when the ray's
 * crossing at z = d is inside the outline, else on a side where the ray
 * enters the prism between d and 0.
 */
export function pickRelief(scene: InteractiveScene, world: ReliefWorld, aspect: number, ray: Ray): ReliefHit {
  const frame = reliefFrame(aspect, world.lens);
  const at = (t: number): Vec3 => [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t];
  const tWall = -ray.origin[2] / ray.dir[2];
  let best: ReliefHit = { surfaceId: null, point: at(tWall), normal: [0, 0, 1], t: tWall };
  for (const s of reliefSolids(scene)) {
    const d = blockDepth(s, world, frame);
    const poly = s.points.map((p) => unproject(frame, p, d));
    const tFront = (d - ray.origin[2]) / ray.dir[2];
    const f = at(tFront);
    if (tFront > 0 && tFront < best.t && inside(poly, f[0], f[1])) {
      best = { surfaceId: s.id, point: f, normal: [0, 0, 1], t: tFront };
      continue;
    }
    // Sides: the first edge the ray crosses between the front and the wall.
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ex = b.x - a.x, ey = b.y - a.y;
      const nx = ey, ny = -ex;
      const denom = nx * ray.dir[0] + ny * ray.dir[1];
      if (Math.abs(denom) < 1e-9) continue;
      const t = (nx * (a.x - ray.origin[0]) + ny * (a.y - ray.origin[1])) / denom;
      if (t <= 0 || t >= best.t) continue;
      const p = at(t);
      if (p[2] < 0 || p[2] > d) continue;
      const along = ((p[0] - a.x) * ex + (p[1] - a.y) * ey) / (ex * ex + ey * ey);
      if (along < 0 || along > 1) continue;
      const len = Math.hypot(nx, ny) || 1;
      const n: Vec3 = [nx / len, ny / len, 0];
      // Face the normal back at the ray.
      if (n[0] * ray.dir[0] + n[1] * ray.dir[1] > 0) { n[0] = -n[0]; n[1] = -n[1]; }
      best = { surfaceId: s.id, point: p, normal: n, t };
    }
  }
  return best;
}
