/**
 * A room scan for the desktop's Depth mode, from an auto-map with LiDAR.
 *
 * The auto-map gives, for every depth cell, where it is in the room (the
 * LiDAR, meters) and which projector pixel lands there (the stripes). The
 * desktop's Depth mode (scene3d/roomPhone.ts on the desktop) solves the
 * projector from those pairs and fits one face per surface, so for each
 * surface this sends its outline on the output and a few thousand of its
 * cells as `{ p, uv }`, plus which way gravity points:
 *
 *   down     gravity, a unit vector in the same frame as every `p`
 *   p        meters, in the upright camera frame the scan was measured in
 *            (x right, y down, z forward, as meshMap.ts): rigid, so any
 *            frame does as long as `down` is in it too
 *   uv       0..1 of the desktop OUTPUT, origin top-left, y down: the
 *            projector pixel through the Screen's place in the output
 *   outline  the same, simplified to the desktop's limit (not truncated)
 *
 * Gravity comes from the ARKit pose of the depth frame. ARKit's world is
 * gravity-aligned (+Y up); its camera frame is the sensor's landscape image
 * with x right, y up, z towards the viewer, while meshMap's is x right, y
 * down, z forward (the flip of y and z), and the scan was then turned upright
 * by `turn` degrees clockwise (lidarScan.ts turnRaster): both are applied
 * here, in that order.
 *
 * Pure: no DOM. Tested with a synthetic room in depthCapture.test.ts.
 */
import type { ScanGrid } from './meshMap';
import { simplifyClosed } from './meshMap';
import type { UV } from './structuredLight';
import { DEPTH_CAPTURE_LIMITS, type DepthCaptureLimits } from './desktopCapabilities';

export type Vec3 = [number, number, number];
export type Turn = 0 | 90 | 180 | 270;
export type CaptureSample = { p: Vec3; uv: UV };
export type DepthCaptureSurface = { id: string; name: string; outline: UV[]; samples: CaptureSample[] };
/** What `studio_depth_capture_offer` carries and what the desktop's "Open a depth capture" reads. */
export type DepthCapture = {
  version: 1;
  down: Vec3;
  surfaces: DepthCaptureSurface[];
  source: { device: string; screen: { id: string; width: number; height: number }; capturedAt: string };
};
/** Where a Screen's picture sits in the desktop output (0..1). The whole output when not known. */
export type OutputRegion = { x: number; y: number; width: number; height: number };
export const FULL_OUTPUT: OutputRegion = { x: 0, y: 0, width: 1, height: 1 };

export type CaptureReport = {
  surfaces: number;
  samples: number;
  /** Share of the output inside the surfaces' outlines. */
  coverage: number;
  /** Surfaces left out: too few measured cells, or past the desktop's limit. */
  dropped: number;
  bytes: number;
};

/** A camera-frame direction turned with the picture: the scan was turned clockwise by `turn` (see lidarScan.ts). */
export function turnVector(v: Vec3, turn: Turn): Vec3 {
  const [x, y, z] = v;
  if (turn === 90) return [-y, x, z];
  if (turn === 180) return [-x, -y, z];
  if (turn === 270) return [y, -x, z];
  return [x, y, z];
}

/**
 * Gravity in the scan's frame, from the ARKit camera transform (4×4,
 * column-major, camera to world) and the turn that made the picture upright.
 */
export function gravityInScan(pose: ArrayLike<number>, turn: Turn): Vec3 {
  // World down (0, −1, 0) in ARKit's camera frame is −(the world Y row of R), i.e. Rᵀ·(0, −1, 0).
  const ark: Vec3 = [-pose[1], -pose[5], -pose[9]];
  // ARKit camera (y up, z back) to meshMap's (y down, z forward).
  const native: Vec3 = [ark[0], -ark[1], -ark[2]];
  const len = Math.hypot(...native) || 1;
  return turnVector([native[0] / len, native[1] / len, native[2] / len], turn);
}

const inside = (points: UV[], x: number, y: number) => {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};
const shrink = (points: UV[], k: number): UV[] => {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length, cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  return points.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
};
const round = (v: number, d: number) => Math.round(v * d) / d;

export type CaptureSurfaceInput = {
  id: string;
  name: string;
  /** The outline on the scan's photo (normalised, top-left origin). */
  photo: UV[];
  /** The same outline in the projector's picture (normalised), when the auto-map fitted it. */
  projector?: UV[];
};

export type CaptureInput = {
  grid: ScanGrid;
  /** The Screen the stripes were shown on: its pixel size and where its picture sits in the output. */
  screen: { id: string; width: number; height: number; region?: OutputRegion };
  surfaces: CaptureSurfaceInput[];
  down: Vec3;
  limits?: DepthCaptureLimits;
  device?: string;
  capturedAt?: string;
};

/** Every n-th cell on a coarser lattice first (spatially even), then every k-th of what is left. */
export function resampleEvenly<T extends { i: number; j: number }>(cells: T[], budget: number): T[] {
  if (cells.length <= budget) return cells;
  if (budget <= 0) return [];
  const step = Math.max(1, Math.floor(Math.sqrt(cells.length / budget)));
  let kept = step > 1 ? cells.filter((c) => c.i % step === 0 && c.j % step === 0) : cells;
  if (kept.length < budget) kept = cells;
  if (kept.length <= budget) return kept;
  const out: T[] = [];
  for (let k = 0; k < budget; k++) out.push(kept[Math.min(kept.length - 1, Math.floor(((k + 0.5) * kept.length) / budget))]);
  return out;
}

/** Share of the output inside any of the outlines, on a 64 × 36 lattice. */
export function outputCoverage(outlines: UV[][]): number {
  let hit = 0;
  const W = 64, H = 36;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = (i + 0.5) / W, y = (j + 0.5) / H;
    if (outlines.some((o) => o.length >= 3 && inside(o, x, y))) hit++;
  }
  return hit / (W * H);
}

/** The room scan for Depth mode from one projector's auto-map with depth. Throws a plain message when nothing usable was measured. */
export function buildDepthCapture(input: CaptureInput): { capture: DepthCapture; report: CaptureReport } {
  const { grid, screen } = input;
  const limits = input.limits ?? DEPTH_CAPTURE_LIMITS;
  const region = screen.region ?? FULL_OUTPUT;
  const toOutput = (px: number, py: number): UV => ({
    x: region.x + (px / screen.width) * region.width,
    y: region.y + (py / screen.height) * region.height,
  });
  // Where each measured cell is in the projector's picture, for outlines the auto-map did not fit.
  const measured: number[] = [];
  for (let g = 0; g < grid.width * grid.height; g++) if (grid.hasProj[g]) measured.push(g);
  const nearestProjector = (p: UV): UV | null => {
    let best = -1, reach = Infinity;
    const x = p.x * grid.width - 0.5, y = p.y * grid.height - 0.5;
    for (const g of measured) {
      const d = (g % grid.width - x) ** 2 + (Math.floor(g / grid.width) - y) ** 2;
      if (d < reach) { reach = d; best = g; }
    }
    return best < 0 ? null : { x: grid.proj[best * 2] / screen.width, y: grid.proj[best * 2 + 1] / screen.height };
  };

  type Cell = { i: number; j: number; g: number };
  const found: { input: CaptureSurfaceInput; cells: Cell[]; outline: UV[] }[] = [];
  let dropped = 0;
  for (const s of input.surfaces) {
    if (s.photo.length < 3) { dropped++; continue; }
    // A little inside the outline: its edge cells straddle two surfaces.
    const inner = shrink(s.photo, 0.93);
    const cells: Cell[] = [];
    for (let j = 0; j < grid.height; j++) for (let i = 0; i < grid.width; i++) {
      const g = j * grid.width + i;
      if (grid.hasXyz[g] && grid.hasProj[g] && inside(inner, (i + 0.5) / grid.width, (j + 0.5) / grid.height)) cells.push({ i, j, g });
    }
    const projector = s.projector && s.projector.length >= 3 ? s.projector : s.photo.map(nearestProjector).filter((p): p is UV => !!p);
    if (cells.length < 6 || projector.length < 3) { dropped++; continue; }
    const outline = projector.map((p) => {
      const o = toOutput(p.x * screen.width, p.y * screen.height);
      return { x: round(o.x, 1e5), y: round(o.y, 1e5) };
    });
    found.push({ input: s, cells, outline: simplifyClosed(outline, limits.maxOutline) });
  }
  // The biggest surfaces when there are more than the desktop takes.
  found.sort((a, b) => b.cells.length - a.cells.length);
  if (found.length > limits.maxSurfaces) { dropped += found.length - limits.maxSurfaces; found.length = limits.maxSurfaces; }
  if (!found.length) throw new Error('No surface had enough depth and stripe readings. Dim the room, move the phone within about 4 m and scan again.');

  const device = input.device ?? 'iPhone';
  const build = (scale: number) => {
    const total = found.reduce((n, f) => n + f.cells.length, 0);
    const share = Math.min(1, limits.maxSamplesTotal / total) * scale;
    const surfaces: DepthCaptureSurface[] = found.map((f) => {
      const budget = Math.max(6, Math.min(limits.maxSamplesPerSurface, Math.floor(f.cells.length * share)));
      return {
        id: f.input.id,
        name: f.input.name.slice(0, 80) || 'Surface',
        outline: f.outline,
        samples: resampleEvenly(f.cells, budget).map(({ g }) => {
          const uv = toOutput(grid.proj[g * 2], grid.proj[g * 2 + 1]);
          return {
            p: [round(grid.xyz[g * 3], 1e4), round(grid.xyz[g * 3 + 1], 1e4), round(grid.xyz[g * 3 + 2], 1e4)] as Vec3,
            uv: { x: round(uv.x, 1e5), y: round(uv.y, 1e5) },
          };
        }),
      };
    });
    // The six-per-surface floor can tip the total over: trim the largest.
    let over = surfaces.reduce((n, s) => n + s.samples.length, 0) - limits.maxSamplesTotal;
    for (const s of surfaces) {
      if (over <= 0) break;
      const cut = Math.min(over, s.samples.length - 6);
      if (cut > 0) { s.samples = resampleEvenly(s.samples.map((x, k) => ({ ...x, i: k, j: 0 })), s.samples.length - cut).map(({ p, uv }) => ({ p, uv })); over -= cut; }
    }
    const capture: DepthCapture = {
      version: 1,
      down: input.down.map((v) => round(v, 1e6)) as Vec3,
      surfaces,
      source: { device, screen: { id: screen.id, width: screen.width, height: screen.height }, capturedAt: input.capturedAt ?? new Date().toISOString() },
    };
    return capture;
  };
  let scale = 1, capture = build(scale), bytes = JSON.stringify(capture).length;
  while (bytes > limits.maxBytes && scale > 0.01) {
    scale *= Math.max(0.3, (limits.maxBytes / bytes) * 0.95);
    capture = build(scale);
    bytes = JSON.stringify(capture).length;
  }
  if (bytes > limits.maxBytes) throw new Error('The scan is too large to send. Scan fewer surfaces.');
  return {
    capture,
    report: {
      surfaces: capture.surfaces.length,
      samples: capture.surfaces.reduce((n, s) => n + s.samples.length, 0),
      coverage: outputCoverage(capture.surfaces.map((s) => s.outline)),
      dropped,
      bytes,
    },
  };
}

/** The file the desktop's "Open a depth capture" reads. */
export const DEPTH_CAPTURE_FILE = 'Room-scan.ghostdepth.json';
