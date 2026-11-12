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

/** Where the Inside view looks: degrees, the field of view vertical. */
export interface DomeCamera {
  azimuth: number;
  elevation: number;
  fov: number;
}

/** The camera's basis, as dome_inside_view in heartbeat.wgsl builds it. */
function cameraBasis(camera: DomeCamera) {
  const yaw = camera.azimuth * DEG;
  const pitch = camera.elevation * DEG;
  const forward: Vec3 = [Math.cos(pitch) * Math.sin(yaw), -Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch)];
  const right: Vec3 = [Math.cos(yaw), Math.sin(yaw), 0];
  const up = cross(forward, right);
  const t = Math.tan(Math.max(camera.fov, 1) * DEG * 0.5);
  return { forward, right, up, t };
}

/** Where a direction shows in the Inside view (frame UV, y-up), or null behind the camera. */
export function insideViewPoint(dir: Vec3, camera: DomeCamera, aspect: number): Vec2 | null {
  const { forward, right, up, t } = cameraBasis(camera);
  const z = dot(dir, forward);
  if (z <= 0.01) return null;
  const x = dot(dir, right) / z;
  const y = dot(dir, up) / z;
  return { x: (x / (t * aspect) + 1) * 0.5, y: (y / t + 1) * 0.5 };
}

/** The direction the Inside view shows at frame UV `uv` (y-up). */
export function insideViewDirection(uv: Vec2, camera: DomeCamera, aspect: number): Vec3 {
  const { forward, right, up, t } = cameraBasis(camera);
  const x = (uv.x * 2 - 1) * t * aspect;
  const y = (uv.y * 2 - 1) * t;
  return normalize(add(forward, add(scale(right, x), scale(up, y))));
}
