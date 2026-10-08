// Framing box that ignores stray points.
//
// Every point cloud consumer recentres on a box and scales its largest side to
// a fixed working size. With the raw min/max box, ONE far point (a reflection,
// a stray reading, a marker left in a third-party export) shrinks the whole
// cloud and pushes it off centre. This box is built from the bulk of the cloud
// instead. All points are kept: strays simply fall outside the frame.
//
// How: per axis, take the 1st and 99th percentile of a bounded sample, widen
// that core range by 25% of its length on each side, and call everything inside
// all three ranges an inlier. The frame is the exact min/max of the inliers
// over ALL points, so a clean cloud (nothing outside the widened range) gets
// exactly its raw bounding box, bit for bit.

export interface RobustFrame {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  center: { x: number; y: number; z: number };
  /** Largest side of the frame. */
  size: number;
  /** Points outside the frame (kept, just not framed). */
  outliers: number;
}

export const ROBUST_FRAME_LOW_PERCENTILE = 0.01;
export const ROBUST_FRAME_HIGH_PERCENTILE = 0.99;
export const ROBUST_FRAME_PAD = 0.25;
export const ROBUST_FRAME_SAMPLE_LIMIT = 200_000;
/** Below this the percentiles mean nothing: use the raw box. */
export const ROBUST_FRAME_MIN_POINTS = 200;

type Coord = (index: number, axis: 0 | 1 | 2) => number;

function emptyFrame(): RobustFrame {
  return {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 },
    center: { x: 0, y: 0, z: 0 },
    size: 0,
    outliers: 0,
  };
}

function axisGate(sample: Float32Array, used: number): [number, number] {
  const sorted = sample.subarray(0, used).sort();
  const lo = sorted[Math.floor((used - 1) * ROBUST_FRAME_LOW_PERCENTILE)];
  const hi = sorted[Math.ceil((used - 1) * ROBUST_FRAME_HIGH_PERCENTILE)];
  const pad = (hi - lo) * ROBUST_FRAME_PAD;
  return [lo - pad, hi + pad];
}

export function computeRobustFrame(count: number, coord: Coord): RobustFrame {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return emptyFrame();

  let gx: [number, number] = [-Infinity, Infinity];
  let gy: [number, number] = [-Infinity, Infinity];
  let gz: [number, number] = [-Infinity, Infinity];
  if (n >= ROBUST_FRAME_MIN_POINTS) {
    const sampleCount = Math.min(n, ROBUST_FRAME_SAMPLE_LIMIT);
    const xs = new Float32Array(sampleCount);
    const ys = new Float32Array(sampleCount);
    const zs = new Float32Array(sampleCount);
    let used = 0;
    for (let s = 0; s < sampleCount; s++) {
      const i = sampleCount === n ? s : Math.min(n - 1, Math.floor((s * n) / sampleCount));
      const x = coord(i, 0), y = coord(i, 1), z = coord(i, 2);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      xs[used] = x; ys[used] = y; zs[used] = z;
      used++;
    }
    if (used >= ROBUST_FRAME_MIN_POINTS) {
      gx = axisGate(xs, used);
      gy = axisGate(ys, used);
      gz = axisGate(zs, used);
    }
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let inliers = 0;
  for (let i = 0; i < n; i++) {
    const x = coord(i, 0), y = coord(i, 1), z = coord(i, 2);
    // Written so NaN fails every test and is left out.
    if (!(x >= gx[0] && x <= gx[1] && y >= gy[0] && y <= gy[1] && z >= gz[0] && z <= gz[1])) continue;
    inliers++;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (inliers === 0) return emptyFrame();
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
    size: Math.max(maxX - minX, maxY - minY, maxZ - minZ),
    outliers: n - inliers,
  };
}

/** Frame of the first `count` xyz triples of a packed position array. */
export function robustFrameFromPositions(positions: ArrayLike<number>, count: number): RobustFrame {
  return computeRobustFrame(count, (i, axis) => positions[i * 3 + axis]);
}

/** Frame of parsed PLY vertices. */
export function robustFrameFromVertices(
  vertices: ReadonlyArray<{ x: number; y: number; z: number }>,
): RobustFrame {
  return computeRobustFrame(vertices.length, (i, axis) => {
    const v = vertices[i];
    return axis === 0 ? v.x : axis === 1 ? v.y : v.z;
  });
}
