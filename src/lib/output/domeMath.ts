/**
 * Dome output geometry, shared by the dome settings, the native sync and the
 * dome gizmo on the editor canvas. Mirrors heartbeat.wgsl line for line
 * (dome_lens_theta, dome_direction, dome_picture_point, dome_place_uv), so
 * what the gizmo draws is where the renderer puts it.
 *
 * Conventions, as in the shader:
 *   - The dome picture is the unit circle `m`. +y is the back of the dome,
 *     -y the front (the bottom of a domemaster), +x the audience's right.
 *   - A direction on the dome has z towards the zenith.
 *   - Azimuth is degrees around from the front, positive to the right.
 *     Elevation is degrees up from the horizon (90 = zenith).
 *   - Frame UV is y-up (0 at the bottom), as the renderer's.
 */
import type { DomePlacement } from '../types';

export type DomeLens = 'angular' | 'stereographic' | 'orthographic';
export type DomeSource = 'flat' | 'panorama' | 'domemaster';

/** The dome settings this module reads (a subset of OutputSettings). */
export interface DomeOutput {
  domeEnabled?: boolean;
  domeMode?: DomeLens | 'equirectangular';
  domeSource?: DomeSource;
  domeFOV?: number;
  domeRotation?: number;
  domeTilt?: number;
  domeOffsetX?: number;
  domeOffsetY?: number;
  domeCurvature?: number;
  domeTruncation?: number;
  domeSourceAngle?: number;
  domePanoBottom?: number;
  domePanoTop?: number;
  domePanoSpan?: number;
  domePanoSeam?: number;
  domeGrid?: boolean;
}

export type Vec2 = { x: number; y: number };
export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;

export const DOME_LENSES: DomeLens[] = ['angular', 'stereographic', 'orthographic'];
export const DOME_SOURCES: DomeSource[] = ['flat', 'panorama', 'domemaster'];

/** The old "Equirectangular 360" mode was meant as a panorama wrap; read it as one. */
export function domeSourceOf(out: DomeOutput): DomeSource {
  if (out.domeSource && DOME_SOURCES.includes(out.domeSource)) return out.domeSource;
  return out.domeMode === 'equirectangular' ? 'panorama' : 'flat';
}

export function domeLensOf(out: DomeOutput): DomeLens {
  const mode = out.domeMode;
  return mode && (DOME_LENSES as string[]).includes(mode) ? (mode as DomeLens) : 'angular';
}

/** The canvas angle that suits a canvas kind: a flat view's width, a domemaster's fisheye. */
export function defaultSourceAngle(source: DomeSource): number {
  return source === 'domemaster' ? 180 : 90;
}

export function domeSourceAngleOf(out: DomeOutput): number {
  const source = domeSourceOf(out);
  if (source === 'panorama') return defaultSourceAngle('flat');
  return finite(out.domeSourceAngle, defaultSourceAngle(source));
}

export const DEFAULT_DOME_PLACEMENT: Omit<DomePlacement, 'enabled'> = {
  azimuth: 0,
  elevation: 90,
  size: 60,
  roll: 0,
};

export function placementOf(layer: { domePlacement?: DomePlacement | null }): DomePlacement {
  return { enabled: false, ...DEFAULT_DOME_PLACEMENT, ...(layer.domePlacement ?? {}) };
}

/** Whether the layer draws in the dome pass under these settings. */
export function isPlacedOnDome(layer: { domePlacement?: DomePlacement | null }, out: DomeOutput): boolean {
  return !!out.domeEnabled && !!layer.domePlacement?.enabled;
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function lensIndex(lens: DomeLens): number {
  return Math.max(0, DOME_LENSES.indexOf(lens));
}

// ─── Lens ────────────────────────────────────────────────────────────────

/** Radians from the zenith at radius `r` of the dome picture (dome_lens_theta). */
export function lensTheta(r: number, lens: DomeLens, fovDeg: number): number {
  const half = fovDeg * DEG * 0.5;
  if (lens === 'stereographic') return 2 * Math.atan(r * Math.tan(Math.min(half, 3) * 0.5));
  if (lens === 'orthographic') return Math.asin(Math.min(r, 1)) * half / (Math.PI * 0.5);
  return r * half;
}

/** The radius in the dome picture that looks `theta` radians from the zenith. */
export function lensRadius(theta: number, lens: DomeLens, fovDeg: number): number {
  const half = fovDeg * DEG * 0.5;
  if (lens === 'stereographic') return Math.tan(theta * 0.5) / Math.tan(Math.min(half, 3) * 0.5);
  if (lens === 'orthographic') return Math.sin(Math.min(theta * (Math.PI * 0.5) / Math.max(half, 1e-6), Math.PI * 0.5));
  return theta / Math.max(half, 1e-6);
}

export function directionAt(m: Vec2, lens: DomeLens, fovDeg: number): Vec3 {
  const theta = lensTheta(Math.hypot(m.x, m.y), lens, fovDeg);
  const phi = Math.atan2(m.y, m.x);
  return [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)];
}

/** Where a direction shows in the dome picture, or null outside the lens. */
export function pointOf(dir: Vec3, lens: DomeLens, fovDeg: number): Vec2 | null {
  const theta = Math.acos(Math.max(-1, Math.min(1, dir[2])));
  if (theta > fovDeg * DEG * 0.5 + 1e-6) return null;
  const r = lensRadius(theta, lens, fovDeg);
  const phi = Math.atan2(dir[1], dir[0]);
  return { x: r * Math.cos(phi), y: r * Math.sin(phi) };
}

export function azElOf(dir: Vec3): { azimuth: number; elevation: number } {
  return {
    azimuth: Math.atan2(dir[0], -dir[1]) / DEG,
    elevation: Math.asin(Math.max(-1, Math.min(1, dir[2]))) / DEG,
  };
}

export function directionOf(azimuthDeg: number, elevationDeg: number): Vec3 {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  return [Math.cos(el) * Math.sin(az), -Math.cos(el) * Math.cos(az), Math.sin(el)];
}

// ─── The dome picture in the output frame ────────────────────────────────

/** dome_picture_point: frame UV (y-up) to the dome picture. */
export function framePointToDome(uv: Vec2, aspect: number, out: DomeOutput): Vec2 {
  let x = (uv.x - 0.5) * 2;
  let y = (uv.y - 0.5) * 2;
  if (aspect > 1) x *= aspect;
  else y /= aspect;
  x -= finite(out.domeOffsetX, 0);
  y -= finite(out.domeOffsetY, 0);
  const rot = finite(out.domeRotation, 0) * DEG;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: x * c - y * s, y: x * s + y * c };
}

/** The inverse: a dome-picture point to frame UV (y-up). */
export function domePointToFrame(m: Vec2, aspect: number, out: DomeOutput): Vec2 {
  const rot = finite(out.domeRotation, 0) * DEG;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  let x = m.x * c + m.y * s + finite(out.domeOffsetX, 0);
  let y = -m.x * s + m.y * c + finite(out.domeOffsetY, 0);
  if (aspect > 1) x /= aspect;
  else y *= aspect;
  return { x: x * 0.5 + 0.5, y: y * 0.5 + 0.5 };
}

// ─── Layers placed on the dome ───────────────────────────────────────────

/** The basis a placement lays its canvas on (dome_place_uv). */
export function placementBasis(p: Omit<DomePlacement, 'enabled'>) {
  const az = p.azimuth * DEG;
  const center = directionOf(p.azimuth, p.elevation);
  const east: Vec3 = [Math.cos(az), Math.sin(az), 0];
  const up = cross(center, east);
  const rc = Math.cos(p.roll * DEG);
  const rs = Math.sin(p.roll * DEG);
  const across = add(scale(east, rc), scale(up, rs));
  const upward = sub(scale(up, rc), scale(east, rs));
  const halfW = Math.tan(Math.min(Math.max(p.size, 1), 170) * DEG * 0.5);
  return { center, across, upward, halfW };
}

/**
 * The direction on the dome showing canvas point `uv` (y-up) of a layer
 * placed by `p`, the canvas `canvasAspect` wide per unit of height.
 */
export function placedCanvasDirection(uv: Vec2, p: Omit<DomePlacement, 'enabled'>, canvasAspect: number): Vec3 {
  const { center, across, upward, halfW } = placementBasis(p);
  const x = (uv.x - 0.5) * 2 * halfW;
  const y = (uv.y - 0.5) * 2 * halfW / canvasAspect;
  return normalize(add(center, add(scale(across, x), scale(upward, y))));
}

/** The canvas UV (y-up) a direction sees through a placement; null behind it. */
export function placedCanvasUv(dir: Vec3, p: Omit<DomePlacement, 'enabled'>, canvasAspect: number): Vec2 | null {
  const { center, across, upward, halfW } = placementBasis(p);
  const facing = dot(dir, center);
  if (facing <= 0.02) return null;
  const x = dot(dir, across) / facing;
  const y = dot(dir, upward) / facing;
  return { x: 0.5 + x / (2 * halfW), y: 0.5 + y * canvasAspect / (2 * halfW) };
}

/** Native `set_layer_dome` payload. */
export function domePlacementCommand(layerId: string, layer: { domePlacement?: DomePlacement | null }) {
  const p = placementOf(layer);
  return {
    type: 'set_layer_dome' as const,
    layer_id: layerId,
    enabled: !!layer.domePlacement?.enabled,
    azimuth: p.azimuth,
    elevation: p.elevation,
    size: p.size,
    roll: p.roll,
  };
}

/** The dome fields of the native `set_output_stage` payload. */
export function nativeDomeStage(out: DomeOutput) {
  const source = domeSourceOf(out);
  return {
    domeEnabled: !!out.domeEnabled,
    domeMode: lensIndex(domeLensOf(out)),
    domeSource: DOME_SOURCES.indexOf(source),
    domeFOV: finite(out.domeFOV, 180),
    domeRotation: finite(out.domeRotation, 0),
    domeTilt: finite(out.domeTilt, 0),
    domeOffsetX: finite(out.domeOffsetX, 0),
    domeOffsetY: finite(out.domeOffsetY, 0),
    domeCurvature: finite(out.domeCurvature, 1),
    domeTruncation: finite(out.domeTruncation, 1),
    domeSourceAngle: domeSourceAngleOf(out),
    domePanoBottom: finite(out.domePanoBottom, 0),
    domePanoTop: finite(out.domePanoTop, 90),
    domePanoSpan: finite(out.domePanoSpan, 360),
    domePanoSeam: finite(out.domePanoSeam, 0),
    domeGrid: out.domeGrid ? 0.85 : 0,
  };
}

// ─── Vectors ─────────────────────────────────────────────────────────────

function add(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a: Vec3, k: number): Vec3 { return [a[0] * k, a[1] * k, a[2] * k]; }
export function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

// ─── The Inside view's camera ─────────────────────────────────────────────

/** Where the Inside view looks: degrees, the field of view vertical; where
 *  the eye sits (`back` 0 the center .. 1 the back of the room, behind the
 *  look) and whether the room is drawn (the eye then sits at seat height). */
export interface DomeCamera {
  azimuth: number;
  elevation: number;
  fov: number;
  back?: number;
  room?: boolean;
}

/** The camera's basis and eye, as dome_inside_view in heartbeat.wgsl builds them. */
function cameraBasis(camera: DomeCamera) {
  const yaw = camera.azimuth * DEG;
  const pitch = camera.elevation * DEG;
  const forward: Vec3 = [Math.cos(pitch) * Math.sin(yaw), -Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch)];
  const right: Vec3 = [Math.cos(yaw), Math.sin(yaw), 0];
  const up = cross(forward, right);
  const t = Math.tan(Math.max(camera.fov, 1) * DEG * 0.5);
  const back = Math.max(0, Math.min(1, camera.back ?? 0)) * 0.82;
  const eye: Vec3 = [-Math.sin(yaw) * back, Math.cos(yaw) * back, camera.room ? -0.14 : 0];
  return { forward, right, up, t, eye };
}

/** Where a direction on the dome shows in the Inside view (frame UV, y-up), or null behind the camera. */
export function insideViewPoint(dir: Vec3, camera: DomeCamera, aspect: number): Vec2 | null {
  const { forward, right, up, t, eye } = cameraBasis(camera);
  const v = sub(normalize(dir), eye);
  const z = dot(v, forward);
  if (z <= 0.01) return null;
  const x = dot(v, right) / z;
  const y = dot(v, up) / z;
  return { x: (x / (t * aspect) + 1) * 0.5, y: (y / t + 1) * 0.5 };
}

/** The direction (from the dome's center) of the dome point the Inside view shows at frame UV `uv` (y-up). */
export function insideViewDirection(uv: Vec2, camera: DomeCamera, aspect: number): Vec3 {
  const { forward, right, up, t, eye } = cameraBasis(camera);
  const x = (uv.x * 2 - 1) * t * aspect;
  const y = (uv.y * 2 - 1) * t;
  const ray = normalize(add(forward, add(scale(right, x), scale(up, y))));
  // Leaving the unit sphere from inside it.
  const b = dot(eye, ray);
  const c = dot(eye, eye) - 1;
  const along = -b + Math.sqrt(Math.max(b * b - c, 0));
  return normalize(add(eye, scale(ray, along)));
}

// ─── Projectors around the dome ──────────────────────────────────────────
//
// A Screen can be one projector of a dome rig (OutputSlice.domeProjector).
// The dome is the unit sphere's upper part around the origin, in the same
// frame as above (z to the zenith, -y the front). A projector sits at a
// point inside it, aims somewhere and throws a frame `throw` degrees wide;
// the render core traces each of its pixels to the dome and shows what is
// there, blended with the other projectors where they overlap
// (dome_projector_view in heartbeat.wgsl).

export interface DomeProjector {
  enabled: boolean;
  /** Where it is mounted: around and up (degrees, as a direction from the
   *  dome's center) and how far out (0 the center, 1 the dome itself). */
  mountAzimuth: number;
  mountElevation: number;
  mountDistance: number;
  /** Where its lens points, and its turn about that axis (degrees). */
  aimAzimuth: number;
  aimElevation: number;
  roll: number;
  /** Horizontal throw angle (degrees). */
  throw: number;
  /** Vertical lens shift, in half frame heights (0 centered). */
  lensShift: number;
  /** The projector's frame, width over height (its native resolution). */
  aspect: number;
}

export const DEFAULT_DOME_PROJECTOR: DomeProjector = {
  enabled: true,
  mountAzimuth: 180,
  mountElevation: 0,
  mountDistance: 0.85,
  aimAzimuth: 0,
  aimElevation: 40,
  roll: 0,
  throw: 70,
  lensShift: 0,
  aspect: 16 / 9,
};

/** A projector as the core traces it: its lens position and basis, the
 *  tangents of half its frame across and up, and its lens shift in those. */
export interface ProjectorFrustum {
  position: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  tanX: number;
  tanY: number;
  shiftY: number;
}

export function projectorFrustum(p: DomeProjector, aspect = p.aspect): ProjectorFrustum {
  const position = scale(directionOf(p.mountAzimuth, p.mountElevation), Math.max(0, Math.min(0.99, p.mountDistance)));
  const forward = directionOf(p.aimAzimuth, p.aimElevation);
  const az = p.aimAzimuth * DEG;
  // As the Inside view's camera: across is the aim's own east, up follows.
  const east: Vec3 = [Math.cos(az), Math.sin(az), 0];
  const up0 = cross(forward, east);
  const rc = Math.cos(p.roll * DEG);
  const rs = Math.sin(p.roll * DEG);
  const right = add(scale(east, rc), scale(up0, rs));
  const up = sub(scale(up0, rc), scale(east, rs));
  const tanX = Math.tan(Math.max(1, Math.min(170, p.throw)) * DEG * 0.5);
  const tanY = tanX / Math.max(aspect, 0.01);
  return { position, right, up, forward, tanX, tanY, shiftY: p.lensShift * tanY };
}

/** Where a ray from a point inside the unit sphere leaves it, or null when it never does. */
export function sphereExit(origin: Vec3, dir: Vec3): Vec3 | null {
  const b = dot(origin, dir);
  const c = dot(origin, origin) - 1;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b + Math.sqrt(disc);
  if (t <= 0) return null;
  return normalize(add(origin, scale(dir, t)));
}

/** The dome point a projector pixel lands on (frame UV y-up), before the dome's own edge. */
export function projectorPixelDirection(f: ProjectorFrustum, uv: Vec2): Vec3 | null {
  const x = (uv.x * 2 - 1) * f.tanX;
  const y = (uv.y * 2 - 1) * f.tanY + f.shiftY;
  return sphereExit(f.position, normalize(add(f.forward, add(scale(f.right, x), scale(f.up, y)))));
}

/** Where a dome point sits in a projector's frame (UV y-up; inside when both are 0..1), or null behind it. */
export function projectorFramePoint(f: ProjectorFrustum, dir: Vec3): Vec2 | null {
  const v = sub(dir, f.position);
  const z = dot(v, f.forward);
  if (z <= 1e-4) return null;
  const x = dot(v, f.right) / z;
  const y = dot(v, f.up) / z;
  return { x: (x / f.tanX + 1) * 0.5, y: ((y - f.shiftY) / f.tanY + 1) * 0.5 };
}

/** The dome points along a projector frame's edge, for drawing its footprint. */
export function projectorFootprint(f: ProjectorFrustum, steps = 24): (Vec3 | null)[] {
  const ring: Vec2[] = [];
  for (let k = 0; k < steps; k++) ring.push({ x: k / steps, y: 0 });
  for (let k = 0; k < steps; k++) ring.push({ x: 1, y: k / steps });
  for (let k = 0; k < steps; k++) ring.push({ x: 1 - k / steps, y: 1 });
  for (let k = 0; k <= steps; k++) ring.push({ x: 0, y: 1 - k / steps });
  return ring.map((uv) => projectorPixelDirection(f, uv));
}

/**
 * Aim a projector at a region of the dome and size its throw to cover it:
 * aimed at the middle of the region as seen from the mount, as wide as its
 * widest point needs, with the lens shift that centers it vertically.
 * `region` are dome points over the region.
 */
export function fitProjector(
  mount: Pick<DomeProjector, 'mountAzimuth' | 'mountElevation' | 'mountDistance'>,
  region: Vec3[],
  aspect: number,
  margin = 1.04,
): DomeProjector {
  const position = scale(directionOf(mount.mountAzimuth, mount.mountElevation), mount.mountDistance);
  let mean: Vec3 = [0, 0, 0];
  for (const point of region) mean = add(mean, normalize(sub(point, position)));
  const { azimuth, elevation } = azElOf(normalize(mean));
  const base: DomeProjector = { ...DEFAULT_DOME_PROJECTOR, ...mount, aimAzimuth: azimuth, aimElevation: elevation, roll: 0, throw: 60, lensShift: 0, aspect };
  const f = projectorFrustum(base, aspect);
  let maxX = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of region) {
    const v = sub(point, position);
    const z = Math.max(dot(v, f.forward), 1e-3);
    maxX = Math.max(maxX, Math.abs(dot(v, f.right) / z));
    const y = dot(v, f.up) / z;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const halfY = (maxY - minY) / 2;
  const tanX = Math.max(maxX, halfY * aspect) * margin;
  const tanY = tanX / aspect;
  return {
    ...base,
    throw: Math.min(170, (2 * Math.atan(tanX)) / DEG),
    lensShift: (maxY + minY) / 2 / tanY,
  };
}

/** Dome points over a band of azimuth and elevation (degrees), edges and inside. */
export function domeRegion(az0: number, az1: number, el0: number, el1: number, n = 8): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      points.push(directionOf(az0 + ((az1 - az0) * i) / n, el0 + ((el1 - el0) * j) / n));
    }
  }
  return points;
}

/**
 * A ring of projectors around the dome, each mounted by the rim across
 * from the part it covers, plus one for the cap when `zenith`. Neighbours
 * overlap by `overlap` degrees for the blend; `top` is where the ring
 * stops and the cap starts.
 */
export function domeProjectorRing(
  count: number,
  zenith: boolean,
  aspect: number,
  { overlap = 12, top = zenith ? 60 : 90 }: { overlap?: number; top?: number } = {},
): DomeProjector[] {
  const n = Math.max(1, Math.min(8 - (zenith ? 1 : 0), Math.round(count)));
  const step = 360 / n;
  const ring = Array.from({ length: n }, (_, i) => {
    const az = i * step;
    return fitProjector(
      { mountAzimuth: az + 180, mountElevation: 0, mountDistance: 0.85 },
      domeRegion(az - step / 2 - overlap / 2, az + step / 2 + overlap / 2, 0, Math.min(90, top + overlap / 2)),
      aspect,
    );
  });
  if (!zenith) return ring;
  // The cap, from low at the back, looking up and forward.
  const cap = fitProjector(
    { mountAzimuth: 180, mountElevation: 0, mountDistance: 0.3 },
    domeRegion(-180, 180, top - overlap / 2, 90, 16),
    aspect,
  );
  return [...ring, cap];
}

/** The rig as the core reads it: every projector of the dome, in order, at most 8. */
export function domeRigPayload(projectors: { id: string; frustum: ProjectorFrustum }[], blendWidth: number, blendGamma: number) {
  return {
    blendWidth,
    blendGamma,
    projectors: projectors.slice(0, 8).map(({ id, frustum: f }) => ({
      id,
      frustum: [...f.position, f.tanX, ...f.right, f.tanY, ...f.up, f.shiftY, ...f.forward, 0],
    })),
  };
}

/** A stored projector, with anything missing or broken at its default. */
export function domeProjectorOf(stored: Partial<DomeProjector> | null | undefined): DomeProjector {
  const out = { ...DEFAULT_DOME_PROJECTOR };
  if (!stored || typeof stored !== 'object') return { ...out, enabled: false };
  for (const key of Object.keys(out) as (keyof DomeProjector)[]) {
    const value = stored[key];
    if (key === 'enabled') out.enabled = value === true;
    else if (typeof value === 'number' && Number.isFinite(value)) (out[key] as number) = value;
  }
  out.aspect = Math.max(0.25, Math.min(4, out.aspect));
  return out;
}
